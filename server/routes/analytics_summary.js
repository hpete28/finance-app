// ── PATCH: Add this block to server/database.js inside initSchema(), ──────────
// after the existing table CREATE statements (end of the db.exec(` ... `); block)

// ── server/database.js — diff/patch snippet ───────────────────────────────────
// Find the closing backtick of the large db.exec(`...`) call in initSchema()
// and INSERT the following SQL before it:

const INDEX_SQL = `
  -- Performance indexes (idempotent — IF NOT EXISTS)
  CREATE INDEX IF NOT EXISTS idx_transactions_date           ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_cat_date       ON transactions(category_id, date);
  CREATE INDEX IF NOT EXISTS idx_transactions_amount_date    ON transactions(amount, date);
  CREATE INDEX IF NOT EXISTS idx_transactions_account_date   ON transactions(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_merchant       ON transactions(merchant_name, date);
  CREATE INDEX IF NOT EXISTS idx_transactions_exclude_date   ON transactions(exclude_from_totals, date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_recurring      ON transactions(is_recurring, date);
  CREATE INDEX IF NOT EXISTS idx_budgets_category            ON budgets(category_id);
  CREATE INDEX IF NOT EXISTS idx_networth_snapshots_date     ON net_worth_snapshots(snapshot_date DESC);
  CREATE INDEX IF NOT EXISTS idx_rules_priority              ON rules(priority DESC, category_id);

  -- Monthly summary (materialized cache, refreshed on import)
  CREATE TABLE IF NOT EXISTS monthly_summary (
    month       TEXT    NOT NULL,
    account_id  INTEGER NOT NULL DEFAULT 0,
    income      REAL    NOT NULL DEFAULT 0,
    expenses    REAL    NOT NULL DEFAULT 0,
    tx_count    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (month, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_summary_month ON monthly_summary(month DESC);
`;

// ── server/routes/analytics_summary.js ───────────────────────────────────────
// Mount as: app.use('/api/analytics', require('./routes/analytics_summary'));
// Provides POST /api/analytics/refresh-summary
// and upgrades /api/analytics/monthly-trend to use summary table when fresh

const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

// POST /api/analytics/refresh-summary
// Call after CSV import to rebuild the monthly_summary cache
router.post('/refresh-summary', (req, res) => {
  try {
    const db = getDb();

    // Rebuild from scratch (fast with indexes in place)
    db.exec(`DELETE FROM monthly_summary`);

    // Re-insert: one row per month × account
    const incomeCategories = db.prepare(`SELECT id FROM categories WHERE is_income = 1`).all();
    const incomeCatIds = incomeCategories.map(c => c.id);
    const incomeFlag = incomeCatIds.length
      ? `(t.is_income_override = 1 OR t.category_id IN (${incomeCatIds.join(',')}))`
      : `(t.is_income_override = 1)`;

    db.prepare(`
      INSERT OR REPLACE INTO monthly_summary (month, account_id, income, expenses, tx_count, updated_at)
      SELECT
        strftime('%Y-%m', t.date) as month,
        t.account_id,
        SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
        SUM(CASE WHEN t.amount < 0 AND NOT ${incomeFlag} THEN ABS(t.amount) ELSE 0 END) as expenses,
        COUNT(*) as tx_count,
        datetime('now')
      FROM transactions t
      WHERE t.exclude_from_totals = 0
        AND t.is_transfer = 0
      GROUP BY month, t.account_id
    `).run();

    // All-accounts rollup (account_id = 0)
    db.prepare(`
      INSERT OR REPLACE INTO monthly_summary (month, account_id, income, expenses, tx_count, updated_at)
      SELECT month, 0 as account_id, SUM(income), SUM(expenses), SUM(tx_count), datetime('now')
      FROM monthly_summary
      WHERE account_id != 0
      GROUP BY month
    `).run();

    const count = db.prepare(`SELECT COUNT(*) as n FROM monthly_summary`).get();
    res.json({ ok: true, rows: count.n, message: 'Monthly summary rebuilt' });
  } catch (err) {
    console.error('refresh-summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/monthly-trend-fast
// Uses monthly_summary for significantly faster response on large datasets
router.get('/monthly-trend-fast', (req, res) => {
  try {
    const db = getDb();
    const { months = 18, account_id } = req.query;
    const acctId = account_id ? parseInt(account_id) : 0;

    const rows = db.prepare(`
      SELECT month, income, expenses, income - expenses as net, tx_count
      FROM monthly_summary
      WHERE account_id = ?
      ORDER BY month DESC
      LIMIT ?
    `).all(acctId, parseInt(months));

    res.json(rows.reverse());
  } catch (err) {
    console.error('monthly-trend-fast error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ── ALSO: In server/index.js, after the CSV import completes, call refresh: ──
// After: results.push({ ...result, ... });
// Add:
//   try {
//     const { getDb } = require('./database');
//     // Trigger async summary refresh (fire and forget)
//     setImmediate(() => {
//       try { require('./routes/analytics_summary').refreshSummary(getDb()); }
//       catch(e) { console.warn('summary refresh failed:', e.message); }
//     });
//   } catch(e) {}
