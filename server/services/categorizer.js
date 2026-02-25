// server/services/categorizer.js
const { getDb } = require('../database');

function normalizeForMatching(value) {
  return String(value || '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Loads all rules from DB (rules table) ordered by priority DESC.
 * Also supports in-memory rules from the JSON file (bootstrapped on import).
 */
function getRules() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.keyword, r.match_type, r.priority,
           c.id as category_id, c.name as category_name
    FROM rules r
    JOIN categories c ON c.id = r.category_id
    ORDER BY r.priority DESC, LENGTH(r.keyword) DESC
  `).all();
}

/**
 * Applies categorization rules to a description string.
 * Returns { category_id, category_name } or null.
 */
function categorize(description, rulesOverride = null) {
  const rules = rulesOverride || getRules();
  const rawDesc = String(description || '');
  const normalizedDesc = normalizeForMatching(rawDesc);

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

    if (matched) {
      return { category_id: rule.category_id, category_name: rule.category_name };
    }
  }
  return null;
}

/**
 * Seeds the rules table from the JSON categorization rules file.
 * Safe to call multiple times (skips existing keywords).
 */
function seedRulesFromJson(rulesJson) {
  const db = getDb();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (name, color, is_system) VALUES (?, ?, 1)
  `);
  const getCategory = db.prepare(`SELECT id FROM categories WHERE name = ?`);
  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO rules (keyword, match_type, category_id, priority)
    VALUES (?, ?, ?, ?)
  `);

  const categoryColors = {
    'Auto & Transportation': '#3b82f6',
    'Amazon': '#f97316',
    'Costco': '#ef4444',
    'Travel': '#8b5cf6',
    'Utilities & Taxes': '#06b6d4',
    'Dining': '#f59e0b',
    'Health & Medical': '#10b981',
    'Home Maintenance/upgrade': '#84cc16',
    'Property Tax': '#6366f1',
    'Income Taxes': '#ec4899',
    'Donation': '#f43f5e',
    'House Downpayment': '#0ea5e9',
    'Investments': '#22c55e',
    'Shopping & Home': '#a855f7',
    'Child Care': '#fb923c',
    'Groceries & Pharmacy': '#14b8a6',
    'Insurance & Benefits': '#64748b',
    'Housing & Mortgage': '#7c3aed',
    'Bank Fees': '#94a3b8',
    'E-Transfers': '#475569',
    'Travel - Entertainment': '#e879f9',
    'Other / Bank Draft': '#78716c',
  };

  // Special priority: COSTCOGAS must match before COSTCO
  const priorityOverrides = { 'COSTCOGAS': 20, 'COSTCO': 10 };

  const seedAll = db.transaction(() => {
    for (const cat of rulesJson.categories) {
      const color = categoryColors[cat.category_name] || '#6366f1';
      insertCategory.run(cat.category_name, color);
      const { id: categoryId } = getCategory.get(cat.category_name);

      for (const keyword of cat.keywords) {
        const priority = priorityOverrides[keyword.toUpperCase()] || 10;
        insertRule.run(keyword, cat.match_type || 'contains_case_insensitive', categoryId, priority);
      }
    }
  });

  seedAll();
}

/**
 * Bulk re-categorize all uncategorized (or all) transactions.
 */
function recategorizeAll(overwriteExisting = false) {
  const db = getDb();
  const rules = getRules();

  const query = overwriteExisting
    ? db.prepare(`SELECT id, description FROM transactions`)
    : db.prepare(`SELECT id, description FROM transactions WHERE category_id IS NULL`);

  const transactions = query.all();
  const update = db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);

  const bulkUpdate = db.transaction(() => {
    let categorized = 0;
    for (const tx of transactions) {
      const result = categorize(tx.description, rules);
      if (result) {
        update.run(result.category_id, tx.id);
        categorized++;
      }
    }
    return categorized;
  });

  return bulkUpdate();
}

/**
 * Detect recurring transactions: same normalized description, similar amount,
 * appearing multiple times ~30 days apart.
 */
function detectRecurring() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      date,
      description,
      ABS(amount) as amount,
      category_id
    FROM transactions
    WHERE amount < 0
    ORDER BY date ASC
  `).all();

  const normalize = (value) => String(value || '')
    .toUpperCase()
    .replace(/\d+/g, ' ')
    .replace(/[^A-Z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const grouped = new Map();
  for (const row of rows) {
    const key = normalize(row.description);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  const isWithin = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
  const median = (nums) => {
    if (!nums.length) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  };

  const patterns = [];
  for (const txs of grouped.values()) {
    if (txs.length < 3) continue;

    const amounts = txs.map(t => t.amount).filter(a => a > 0);
    if (amounts.length < 3) continue;
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + ((a - avgAmount) ** 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const amountCv = avgAmount > 0 ? stdDev / avgAmount : 1;

    // Recurring bills/subscriptions are typically stable in amount.
    if (amountCv > 0.2) continue;

    const intervals = [];
    for (let i = 1; i < txs.length; i++) {
      const days = Math.round((new Date(txs[i].date) - new Date(txs[i - 1].date)) / 86400000);
      if (days > 0) intervals.push(days);
    }
    if (intervals.length < 2) continue;

    const freqDays = Math.round(median(intervals));

    // Keep this focused on true recurring bills (roughly monthly cadence).
    if (freqDays < 20 || freqDays > 40) continue;

    const consistentIntervals = intervals.filter(d => isWithin(d, freqDays, 4)).length;
    if (consistentIntervals / intervals.length < 0.6) continue;

    const lastTx = txs[txs.length - 1];
    patterns.push({
      description_pattern: lastTx.description,
      avg_amount: avgAmount,
      frequency_days: freqDays,
      category_id: lastTx.category_id || null,
      last_seen: lastTx.date,
    });
  }

  const refreshPatterns = db.transaction(() => {
    db.prepare(`DELETE FROM recurring_patterns`).run();
    const insertPattern = db.prepare(`
      INSERT INTO recurring_patterns
        (description_pattern, avg_amount, frequency_days, category_id, last_seen)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const p of patterns) {
      insertPattern.run(p.description_pattern, p.avg_amount, p.frequency_days, p.category_id, p.last_seen);
    }
  });

  refreshPatterns();

  return db.prepare(`
    SELECT rp.*, c.name as category_name
    FROM recurring_patterns rp
    LEFT JOIN categories c ON c.id = rp.category_id
    ORDER BY rp.avg_amount DESC
  `).all();
}

module.exports = { categorize, seedRulesFromJson, recategorizeAll, detectRecurring, getRules, normalizeForMatching };
