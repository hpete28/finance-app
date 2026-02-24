// server/routes/transactions.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { categorize } = require('../services/categorizer');
const { v4: uuidv4 } = require('uuid');

// GET /api/transactions — list with filtering, pagination, sorting
router.get('/', (req, res) => {
  const db = getDb();
  const {
    page = 1, limit = 50, account_id, category_id, month,
    start_date, end_date, search, tag, uncategorized, is_recurring,
    sort = 'date', order = 'desc',
    amount_search,   // partial amount string e.g. "432" matches $432.xx
    amount_min, amount_max
  } = req.query;

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
  if (search) { where.push('UPPER(t.description) LIKE ?'); params.push(`%${search.toUpperCase()}%`); }
  if (tag) { where.push("t.tags LIKE ?"); params.push(`%${tag}%`); }
  if (is_recurring === 'true') { where.push('t.is_recurring = 1'); }

  // Amount search — matches partial dollar amounts live as user types
  if (amount_search && amount_search.trim()) {
    // Strip leading $ or - so user can type "432" or "$432" or "432.27"
    const cleaned = amount_search.replace(/^[$-]+/, '').replace(/,/g, '');
    where.push(`CAST(ABS(t.amount) AS TEXT) LIKE ?`);
    params.push(`${cleaned}%`);
  }
  if (amount_min) { where.push('ABS(t.amount) >= ?'); params.push(parseFloat(amount_min)); }
  if (amount_max) { where.push('ABS(t.amount) <= ?'); params.push(parseFloat(amount_max)); }

  // Income-source filtering: only show transactions matching income_sources keywords
  if (req.query.type === 'income') {
    const sources = db.prepare('SELECT keyword, match_type FROM income_sources').all();
    if (sources.length) {
      const conds = sources.map(s => {
        const kw = s.keyword.replace(/'/g, "''");
        return s.match_type === 'exact'
          ? `UPPER(t.description) = UPPER('${kw}')`
          : `UPPER(t.description) LIKE UPPER('%${kw}%')`;
      });
      where.push(`t.amount > 0`);
      where.push(`(${conds.join(' OR ')})`);
    } else {
      // No income sources defined — return nothing
      where.push('1 = 0');
    }
  } else if (req.query.type === 'expense') {
    where.push('t.amount < 0');
    // Exclude income-category transactions from expenses
    const incomeCats = db.prepare("SELECT id FROM categories WHERE is_income = 1").all();
    if (incomeCats.length) {
      const ids = incomeCats.map(c => c.id).join(',');
      where.push(`(t.category_id IS NULL OR t.category_id NOT IN (${ids}))`);
    }
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const allowedSort = ['date', 'amount', 'description'];
  const sortCol = allowedSort.includes(sort) ? sort : 'date';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM transactions t ${whereClause}
  `).get(...params);

  const rows = db.prepare(`
    SELECT t.*,
           a.name as account_name, a.currency,
           c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereClause}
    ORDER BY t.${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Parse tags JSON
  const transactions = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));

  res.json({
    transactions,
    total: countRow.total,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(countRow.total / parseInt(limit))
  });
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
  const { category_id, notes, tags, is_transfer, reviewed, is_income_override } = req.body;
  const fields = [];
  const vals = [];

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
  if (tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(tags)); }
  if (is_transfer !== undefined) { fields.push('is_transfer = ?'); vals.push(is_transfer ? 1 : 0); }
  if (reviewed !== undefined) { fields.push('reviewed = ?'); vals.push(reviewed ? 1 : 0); }
  if (is_income_override !== undefined) { fields.push('is_income_override = ?'); vals.push(is_income_override ? 1 : 0); }

  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  res.json({ ok: true });
});

// POST /api/transactions/bulk — bulk update
router.post('/bulk', (req, res) => {
  const db = getDb();
  const { ids, category_id, tags, reviewed, is_income_override } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

  const placeholders = ids.map(() => '?').join(',');
  const fields = [];
  const vals = [];

  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id || null); }
  if (tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(tags)); }
  if (reviewed !== undefined) { fields.push('reviewed = ?'); vals.push(reviewed ? 1 : 0); }
  if (is_income_override !== undefined) { fields.push('is_income_override = ?'); vals.push(is_income_override ? 1 : 0); }

  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  const info = db.prepare(
    `UPDATE transactions SET ${fields.join(', ')} WHERE id IN (${placeholders})`
  ).run(...vals, ...ids);

  res.json({ updated: info.changes });
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

// GET /api/transactions/summary/monthly — income/expense summary
router.get('/summary/monthly', (req, res) => {
  const db = getDb();
  const { months = 12, account_id } = req.query;

  let where = '';
  let params = [];
  if (account_id) { where = 'WHERE account_id = ?'; params.push(account_id); }

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

module.exports = router;
