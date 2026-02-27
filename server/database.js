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
      category_id   INTEGER REFERENCES categories(id),
      priority      INTEGER NOT NULL DEFAULT 10,
      name          TEXT,
      is_enabled    INTEGER NOT NULL DEFAULT 1,
      stop_processing INTEGER NOT NULL DEFAULT 0,
      source        TEXT    NOT NULL DEFAULT 'manual',
      confidence    REAL,
      conditions_json TEXT  NOT NULL DEFAULT '{}',
      actions_json  TEXT    NOT NULL DEFAULT '{}',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );


    -- Tagging rules engine
    CREATE TABLE IF NOT EXISTS tag_rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword       TEXT    NOT NULL,
      match_type    TEXT    NOT NULL DEFAULT 'contains_case_insensitive',
      tag           TEXT    NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_transactions_transfer_date ON transactions(is_transfer, date);
    CREATE INDEX IF NOT EXISTS idx_budgets_month           ON budgets(month);
    CREATE INDEX IF NOT EXISTS idx_tag_rules_priority      ON tag_rules(priority DESC);

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

    CREATE TABLE IF NOT EXISTS rules_archived (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_batch_id TEXT    NOT NULL,
      archived_reason  TEXT    NOT NULL DEFAULT 'learned_reset',
      original_rule_id INTEGER,
      name            TEXT,
      keyword         TEXT    NOT NULL,
      match_type      TEXT    NOT NULL DEFAULT 'contains_case_insensitive',
      category_id     INTEGER,
      priority        INTEGER NOT NULL DEFAULT 10,
      is_enabled      INTEGER NOT NULL DEFAULT 1,
      stop_processing INTEGER NOT NULL DEFAULT 0,
      source          TEXT    NOT NULL DEFAULT 'manual',
      confidence      REAL,
      conditions_json TEXT    NOT NULL DEFAULT '{}',
      actions_json    TEXT    NOT NULL DEFAULT '{}',
      original_created_at TEXT,
      archived_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rules_archived_batch ON rules_archived(archive_batch_id, archived_at);
    CREATE INDEX IF NOT EXISTS idx_rules_archived_source ON rules_archived(source, archived_at DESC);

    CREATE TABLE IF NOT EXISTS rule_lint_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      scope         TEXT    NOT NULL DEFAULT 'all',
      summary_json  TEXT    NOT NULL DEFAULT '{}',
      findings_json TEXT    NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_rule_lint_reports_created ON rule_lint_reports(created_at DESC);

    CREATE TABLE IF NOT EXISTS rule_rebuild_runs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      config_json      TEXT    NOT NULL DEFAULT '{}',
      suggestions_json TEXT    NOT NULL DEFAULT '[]',
      applied_count    INTEGER NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'preview'
    );

    CREATE INDEX IF NOT EXISTS idx_rule_rebuild_runs_created ON rule_rebuild_runs(created_at DESC);
  `);

  // Safe migrations — run every startup, ignored if column already exists
  const migrations = [
    `ALTER TABLE transactions ADD COLUMN is_income_override INTEGER DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN exclude_from_totals INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN merchant_name TEXT`,
    `ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'import_default'`,
    `ALTER TABLE transactions ADD COLUMN category_locked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE transactions ADD COLUMN tags_locked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* column already exists — fine */ }
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_source_lock ON transactions(account_id, category_source, category_locked, tags_locked)`);
  } catch (e) { /* migration race/older schema during bootstrap — fine */ }

  ensureRulesSchemaV2();

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
  // Income Taxes should behave as expense-oriented category in analytics/rules guards.
  db.prepare(`UPDATE categories SET is_income = 0 WHERE UPPER(name) = 'INCOME TAXES'`).run();

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

function ensureRulesSchemaV2() {
  const cols = db.prepare(`PRAGMA table_info(rules)`).all();
  const byName = new Map(cols.map((c) => [c.name, c]));

  const addIfMissing = [
    `ALTER TABLE rules ADD COLUMN name TEXT`,
    `ALTER TABLE rules ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE rules ADD COLUMN stop_processing INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE rules ADD COLUMN confidence REAL`,
    `ALTER TABLE rules ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE rules ADD COLUMN actions_json TEXT NOT NULL DEFAULT '{}'`,
  ];
  for (const sql of addIfMissing) {
    try { db.exec(sql); } catch (e) { /* already exists */ }
  }

  // If legacy schema still has category_id NOT NULL, rebuild table to allow
  // non-category action rules while preserving existing rows.
  const categoryCol = byName.get('category_id');
  if (categoryCol && categoryCol.notnull === 1) {
    db.exec(`
      BEGIN;
      ALTER TABLE rules RENAME TO rules_legacy_v1;
      CREATE TABLE rules (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword       TEXT    NOT NULL,
        match_type    TEXT    NOT NULL DEFAULT 'contains_case_insensitive',
        category_id   INTEGER REFERENCES categories(id),
        priority      INTEGER NOT NULL DEFAULT 10,
        name          TEXT,
        is_enabled    INTEGER NOT NULL DEFAULT 1,
        stop_processing INTEGER NOT NULL DEFAULT 0,
        source        TEXT    NOT NULL DEFAULT 'manual',
        confidence    REAL,
        conditions_json TEXT  NOT NULL DEFAULT '{}',
        actions_json  TEXT    NOT NULL DEFAULT '{}',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO rules (
        id, keyword, match_type, category_id, priority, created_at,
        name, is_enabled, stop_processing, source, confidence, conditions_json, actions_json
      )
      SELECT
        id,
        COALESCE(keyword, ''),
        COALESCE(match_type, 'contains_case_insensitive'),
        category_id,
        COALESCE(priority, 10),
        COALESCE(created_at, datetime('now')),
        NULL,
        1,
        0,
        'manual',
        NULL,
        '{}',
        '{}'
      FROM rules_legacy_v1;
      DROP TABLE rules_legacy_v1;
      COMMIT;
    `);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_eval ON rules(is_enabled, priority DESC, id ASC)`);
}

module.exports = { getDb };
