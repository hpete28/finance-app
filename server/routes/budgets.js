// server/routes/budgets.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/budgets?month=YYYY-MM
router.get('/', (req, res) => {
  const db = getDb();
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const budgets = db.prepare(`
    SELECT b.*,
           c.name as category_name, c.color as category_color,
           COALESCE((
             SELECT SUM(ABS(t.amount))
             FROM transactions t
             WHERE t.category_id = b.category_id
               AND strftime('%Y-%m', t.date) = ?
               AND t.amount < 0
               AND t.exclude_from_totals = 0
               AND t.is_transfer = 0
           ), 0) as spent,
           COALESCE((
             SELECT SUM(ts.amount)
             FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category_id = b.category_id
               AND strftime('%Y-%m', t.date) = ?
               AND t.amount < 0
               AND t.exclude_from_totals = 0
               AND t.is_transfer = 0
           ), 0) as spent_splits
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    WHERE b.month = ?
    ORDER BY c.name ASC
  `).all(month, month, month);

  // Calculate effective budget including rollover
  const result = budgets.map(b => {
    const effectiveBudget = b.amount + (b.rollover ? b.rollover_amount : 0);
    const totalSpent = b.spent + b.spent_splits;
    const remaining = effectiveBudget - totalSpent;
    const pct = effectiveBudget > 0 ? (totalSpent / effectiveBudget) * 100 : 0;
    const status = pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'safe';
    return { ...b, effective_budget: effectiveBudget, spent: totalSpent, remaining, pct, status };
  });

  // Income vs Expenses summary
  const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
      AND exclude_from_totals = 0
      AND is_transfer = 0
  `).get(month);

  res.json({ budgets: result, summary, month });
});

// PUT /api/budgets — upsert a budget for a category/month
router.put('/', (req, res) => {
  const db = getDb();
  const { category_id, month, amount, rollover } = req.body;
  if (!category_id || !month || amount === undefined) {
    return res.status(400).json({ error: 'category_id, month, and amount required' });
  }

  db.prepare(`
    INSERT INTO budgets (category_id, month, amount, rollover)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category_id, month) DO UPDATE SET
      amount   = excluded.amount,
      rollover = excluded.rollover
  `).run(category_id, month, amount, rollover ? 1 : 0);

  res.json({ ok: true });
});

// POST /api/budgets/rollover — compute and write rollover amounts for next month
router.post('/rollover', (req, res) => {
  const db = getDb();
  const { from_month } = req.body; // YYYY-MM
  if (!from_month) return res.status(400).json({ error: 'from_month required' });

  const [year, month] = from_month.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // JS month is 0-indexed
  const to_month = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const budgets = db.prepare(`
    SELECT b.*, c.name as category_name,
           COALESCE((
             SELECT SUM(ABS(t.amount))
             FROM transactions t
             WHERE t.category_id = b.category_id
               AND strftime('%Y-%m', t.date) = ?
               AND t.amount < 0
               AND t.exclude_from_totals = 0
               AND t.is_transfer = 0
           ), 0) as spent
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    WHERE b.month = ? AND b.rollover = 1
  `).all(from_month, from_month);

  const upsert = db.prepare(`
    INSERT INTO budgets (category_id, month, amount, rollover, rollover_amount)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(category_id, month) DO UPDATE SET
      rollover_amount = excluded.rollover_amount
  `);

  const doRollover = db.transaction(() => {
    let rolled = 0;
    for (const b of budgets) {
      const remaining = b.amount - b.spent;
      upsert.run(b.category_id, to_month, b.amount, remaining);
      rolled++;
    }
    return rolled;
  });

  const rolled = doRollover();
  res.json({ ok: true, rolled, to_month });
});

module.exports = router;
