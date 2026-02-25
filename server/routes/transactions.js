// server/routes/transactions.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { categorize } = require('../services/categorizer');
const { detectTransferCandidates } = require('../services/transferDetection');
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
  try {
    const parsed = JSON.parse(rawTags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
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
  if (tag) { where.push('t.tags LIKE ?'); params.push(`%${tag}%`); }
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
  const allowedSort = ['date', 'amount', 'description'];
  const sortCol = allowedSort.includes(sort) ? sort : 'date';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  return { whereClause, params, sortCol, sortOrder };
}

// GET /api/transactions — list with filtering, pagination, sorting
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 50, 1);
  const offset = (pageNum - 1) * limitNum;
  const { whereClause, params, sortCol, sortOrder } = buildTransactionsQueryState(db, req.query);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM transactions t ${whereClause}
  `).get(...params);

  const rows = db.prepare(`
    ${TRANSACTION_SELECT_SQL}
    ${whereClause}
    ORDER BY t.${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  // Parse tags JSON
  const transactions = rows.map(r => ({ ...r, tags: parseTags(r.tags) }));

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
    const { whereClause, params, sortCol, sortOrder } = buildTransactionsQueryState(db, req.query);
    const stmt = db.prepare(`
      ${TRANSACTION_SELECT_SQL}
      ${whereClause}
      ORDER BY t.${sortCol} ${sortOrder}
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
        tags: parseTags(row.tags).join(', '),
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

  res.json({ ...tx, tags: JSON.parse(tx.tags || '[]'), splits });
});

// PATCH /api/transactions/:id — update single transaction
router.patch('/:id', (req, res) => {
  const db = getDb();
  const { category_id, notes, tags, is_transfer, reviewed, is_income_override, exclude_from_totals, merchant_name } = req.body;
  const fields = [];
  const vals = [];
  const forceExclude = is_transfer === true || is_transfer === 1;

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
  if (tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(tags)); }
  if (is_transfer !== undefined) { fields.push('is_transfer = ?'); vals.push(is_transfer ? 1 : 0); }
  if (reviewed !== undefined) { fields.push('reviewed = ?'); vals.push(reviewed ? 1 : 0); }
  if (is_income_override !== undefined) { fields.push('is_income_override = ?'); vals.push(is_income_override ? 1 : 0); }
  if (exclude_from_totals !== undefined || forceExclude) {
    fields.push('exclude_from_totals = ?');
    vals.push(forceExclude ? 1 : (exclude_from_totals ? 1 : 0));
  }
  if (merchant_name !== undefined) { fields.push('merchant_name = ?'); vals.push(merchant_name || null); }

  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  res.json({ ok: true });
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

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (tags !== undefined) {
    if (tags_mode === 'append') {
      const rows = db.prepare(`SELECT id, tags FROM transactions WHERE id IN (${placeholders})`).all(...ids);
      const updateOne = db.prepare(`UPDATE transactions SET tags = ? WHERE id = ?`);
      rows.forEach(r => {
        const existing = JSON.parse(r.tags || '[]');
        const merged = [...new Set([...existing, ...tags])];
        updateOne.run(JSON.stringify(merged), r.id);
      });
      updatedViaAppend = rows.length;
    } else {
      fields.push('tags = ?'); vals.push(JSON.stringify(tags));
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
    tags: JSON.parse(tx.tags || '[]'),
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

  res.json({ deleted: { ...tx, tags: JSON.parse(tx.tags || '[]'), splits } });
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
      exclude_from_totals, merchant_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(tx.tags || []),
        tx.notes || null,
        tx.is_transfer ? 1 : 0,
        tx.is_recurring ? 1 : 0,
        tx.reviewed ? 1 : 0,
        tx.created_at,
        tx.is_income_override ? 1 : 0,
        tx.exclude_from_totals ? 1 : 0,
        tx.merchant_name || null,
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
