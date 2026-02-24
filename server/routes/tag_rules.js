const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { retagAll } = require('../services/tagger');

router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`
    SELECT id, keyword, match_type, tag, priority, created_at
    FROM tag_rules
    ORDER BY priority DESC, id ASC
  `).all();
  res.json(rules);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { keyword, match_type = 'contains_case_insensitive', tag, priority = 10 } = req.body;
  const trimmedKeyword = String(keyword || '').trim();
  const trimmedTag = String(tag || '').trim();
  if (!trimmedKeyword || !trimmedTag) {
    return res.status(400).json({ error: 'keyword and tag are required' });
  }

  const info = db.prepare(`
    INSERT INTO tag_rules (keyword, match_type, tag, priority)
    VALUES (?, ?, ?, ?)
  `).run(trimmedKeyword, match_type, trimmedTag, priority);

  res.json({ id: info.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { keyword, match_type, tag, priority } = req.body;
  db.prepare(`
    UPDATE tag_rules SET
      keyword = COALESCE(?, keyword),
      match_type = COALESCE(?, match_type),
      tag = COALESCE(?, tag),
      priority = COALESCE(?, priority)
    WHERE id = ?
  `).run(keyword ? String(keyword).trim() : null, match_type, tag ? String(tag).trim() : null, priority, req.params.id);

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM tag_rules WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/apply', (req, res) => {
  const { overwrite = false } = req.body;
  const count = retagAll(overwrite);
  res.json({ tagged: count });
});

module.exports = router;
