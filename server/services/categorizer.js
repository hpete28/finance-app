// server/services/categorizer.js
const { getDb } = require('../database');

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
  const desc = description.toUpperCase();

  for (const rule of rules) {
    const keyword = rule.keyword.toUpperCase();
    let matched = false;

    switch (rule.match_type) {
      case 'contains_case_insensitive':
        matched = desc.includes(keyword);
        break;
      case 'starts_with':
        matched = desc.startsWith(keyword);
        break;
      case 'exact':
        matched = desc === keyword;
        break;
      case 'regex':
        try {
          matched = new RegExp(rule.keyword, 'i').test(description);
        } catch (e) { matched = false; }
        break;
      default:
        matched = desc.includes(keyword);
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

  // Group by description, look for patterns
  const groups = db.prepare(`
    SELECT
      description,
      COUNT(*) as count,
      AVG(ABS(amount)) as avg_amount,
      MIN(date) as first_seen,
      MAX(date) as last_seen,
      category_id
    FROM transactions
    WHERE amount < 0
    GROUP BY description
    HAVING count >= 2
    ORDER BY count DESC
  `).all();

  const insertPattern = db.prepare(`
    INSERT OR IGNORE INTO recurring_patterns
      (description_pattern, avg_amount, frequency_days, category_id, last_seen)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insert = db.transaction(() => {
    for (const g of groups) {
      // Estimate frequency
      const daysDiff = Math.round(
        (new Date(g.last_seen) - new Date(g.first_seen)) / (1000 * 86400) / (g.count - 1)
      );
      const freqDays = daysDiff > 0 ? daysDiff : 30;

      if (freqDays <= 35) { // Monthly or more frequent
        insertPattern.run(g.description, g.avg_amount, freqDays, g.category_id, g.last_seen);
      }
    }
  });

  insert();

  return db.prepare(`
    SELECT rp.*, c.name as category_name
    FROM recurring_patterns rp
    LEFT JOIN categories c ON c.id = rp.category_id
    ORDER BY rp.avg_amount DESC
  `).all();
}

module.exports = { categorize, seedRulesFromJson, recategorizeAll, detectRecurring, getRules };
