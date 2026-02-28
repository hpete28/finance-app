// server/routes/transactions.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');
const {
  normalizeForMatching,
  getActiveRuleSetId,
  getRules,
  compileRules,
} = require('../services/categorizer');
const { detectTransferCandidates } = require('../services/transferDetection');
const { applyAccountStrategyToRow, STRATEGY_SOURCE, BMO_US_ACCOUNT_ID } = require('../services/accountStrategies');
const { v4: uuidv4 } = require('uuid');

const TRANSACTION_SELECT_SQL = `
  SELECT t.*,
         a.name as account_name, a.currency,
         c.name as category_name, c.color as category_color
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
`;

const EXPORT_COLUMNS = [
  'id',
  'date',
  'description',
  'amount',
  'currency',
  'account_id',
  'account_name',
  'category_id',
  'category_name',
  'category_color',
  'tags',
  'notes',
  'merchant_name',
  'is_transfer',
  'is_recurring',
  'reviewed',
  'is_income_override',
  'exclude_from_totals',
  'created_at',
];

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return [...new Set(rawTags.map((tag) => String(tag || '').trim()).filter(Boolean))];
  }
  try {
    const parsed = JSON.parse(rawTags || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((tag) => String(tag || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

const RENTAL_TAG_CANONICAL = {
  CRESTHAVEN: 'Property Rental-Cresthaven',
  WOODRUFF: 'Property Rental-Woodruff',
};

const RENTAL_TAG_ALIASES = {
  [RENTAL_TAG_CANONICAL.CRESTHAVEN]: new Set([
    'Property Rental-Cresthaven',
    'Property Rental - Cresthaven',
    'income:rental_property:cresthaven',
  ]),
  [RENTAL_TAG_CANONICAL.WOODRUFF]: new Set([
    'Property Rental-Woodruff',
    'Property Rental-Woodroffe',
    'Property Rental - Woodroffe',
    'Property Rental - Woodruff',
    'income:rental_property:woodroffe',
    'income:rental_property:woodruff',
  ]),
};

function canonicalizeRentalTag(tag) {
  const value = String(tag || '').trim();
  if (!value) return '';
  if (RENTAL_TAG_ALIASES[RENTAL_TAG_CANONICAL.CRESTHAVEN].has(value)) return RENTAL_TAG_CANONICAL.CRESTHAVEN;
  if (RENTAL_TAG_ALIASES[RENTAL_TAG_CANONICAL.WOODRUFF].has(value)) return RENTAL_TAG_CANONICAL.WOODRUFF;
  return value;
}

function canonicalizeTags(tags = []) {
  return [...new Set(parseTags(tags).map(canonicalizeRentalTag).filter((t) => t && t !== 'income:rental_property'))];
}

function expandTagAliases(tag) {
  const canonical = canonicalizeRentalTag(tag);
  const aliases = RENTAL_TAG_ALIASES[canonical];
  if (aliases) return [...aliases];
  return [String(tag || '').trim()].filter(Boolean);
}

function appendTagFilter(where, params, tag, columnExpr = 't.tags') {
  if (!tag) return;
  const aliases = expandTagAliases(tag);
  if (!aliases.length) return;
  const clauses = aliases.map(() => `LOWER(COALESCE(${columnExpr}, '[]')) LIKE ?`);
  where.push(`(${clauses.join(' OR ')})`);
  params.push(...aliases.map((t) => `%\"${String(t).toLowerCase()}\"%`));
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function stableTagString(tags) {
  return JSON.stringify(parseTags(Array.isArray(tags) ? JSON.stringify(tags) : tags));
}

function normalizeRuleTier(value, fallback = 'manual_fix') {
  const tier = String(value || fallback).toLowerCase();
  if (['manual_fix', 'protected_core', 'generated_curated', 'legacy_archived', 'legacy_tag'].includes(tier)) return tier;
  return fallback;
}

function normalizeRuleOrigin(value, fallback = 'manual_fix') {
  const origin = String(value || fallback).toLowerCase();
  if (['manual_fix', 'imported', 'generated', 'protected_migrated'].includes(origin)) return origin;
  return fallback;
}

function normalizeRuleMatchSemantics(value, fallback = 'token_default') {
  const semantics = String(value || fallback).toLowerCase();
  if (['token_default', 'substring_explicit', 'exact', 'starts_with', 'regex_safe'].includes(semantics)) return semantics;
  return fallback;
}

function deriveDescriptionConditionValue(description = '') {
  const tokens = normalizeForMatching(description)
    .split(' ')
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  if (!tokens.length) return '';
  return tokens.slice(0, Math.min(tokens.length >= 3 ? 3 : 2, 4)).join(' ').trim();
}

function buildManualFixRuleFromTransaction({ tx, categoryId, categoryName, options = {} }) {
  const merchant = String(options.merchant_name ?? tx.merchant_name ?? '').trim();
  const descriptionValue = deriveDescriptionConditionValue(tx.description || '');
  const amountSign = Number(tx.amount || 0) < 0 ? 'expense' : (Number(tx.amount || 0) > 0 ? 'income' : 'any');

  const conditions = {
    amount_sign: amountSign,
    account_ids: Number.isFinite(Number(tx.account_id)) ? [Number(tx.account_id)] : [],
  };

  if (merchant) {
    conditions.merchant = {
      operator: 'equals',
      value: merchant,
      case_sensitive: false,
      match_semantics: 'token_default',
    };
  } else if (descriptionValue) {
    conditions.description = {
      operator: 'contains',
      value: descriptionValue,
      case_sensitive: false,
      match_semantics: 'token_default',
    };
  } else {
    conditions.description = {
      operator: 'contains',
      value: String(tx.description || '').slice(0, 80),
      case_sensitive: false,
      match_semantics: 'token_default',
    };
  }

  if (options.amount_mode === 'exact') {
    conditions.amount = { exact: Math.abs(Number(tx.amount) || 0) };
  } else if (options.amount_mode === 'range') {
    const base = Math.abs(Number(tx.amount) || 0);
    const delta = Math.max(1, Number((base * 0.05).toFixed(2)));
    conditions.amount = { min: Number((base - delta).toFixed(2)), max: Number((base + delta).toFixed(2)) };
  }

  const priority = Math.max(100, Math.min(1000, Number(options.priority) || 950));
  const source = String(options.source || 'manual').toLowerCase() === 'learned' ? 'learned' : 'manual';
  const ruleNamePrefix = merchant || descriptionValue || String(tx.description || '').slice(0, 40) || `TX ${tx.id}`;
  const friendlyCategory = String(categoryName || `Category ${categoryId}`);

  return {
    name: `Manual fix: ${ruleNamePrefix} -> ${friendlyCategory}`.slice(0, 160),
    keyword: merchant || descriptionValue || String(tx.description || '').slice(0, 80),
    match_type: 'contains_case_insensitive',
    category_id: Number(categoryId),
    priority,
    is_enabled: 1,
    stop_processing: 1,
    source,
    rule_tier: normalizeRuleTier(options.rule_tier, 'manual_fix'),
    origin: normalizeRuleOrigin(options.origin, 'manual_fix'),
    match_semantics: normalizeRuleMatchSemantics(options.match_semantics, 'token_default'),
    specificity_score: Number(options.specificity_score) || 100,
    confidence: null,
    conditions,
    actions: {
      set_category_id: Number(categoryId),
    },
  };
}

function buildRuleSignatureLite(rule) {
  const conditions = rule.conditions || {};
  const desc = conditions.description || null;
  const merchant = conditions.merchant || null;
  const amount = conditions.amount || null;
  const actions = rule.actions || {};
  return JSON.stringify({
    keyword: normalizeForMatching(rule.keyword || ''),
    category_id: Number(rule.category_id) || null,
    conditions: {
      description: desc ? {
        operator: String(desc.operator || 'contains').toLowerCase(),
        case_sensitive: !!desc.case_sensitive,
        match_semantics: normalizeRuleMatchSemantics(desc.match_semantics, 'token_default'),
        value: desc.case_sensitive ? String(desc.value || '') : normalizeForMatching(desc.value || ''),
      } : null,
      merchant: merchant ? {
        operator: String(merchant.operator || 'contains').toLowerCase(),
        case_sensitive: !!merchant.case_sensitive,
        match_semantics: normalizeRuleMatchSemantics(merchant.match_semantics, 'token_default'),
        value: merchant.case_sensitive ? String(merchant.value || '') : normalizeForMatching(merchant.value || ''),
      } : null,
      amount: amount ? {
        exact: amount.exact ?? null,
        min: amount.min ?? null,
        max: amount.max ?? null,
      } : null,
      amount_sign: String(conditions.amount_sign || 'any').toLowerCase(),
      account_ids: Array.isArray(conditions.account_ids)
        ? [...conditions.account_ids].map((v) => Number(v)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
        : [],
      date_range: conditions.date_range || null,
    },
    actions: {
      set_category_id: actions.set_category_id ?? null,
      tags: actions.tags || null,
      set_merchant_name: actions.set_merchant_name || null,
      set_is_income_override: actions.set_is_income_override ?? null,
      set_exclude_from_totals: actions.set_exclude_from_totals ?? null,
    },
    rule_tier: normalizeRuleTier(rule.rule_tier, 'manual_fix'),
    source: String(rule.source || 'manual').toLowerCase(),
  });
}

function insertManualFixRule(db, payload, ruleSetId) {
  const existingCompiled = compileRules(getRules({ ruleSetId, includeAllRuleSets: false }), { includeLegacyTagRules: false });
  const existingSignatures = new Set(existingCompiled.map(buildRuleSignatureLite));
  const signature = buildRuleSignatureLite(payload);
  if (existingSignatures.has(signature)) return { created: false, duplicate: true };

  const info = db.prepare(`
    INSERT INTO rules (
      name, keyword, match_type, category_id, priority,
      is_enabled, stop_processing, source, confidence,
      conditions_json, actions_json, rule_set_id, rule_tier, origin, match_semantics, specificity_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.name || null,
    payload.keyword || '',
    payload.match_type || 'contains_case_insensitive',
    payload.category_id ?? null,
    Number(payload.priority) || 950,
    payload.is_enabled ? 1 : 0,
    payload.stop_processing ? 1 : 0,
    payload.source || 'manual',
    payload.confidence ?? null,
    JSON.stringify(payload.conditions || {}),
    JSON.stringify(payload.actions || {}),
    ruleSetId,
    normalizeRuleTier(payload.rule_tier, 'manual_fix'),
    normalizeRuleOrigin(payload.origin, 'manual_fix'),
    normalizeRuleMatchSemantics(payload.match_semantics, 'token_default'),
    Number(payload.specificity_score) || 100
  );
  return { created: true, id: Number(info.lastInsertRowid) };
}

function ensureBackupDir(runId) {
  const dir = path.join(__dirname, '..', 'backups', `bmo-us-strategy-${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildCsvFilename(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start_date || '') ? query.start_date : '';
  const end = /^\d{4}-\d{2}-\d{2}$/.test(query.end_date || '') ? query.end_date : '';

  let base = `transactions-export-${today}`;
  if (start && end) base += `-${start}_to_${end}`;
  else if (start) base += `-${start}`;
  else if (end) base += `-${end}`;
  return `${base}.csv`;
}

function buildTransactionsQueryState(db, query = {}) {
  const {
    account_id, category_id, month,
    start_date, end_date, search, tag, uncategorized, is_recurring,
    sort = 'date', order = 'desc',
    amount_search, amount_min, amount_max,
    exclude_from_totals,
    is_transfer,
  } = query;

  let where = [];
  let params = [];

  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  if (category_id === 'null' || uncategorized === 'true') {
    where.push('t.category_id IS NULL');
  } else if (category_id) {
    where.push('t.category_id = ?'); params.push(category_id);
  }
  if (month) {
    where.push("strftime('%Y-%m', t.date) = ?"); params.push(month);
  }
  if (start_date) { where.push('t.date >= ?'); params.push(start_date); }
  if (end_date) { where.push('t.date <= ?'); params.push(end_date); }
  if (search) {
    where.push(`(
      UPPER(t.description) LIKE ? OR
      UPPER(COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.description)) LIKE ?
    )`);
    const searchTerm = `%${search.toUpperCase()}%`;
    params.push(searchTerm, searchTerm);
  }
  appendTagFilter(where, params, tag, 't.tags');
  if (is_recurring === 'true') { where.push('t.is_recurring = 1'); }
  if (exclude_from_totals === 'true') { where.push('t.exclude_from_totals = 1'); }
  if (exclude_from_totals === 'false') { where.push('t.exclude_from_totals = 0'); }
  if (is_transfer === 'true') { where.push('t.is_transfer = 1'); }
  if (is_transfer === 'false') { where.push('t.is_transfer = 0'); }

  if (amount_search && amount_search.trim()) {
    const cleaned = amount_search.replace(/^[$-]+/, '').replace(/,/g, '');
    where.push('CAST(ABS(t.amount) AS TEXT) LIKE ?');
    params.push(`${cleaned}%`);
  }
  if (amount_min) { where.push('ABS(t.amount) >= ?'); params.push(parseFloat(amount_min)); }
  if (amount_max) { where.push('ABS(t.amount) <= ?'); params.push(parseFloat(amount_max)); }

  if (query.type === 'income') {
    const sources = db.prepare('SELECT keyword, match_type FROM income_sources').all();
    const conds = [
      't.is_income_override = 1',
      'EXISTS (SELECT 1 FROM categories ic WHERE ic.id = t.category_id AND ic.is_income = 1)',
    ];
    for (const s of sources) {
      if (s.match_type === 'exact') {
        conds.push('UPPER(t.description) = UPPER(?)');
        params.push(s.keyword);
      } else {
        conds.push('UPPER(t.description) LIKE UPPER(?)');
        params.push(`%${s.keyword}%`);
      }
    }
    where.push('t.is_transfer = 0');
    where.push('t.amount > 0');
    where.push(`(${conds.join(' OR ')})`);
  } else if (query.type === 'expense') {
    where.push('t.is_transfer = 0');
    where.push('t.amount < 0');
    const incomeCats = db.prepare('SELECT id FROM categories WHERE is_income = 1').all();
    if (incomeCats.length) {
      const ids = incomeCats.map(c => c.id).join(',');
      where.push(`(t.category_id IS NULL OR t.category_id NOT IN (${ids}))`);
    }
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortMap = {
    date: 't.date',
    amount: 't.amount',
    description: 'UPPER(t.description)',
    category: "UPPER(COALESCE(c.name, ''))",
    account: 'UPPER(a.name)',
  };
  const sortExpr = sortMap[sort] || sortMap.date;
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  return { whereClause, params, sortExpr, sortOrder };
}

// GET /api/transactions — list with filtering, pagination, sorting
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 50, 1);
  const offset = (pageNum - 1) * limitNum;
  const { whereClause, params, sortExpr, sortOrder } = buildTransactionsQueryState(db, req.query);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM transactions t ${whereClause}
  `).get(...params);

  const rows = db.prepare(`
    ${TRANSACTION_SELECT_SQL}
    ${whereClause}
    ORDER BY ${sortExpr} ${sortOrder}, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  // Parse tags JSON
  const transactions = rows.map(r => ({ ...r, tags: canonicalizeTags(r.tags) }));

  res.json({
    transactions,
    total: countRow.total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(countRow.total / limitNum)
  });
});

// GET /api/transactions/export.csv — full filtered export (ignores pagination)
router.get('/export.csv', (req, res) => {
  const db = getDb();

  try {
    const { whereClause, params, sortExpr, sortOrder } = buildTransactionsQueryState(db, req.query);
    const stmt = db.prepare(`
      ${TRANSACTION_SELECT_SQL}
      ${whereClause}
      ORDER BY ${sortExpr} ${sortOrder}, t.id DESC
    `);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildCsvFilename(req.query)}"`);
    res.setHeader('Cache-Control', 'no-store');

    // UTF-8 BOM helps Excel auto-detect encoding.
    res.write('\uFEFF');
    res.write(`${EXPORT_COLUMNS.join(',')}\r\n`);

    for (const row of stmt.iterate(...params)) {
      const exported = {
        id: row.id,
        date: row.date,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        account_id: row.account_id,
        account_name: row.account_name,
        category_id: row.category_id,
        category_name: row.category_name,
        category_color: row.category_color,
        tags: canonicalizeTags(row.tags).join(', '),
        notes: row.notes,
        merchant_name: row.merchant_name,
        is_transfer: row.is_transfer,
        is_recurring: row.is_recurring,
        reviewed: row.reviewed,
        is_income_override: row.is_income_override,
        exclude_from_totals: row.exclude_from_totals,
        created_at: row.created_at,
      };

      const line = EXPORT_COLUMNS.map(col => csvEscape(exported[col])).join(',');
      res.write(`${line}\r\n`);
    }

    res.end();
  } catch (err) {
    console.error('CSV export failed:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to export CSV' });
    }
    res.end();
  }
});

// GET /api/transactions/summary/monthly — income/expense summary
router.get('/summary/monthly', (req, res) => {
  const db = getDb();
  const { months = 12, account_id } = req.query;

  let where = 'WHERE exclude_from_totals = 0 AND is_transfer = 0';
  let params = [];
  if (account_id) { where += ' AND account_id = ?'; params.push(account_id); }

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses,
      SUM(amount) as net
    FROM transactions
    ${where}
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).all(...params, parseInt(months));

  res.json(rows.reverse());
});

// GET /api/transactions/summary/filtered — aggregate summary for current filters (ignores pagination/sort)
router.get('/summary/filtered', (req, res) => {
  const db = getDb();
  const { whereClause, params } = buildTransactionsQueryState(db, req.query);

  const row = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as total_expense,
      COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as total_income,
      MIN(t.date) as first_date,
      MAX(t.date) as last_date
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereClause}
  `).get(...params);

  res.json({
    count: Number(row?.count || 0),
    total_expense: Number(row?.total_expense || 0),
    total_income: Number(row?.total_income || 0),
    first_date: row?.first_date || null,
    last_date: row?.last_date || null,
  });
});

// GET /api/transactions/transfer-candidates — suggest likely internal-transfer pairs
router.get('/transfer-candidates', (req, res) => {
  const db = getDb();
  const {
    start_date,
    end_date,
    days_window = 3,
    limit = 150,
    min_confidence = 0.55,
  } = req.query;

  const result = detectTransferCandidates(db, {
    start_date,
    end_date,
    days_window,
    limit,
    min_confidence,
  });

  res.json({
    count: result.candidates.length,
    options: result.options,
    candidates: result.candidates,
  });
});

// POST /api/transactions/apply-transfer-candidates — mark selected candidates as transfer
router.post('/apply-transfer-candidates', (req, res) => {
  const db = getDb();
  const { pairs = [], transaction_ids = [], pair_ids = [], candidates = [], candidate_options = {} } = req.body || {};
  const txIds = new Set(Array.isArray(transaction_ids) ? transaction_ids : []);

  if (Array.isArray(pairs)) {
    pairs.forEach((p) => {
      if (p?.debit_tx_id) txIds.add(p.debit_tx_id);
      if (p?.credit_tx_id) txIds.add(p.credit_tx_id);
    });
  }

  if (Array.isArray(pair_ids) && Array.isArray(candidates) && candidates.length) {
    const selected = new Set(pair_ids);
    candidates.forEach((c) => {
      if (!selected.has(c.pair_id)) return;
      if (c.debit_tx_id) txIds.add(c.debit_tx_id);
      if (c.credit_tx_id) txIds.add(c.credit_tx_id);
    });
  }

  if (Array.isArray(pair_ids) && pair_ids.length && txIds.size === 0) {
    const selected = new Set(pair_ids);
    const detected = detectTransferCandidates(db, {
      ...candidate_options,
      limit: Math.max(parseInt(candidate_options.limit || 500, 10) || 500, pair_ids.length),
      min_confidence: candidate_options.min_confidence ?? 0,
    });
    detected.candidates.forEach((c) => {
      if (!selected.has(c.pair_id)) return;
      if (c.debit_tx_id) txIds.add(c.debit_tx_id);
      if (c.credit_tx_id) txIds.add(c.credit_tx_id);
    });
  }

  if (!txIds.size) {
    return res.status(400).json({ error: 'No transactions selected' });
  }

  const ids = [...txIds];
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`
    UPDATE transactions
    SET is_transfer = 1, exclude_from_totals = 1
    WHERE id IN (${placeholders})
  `).run(...ids);

  res.json({ updated: info.changes, ids });
});

// POST /api/transactions/strategies/bmo-us-travel/backfill
router.post('/strategies/bmo-us-travel/backfill', (req, res) => {
  const db = getDb();
  const dryRun = req.body?.dry_run !== undefined ? !!req.body.dry_run : true;
  const fromDate = String(req.body?.from_date || '').trim() || null;
  const toDate = String(req.body?.to_date || '').trim() || null;
  const limit = Math.max(1, Math.min(5000, Number(req.body?.limit) || 5000));

  const where = ['account_id = ?'];
  const params = [BMO_US_ACCOUNT_ID];
  if (fromDate) { where.push('date >= ?'); params.push(fromDate); }
  if (toDate) { where.push('date <= ?'); params.push(toDate); }

  const rows = db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, tags, merchant_name,
           is_transfer, exclude_from_totals, is_income_override,
           category_source, category_locked, tags_locked, lock_category, lock_tags, lock_merchant, lock_reason, locked_at
    FROM transactions
    WHERE ${where.join(' AND ')}
    ORDER BY date ASC, id ASC
    LIMIT ?
  `).all(...params, limit);

  const candidates = [];
  for (const row of rows) {
    if (String(row.category_source || '').toLowerCase() === 'manual_override') continue;

    const next = applyAccountStrategyToRow({
      db,
      row: {
        ...row,
        tags: parseTags(row.tags),
      },
    });

    const changed = (
      Number(row.category_id ?? null) !== Number(next.category_id ?? null)
      || stableTagString(row.tags) !== stableTagString(next.tags)
      || Number(row.is_transfer || 0) !== Number(next.is_transfer || 0)
      || Number(row.exclude_from_totals || 0) !== Number(next.exclude_from_totals || 0)
      || String(row.category_source || 'import_default') !== String(next.category_source || 'import_default')
      || Number(row.category_locked || 0) !== Number(next.category_locked || 0)
      || Number(row.tags_locked || 0) !== Number(next.tags_locked || 0)
      || Number(row.lock_category || 0) !== Number(next.lock_category || next.category_locked || 0)
      || Number(row.lock_tags || 0) !== Number(next.lock_tags || next.tags_locked || 0)
      || Number(row.lock_merchant || 0) !== Number(next.lock_merchant || 0)
    );
    if (!changed) continue;
    candidates.push({ before: row, after: next });
  }

  const summary = {
    dry_run: dryRun,
    scanned: rows.length,
    changed: candidates.length,
    updated: 0,
    transfer_updates: candidates.filter((c) => Number(c.after.is_transfer || 0) === 1).length,
    travel_updates: candidates.filter((c) => Number(c.after.is_transfer || 0) === 0 && Number(c.after.exclude_from_totals || 0) === 0).length,
    sample: candidates.slice(0, 40).map((c) => ({
      id: c.before.id,
      date: c.before.date,
      description: c.before.description,
      amount: c.before.amount,
      before: {
        category_id: c.before.category_id ?? null,
        tags: parseTags(c.before.tags),
        is_transfer: c.before.is_transfer ? 1 : 0,
        exclude_from_totals: c.before.exclude_from_totals ? 1 : 0,
        category_source: c.before.category_source || 'import_default',
        category_locked: c.before.category_locked ? 1 : 0,
        tags_locked: c.before.tags_locked ? 1 : 0,
        lock_category: c.before.lock_category ? 1 : 0,
        lock_tags: c.before.lock_tags ? 1 : 0,
        lock_merchant: c.before.lock_merchant ? 1 : 0,
      },
      after: {
        category_id: c.after.category_id ?? null,
        tags: parseTags(c.after.tags),
        is_transfer: c.after.is_transfer ? 1 : 0,
        exclude_from_totals: c.after.exclude_from_totals ? 1 : 0,
        category_source: c.after.category_source || 'import_default',
        category_locked: c.after.category_locked ? 1 : 0,
        tags_locked: c.after.tags_locked ? 1 : 0,
        lock_category: c.after.lock_category ? 1 : (c.after.category_locked ? 1 : 0),
        lock_tags: c.after.lock_tags ? 1 : (c.after.tags_locked ? 1 : 0),
        lock_merchant: c.after.lock_merchant ? 1 : 0,
      },
    })),
  };

  if (dryRun || !candidates.length) {
    return res.json(summary);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${uuidv4().slice(0, 8)}`;
  const backupDir = ensureBackupDir(runId);
  const updateOne = db.prepare(`
    UPDATE transactions
    SET category_id = ?, tags = ?, is_transfer = ?, exclude_from_totals = ?, category_source = ?, category_locked = ?, tags_locked = ?,
        lock_category = ?, lock_tags = ?, lock_reason = ?, locked_at = ?
    WHERE id = ?
  `);

  db.transaction(() => {
    for (const candidate of candidates) {
      const { before, after } = candidate;
      updateOne.run(
        after.category_id ?? null,
        JSON.stringify(parseTags(after.tags)),
        after.is_transfer ? 1 : 0,
        after.exclude_from_totals ? 1 : 0,
        after.category_source || STRATEGY_SOURCE,
        after.category_locked ? 1 : 0,
        after.tags_locked ? 1 : 0,
        after.category_locked ? 1 : 0,
        after.tags_locked ? 1 : 0,
        (after.category_locked || after.tags_locked) ? 'account_strategy' : null,
        (after.category_locked || after.tags_locked) ? new Date().toISOString() : null,
        before.id
      );
    }
  })();

  const beforeRows = candidates.map((c) => ({
    id: c.before.id,
    category_id: c.before.category_id ?? null,
    tags: parseTags(c.before.tags),
    is_transfer: c.before.is_transfer ? 1 : 0,
    exclude_from_totals: c.before.exclude_from_totals ? 1 : 0,
    merchant_name: c.before.merchant_name || null,
    category_source: c.before.category_source || 'import_default',
    category_locked: c.before.category_locked ? 1 : 0,
    tags_locked: c.before.tags_locked ? 1 : 0,
    lock_category: c.before.lock_category ? 1 : 0,
    lock_tags: c.before.lock_tags ? 1 : 0,
    lock_merchant: c.before.lock_merchant ? 1 : 0,
    lock_reason: c.before.lock_reason || null,
    locked_at: c.before.locked_at || null,
  }));
  const afterRows = candidates.map((c) => ({
    id: c.after.id,
    category_id: c.after.category_id ?? null,
    tags: parseTags(c.after.tags),
    is_transfer: c.after.is_transfer ? 1 : 0,
    exclude_from_totals: c.after.exclude_from_totals ? 1 : 0,
    merchant_name: c.after.merchant_name || null,
    category_source: c.after.category_source || STRATEGY_SOURCE,
    category_locked: c.after.category_locked ? 1 : 0,
    tags_locked: c.after.tags_locked ? 1 : 0,
    lock_category: c.after.category_locked ? 1 : 0,
    lock_tags: c.after.tags_locked ? 1 : 0,
    lock_merchant: c.after.lock_merchant ? 1 : 0,
    lock_reason: (c.after.category_locked || c.after.tags_locked) ? 'account_strategy' : null,
    locked_at: (c.after.category_locked || c.after.tags_locked) ? new Date().toISOString() : null,
  }));

  fs.writeFileSync(path.join(backupDir, 'summary.json'), JSON.stringify({ ...summary, dry_run: false, run_id: runId }, null, 2));
  fs.writeFileSync(path.join(backupDir, 'before_rows.json'), JSON.stringify(beforeRows, null, 2));
  fs.writeFileSync(path.join(backupDir, 'after_rows.json'), JSON.stringify(afterRows, null, 2));

  res.json({
    ...summary,
    dry_run: false,
    updated: candidates.length,
    run_id: runId,
    backup_path: backupDir,
  });
});

// POST /api/transactions/strategies/bmo-us-travel/rollback
router.post('/strategies/bmo-us-travel/rollback', (req, res) => {
  const db = getDb();
  const runId = String(req.body?.run_id || '').trim();
  if (!runId) return res.status(400).json({ error: 'run_id is required' });

  const backupDir = path.join(__dirname, '..', 'backups', `bmo-us-strategy-${runId}`);
  const beforePath = path.join(backupDir, 'before_rows.json');
  if (!fs.existsSync(beforePath)) {
    return res.status(404).json({ error: 'Rollback backup not found for run_id' });
  }

  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: `Failed to parse rollback backup: ${err.message}` });
  }

  const updateOne = db.prepare(`
    UPDATE transactions
    SET category_id = ?, tags = ?, is_transfer = ?, exclude_from_totals = ?, merchant_name = ?, category_source = ?, category_locked = ?, tags_locked = ?,
        lock_category = ?, lock_tags = ?, lock_merchant = ?, lock_reason = ?, locked_at = ?
    WHERE id = ?
  `);

  db.transaction(() => {
    for (const row of rows) {
      updateOne.run(
        row.category_id ?? null,
        JSON.stringify(parseTags(row.tags)),
        row.is_transfer ? 1 : 0,
        row.exclude_from_totals ? 1 : 0,
        row.merchant_name || null,
        row.category_source || 'import_default',
        row.category_locked ? 1 : 0,
        row.tags_locked ? 1 : 0,
        row.lock_category !== undefined ? (row.lock_category ? 1 : 0) : (row.category_locked ? 1 : 0),
        row.lock_tags !== undefined ? (row.lock_tags ? 1 : 0) : (row.tags_locked ? 1 : 0),
        row.lock_merchant ? 1 : 0,
        row.lock_reason || null,
        row.locked_at || null,
        row.id
      );
    }
  })();

  res.json({ ok: true, restored: rows.length, run_id: runId, backup_path: backupDir });
});

// GET /api/transactions/tags — distinct tag list for picker/autocomplete
router.get('/tags', (req, res) => {
  const db = getDb();
  const { q = '', limit = 200 } = req.query;
  const rows = db.prepare(`
    SELECT tags
    FROM transactions
    WHERE COALESCE(tags, '[]') NOT IN ('[]', '')
  `).all();

  const needle = String(q || '').trim().toLowerCase();
  const counts = new Map();
  for (const row of rows) {
    const tags = canonicalizeTags(row.tags);
    for (const tag of tags) {
      const value = String(tag || '').trim();
      if (!value) continue;
      if (needle && !value.toLowerCase().includes(needle)) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }

  const max = Math.min(500, Math.max(10, parseInt(limit, 10) || 200));
  const tags = [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, max)
    .map(([tag, count]) => ({ tag, count }));

  res.json({ tags, total: tags.length });
});

// GET /api/transactions/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const tx = db.prepare(`
    SELECT t.*, a.name as account_name, a.currency,
           c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!tx) return res.status(404).json({ error: 'Not found' });

  const splits = db.prepare(`
    SELECT ts.*, c.name as category_name, c.color as category_color
    FROM transaction_splits ts
    JOIN categories c ON c.id = ts.category_id
    WHERE ts.transaction_id = ?
  `).all(req.params.id);

  res.json({ ...tx, tags: canonicalizeTags(tx.tags), splits });
});

