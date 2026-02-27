// server/routes/pdf_import.js
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { spawn, execSync } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { applyRulesToTransactionInput, getCompiledRules } = require('../services/categorizer');
const { guessAccountFromFilename } = require('../services/csvParser');
const { recordImportRun } = require('../services/importHistory');
const { applyAccountStrategyToEvaluated } = require('../services/accountStrategies');
const {
  TD_CHECKING_ACCOUNT_ID,
  backfillTdCheckingRentalIncome,
} = require('../services/accountStrategies/tdCheckingRentalIncomeStrategy');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Cache the working python executable (avoid repeated probes)
let _pythonExe = null;

function findPython() {
  if (_pythonExe) return _pythonExe;
  if (process.env.PYTHON_PATH) { _pythonExe = process.env.PYTHON_PATH; return _pythonExe; }

  // On Windows python3 rarely exists; try python, py, python3 in order
  const candidates = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];

  for (const exe of candidates) {
    try {
      const out = execSync(`${exe} -c "import sys; print(sys.version)"`, {
        timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
      }).toString();
      if (out.trim()) { _pythonExe = exe; return exe; }
    } catch (_) { /* try next */ }
  }
  return 'python'; // last resort
}

// Run pdf_parser.py on a temp file, return parsed JSON
function parsePdf(buffer, filename, accountHint) {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(os.tmpdir(), `ledger_pdf_${Date.now()}_${filename}`);
    fs.writeFileSync(tmpPath, buffer);

    const parserPath = path.join(__dirname, '..', 'pdf_parser.py');
    const args = [parserPath, tmpPath];
    if (accountHint) args.push(accountHint);

    const py = spawn(findPython(), args, { timeout: 120000 });
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });

    py.on('close', (code) => {
      fs.unlink(tmpPath, () => {});
      const jsonStr = stdout.trim();
      if (!jsonStr) {
        reject(new Error(`PDF parser produced no output (exit ${code}). stderr: ${stderr.slice(0,300)}`));
        return;
      }
      try {
        resolve(JSON.parse(jsonStr));
      } catch (e) {
        reject(new Error(`PDF parser output was not valid JSON (exit ${code}): ${jsonStr.slice(0,200)}`));
      }
    });

    py.on('error', (err) => {
      fs.unlink(tmpPath, () => {});
      if (err.code === 'ENOENT') {
        _pythonExe = null; // reset cache
        reject(new Error('Python not found. Install Python 3 and ensure it is in your PATH.'));
      } else {
        reject(err);
      }
    });
  });
}

// POST /api/pdf-import/parse — parse PDF(s), return preview without importing
router.post('/parse', upload.array('files'), async (req, res) => {
  const results = [];
  for (const file of req.files) {
    const hint = req.body[`hint_${file.originalname}`] || req.body.hint || null;
    try {
      const parsed = await parsePdf(file.buffer, file.originalname, hint);
      results.push({
        filename: file.originalname,
        account:  parsed.account,
        count:    parsed.count,
        transactions: (parsed.transactions || []).slice(0, 5),
        total_count: parsed.count,
        error: parsed.error,
      });
    } catch (err) {
      results.push({ filename: file.originalname, error: err.message, count: 0 });
    }
  }
  res.json({ results });
});

// POST /api/pdf-import/import — parse + import into DB
router.post('/import', upload.array('files'), async (req, res) => {
  const db = getDb();
  const results = [];
  const errors  = [];

  for (const file of req.files) {
    const hint = req.body[`hint_${file.originalname}`] || req.body.hint || null;
    try {
      const parsed = await parsePdf(file.buffer, file.originalname, hint);
      if (parsed.error) { errors.push({ file: file.originalname, error: parsed.error }); continue; }

      let accountName = parsed.account || (hint ? hint : null) || guessAccountFromFilename(file.originalname);
      if (!accountName) {
        errors.push({ file: file.originalname, error: 'Could not determine account. Use the account selector.' });
        continue;
      }

      const account = db.prepare(`SELECT id FROM accounts WHERE name = ?`).get(accountName);
      if (!account) {
        errors.push({ file: file.originalname, error: `Account "${accountName}" not found in database.` });
        continue;
      }

      const insert = db.prepare(`
        INSERT INTO transactions
          (id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals, category_source, category_locked, tags_locked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const compiledRules = getCompiledRules({ includeLegacyTagRules: true });

      let imported = 0, skipped = 0;
      let fromDate = null, toDate = null;
      db.transaction(() => {
        for (const row of (parsed.transactions || [])) {
          if (!row.Date || !row.Description) { skipped++; continue; }
          const evaluated = applyRulesToTransactionInput({
            account_id: account.id,
            date: row.Date,
            description: row.Description,
            amount: row.Amount,
            category_id: null,
            tags: [],
            merchant_name: null,
            is_income_override: 0,
            exclude_from_totals: 0,
          }, {
            compiledRules,
            overwrite_category: true,
            overwrite_tags: true,
            overwrite_merchant: true,
            overwrite_flags: true,
          });
          const finalized = applyAccountStrategyToEvaluated({
            db,
            accountId: account.id,
            accountName,
            evaluated,
          });
          insert.run(
            uuidv4(),
            account.id,
            row.Date,
            row.Description,
            row.Amount,
            finalized.category_id ?? null,
            JSON.stringify(finalized.tags || []),
            finalized.merchant_name || null,
            finalized.is_income_override ? 1 : 0,
            finalized.exclude_from_totals ? 1 : 0,
            finalized.category_source || 'import_default',
            finalized.category_locked ? 1 : 0,
            finalized.tags_locked ? 1 : 0
          );
          imported++;
          if (!fromDate || row.Date < fromDate) fromDate = row.Date;
          if (!toDate || row.Date > toDate) toDate = row.Date;
        }
      })();

      if (Number(account.id) === TD_CHECKING_ACCOUNT_ID && fromDate && toDate) {
        backfillTdCheckingRentalIncome(db, {
          accountId: account.id,
          startDate: fromDate,
          endDate: toDate,
          dryRun: false,
        });
      }

      const bal = db.prepare(`SELECT COALESCE(SUM(amount),0) as b FROM transactions WHERE account_id = ?`).get(account.id);
      db.prepare(`UPDATE accounts SET balance = ? WHERE id = ?`).run(bal.b, account.id);

      recordImportRun({
        source: 'pdf',
        accountId: account.id,
        accountName,
        fileName: file.originalname,
        importedCount: imported,
        totalCount: parsed.count,
        fromDate,
        toDate,
      });

      results.push({ file: file.originalname, account: accountName, imported, skipped, total: parsed.count });
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  res.json({ results, errors, total_imported: results.reduce((s, r) => s + r.imported, 0) });
});

// GET /api/pdf-import/check-python — probe python + pdfplumber
router.get('/check-python', (req, res) => {
  const exe = findPython();
  const py = spawn(exe, ['-c', 'import pdfplumber; print("ok")']);
  let out = '', err = '';
  py.stdout.on('data', d => { out += d; });
  py.stderr.on('data', d => { err += d; });
  py.on('close', code => {
    const ok = code === 0 && out.includes('ok');
    if (!ok) _pythonExe = null; // reset so next request re-probes
    res.json({ ok, python: exe, stderr: err.slice(0, 200) });
  });
  py.on('error', () => {
    _pythonExe = null;
    res.json({ ok: false, error: 'Python not found in PATH', tried: exe });
  });
});

module.exports = router;
