// server/routes/bills.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/bills
router.get('/', (req, res) => {
  const db = getDb();
  const bills = db.prepare(`
    SELECT b.*, c.name as category_name, a.name as account_name
    FROM bills b
    LEFT JOIN categories c ON c.id = b.category_id
    LEFT JOIN accounts a ON a.id = b.account_id
    WHERE b.is_active = 1
    ORDER BY b.due_day ASC
  `).all();

  // Check TD checking balance for upcoming bill warning
  const checkingBalance = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as bal
    FROM transactions
    WHERE account_id = (SELECT id FROM accounts WHERE name = 'TD CAD Checking')
  `).get();

  // Bills due in next 7 days
  const today = new Date();
  const in7 = new Date(today.getTime() + 7 * 86400000);

  const upcoming = bills.filter(b => {
    if (!b.next_due) return false;
    const due = new Date(b.next_due);
    return due >= today && due <= in7;
  });

  const upcomingTotal = upcoming.reduce((s, b) => s + b.amount, 0);
  const warning = checkingBalance.bal < upcomingTotal;

  res.json({ bills, upcoming, upcomingTotal, checkingBalance: checkingBalance.bal, warning });
});

// POST /api/bills
router.post('/', (req, res) => {
  const db = getDb();
  const { name, amount, due_day, frequency = 'monthly', category_id, account_id, notes } = req.body;
  if (!name || !amount || !due_day) {
    return res.status(400).json({ error: 'name, amount, due_day required' });
  }

  // Calculate next due date
  const today = new Date();
  let nextDue = new Date(today.getFullYear(), today.getMonth(), due_day);
  if (nextDue <= today) nextDue.setMonth(nextDue.getMonth() + 1);
  const nextDueStr = nextDue.toISOString().split('T')[0];

  const info = db.prepare(`
    INSERT INTO bills (name, amount, due_day, frequency, category_id, account_id, notes, next_due)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, amount, due_day, frequency, category_id || null, account_id || null, notes || null, nextDueStr);

  res.json({ id: info.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, amount, due_day, frequency, category_id, is_active, last_paid, next_due, notes } = req.body;
  db.prepare(`
    UPDATE bills SET
      name        = COALESCE(?, name),
      amount      = COALESCE(?, amount),
      due_day     = COALESCE(?, due_day),
      frequency   = COALESCE(?, frequency),
      category_id = COALESCE(?, category_id),
      is_active   = COALESCE(?, is_active),
      last_paid   = COALESCE(?, last_paid),
      next_due    = COALESCE(?, next_due),
      notes       = COALESCE(?, notes)
    WHERE id = ?
  `).run(name, amount, due_day, frequency, category_id, is_active, last_paid, next_due, notes, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE bills SET is_active = 0 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// GET /api/bills/recurring — auto-detected recurring transactions
router.get('/recurring', (req, res) => {
  const { detectRecurring } = require('../services/categorizer');
  const patterns = detectRecurring();
  res.json(patterns);
});

module.exports = router;


// ====== Net Worth Routes (separate file below) ======