// PATCH /api/transactions/:id — update single transaction
router.patch('/:id', (req, res) => {
  const db = getDb();
  const txBefore = db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, merchant_name, category_source
    FROM transactions
    WHERE id = ?
  `).get(req.params.id);
  if (!txBefore) return res.status(404).json({ error: 'Transaction not found' });

  const {
    category_id,
    notes,
    tags,
    is_transfer,
    reviewed,
    is_income_override,
    exclude_from_totals,
    merchant_name,
    recategorize_mode,
    manual_fix_options,
  } = req.body;
  const fields = [];
  const vals = [];
  const forceExclude = is_transfer === true || is_transfer === 1;
  const manualCategoryEdit = category_id !== undefined;
  const manualTagEdit = tags !== undefined;
  const manualMerchantEdit = merchant_name !== undefined;
  const recategorizeMode = manualCategoryEdit
    ? String(recategorize_mode || 'create_winning_rule').toLowerCase()
    : null;
  if (manualCategoryEdit && !['create_winning_rule', 'one_off_only'].includes(recategorizeMode)) {
    return res.status(400).json({ error: `Invalid recategorize_mode: ${recategorize_mode}` });
  }

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
  if (tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(canonicalizeTags(tags))); }
  if (is_transfer !== undefined) { fields.push('is_transfer = ?'); vals.push(is_transfer ? 1 : 0); }
  if (reviewed !== undefined) { fields.push('reviewed = ?'); vals.push(reviewed ? 1 : 0); }
  if (is_income_override !== undefined) { fields.push('is_income_override = ?'); vals.push(is_income_override ? 1 : 0); }
  if (exclude_from_totals !== undefined || forceExclude) {
    fields.push('exclude_from_totals = ?');
    vals.push(forceExclude ? 1 : (exclude_from_totals ? 1 : 0));
  }
  if (merchant_name !== undefined) { fields.push('merchant_name = ?'); vals.push(merchant_name || null); }

  if (manualCategoryEdit || manualTagEdit) {
    fields.push('category_source = ?');
    vals.push('manual_override');
  }
  if (manualCategoryEdit) {
    fields.push('category_locked = 1');
    fields.push('lock_category = 1');
    fields.push('lock_reason = ?');
    vals.push(recategorizeMode === 'one_off_only' ? 'manual_one_off' : 'manual_fix_rule');
    fields.push('locked_at = datetime(\'now\')');
  }
  if (manualTagEdit) {
    fields.push('tags_locked = 1');
    fields.push('lock_tags = 1');
    if (!manualCategoryEdit) {
      fields.push('lock_reason = ?');
      vals.push('manual_tag_edit');
      fields.push('locked_at = datetime(\'now\')');
    }
  }
  if (manualMerchantEdit) {
    fields.push('lock_merchant = 1');
    if (!manualCategoryEdit && !manualTagEdit) {
      fields.push('lock_reason = ?');
      vals.push('manual_merchant_edit');
      fields.push('locked_at = datetime(\'now\')');
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  let createdRule = null;
  db.transaction(() => {
    db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...vals, req.params.id);

    if (!manualCategoryEdit || recategorizeMode !== 'create_winning_rule' || !category_id) return;

    const categoryRow = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(category_id);
    if (!categoryRow) return;
    const activeRuleSetId = getActiveRuleSetId({});
    if (!Number.isFinite(Number(activeRuleSetId))) return;

    const manualFixPayload = buildManualFixRuleFromTransaction({
      tx: {
        ...txBefore,
        merchant_name: merchant_name !== undefined ? merchant_name : txBefore.merchant_name,
      },
      categoryId: Number(categoryRow.id),
      categoryName: categoryRow.name,
      options: {
        amount_mode: manual_fix_options?.amount_mode,
        priority: manual_fix_options?.priority,
        rule_tier: manual_fix_options?.rule_tier,
        origin: manual_fix_options?.origin,
      },
    });
    const insertInfo = insertManualFixRule(db, manualFixPayload, Number(activeRuleSetId));
    if (insertInfo.created) createdRule = { id: insertInfo.id, name: manualFixPayload.name };
  })();

  res.json({
    ok: true,
    recategorize_mode: recategorizeMode || undefined,
    created_winning_rule: createdRule,
  });
});

// PATCH /api/transactions/:id/lock — lock/unlock category/tags/merchant fields
router.patch('/:id/lock', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, lock_category, lock_tags, lock_merchant, category_locked, tags_locked
    FROM transactions
    WHERE id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transaction not found' });

  const updates = [];
  const vals = [];
  const hasCategory = Object.prototype.hasOwnProperty.call(req.body || {}, 'lock_category');
  const hasTags = Object.prototype.hasOwnProperty.call(req.body || {}, 'lock_tags');
  const hasMerchant = Object.prototype.hasOwnProperty.call(req.body || {}, 'lock_merchant');
  const hasReason = Object.prototype.hasOwnProperty.call(req.body || {}, 'lock_reason');

  if (!hasCategory && !hasTags && !hasMerchant && !hasReason) {
    return res.status(400).json({ error: 'No lock fields provided' });
  }

  const nextCategory = hasCategory ? (req.body.lock_category ? 1 : 0) : Number(row.lock_category || 0);
  const nextTags = hasTags ? (req.body.lock_tags ? 1 : 0) : Number(row.lock_tags || 0);
  const nextMerchant = hasMerchant ? (req.body.lock_merchant ? 1 : 0) : Number(row.lock_merchant || 0);
  const anyLocked = nextCategory === 1 || nextTags === 1 || nextMerchant === 1;

  if (hasCategory) {
    updates.push('lock_category = ?');
    vals.push(nextCategory);
    updates.push('category_locked = ?');
    vals.push(nextCategory);
  }
  if (hasTags) {
    updates.push('lock_tags = ?');
    vals.push(nextTags);
    updates.push('tags_locked = ?');
    vals.push(nextTags);
  }
  if (hasMerchant) {
    updates.push('lock_merchant = ?');
    vals.push(nextMerchant);
  }
  if (hasReason) {
    updates.push('lock_reason = ?');
    vals.push(req.body.lock_reason ? String(req.body.lock_reason) : null);
  } else if (!anyLocked) {
    updates.push('lock_reason = NULL');
  }
  updates.push(`locked_at = ${anyLocked ? "datetime('now')" : 'NULL'}`);

  db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  res.json({
    ok: true,
    lock_category: nextCategory,
    lock_tags: nextTags,
    lock_merchant: nextMerchant,
    locked: anyLocked,
  });
});

// POST /api/transactions/bulk — bulk update
router.post('/bulk', (req, res) => {
  const db = getDb();
  const { ids, category_id, tags, tags_mode = 'replace', reviewed, is_income_override, exclude_from_totals, merchant_name, is_transfer } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

  const placeholders = ids.map(() => '?').join(',');
  const fields = [];
  const vals = [];
  let updatedViaAppend = 0;
  const forceExclude = is_transfer === true || is_transfer === 1;
  const manualCategoryEdit = category_id !== undefined;
  const manualTagEdit = tags !== undefined;

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (tags !== undefined) {
    if (tags_mode === 'append' || tags_mode === 'remove') {
      const rows = db.prepare(`SELECT id, tags FROM transactions WHERE id IN (${placeholders})`).all(...ids);
      const updateOne = db.prepare(`
        UPDATE transactions
        SET tags = ?, tags_locked = 1, lock_tags = 1, category_source = 'manual_override', lock_reason = 'manual_tag_edit', locked_at = datetime('now')
        WHERE id = ?
      `);
      const nextTags = canonicalizeTags(tags);
      const nextTagSet = new Set(nextTags.map((tag) => tag.toLowerCase()));
      rows.forEach(r => {
        const existing = parseTags(r.tags);
        if (tags_mode === 'append') {
          const merged = [...new Set([...existing, ...nextTags])];
          updateOne.run(JSON.stringify(merged), r.id);
          return;
        }
        if (!nextTagSet.size) {
          updateOne.run('[]', r.id);
          return;
        }
        const filtered = existing.filter((tag) => !nextTagSet.has(String(tag || '').toLowerCase()));
        updateOne.run(JSON.stringify(filtered), r.id);
      });
      updatedViaAppend = rows.length;
    } else {
      fields.push('tags = ?'); vals.push(JSON.stringify(canonicalizeTags(tags)));
    }
  }
  if (reviewed !== undefined) { fields.push('reviewed = ?'); vals.push(reviewed ? 1 : 0); }
  if (is_income_override !== undefined) { fields.push('is_income_override = ?'); vals.push(is_income_override ? 1 : 0); }
  if (is_transfer !== undefined) { fields.push('is_transfer = ?'); vals.push(is_transfer ? 1 : 0); }
  if (exclude_from_totals !== undefined || forceExclude) {
    fields.push('exclude_from_totals = ?');
    vals.push(forceExclude ? 1 : (exclude_from_totals ? 1 : 0));
  }
  if (merchant_name !== undefined) { fields.push('merchant_name = ?'); vals.push(merchant_name || null); }
  if (manualCategoryEdit || manualTagEdit) {
    fields.push('category_source = ?');
    vals.push('manual_override');
  }
  if (manualCategoryEdit) {
    fields.push('category_locked = 1');
    fields.push('lock_category = 1');
    fields.push(`lock_reason = 'manual_bulk_category_edit'`);
    fields.push(`locked_at = datetime('now')`);
  }
  if (manualTagEdit && tags_mode !== 'append' && tags_mode !== 'remove') {
    fields.push('tags_locked = 1');
    fields.push('lock_tags = 1');
    if (!manualCategoryEdit) {
      fields.push(`lock_reason = 'manual_bulk_tag_edit'`);
      fields.push(`locked_at = datetime('now')`);
    }
  }
  if (merchant_name !== undefined) {
    fields.push('lock_merchant = 1');
    if (!manualCategoryEdit && !manualTagEdit) {
      fields.push(`lock_reason = 'manual_bulk_merchant_edit'`);
      fields.push(`locked_at = datetime('now')`);
    }
  }

  let updated = updatedViaAppend;
  if (fields.length) {
    const info = db.prepare(
      `UPDATE transactions SET ${fields.join(', ')} WHERE id IN (${placeholders})`
    ).run(...vals, ...ids);
    updated = Math.max(updated, info.changes);
  }

  if (!fields.length && !updatedViaAppend) return res.status(400).json({ error: 'No fields to update' });

  res.json({ updated });
});

// POST /api/transactions/:id/split — split a transaction
router.post('/:id/split', (req, res) => {
  const db = getDb();
  const { splits } = req.body; // [{ category_id, amount, notes }]

  const tx = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const total = splits.reduce((s, sp) => s + Math.abs(sp.amount), 0);
  const txAbs = Math.abs(tx.amount);
  if (Math.abs(total - txAbs) > 0.01) {
    return res.status(400).json({ error: `Split amounts (${total}) must equal transaction amount (${txAbs})` });
  }

  db.prepare(`DELETE FROM transaction_splits WHERE transaction_id = ?`).run(req.params.id);

  const insert = db.prepare(`
    INSERT INTO transaction_splits (transaction_id, category_id, amount, notes)
    VALUES (?, ?, ?, ?)
  `);

  const doSplit = db.transaction(() => {
    for (const sp of splits) {
      insert.run(req.params.id, sp.category_id, sp.amount, sp.notes || null);
    }
  });
  doSplit();

  res.json({ ok: true, splits: splits.length });
});

// DELETE /api/transactions/bulk — permanently delete selected transactions
router.delete('/bulk', (req, res) => {
  const db = getDb();
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`).all(...ids);
  if (!rows.length) return res.json({ deleted_count: 0, deleted: [] });

  const splitRows = db.prepare(`SELECT * FROM transaction_splits WHERE transaction_id IN (${placeholders})`).all(...ids);
  const splitMap = new Map();
  splitRows.forEach((sp) => {
    const list = splitMap.get(sp.transaction_id) || [];
    list.push(sp);
    splitMap.set(sp.transaction_id, list);
  });

  db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);

  const deleted = rows.map(tx => ({
    ...tx,
    tags: canonicalizeTags(tx.tags),
    splits: splitMap.get(tx.id) || []
  }));

  res.json({ deleted_count: deleted.length, deleted });
});

