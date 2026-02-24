// server/migrations/003_performance_indexes.js
// Run once: node server/migrations/003_performance_indexes.js
// Or integrate into database.js initSchema() — see patch below.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Running migration: 003_performance_indexes');

db.exec(`
  -- ── Core query patterns: transactions by date (most frequent filter) ─────
  CREATE INDEX IF NOT EXISTS idx_transactions_date
    ON transactions(date DESC);

  -- ── Analytics: spending by category+month ────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_cat_date
    ON transactions(category_id, date);

  -- ── Analytics: income flag queries (amount sign) ─────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_amount_date
    ON transactions(amount, date);

  -- ── Analytics: per-account queries ───────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_account_date
    ON transactions(account_id, date DESC);

  -- ── Merchant concentration queries ───────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_merchant
    ON transactions(merchant_name, date);

  -- ── Exclude flag (exclude_from_totals = 0 is the common case) ────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_exclude_date
    ON transactions(exclude_from_totals, date DESC);

  -- ── Transfer flag ─────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_transfer
    ON transactions(is_transfer, date);

  -- ── Recurring flag ────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_transactions_recurring
    ON transactions(is_recurring, date);

  -- ── Budget lookups ────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_budgets_category
    ON budgets(category_id);

  -- ── Net worth snapshots by date ───────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_networth_snapshots_date
    ON net_worth_snapshots(snapshot_date DESC);

  -- ── Category rules priority ───────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_rules_priority
    ON rules(priority DESC, category_id);

  -- ── Recurring patterns ────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_recurring_patterns_merchant
    ON recurring_patterns(description_pattern);
`);

// ── Monthly summary table (materialized view pattern) ─────────────────────────
// Rebuild on import or on-demand via POST /api/analytics/refresh-summary
db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_summary (
    month       TEXT NOT NULL,
    account_id  INTEGER,
    income      REAL NOT NULL DEFAULT 0,
    expenses    REAL NOT NULL DEFAULT 0,
    net         REAL GENERATED ALWAYS AS (income - expenses) VIRTUAL,
    tx_count    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (month, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_summary_month
    ON monthly_summary(month DESC);
`);

console.log('✓ Indexes created');
console.log('✓ monthly_summary table created');

// ── ANALYZE to update query planner statistics ─────────────────────────────
db.exec('ANALYZE;');
console.log('✓ ANALYZE complete');

db.close();
console.log('\nMigration 003 complete. Add to database.js initSchema() to run automatically.');
