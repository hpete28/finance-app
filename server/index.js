// server/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { getDb } = require('./database');
const { importCSV, ACCOUNT_MAP, guessAccountFromFilename } = require('./services/csvParser');
const { seedRulesFromJson, recategorizeAll, detectRecurring } = require('./services/categorizer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// File upload config (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Initialize DB ─────────────────────────────────────────────────────────────
getDb(); // Runs schema init

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/categories',   require('./routes/categories'));
app.use('/api/rules',        require('./routes/rules'));
app.use('/api/budgets',      require('./routes/budgets'));
app.use('/api/analytics', require('./routes/analytics_v2'));
app.use('/api/analytics', require('./routes/analytics_summary'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/bills',        require('./routes/bills'));
app.use('/api/networth',     require('./routes/networth'));
app.use('/api/income-sources', require('./routes/income_sources'));
app.use('/api/pdf-import',     require('./routes/pdf_import'));

// ─── Upload endpoint ────────────────────────────────────────────────────────────
app.post('/api/upload/transactions', upload.array('files'), async (req, res) => {
  const results = [];
  const errors  = [];

  for (const file of req.files) {
    try {
      const guessedAccount = guessAccountFromFilename(file.originalname);
      const result = await importCSV(file.originalname, file.buffer);
      results.push({ ...result, guessedAccount, originalFilename: file.originalname });
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  res.json({ results, errors, total_imported: results.reduce((s, r) => s + r.imported, 0) });
});

// ─── Upload categorization rules JSON ──────────────────────────────────────────
app.post('/api/upload/rules', upload.single('file'), (req, res) => {
  try {
    const rulesJson = JSON.parse(req.file.buffer.toString());
    seedRulesFromJson(rulesJson);
    const count = recategorizeAll(false);
    res.json({ ok: true, categorized: count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Seed rules from bundled JSON (call once on first run) ─────────────────────
app.post('/api/setup/seed-rules', (req, res) => {
  try {
    const rulesPath = path.join(__dirname, 'default_rules.json');
    if (fs.existsSync(rulesPath)) {
      const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      seedRulesFromJson(rulesJson);
    }
    const count = recategorizeAll(false);
    res.json({ ok: true, categorized: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const db = getDb();
  const stats = {
    transactions: db.prepare('SELECT COUNT(*) as n FROM transactions').get().n,
    categories:   db.prepare('SELECT COUNT(*) as n FROM categories').get().n,
    rules:        db.prepare('SELECT COUNT(*) as n FROM rules').get().n,
    accounts:     db.prepare('SELECT COUNT(*) as n FROM accounts').get().n,
  };
  res.json({ ok: true, stats });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`\n🚀 Finance API running at http://localhost:${PORT}`);
  console.log(`   Endpoints: /api/transactions, /api/budgets, /api/analytics, /api/bills, /api/networth`);
});