// DELETE /api/transactions/:id — permanently delete a single transaction
router.delete('/:id', (req, res) => {
  const db = getDb();
  const tx = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const splits = db.prepare(`SELECT * FROM transaction_splits WHERE transaction_id = ?`).all(req.params.id);
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(req.params.id);

  res.json({ deleted: { ...tx, tags: canonicalizeTags(tx.tags), splits } });
});

// POST /api/transactions/restore — restore previously deleted transactions
router.post('/restore', (req, res) => {
  const db = getDb();
  const { transactions } = req.body || {};
  if (!Array.isArray(transactions) || !transactions.length) {
    return res.status(400).json({ error: 'No transactions provided' });
  }

  const insertTx = db.prepare(`
    INSERT OR REPLACE INTO transactions (
      id, account_id, date, description, amount, category_id, tags, notes,
      is_transfer, is_recurring, reviewed, created_at, is_income_override,
      exclude_from_totals, merchant_name, category_source, category_locked, tags_locked,
      lock_category, lock_tags, lock_merchant, lock_reason, locked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteSplits = db.prepare(`DELETE FROM transaction_splits WHERE transaction_id = ?`);
  const insertSplit = db.prepare(`
    INSERT INTO transaction_splits (transaction_id, category_id, amount, notes)
    VALUES (?, ?, ?, ?)
  `);

  const restore = db.transaction(() => {
    transactions.forEach((tx) => {
      insertTx.run(
        tx.id,
        tx.account_id,
        tx.date,
        tx.description,
        tx.amount,
        tx.category_id || null,
        JSON.stringify(canonicalizeTags(tx.tags || [])),
        tx.notes || null,
        tx.is_transfer ? 1 : 0,
        tx.is_recurring ? 1 : 0,
        tx.reviewed ? 1 : 0,
        tx.created_at,
        tx.is_income_override ? 1 : 0,
        tx.exclude_from_totals ? 1 : 0,
        tx.merchant_name || null,
        tx.category_source || 'import_default',
        tx.category_locked ? 1 : 0,
        tx.tags_locked ? 1 : 0,
        tx.lock_category ? 1 : 0,
        tx.lock_tags ? 1 : 0,
        tx.lock_merchant ? 1 : 0,
        tx.lock_reason || null,
        tx.locked_at || null,
      );

      deleteSplits.run(tx.id);
      (tx.splits || []).forEach((sp) => {
        insertSplit.run(tx.id, sp.category_id, sp.amount, sp.notes || null);
      });
    });
  });

  restore();
  res.json({ restored: transactions.length });
});

module.exports = router;
