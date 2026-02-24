// server/database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'finance.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Accounts represent each CSV source file
    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      type        TEXT    NOT NULL CHECK(type IN ('credit_card','checking','savings','investment','asset','liability')),
      currency    TEXT    NOT NULL DEFAULT 'CAD',
      balance     REAL    NOT NULL DEFAULT 0,
      is_manual   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Categories (system + user-defined)
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      parent_id   INTEGER REFERENCES categories(id),
      color       TEXT    NOT NULL DEFAULT '#6366f1',
      icon        TEXT,
      is_system   INTEGER NOT NULL DEFAULT 0
    );

    -- Categorization rules engine
    CREATE TABLE IF NOT EXISTS rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword       TEXT    NOT NULL,
      match_type    TEXT    NOT NULL DEFAULT 'contains_case_insensitive',
      category_id   INTEGER NOT NULL REFERENCES categories(id),
      priority      INTEGER NOT NULL DEFAULT 10,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Core transactions table
    CREATE TABLE IF NOT EXISTS transactions (
      id            TEXT    PRIMARY KEY,
      account_id    INTEGER NOT NULL REFERENCES accounts(id),
      date          TEXT    NOT NULL,
      description   TEXT    NOT NULL,
      amount        REAL    NOT NULL,
      category_id   INTEGER REFERENCES categories(id),
      tags          TEXT    NOT NULL DEFAULT '[]',
      notes         TEXT,
      is_transfer   INTEGER NOT NULL DEFAULT 0,
      is_recurring  INTEGER NOT NULL DEFAULT 0,
      reviewed      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Split transactions (child rows that sum to a parent transaction)
    CREATE TABLE IF NOT EXISTS transaction_splits (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id  TEXT    NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id     INTEGER NOT NULL REFERENCES categories(id),
      amount          REAL    NOT NULL,
      notes           TEXT
    );

    -- Monthly budgets per category
    CREATE TABLE IF NOT EXISTS budgets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id   INTEGER NOT NULL REFERENCES categories(id),
      month         TEXT    NOT NULL,   -- YYYY-MM
      amount        REAL    NOT NULL,
      rollover      INTEGER NOT NULL DEFAULT 0,
      rollover_amount REAL  NOT NULL DEFAULT 0,
      UNIQUE(category_id, month)
    );

    -- Manual bills / subscriptions
    CREATE TABLE IF NOT EXISTS bills (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      amount        REAL    NOT NULL,
      due_day       INTEGER NOT NULL,   -- day of month (1-31)
      frequency     TEXT    NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('monthly','weekly','annual','once')),
      category_id   INTEGER REFERENCES categories(id),
      account_id    INTEGER REFERENCES accounts(id),
      is_active     INTEGER NOT NULL DEFAULT 1,
      last_paid     TEXT,
      next_due      TEXT,
      notes         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Net worth snapshots
    CREATE TABLE IF NOT EXISTS net_worth_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      total_assets      REAL NOT NULL DEFAULT 0,
      total_liabilities REAL NOT NULL DEFAULT 0,
      net_worth         REAL NOT NULL DEFAULT 0,
      snapshot_data     TEXT NOT NULL DEFAULT '{}'  -- JSON breakdown
    );

    -- Manual assets (home value, car, etc.)
    CREATE TABLE IF NOT EXISTS manual_assets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'asset' CHECK(type IN ('asset','liability')),
      value       REAL    NOT NULL,
      notes       TEXT,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Detected recurring transactions
    CREATE TABLE IF NOT EXISTS recurring_patterns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      description_pattern TEXT NOT NULL,
      avg_amount      REAL NOT NULL,
      frequency_days  INTEGER NOT NULL DEFAULT 30,
      category_id     INTEGER REFERENCES categories(id),
      last_seen       TEXT,
      confirmed       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date       ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_account    ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_category   ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_month           ON budgets(month);

    CREATE TABLE IF NOT EXISTS import_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT    NOT NULL CHECK(source IN ('csv','pdf')),
      account_id      INTEGER REFERENCES accounts(id),
      account_name    TEXT    NOT NULL,
      file_name       TEXT    NOT NULL,
      imported_count  INTEGER NOT NULL DEFAULT 0,
      total_count     INTEGER NOT NULL DEFAULT 0,
      from_date       TEXT,
      to_date         TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_import_runs_created_at  ON import_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_import_runs_account     ON import_runs(account_name, created_at);
  `);

  // Safe migrations — run every startup, ignored if column already exists
  const migrations = [
  `ALTER TABLE transactions ADD COLUMN is_income_override INTEGER DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN exclude_from_totals INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN merchant_name TEXT`,
    `ALTER TABLE categories ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* column already exists — fine */ }
  }

  // Income sources table — user-defined merchant keywords that count as income
  db.exec(`
    CREATE TABLE IF NOT EXISTS income_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword     TEXT    NOT NULL,
      match_type  TEXT    NOT NULL DEFAULT 'contains',
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Auto-flag any category named Income as is_income=1
  db.prepare(`UPDATE categories SET is_income = 1 WHERE UPPER(name) LIKE '%INCOME%' AND is_income = 0`).run();

  // Seed default accounts
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (name, type, currency) VALUES (?, ?, ?)
  `);
  insertAccount.run('BMO CAD Credit Card', 'credit_card', 'CAD');
  insertAccount.run('BMO US Credit Card', 'credit_card', 'USD');
  insertAccount.run('TD CAD Credit Card', 'credit_card', 'CAD');
  insertAccount.run('TD CAD Checking', 'checking', 'CAD');

  const catCount = db.prepare(`SELECT COUNT(*) as n FROM categories`).get().n;
  if (catCount === 0) {
    const insertCategory = db.prepare(`
      INSERT INTO categories (name, color, is_system, is_income)
      VALUES (?, ?, 1, ?)
    `);
    const starter = [
      ['Income', '#10b981', 1],
      ['Groceries', '#14b8a6', 0],
      ['Dining', '#f59e0b', 0],
      ['Housing', '#8b5cf6', 0],
      ['Transport', '#3b82f6', 0],
      ['Shopping', '#ec4899', 0],
      ['Utilities', '#06b6d4', 0],
      ['Healthcare', '#22c55e', 0],
      ['Travel', '#a855f7', 0],
      ['Savings', '#6366f1', 0],
    ];
    starter.forEach(([name, color, isIncome]) => insertCategory.run(name, color, isIncome));
  }
}

module.exports = { getDb };
