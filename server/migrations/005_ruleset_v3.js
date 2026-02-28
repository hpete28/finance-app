// server/migrations/005_ruleset_v3.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Running migration: 005_ruleset_v3');

const addColumn = (sql) => {
  try { db.exec(sql); } catch (_) {}
};

db.exec(`
  CREATE TABLE IF NOT EXISTS rule_sets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    description TEXT,
    status      TEXT    NOT NULL DEFAULT 'candidate'
                 CHECK(status IN ('candidate','active','archived','legacy')),
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT
  )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_sets_single_active ON rule_sets(is_active) WHERE is_active = 1`);

addColumn(`ALTER TABLE rules ADD COLUMN rule_set_id INTEGER REFERENCES rule_sets(id)`);
addColumn(`ALTER TABLE rules ADD COLUMN rule_tier TEXT NOT NULL DEFAULT 'generated_curated'`);
addColumn(`ALTER TABLE rules ADD COLUMN origin TEXT NOT NULL DEFAULT 'imported'`);
addColumn(`ALTER TABLE rules ADD COLUMN match_semantics TEXT NOT NULL DEFAULT 'token_default'`);
addColumn(`ALTER TABLE rules ADD COLUMN specificity_score REAL NOT NULL DEFAULT 0`);

addColumn(`ALTER TABLE transactions ADD COLUMN lock_category INTEGER NOT NULL DEFAULT 0`);
addColumn(`ALTER TABLE transactions ADD COLUMN lock_tags INTEGER NOT NULL DEFAULT 0`);
addColumn(`ALTER TABLE transactions ADD COLUMN lock_merchant INTEGER NOT NULL DEFAULT 0`);
addColumn(`ALTER TABLE transactions ADD COLUMN lock_reason TEXT`);
addColumn(`ALTER TABLE transactions ADD COLUMN locked_at TEXT`);

let legacy = db.prepare(`SELECT id, is_active FROM rule_sets WHERE name = 'legacy_default' LIMIT 1`).get();
if (!legacy) {
  const info = db.prepare(`
    INSERT INTO rule_sets (name, description, status, is_active, activated_at)
    VALUES ('legacy_default', 'Auto-created baseline ruleset', 'active', 1, datetime('now'))
  `).run();
  legacy = { id: Number(info.lastInsertRowid), is_active: 1 };
} else if (Number(legacy.is_active || 0) !== 1) {
  db.prepare(`UPDATE rule_sets SET is_active = 0`).run();
  db.prepare(`UPDATE rule_sets SET is_active = 1, status = 'active', activated_at = datetime('now') WHERE id = ?`).run(legacy.id);
}

db.prepare(`
  UPDATE rules
  SET
    rule_set_id = COALESCE(rule_set_id, ?),
    rule_tier = CASE
      WHEN LOWER(COALESCE(rule_tier, '')) IN ('manual_fix','protected_core','generated_curated','legacy_archived','legacy_tag')
        THEN rule_tier
      WHEN LOWER(COALESCE(source, 'manual')) = 'manual' THEN 'protected_core'
      WHEN LOWER(COALESCE(source, 'manual')) = 'learned' THEN 'generated_curated'
      ELSE 'generated_curated'
    END,
    origin = CASE
      WHEN LOWER(COALESCE(origin, '')) IN ('manual_fix','imported','generated','protected_migrated')
        THEN origin
      WHEN LOWER(COALESCE(source, 'manual')) = 'learned' THEN 'generated'
      WHEN LOWER(COALESCE(source, 'manual')) = 'manual' THEN 'protected_migrated'
      ELSE 'imported'
    END,
    match_semantics = CASE
      WHEN LOWER(COALESCE(match_semantics, '')) IN ('token_default','substring_explicit','exact','starts_with','regex_safe')
        THEN match_semantics
      WHEN LOWER(COALESCE(match_type, 'contains_case_insensitive')) = 'contains_case_insensitive' THEN 'token_default'
      WHEN LOWER(COALESCE(match_type, 'contains_case_insensitive')) = 'starts_with' THEN 'starts_with'
      WHEN LOWER(COALESCE(match_type, 'contains_case_insensitive')) = 'exact' THEN 'exact'
      WHEN LOWER(COALESCE(match_type, 'contains_case_insensitive')) = 'regex' THEN 'regex_safe'
      ELSE 'token_default'
    END
`).run(legacy.id);

db.prepare(`
  UPDATE transactions
  SET
    lock_category = CASE
      WHEN COALESCE(lock_category, 0) = 1 THEN 1
      WHEN COALESCE(category_locked, 0) = 1 THEN 1
      ELSE 0
    END,
    lock_tags = CASE
      WHEN COALESCE(lock_tags, 0) = 1 THEN 1
      WHEN COALESCE(tags_locked, 0) = 1 THEN 1
      ELSE 0
    END
`).run();

db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_eval_v3 ON rules(is_enabled, rule_set_id, rule_tier, priority DESC, specificity_score DESC, id ASC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_lock_v3 ON transactions(lock_category, lock_tags, lock_merchant)`);

db.close();
console.log('✅ Migration 005 complete!');
