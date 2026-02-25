// server/routes/analytics.js
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

// Returns a helper that adds a CTE for income-matched transactions
// Usage: const { cte, incomeJoin, incomeFlag } = getIncomeCTE(db)
// Then prepend cte to SQL, and use incomeFlag in CASE expressions
function getIncomeCTE(db) {
  const sources = db.prepare(`SELECT keyword, match_type FROM income_sources`).all();

  if (!sources.length) {
    // No sources: income is always 0 (no matches)
    return {
      cte: '',
      incomeJoin: '',
      incomeFlag: '(t.is_income_override = 1 OR cat.is_income = 1)',
      params: [],
    };
  }

  // Build income flag: matches income-source keywords OR income category OR per-tx override
  const conditions = sources.map(s => {
    const kw = s.keyword.replace(/'/g, "''");
    if (s.match_type === 'exact') {
      return `UPPER(t.description) = UPPER('${kw}')`;
    }
    return `UPPER(t.description) LIKE UPPER('%${kw}%')`;
  });

  const incomeFlag = `(t.is_income_override = 1 OR cat.is_income = 1 OR ${conditions.join(' OR ')})`;

  return {
    cte: '',
    incomeJoin: '',
    incomeFlag,
    params: [],
  };
}

// GET /api/analytics/spending-by-category
router.get('/spending-by-category', (req, res) => {
  const db = getDb();
  const { month, account_id, start_date, end_date } = req.query;

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0', 't.amount < 0', '(cat.is_income IS NULL OR cat.is_income = 0)'];
  let params = [];
  if (month)      { where.push("strftime('%Y-%m', t.date) = ?"); params.push(month); }
  if (start_date) { where.push('t.date >= ?'); params.push(start_date); }
  if (end_date)   { where.push('t.date <= ?'); params.push(end_date); }
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

  const rows = db.prepare(`
    SELECT COALESCE(c.name,'Uncategorized') as category,
           COALESCE(c.color,'#94a3b8') as color,
           c.id as category_id,
           COUNT(*) as count, SUM(ABS(t.amount)) as total
    FROM transactions t
    LEFT JOIN categories c   ON c.id = t.category_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE ${where.join(' AND ')}
    GROUP BY c.id, c.name
    ORDER BY total DESC
  `).all(...params);
  res.json(rows);
});

// GET /api/analytics/monthly-trend
router.get('/monthly-trend', (req, res) => {
  const db = getDb();
  const { months = 18, account_id } = req.query;
  const { incomeFlag } = getIncomeCTE(db);

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0'];
  let params = [];
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

  const rows = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month,
      SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0) THEN ABS(t.amount) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE ${where.join(' AND ')}
    GROUP BY month ORDER BY month DESC LIMIT ?
  `).all(...params, parseInt(months));

  res.json(rows.reverse());
});

// GET /api/analytics/category-breakdown
router.get('/category-breakdown', (req, res) => {
  const db = getDb();
  const { category_id, start_date, end_date, account_id } = req.query;

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0', 't.amount < 0'];
  let params = [];

  if (category_id === 'null' || !category_id) {
    where.push('t.category_id IS NULL');
  } else {
    where.push('t.category_id = ?'); params.push(category_id);
  }
  if (start_date)  { where.push('t.date >= ?'); params.push(start_date); }
  if (end_date)    { where.push('t.date <= ?'); params.push(end_date); }
  if (account_id)  { where.push('t.account_id = ?'); params.push(account_id); }

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month, COUNT(*) as tx_count,
           SUM(ABS(t.amount)) as total, MIN(ABS(t.amount)) as min_tx, MAX(ABS(t.amount)) as max_tx
    FROM transactions t
    WHERE ${where.join(' AND ')}
    GROUP BY month ORDER BY month ASC
  `).all(...params);

  const merchants = db.prepare(`
    SELECT description, COUNT(*) as count, SUM(ABS(amount)) as total
    FROM transactions t
    WHERE ${where.join(' AND ')}
    GROUP BY description ORDER BY total DESC LIMIT 15
  `).all(...params);

  const totals = monthly.map(m => m.total);
  const avg = totals.length ? totals.reduce((s,v)=>s+v,0)/totals.length : 0;
  res.json({ monthly, avg, min: totals.length ? Math.min(...totals) : 0, max: totals.length ? Math.max(...totals) : 0, grandTotal: totals.reduce((s,v)=>s+v,0), merchants });
});

// GET /api/analytics/month-transactions
router.get('/month-transactions', (req, res) => {
  const db = getDb();
  const { month, category_id, start_date, end_date, sort = 'date', order = 'desc' } = req.query;

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0'];
  let params = [];
  if (month)      { where.push("strftime('%Y-%m', t.date) = ?"); params.push(month); }
  if (start_date) { where.push('t.date >= ?'); params.push(start_date); }
  if (end_date)   { where.push('t.date <= ?'); params.push(end_date); }

  if (category_id === 'null' || category_id === '') {
    where.push('t.category_id IS NULL');
    where.push('t.amount < 0');
  } else if (category_id) {
    where.push('t.category_id = ?'); params.push(category_id);
    where.push('t.amount < 0');
  }

  const sortMap = { date: 't.date', amount: 'ABS(t.amount)', description: 't.description' };
  const sortCol = sortMap[sort] || 't.date';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const rows = db.prepare(`
    SELECT t.*, a.name as account_name, a.currency,
           c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${where.length ? where.join(' AND ') : '1=1'}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT 500
  `).all(...params);

  const transactions = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
  const total = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);
  res.json({ transactions, total, count: transactions.length });
});

