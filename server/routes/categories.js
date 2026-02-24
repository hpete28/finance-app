// server/routes/categories.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const db = getDb();
  const cats = db.prepare(`
    SELECT c.*, p.name as parent_name,
           (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) as tx_count
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    ORDER BY c.name COLLATE NOCASE ASC
  `).all();
  res.json(cats);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, parent_id, color, icon, is_income } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare(`
    INSERT INTO categories (name, parent_id, color, icon, is_system, is_income)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(name, parent_id || null, color || '#6366f1', icon || null, is_income ? 1 : 0);
  res.json({ id: info.lastInsertRowid, name });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, parent_id, color, icon, is_income } = req.body;
  db.prepare(`
    UPDATE categories SET
      name      = COALESCE(?, name),
      parent_id = COALESCE(?, parent_id),
      color     = COALESCE(?, color),
      icon      = COALESCE(?, icon),
      is_income = CASE WHEN ? IS NOT NULL THEN ? ELSE is_income END
    WHERE id = ?
  `).run(name, parent_id, color, icon, is_income !== undefined ? 1 : null, is_income ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE transactions SET category_id = NULL WHERE category_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM categories WHERE id = ? AND is_system = 0`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
