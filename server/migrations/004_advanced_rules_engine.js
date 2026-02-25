// server/migrations/004_advanced_rules_engine.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Running migration: 004_advanced_rules_engine');

const cols = db.prepare(`PRAGMA table_info(rules)`).all();
const byName = new Map(cols.map((c) => [c.name, c]));

const addColumn = (sql) => {
  try { db.exec(sql); } catch (_) {}
};

addColumn(`ALTER TABLE rules ADD COLUMN name TEXT`);
addColumn(`ALTER TABLE rules ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1`);
addColumn(`ALTER TABLE rules ADD COLUMN stop_processing INTEGER NOT NULL DEFAULT 0`);
addColumn(`ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
addColumn(`ALTER TABLE rules ADD COLUMN confidence REAL`);
addColumn(`ALTER TABLE rules ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}'`);
addColumn(`ALTER TABLE rules ADD COLUMN actions_json TEXT NOT NULL DEFAULT '{}'`);

if (byName.get('category_id') && byName.get('category_id').notnull === 1) {
  console.log('Rebuilding rules table to make category_id nullable...');
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

db.close();
console.log('✅ Migration 004 complete!');
