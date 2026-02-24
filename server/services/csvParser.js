// server/services/csvParser.js
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { categorize } = require('./categorizer');

const ACCOUNT_MAP = {
  'BMO_CAD_CC_MASTER_TRANSACTIONS.csv': 'BMO CAD Credit Card',
  'BMO_US_CC_MASTER_TRANSACTIONS.csv': 'BMO US Credit Card',
  'TD_CAD_CC_MASTER_TRANSACTIONS.csv': 'TD CAD Credit Card',
  'TD_CAD_Checking_MASTER_TRANSACTIONS.csv': 'TD CAD Checking',
};

// Fuzzy match: try to identify account from partial filename
function guessAccountFromFilename(filename) {
  const f = filename.toUpperCase();
  if (ACCOUNT_MAP[filename]) return ACCOUNT_MAP[filename];
  // Partial keyword matching
  if (f.includes('BMO') && (f.includes('US') || f.includes('USD'))) return 'BMO US Credit Card';
  if (f.includes('BMO') && (f.includes('CAD') || f.includes('CC') || f.includes('CREDIT'))) return 'BMO CAD Credit Card';
  if (f.includes('TD') && f.includes('CHECK')) return 'TD CAD Checking';
  if (f.includes('TD') && (f.includes('CC') || f.includes('CREDIT') || f.includes('VISA'))) return 'TD CAD Credit Card';
  if (f.includes('TD') && f.includes('CAD') && !f.includes('CC')) return 'TD CAD Checking';
  return null; // unrecognized
}

/**
 * Parse raw CSV buffer/string into normalized transaction objects.
 * All four source files share: Date, Description, Amount
 */
function parseCSV(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  return records.map(row => {
    // Normalize date to YYYY-MM-DD
    let date = row['Date'] || row['date'] || '';
    date = normalizeDate(date);

    const description = (row['Description'] || row['description'] || '').trim();
    const rawAmount = row['Amount'] || row['amount'] || '0';
    const amount = parseFloat(String(rawAmount).replace(/[,$]/g, ''));

    return { date, description, amount };
  }).filter(r => r.date && r.description);
}

function normalizeDate(raw) {
  if (!raw) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  // DD-Mon-YYYY or similar — try JS Date
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return raw;
}

/**
 * Import transactions from a CSV file into the database.
 * Deduplicates by (account_id, date, description, amount).
 */
function importCSV(filename, buffer, accountNameOverride) {
  const db = getDb();
  const accountName = accountNameOverride || guessAccountFromFilename(filename);

  if (!accountName) throw new Error(`Cannot determine account for file "${filename}". Please rename it to match: TD_CAD_Checking_MASTER_TRANSACTIONS.csv, BMO_CAD_CC_MASTER_TRANSACTIONS.csv, etc.`);

  const account = db.prepare(`SELECT id FROM accounts WHERE name = ?`).get(accountName);
  if (!account) throw new Error(`Account not found: "${accountName}"`);

  const rows = parseCSV(buffer);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, date, description, amount, category_id, tags)
    VALUES (?, ?, ?, ?, ?, ?, '[]')
  `);

  const checkDup = db.prepare(`
    SELECT id FROM transactions
    WHERE account_id = ? AND date = ? AND description = ? AND amount = ?
  `);

  let imported = 0;
  let skipped = 0;

  const bulk = db.transaction(() => {
    for (const row of rows) {
      const existing = checkDup.get(account.id, row.date, row.description, row.amount);
      if (existing) { skipped++; continue; }

      const catResult = categorize(row.description);
      const txId = uuidv4();
      insert.run(txId, account.id, row.date, row.description, row.amount,
        catResult ? catResult.category_id : null);
      imported++;
    }
  });

  bulk();

  // Update account balance (sum of all transactions for this account)
  const balance = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as bal FROM transactions WHERE account_id = ?
  `).get(account.id);

  db.prepare(`UPDATE accounts SET balance = ? WHERE id = ?`).run(balance.bal, account.id);

  return { imported, skipped, total: rows.length, account: accountName };
}

module.exports = { importCSV, parseCSV, ACCOUNT_MAP, guessAccountFromFilename };
