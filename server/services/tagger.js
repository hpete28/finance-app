const { getDb } = require('../database');
const { normalizeForMatching } = require('./categorizer');

function getTagRules() {
  const db = getDb();
  return db.prepare(`
    SELECT id, keyword, match_type, tag, priority
    FROM tag_rules
    ORDER BY priority DESC, LENGTH(keyword) DESC, id ASC
  `).all();
}

function getMatchedTags(description, rulesOverride = null) {
  const rules = rulesOverride || getTagRules();
  const rawDesc = String(description || '');
  const normalizedDesc = normalizeForMatching(rawDesc);
  const matchedTags = [];

  for (const rule of rules) {
    const rawKeyword = String(rule.keyword || '');
    const normalizedKeyword = normalizeForMatching(rawKeyword);
    let matched = false;

    switch (rule.match_type) {
      case 'contains_case_insensitive':
        matched = normalizedKeyword.length > 0 && normalizedDesc.includes(normalizedKeyword);
        break;
      case 'starts_with':
        matched = normalizedKeyword.length > 0 && normalizedDesc.startsWith(normalizedKeyword);
        break;
      case 'exact':
        matched = normalizedDesc === normalizedKeyword;
        break;
      case 'regex':
        try {
          matched = new RegExp(rawKeyword, 'i').test(rawDesc);
        } catch (e) { matched = false; }
        break;
      default:
        matched = normalizedKeyword.length > 0 && normalizedDesc.includes(normalizedKeyword);
    }

    if (matched && rule.tag) matchedTags.push(rule.tag);
  }

  return [...new Set(matchedTags)];
}

function retagAll(overwriteExisting = false) {
  const db = getDb();
  const rules = getTagRules();
  const rows = overwriteExisting
    ? db.prepare(`SELECT id, description, tags FROM transactions`).all()
    : db.prepare(`SELECT id, description, tags FROM transactions WHERE COALESCE(tags, '[]') IN ('[]', '')`).all();

  const update = db.prepare(`UPDATE transactions SET tags = ? WHERE id = ?`);

  return db.transaction(() => {
    let tagged = 0;
    for (const tx of rows) {
      const matchedTags = getMatchedTags(tx.description, rules);
      if (matchedTags.length === 0) continue;
      const existing = overwriteExisting ? [] : JSON.parse(tx.tags || '[]');
      const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...matchedTags])];
      update.run(JSON.stringify(merged), tx.id);
      tagged++;
    }
    return tagged;
  })();
}

module.exports = { getTagRules, getMatchedTags, retagAll };
