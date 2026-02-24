// server/routes/rules.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { recategorizeAll } = require('../services/categorizer');

router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM rules r
    JOIN categories c ON c.id = r.category_id
    ORDER BY r.priority DESC, r.id ASC
  `).all();
  res.json(rules);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { keyword, match_type = 'contains_case_insensitive', category_id, priority = 10 } = req.body;
  if (!keyword || !category_id) return res.status(400).json({ error: 'keyword and category_id required' });
  const info = db.prepare(`
    INSERT INTO rules (keyword, match_type, category_id, priority) VALUES (?, ?, ?, ?)
  `).run(keyword, match_type, category_id, priority);
  res.json({ id: info.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { keyword, match_type, category_id, priority } = req.body;
  db.prepare(`
    UPDATE rules SET
      keyword    = COALESCE(?, keyword),
      match_type = COALESCE(?, match_type),
      category_id= COALESCE(?, category_id),
      priority   = COALESCE(?, priority)
    WHERE id = ?
  `).run(keyword, match_type, category_id, priority, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM rules WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// POST /api/rules/apply — re-run categorization over all transactions
router.post('/apply', (req, res) => {
  const { overwrite = false } = req.body;
  const count = recategorizeAll(overwrite);
  res.json({ categorized: count });
});


// POST /api/rules/learn — auto-generate rules from manually categorized transactions
router.post('/learn', (req, res) => {
  const db = getDb();
  const minCount = Math.max(2, parseInt(req.body.min_count) || 3);
  const maxNewRules = Math.min(100, Math.max(10, parseInt(req.body.max_new_rules) || 60));

  // Find description patterns that always map to the same category
  // Only look at manually categorized transactions (not just auto-categorized would require a flag,
  // so we look at ALL categorized transactions and find consistent patterns)
  const patterns = db.prepare(`
    SELECT 
      UPPER(t.description) as desc_upper,
      t.description,
      t.category_id,
      c.name as category_name,
      COUNT(*) as count
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.category_id IS NOT NULL
    GROUP BY UPPER(t.description), t.category_id
    HAVING COUNT(*) >= ?
    ORDER BY count DESC
    LIMIT 1000
  `).all(minCount);

  const existingKeywords = new Set(
    db.prepare(`SELECT UPPER(keyword) as k FROM rules`).all().map(r => r.k)
  );

  let created = 0, skipped = 0, analyzed = patterns.length;

  const insert = db.prepare(`
    INSERT INTO rules (keyword, match_type, category_id, priority)
    VALUES (?, 'contains_case_insensitive', ?, 5)
  `);

  const normalizeKeyword = (description) => {
    const cleaned = description
      .toUpperCase()
      .replace(/[0-9]{2,}/g, ' ')
      .replace(/[#*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 4) return '';
    if (/^[0-9\s\-]+$/.test(cleaned)) return '';
    return cleaned.slice(0, 32);
  };

  db.transaction(() => {
    for (const p of patterns) {
      if (created >= maxNewRules) break;
      const kw = normalizeKeyword(p.description);
      if (!kw || existingKeywords.has(kw)) { skipped++; continue; }
      insert.run(kw, p.category_id);
      existingKeywords.add(kw);
      created++;
    }
  })();

  res.json({ created, skipped, analyzed, capped_at: maxNewRules, min_count: minCount });
});

module.exports = router;
