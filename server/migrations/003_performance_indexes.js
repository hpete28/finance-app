// server/migrations/003_performance_indexes.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Running migration: 003_performance_indexes');

// ── Core indexes ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_date
    ON transactions(date DESC);

  CREATE INDEX IF NOT EXISTS idx_transactions_cat_date
    ON transactions(category_id, date);

  CREATE INDEX IF NOT EXISTS idx_transactions_amount_date
    ON transactions(amount, date);

  CREATE INDEX IF NOT EXISTS idx_transactions_account_date
    ON transactions(account_id, date DESC);

  CREATE INDEX IF NOT EXISTS idx_transactions_merchant
    ON transactions(merchant_name, date);

  CREATE INDEX IF NOT EXISTS idx_transactions_exclude_date
    ON transactions(exclude_from_totals, date DESC);

  CREATE INDEX IF NOT EXISTS idx_transactions_recurring
    ON transactions(is_recurring, date);

  CREATE INDEX IF NOT EXISTS idx_budgets_category
    ON budgets(category_id);

  CREATE INDEX IF NOT EXISTS idx_rules_priority
    ON rules(priority DESC, category_id);
`);
console.log('✓ Transaction indexes created');

// ── net_worth_snapshots index (detect correct date column first) ──────────────
try {
  const cols = db.prepare(`PRAGMA table_info(net_worth_snapshots)`).all();
  const dateCol = cols.find(c =>
    ['snapshot_date', 'date', 'created_at', 'recorded_at'].includes(c.name)
  );
  if (dateCol) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_networth_snapshots_date
        ON net_worth_snapshots(${dateCol.name} DESC);
    `);
    console.log(`✓ Net worth snapshot index created on column: ${dateCol.name}`);
  } else {
    console.log('⚠  Skipped net_worth_snapshots index (no date column found)');
  }
} catch (e) {
  console.log('⚠  Skipped net_worth_snapshots index:', e.message);
}

// ── Monthly summary cache table ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_summary (
    month       TEXT    NOT NULL,
    account_id  INTEGER NOT NULL DEFAULT 0,
    income      REAL    NOT NULL DEFAULT 0,
    expenses    REAL    NOT NULL DEFAULT 0,
    tx_count    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (month, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_monthly_summary_month
    ON monthly_summary(month DESC);
`);
console.log('✓ monthly_summary table created');

// ── Update query planner stats ────────────────────────────────────────────────
db.exec('ANALYZE;');
console.log('✓ ANALYZE complete');

db.close();
console.log('\n✅ Migration 003 complete!');
