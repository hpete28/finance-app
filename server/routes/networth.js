// server/routes/networth.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

function computeNetWorth(db) {
  // Account balances from transactions
  const accounts = db.prepare(`
    SELECT a.name, a.type, a.currency,
           COALESCE(SUM(t.amount), 0) as balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
  `).all();

  // Manual assets
  const manualAssets = db.prepare(`SELECT * FROM manual_assets`).all();

  let totalAssets = 0;
  let totalLiabilities = 0;

  const breakdown = { accounts: [], manual: [] };

  for (const acc of accounts) {
    const bal = acc.balance;
    if (acc.type === 'checking' || acc.type === 'savings' || acc.type === 'investment') {
      totalAssets += Math.max(0, bal);
      breakdown.accounts.push({ ...acc, balance: bal, side: 'asset' });
    } else if (acc.type === 'credit_card') {
      // Credit card: negative balance = debt (liability), positive = credit
      if (bal < 0) totalLiabilities += Math.abs(bal);
      breakdown.accounts.push({ ...acc, balance: bal, side: 'liability' });
    }
  }

  for (const ma of manualAssets) {
    if (ma.type === 'asset') totalAssets += ma.value;
    else totalLiabilities += ma.value;
    breakdown.manual.push(ma);
  }

  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, breakdown };
}

// GET /api/networth/current
router.get('/current', (req, res) => {
  const db = getDb();
  res.json(computeNetWorth(db));
});

// POST /api/networth/snapshot — save a net worth snapshot
router.post('/snapshot', (req, res) => {
  const db = getDb();
  const nw = computeNetWorth(db);
  const today = new Date().toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO net_worth_snapshots (date, total_assets, total_liabilities, net_worth, snapshot_data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(today, nw.totalAssets, nw.totalLiabilities, nw.netWorth, JSON.stringify(nw.breakdown));

  res.json({ ok: true, ...nw });
});

// GET /api/networth/history
router.get('/history', (req, res) => {
  const db = getDb();
  const { limit = 24 } = req.query;
  const history = db.prepare(`
    SELECT date, total_assets, total_liabilities, net_worth
    FROM net_worth_snapshots
    ORDER BY date DESC
    LIMIT ?
  `).all(parseInt(limit));
  res.json(history.reverse());
});

// Manual assets CRUD
router.get('/assets', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT * FROM manual_assets ORDER BY type, name`).all());
});

router.post('/assets', (req, res) => {
  const db = getDb();
  const { name, type = 'asset', value, notes } = req.body;
  if (!name || value === undefined) return res.status(400).json({ error: 'name and value required' });
  const info = db.prepare(`
    INSERT INTO manual_assets (name, type, value, notes) VALUES (?, ?, ?, ?)
  `).run(name, type, value, notes || null);
  res.json({ id: info.lastInsertRowid });
});

router.patch('/assets/:id', (req, res) => {
  const db = getDb();
  const { name, type, value, notes } = req.body;
  db.prepare(`
    UPDATE manual_assets SET
      name  = COALESCE(?, name),
      type  = COALESCE(?, type),
      value = COALESCE(?, value),
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, type, value, notes, req.params.id);
  res.json({ ok: true });
});

router.delete('/assets/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM manual_assets WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
