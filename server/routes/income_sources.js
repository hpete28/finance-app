// server/routes/income_sources.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT * FROM income_sources ORDER BY keyword ASC`).all());
});

router.post('/', (req, res) => {
  const db = getDb();
  const { keyword, match_type = 'contains', notes } = req.body;
  if (!keyword?.trim()) return res.status(400).json({ error: 'Keyword required' });
  const info = db.prepare(
    `INSERT INTO income_sources (keyword, match_type, notes) VALUES (?, ?, ?)`
  ).run(keyword.trim(), match_type, notes || null);
  res.json({ id: info.lastInsertRowid, keyword, match_type, notes });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM income_sources WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// GET /api/income-sources/preview — shows what would be counted as income
router.get('/preview', (req, res) => {
  const db = getDb();
  const sources = db.prepare(`SELECT * FROM income_sources`).all();
  if (!sources.length) return res.json({ transactions: [], total: 0, sources: [] });

  // Build WHERE clause matching any keyword
  const conditions = sources.map(s =>
    s.match_type === 'exact'
      ? `UPPER(t.description) = UPPER(?)`
      : `UPPER(t.description) LIKE UPPER(?)`
  );
  const params = sources.map(s =>
    s.match_type === 'exact' ? s.keyword : `%${s.keyword}%`
  );

  const rows = db.prepare(`
    SELECT t.date, t.description, t.amount,
           a.name as account_name,
           c.name as category_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.amount > 0 AND (${conditions.join(' OR ')})
    ORDER BY t.date DESC
    LIMIT 50
  `).all(...params);

  const total = db.prepare(`
    SELECT SUM(amount) as total
    FROM transactions t
    WHERE t.amount > 0 AND (${conditions.join(' OR ')})
  `).get(...params);

  res.json({ transactions: rows, total: total?.total || 0, sources });
});

module.exports = router;