// GET /api/analytics/merchant-search
router.get('/merchant-search', (req, res) => {
  const db = getDb();
  const { q, start_date, end_date, account_id } = req.query;
  if (!q || q.length < 2) return res.json([]);

  const merchantLabelExpr = "COALESCE(NULLIF(TRIM(merchant_name), ''), description)";
  let where = ['exclude_from_totals = 0', 'is_transfer = 0', `UPPER(${merchantLabelExpr}) LIKE ?`];
  let params = [`%${q.toUpperCase()}%`];
  if (start_date) { where.push('date >= ?'); params.push(start_date); }
  if (end_date)   { where.push('date <= ?'); params.push(end_date); }
  if (account_id) { where.push('account_id = ?'); params.push(account_id); }

  res.json(db.prepare(`
    SELECT ${merchantLabelExpr} as description,
           COUNT(*) as count, SUM(ABS(amount)) as total,
           MIN(date) as first_seen, MAX(date) as last_seen
    FROM transactions
    WHERE ${where.join(' AND ')}
    GROUP BY ${merchantLabelExpr} ORDER BY total DESC LIMIT 20
  `).all(...params));
});

// GET /api/analytics/top-merchants
router.get('/top-merchants', (req, res) => {
  const db = getDb();
  const { month, limit = 15, account_id } = req.query;
  let where = ['exclude_from_totals = 0', 'is_transfer = 0', 'amount < 0'];
  let params = [];
  if (month)      { where.push("strftime('%Y-%m', date) = ?"); params.push(month); }
  if (account_id) { where.push('account_id = ?'); params.push(account_id); }
  res.json(db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(merchant_name), ''), description) as description,
           SUM(ABS(amount)) as total, COUNT(*) as count
    FROM transactions WHERE ${where.join(' AND ')}
    GROUP BY COALESCE(NULLIF(TRIM(merchant_name), ''), description) ORDER BY total DESC LIMIT ?
  `).all(...params, parseInt(limit)));
});

// GET /api/analytics/cashflow
router.get('/cashflow', (req, res) => {
  const db = getDb();
  const { start_date, end_date, account_id } = req.query;
  const { incomeFlag } = getIncomeCTE(db);

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0'];
  let params = [];
  if (start_date) { where.push('t.date >= ?'); params.push(start_date); }
  if (end_date)   { where.push('t.date <= ?'); params.push(end_date); }
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const daily = db.prepare(`
    SELECT t.date,
      SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0) THEN ABS(t.amount) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN categories cat ON cat.id = t.category_id
    ${wc}
    GROUP BY t.date ORDER BY t.date ASC
  `).all(...params);

  let running = 0;
  res.json(daily.map(d => { running += d.income - d.expenses; return { ...d, net: d.income - d.expenses, running_total: running }; }));
});

// GET /api/analytics/accounts-summary
router.get('/accounts-summary', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`
    SELECT a.*, COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) as computed_balance
    FROM accounts a ORDER BY a.type, a.name
  `).all());
});

// GET /api/analytics/year-summary
router.get('/year-summary', (req, res) => {
  const db = getDb();
  const year = String(req.query.year || new Date().getFullYear());
  const account_id = req.query.account_id;
  const { incomeFlag } = getIncomeCTE(db);

  let where = ['t.exclude_from_totals = 0', 't.is_transfer = 0', `strftime('%Y', t.date) = '${year}'`];
  let params = [];
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  const wc = where.join(' AND ');

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month,
      SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0) THEN ABS(t.amount) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE ${wc}
    GROUP BY month ORDER BY month ASC
  `).all(...params);

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name,'Uncategorized') as category,
           COALESCE(c.color,'#94a3b8') as color, c.id as category_id,
           COUNT(*) as tx_count, SUM(ABS(t.amount)) as total,
           SUM(ABS(t.amount))/12.0 as monthly_avg
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE ${wc} AND t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0)
    GROUP BY c.id, c.name ORDER BY total DESC
  `).all(...params);

  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as total_income,
      SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0) THEN ABS(t.amount) ELSE 0 END) as total_expenses,
      COUNT(*) as tx_count
    FROM transactions t
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE ${wc}
  `).get(...params);

  res.json({ monthly, byCategory, totals, year });
});

// GET /api/analytics/dashboard-summary
router.get('/dashboard-summary', (req, res) => {
  const db = getDb();
  const m = req.query.month || new Date().toISOString().slice(0,7);
  const { incomeFlag } = getIncomeCTE(db);

  const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0) THEN ABS(t.amount) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN categories cat ON cat.id = t.category_id
    WHERE t.exclude_from_totals = 0 AND t.is_transfer = 0 AND strftime('%Y-%m', t.date) = ?
  `).get(m);

  res.json({ ...summary, month: m });
});

module.exports = router;
