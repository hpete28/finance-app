// server/services/categorizer.js
const { getDb } = require('../database');

const MAX_REGEX_PATTERN_LENGTH = 256;
const SOURCE_RANK = { manual: 0, learned: 1, legacy_tag: 2 };
const RULE_TIER_RANK = {
  manual_fix: 0,
  protected_core: 1,
  generated_curated: 2,
  legacy_archived: 3,
  legacy_tag: 4,
};
const MATCH_SEMANTICS = {
  token_default: 'token_default',
  substring_explicit: 'substring_explicit',
  exact: 'exact',
  starts_with: 'starts_with',
  regex_safe: 'regex_safe',
};
let incomeCategoryCache = { ids: new Set(), fetched_at: 0 };
let activeRuleSetCache = { id: null, fetched_at: 0 };

function normalizeForMatching(value) {
  return String(value || '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonSafe(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTagArray(tags) {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))];
  }
  if (typeof tags === 'string') {
    try { return normalizeTagArray(JSON.parse(tags)); } catch { return []; }
  }
  return [];
}

function normalizeRuleTier(value, fallback = 'generated_curated') {
  const tier = String(value || fallback).toLowerCase();
  if (tier in RULE_TIER_RANK) return tier;
  return fallback;
}

function normalizeMatchSemantics(value, fallback = MATCH_SEMANTICS.token_default) {
  const semantics = String(value || fallback).toLowerCase();
  if (semantics === MATCH_SEMANTICS.token_default) return MATCH_SEMANTICS.token_default;
  if (semantics === MATCH_SEMANTICS.substring_explicit) return MATCH_SEMANTICS.substring_explicit;
  if (semantics === MATCH_SEMANTICS.exact) return MATCH_SEMANTICS.exact;
  if (semantics === MATCH_SEMANTICS.starts_with) return MATCH_SEMANTICS.starts_with;
  if (semantics === MATCH_SEMANTICS.regex_safe) return MATCH_SEMANTICS.regex_safe;
  return fallback;
}

function computeSpecificityScore(conditions = {}) {
  let score = 0;
  const desc = conditions.description || null;
  const merchant = conditions.merchant || null;
  const amount = conditions.amount || null;

  if (desc?.value) {
    const op = String(desc.operator || 'contains').toLowerCase();
    if (op === 'equals') score += 8;
    else if (op === 'starts_with') score += 6;
    else if (op === 'regex') score += 5;
    else if (String(desc.match_semantics || MATCH_SEMANTICS.token_default) === MATCH_SEMANTICS.substring_explicit) score += 2;
    else score += 4;
    score += Math.min(3, Math.floor(normalizeForMatching(desc.value).length / 8));
  }

  if (merchant?.value) {
    const op = String(merchant.operator || 'contains').toLowerCase();
    if (op === 'equals') score += 7;
    else if (op === 'starts_with') score += 5;
    else if (op === 'regex') score += 4;
    else if (String(merchant.match_semantics || MATCH_SEMANTICS.token_default) === MATCH_SEMANTICS.substring_explicit) score += 2;
    else score += 4;
  }

  if (amount) {
    if (Number.isFinite(amount.exact)) score += 6;
    else if (Number.isFinite(amount.min) || Number.isFinite(amount.max)) score += 4;
  }
  if (String(conditions.amount_sign || 'any').toLowerCase() !== 'any') score += 2;
  if (Array.isArray(conditions.account_ids) && conditions.account_ids.length) {
    score += 3 + Math.min(2, conditions.account_ids.length);
  }
  if (conditions.date_range && (conditions.date_range.from || conditions.date_range.to)) score += 2;
  return Number(score.toFixed(2));
}

function normalizeMatchType(matchType) {
  switch (String(matchType || '').toLowerCase()) {
    case 'contains':
    case 'contains_case_insensitive':
      return { operator: 'contains', case_sensitive: false };
    case 'starts_with':
      return { operator: 'starts_with', case_sensitive: false };
    case 'exact':
      return { operator: 'equals', case_sensitive: false };
    case 'regex':
      return { operator: 'regex', case_sensitive: false };
    default:
      return { operator: 'contains', case_sensitive: false };
  }
}

function sourceRank(source) {
  return SOURCE_RANK[String(source || 'manual').toLowerCase()] ?? 9;
}

function tierRank(tier) {
  return RULE_TIER_RANK[normalizeRuleTier(tier)] ?? 9;
}

function getActiveRuleSetId(options = {}) {
  const explicit = options.ruleSetId;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const n = Number(explicit);
    return Number.isFinite(n) ? n : null;
  }
  if (options.includeAllRuleSets) return null;

  const now = Date.now();
  if ((now - activeRuleSetCache.fetched_at) < 1500) {
    return activeRuleSetCache.id;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id
    FROM rule_sets
    WHERE is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const id = row ? Number(row.id) : null;
  activeRuleSetCache = { id: Number.isFinite(id) ? id : null, fetched_at: now };
  return activeRuleSetCache.id;
}

function getIncomeCategoryIds(options = {}) {
  if (options.incomeCategoryIds instanceof Set) return options.incomeCategoryIds;
  if (Array.isArray(options.incomeCategoryIds)) {
    return new Set(options.incomeCategoryIds.map((v) => Number(v)).filter((v) => Number.isFinite(v)));
  }
  const now = Date.now();
  if (now - incomeCategoryCache.fetched_at > 30000 || !incomeCategoryCache.ids.size) {
    const db = getDb();
    const rows = db.prepare(`SELECT id FROM categories WHERE COALESCE(is_income, 0) = 1`).all();
    incomeCategoryCache = {
      ids: new Set(rows.map((r) => Number(r.id)).filter((v) => Number.isFinite(v))),
      fetched_at: now,
    };
  }
  return incomeCategoryCache.ids;
}

function normalizeTextCondition(input, fallbackKeyword = '', fallbackMatchType = '', fallbackSemantics = MATCH_SEMANTICS.token_default) {
  const fallback = normalizeMatchType(fallbackMatchType);

  let raw = input;
  if (typeof raw === 'string') raw = { value: raw };
  if (!raw || typeof raw !== 'object') raw = {};

  const value = String(raw.value ?? raw.keyword ?? fallbackKeyword ?? '').trim();
  if (!value) return null;

  const operator = String(raw.operator || raw.match || raw.type || fallback.operator || 'contains').toLowerCase();
  const case_sensitive = raw.case_sensitive === true;
  const explicitSemantics = raw.match_semantics || raw.semantics || null;
  const matchSemantics = normalizeMatchSemantics(
    explicitSemantics,
    normalizeMatchSemantics(
      fallbackSemantics,
      operator === 'contains' ? MATCH_SEMANTICS.token_default : MATCH_SEMANTICS.substring_explicit
    )
  );

  const cond = { value, operator, case_sensitive, match_semantics: matchSemantics };
  if (operator === 'regex') {
    if (value.length > MAX_REGEX_PATTERN_LENGTH) {
      cond.invalid = `Regex pattern too long (max ${MAX_REGEX_PATTERN_LENGTH})`;
      return cond;
    }
    try {
      cond.regex = new RegExp(value, case_sensitive ? '' : 'i');
    } catch {
      cond.invalid = 'Invalid regex';
    }
    return cond;
  }

  if (case_sensitive) {
    cond.needle = value;
  } else {
    cond.needle = normalizeForMatching(value);
  }
  return cond;
}

function normalizeConditionsFromRow(row) {
  const parsed = parseJsonSafe(row.conditions_json, {});
  const conditions = typeof parsed === 'object' ? { ...parsed } : {};

  if (!conditions.description && String(row.keyword || '').trim()) {
    const fallback = normalizeMatchType(row.match_type);
    conditions.description = {
      operator: fallback.operator,
      value: row.keyword,
      case_sensitive: fallback.case_sensitive,
    };
  }

  const normalized = {};
  const fallbackSemantics = normalizeMatchSemantics(row.match_semantics, MATCH_SEMANTICS.token_default);
  normalized.description = normalizeTextCondition(conditions.description, row.keyword, row.match_type, fallbackSemantics);
  normalized.merchant = normalizeTextCondition(conditions.merchant, '', '', fallbackSemantics);

  const amount = conditions.amount || {};
  const exact = amount.exact ?? conditions.amount_exact;
  const min = amount.min ?? conditions.amount_min;
  const max = amount.max ?? conditions.amount_max;
  if (exact !== undefined || min !== undefined || max !== undefined) {
    normalized.amount = {
      exact: exact !== undefined && exact !== '' ? Number(exact) : null,
      min: min !== undefined && min !== '' ? Number(min) : null,
      max: max !== undefined && max !== '' ? Number(max) : null,
    };
  } else {
    normalized.amount = null;
  }

  const amountSign = String(
    conditions.amount_sign ??
    conditions.sign ??
    conditions.transaction_type ??
    'any'
  ).toLowerCase();
  normalized.amount_sign = amountSign;

  const accountIds = conditions.account_ids ?? conditions.accounts ?? [];
  normalized.account_ids = Array.isArray(accountIds)
    ? [...new Set(accountIds.map((v) => Number(v)).filter((v) => Number.isFinite(v)))]
    : [];

  const dateRange = conditions.date_range || {};
  const from = String(dateRange.from || dateRange.start || conditions.date_from || '').trim();
  const to = String(dateRange.to || dateRange.end || conditions.date_to || '').trim();
  normalized.date_range = (from || to) ? { from: from || null, to: to || null } : null;

  normalized.has_any =
    !!normalized.description ||
    !!normalized.merchant ||
    !!normalized.amount ||
    amountSign !== 'any' ||
    normalized.account_ids.length > 0 ||
    !!normalized.date_range;

  return normalized;
}

function normalizeActionsFromRow(row) {
  const parsed = parseJsonSafe(row.actions_json, {});
  const actions = typeof parsed === 'object' ? { ...parsed } : {};

  if ((actions.set_category_id === undefined || actions.set_category_id === null) && row.category_id !== null && row.category_id !== undefined) {
    actions.set_category_id = Number(row.category_id);
  }

  if (actions.tags === undefined && row.tag) {
    actions.tags = { mode: 'append', values: [String(row.tag)] };
  }

  if (actions.tags && typeof actions.tags === 'object') {
    const mode = String(actions.tags.mode || 'append').toLowerCase();
    const values = normalizeTagArray(actions.tags.values || actions.tags.tags || []);
    actions.tags = { mode, values };
  } else {
    actions.tags = null;
  }

  if (actions.set_merchant_name !== undefined && actions.set_merchant_name !== null) {
    actions.set_merchant_name = String(actions.set_merchant_name).trim() || null;
  }

  if (actions.set_is_income_override !== undefined) {
    actions.set_is_income_override = actions.set_is_income_override ? 1 : 0;
  } else if (actions.is_income_override !== undefined) {
    actions.set_is_income_override = actions.is_income_override ? 1 : 0;
  }

  if (actions.set_exclude_from_totals !== undefined) {
    actions.set_exclude_from_totals = actions.set_exclude_from_totals ? 1 : 0;
  } else if (actions.exclude_from_totals !== undefined) {
    actions.set_exclude_from_totals = actions.exclude_from_totals ? 1 : 0;
  }

  return actions;
}

function compileRule(row) {
  const conditions = normalizeConditionsFromRow(row);
  const actions = normalizeActionsFromRow(row);
  const explicitSpecificity = Number(row.specificity_score);
  const specificity = Number.isFinite(explicitSpecificity)
    ? explicitSpecificity
    : computeSpecificityScore(conditions);

  return {
    id: row.id,
    name: row.name || null,
    priority: Number(row.priority) || 10,
    source: String(row.source || 'manual').toLowerCase(),
    source_rank: sourceRank(row.source),
    rule_set_id: row.rule_set_id === null || row.rule_set_id === undefined ? null : Number(row.rule_set_id),
    rule_tier: normalizeRuleTier(row.rule_tier, 'generated_curated'),
    rule_tier_rank: tierRank(row.rule_tier),
    origin: String(row.origin || 'imported').toLowerCase(),
    match_semantics: normalizeMatchSemantics(row.match_semantics, MATCH_SEMANTICS.token_default),
    specificity_score: specificity,
    is_enabled: row.is_enabled === undefined ? 1 : (row.is_enabled ? 1 : 0),
    stop_processing: row.stop_processing ? 1 : 0,
    category_name: row.category_name || null,
    keyword: String(row.keyword || ''),
    match_type: String(row.match_type || 'contains_case_insensitive'),
    conditions,
    actions,
  };
}

function compareRuleOrder(a, b) {
  if (a.rule_tier_rank !== b.rule_tier_rank) return a.rule_tier_rank - b.rule_tier_rank;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.specificity_score !== b.specificity_score) return b.specificity_score - a.specificity_score;
  if (a.source_rank !== b.source_rank) return a.source_rank - b.source_rank;
  return Number(a.id) - Number(b.id);
}

function getRules(options = {}) {
  const db = getDb();
  const includeAllRuleSets = options.includeAllRuleSets === true;
  const activeRuleSetId = includeAllRuleSets ? null : getActiveRuleSetId(options);

  let whereSql = '1 = 1';
  const params = [];
  if (!includeAllRuleSets && activeRuleSetId !== null) {
    whereSql = 'COALESCE(r.rule_set_id, ?) = ?';
    params.push(activeRuleSetId, activeRuleSetId);
  }

  return db.prepare(`
    SELECT
      r.id, r.name, r.keyword, r.match_type, r.category_id, r.priority,
      r.is_enabled, r.stop_processing, r.source, r.confidence,
      r.rule_set_id, r.rule_tier, r.origin, r.match_semantics, r.specificity_score,
      r.conditions_json, r.actions_json, r.created_at,
      c.name as category_name
    FROM rules r
    LEFT JOIN categories c ON c.id = r.category_id
    WHERE ${whereSql}
    ORDER BY
      CASE LOWER(COALESCE(r.rule_tier, 'generated_curated'))
        WHEN 'manual_fix' THEN 0
        WHEN 'protected_core' THEN 1
        WHEN 'generated_curated' THEN 2
        WHEN 'legacy_archived' THEN 3
        ELSE 4
      END ASC,
      r.priority DESC,
      COALESCE(r.specificity_score, 0) DESC,
      CASE LOWER(COALESCE(r.source, 'manual'))
        WHEN 'manual' THEN 0
        WHEN 'learned' THEN 1
        ELSE 2
      END ASC,
      r.id ASC
  `).all(...params);
}

function getLegacyTagRules() {
  const db = getDb();
  return db.prepare(`
    SELECT id, keyword, match_type, tag, priority
    FROM tag_rules
    ORDER BY priority DESC, LENGTH(keyword) DESC, id ASC
  `).all();
}

function compileRules(ruleRows, options = {}) {
  const includeLegacyTagRules = options.includeLegacyTagRules !== false;
  const compiled = (ruleRows || [])
    .map(compileRule)
    .filter((r) => r.is_enabled);

  if (includeLegacyTagRules) {
    for (const tr of getLegacyTagRules()) {
      compiled.push(compileRule({
        id: 1000000000 + Number(tr.id),
        name: `Legacy tag rule #${tr.id}`,
        keyword: tr.keyword,
        match_type: tr.match_type,
        category_id: null,
        priority: Number(tr.priority) || 10,
        is_enabled: 1,
        stop_processing: 0,
        source: 'legacy_tag',
        rule_tier: 'legacy_tag',
        origin: 'imported',
        match_semantics: tr.match_type === 'contains_case_insensitive'
          ? MATCH_SEMANTICS.substring_explicit
          : normalizeMatchSemantics(tr.match_type, MATCH_SEMANTICS.substring_explicit),
        specificity_score: 1,
        confidence: null,
        conditions_json: JSON.stringify({
          description: {
            ...normalizeMatchType(tr.match_type),
            value: tr.keyword,
            match_semantics: tr.match_type === 'contains_case_insensitive'
              ? MATCH_SEMANTICS.substring_explicit
              : undefined,
          },
        }),
        actions_json: JSON.stringify({
          tags: { mode: 'append', values: [tr.tag] },
        }),
      }));
    }
  }

  compiled.sort(compareRuleOrder);
  return compiled;
}

function getCompiledRules(options = {}) {
  return compileRules(getRules(options), options);
}

function normalizedContainsByTokenBoundary(haystack, needle) {
  const hay = String(haystack || '').trim();
  const ned = String(needle || '').trim();
  if (!hay || !ned) return false;

  const paddedHay = ` ${hay} `;
  const paddedNeedle = ` ${ned} `;
  if (paddedHay.includes(paddedNeedle)) return true;

  const hayCompact = hay.replace(/\s+/g, '');
  const needleCompact = ned.replace(/\s+/g, '');
  if (ned.includes(' ') && needleCompact.length >= 7 && hayCompact.includes(needleCompact)) return true;
  return false;
}

function matchesTextCondition(rawValue, condition) {
  if (!condition) return true;
  if (condition.invalid) return false;

  const raw = String(rawValue || '');
  if (condition.operator === 'regex') {
    return !!condition.regex && condition.regex.test(raw);
  }

  const haystack = condition.case_sensitive ? raw : normalizeForMatching(raw);
  const needle = condition.needle || '';
  if (!needle) return false;

  if (condition.operator === 'equals') {
    if (condition.case_sensitive) return haystack === needle;
    return haystack === needle || normalizedContainsByTokenBoundary(haystack, needle);
  }
  if (condition.operator === 'starts_with') {
    if (condition.case_sensitive) return haystack.startsWith(needle);
    return haystack === needle || haystack.startsWith(`${needle} `) || haystack.startsWith(needle);
  }

  const semantics = normalizeMatchSemantics(
    condition.match_semantics,
    condition.operator === 'contains' ? MATCH_SEMANTICS.token_default : MATCH_SEMANTICS.substring_explicit
  );

  if (condition.case_sensitive || semantics === MATCH_SEMANTICS.substring_explicit) {
    const compact = (v) => String(v || '').replace(/\s+/g, '');
    const haystackCompact = compact(haystack);
    const needleCompact = compact(needle);
    const shouldUseCompactFallback = (
      !condition.case_sensitive
      && String(needle).includes(' ')
      && needleCompact.length >= 7
    );
    return haystack.includes(needle) || (shouldUseCompactFallback && haystackCompact.includes(needleCompact));
  }

  return normalizedContainsByTokenBoundary(haystack, needle);
}

function matchesAmountCondition(txAmount, amountCond) {
  if (!amountCond) return true;
  const absAmount = Math.abs(Number(txAmount) || 0);
  if (amountCond.exact !== null && Number.isFinite(amountCond.exact)) {
    if (Math.abs(absAmount - Math.abs(amountCond.exact)) > 0.00001) return false;
  }
  if (amountCond.min !== null && Number.isFinite(amountCond.min)) {
    if (absAmount < Math.abs(amountCond.min)) return false;
  }
  if (amountCond.max !== null && Number.isFinite(amountCond.max)) {
    if (absAmount > Math.abs(amountCond.max)) return false;
  }
  return true;
}

function matchesAmountSign(amount, amountSign) {
  switch (String(amountSign || 'any').toLowerCase()) {
    case 'expense':
    case 'negative':
      return Number(amount) < 0;
    case 'income':
    case 'positive':
      return Number(amount) > 0;
    default:
      return true;
  }
}

function matchesDateRange(txDate, range) {
  if (!range) return true;
  const date = String(txDate || '');
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function matchesRule(rule, tx) {
  if (!rule.conditions?.has_any) return false;

  if (!matchesTextCondition(tx.description, rule.conditions.description)) return false;
  if (rule.conditions.merchant && !matchesTextCondition(tx.merchant_name, rule.conditions.merchant)) return false;
  if (!matchesAmountCondition(tx.amount, rule.conditions.amount)) return false;
  if (!matchesAmountSign(tx.amount, rule.conditions.amount_sign)) return false;
  if (rule.conditions.account_ids.length && !rule.conditions.account_ids.includes(Number(tx.account_id))) return false;
  if (!matchesDateRange(tx.date, rule.conditions.date_range)) return false;

  return true;
}

function canWriteBooleanFlag(currentValue, nextValue, overwriteFlags) {
  if (overwriteFlags) return true;
  const current = Number(currentValue) || 0;
  const next = nextValue ? 1 : 0;
  // Safe default without overwrite: allow only 0 -> 1 upgrades.
  return current === 0 && next === 1;
}

function applyTagAction(existingTags, tagAction) {
  if (!tagAction || !Array.isArray(tagAction.values)) return existingTags;
  const mode = String(tagAction.mode || 'append').toLowerCase();
  const values = normalizeTagArray(tagAction.values);
  const current = normalizeTagArray(existingTags);

  if (mode === 'replace') return values;
  if (mode === 'remove') {
    const removeSet = new Set(values.map((v) => normalizeForMatching(v)));
    return current.filter((tag) => !removeSet.has(normalizeForMatching(tag)));
  }
  return [...new Set([...current, ...values])];
}

function evaluateTransactionWithRules(transaction, compiledRules, options = {}) {
  const tx = {
    id: transaction.id,
    account_id: Number(transaction.account_id) || null,
    date: String(transaction.date || ''),
    description: String(transaction.description || ''),
    amount: Number(transaction.amount) || 0,
    category_id: transaction.category_id === undefined ? null : transaction.category_id,
    tags: normalizeTagArray(transaction.tags),
    merchant_name: String(transaction.merchant_name || '').trim() || null,
    is_income_override: transaction.is_income_override ? 1 : 0,
    exclude_from_totals: transaction.exclude_from_totals ? 1 : 0,
    category_source: String(transaction.category_source || 'import_default'),
    category_locked: transaction.category_locked ? 1 : 0,
    tags_locked: transaction.tags_locked ? 1 : 0,
    lock_category: transaction.lock_category ? 1 : 0,
    lock_tags: transaction.lock_tags ? 1 : 0,
    lock_merchant: transaction.lock_merchant ? 1 : 0,
  };

  const opts = {
    overwrite_category: !!options.overwrite_category,
    overwrite_tags: !!options.overwrite_tags,
    overwrite_merchant: !!options.overwrite_merchant,
    overwrite_flags: !!options.overwrite_flags,
    allow_negative_income_category: !!options.allow_negative_income_category,
    respect_locks: options.respect_locks !== false,
    ignore_locks: !!options.ignore_locks,
  };
  const incomeCategoryIds = getIncomeCategoryIds(options);
  const existingCategoryId = tx.category_id === undefined ? null : tx.category_id;
  const clearInvalidNegativeIncomeSeed = (
    opts.overwrite_category
    && existingCategoryId !== null
    && existingCategoryId !== undefined
    && incomeCategoryIds.has(Number(existingCategoryId))
    && Number(tx.amount) <= 0
    && !opts.allow_negative_income_category
  );

  const result = {
    ...tx,
    category_id: clearInvalidNegativeIncomeSeed ? null : existingCategoryId,
    matched_rule_ids: [],
    matched_rules: [],
    blocked_rules: [],
    winning_category_rule: null,
  };

  const enforceLocks = opts.respect_locks && !opts.ignore_locks;

  const lock = {
    category: (enforceLocks && (tx.lock_category === 1 || tx.category_locked === 1))
      || (!opts.overwrite_category && tx.category_id !== null && tx.category_id !== undefined),
    tags: (enforceLocks && (tx.lock_tags === 1 || tx.tags_locked === 1)),
    merchant: (enforceLocks && tx.lock_merchant === 1) || (!opts.overwrite_merchant && !!tx.merchant_name),
    income: !opts.overwrite_flags && tx.is_income_override === 1,
    exclude: !opts.overwrite_flags && tx.exclude_from_totals === 1,
  };
  const allowTagActions = !lock.tags && (opts.overwrite_tags || tx.tags.length === 0);

  for (const rule of compiledRules) {
    if (!rule.is_enabled) continue;
    if (!matchesRule(rule, result)) continue;

    result.matched_rule_ids.push(rule.id);
    result.matched_rules.push({
      id: rule.id,
      name: rule.name,
      category_name: rule.category_name || null,
      source: rule.source,
      priority: rule.priority,
    });

    const actions = rule.actions || {};

    if (actions.set_category_id !== undefined && actions.set_category_id !== null && !lock.category) {
      const nextCategoryId = Number(actions.set_category_id);
      const nextIsIncome = incomeCategoryIds.has(nextCategoryId);
      const assigningNegativeIncome = nextIsIncome && Number(result.amount) <= 0 && !opts.allow_negative_income_category;
      if (assigningNegativeIncome) {
        result.blocked_rules.push({
          id: rule.id,
          reason: 'income_requires_positive_amount',
          attempted_category_id: nextCategoryId,
          amount: Number(result.amount) || 0,
        });
      } else {
        result.category_id = nextCategoryId;
        result.winning_category_rule = {
          id: rule.id,
          name: rule.name || null,
          source: rule.source,
          tier: rule.rule_tier || 'generated_curated',
          priority: rule.priority,
          category_id: nextCategoryId,
          category_name: rule.category_name || null,
        };
        if (rule.rule_tier === 'manual_fix') result.category_source = 'rule_manual_fix';
        else if (rule.source === 'learned') result.category_source = 'rule_learned';
        else if (rule.rule_tier === 'protected_core') result.category_source = 'rule_protected';
        else result.category_source = 'rule_manual';
        lock.category = true;
      }
    }

    if (allowTagActions && actions.tags) {
      result.tags = applyTagAction(result.tags, actions.tags);
    }

    if (actions.set_merchant_name && !lock.merchant) {
      result.merchant_name = String(actions.set_merchant_name).trim() || null;
      if (result.merchant_name) lock.merchant = true;
    }

    if (actions.set_is_income_override !== undefined && !lock.income) {
      const nextIncome = actions.set_is_income_override ? 1 : 0;
      if (canWriteBooleanFlag(result.is_income_override, nextIncome, opts.overwrite_flags)) {
        result.is_income_override = nextIncome;
        lock.income = true;
      }
    }

    if (actions.set_exclude_from_totals !== undefined && !lock.exclude) {
      const nextExclude = actions.set_exclude_from_totals ? 1 : 0;
      if (canWriteBooleanFlag(result.exclude_from_totals, nextExclude, opts.overwrite_flags)) {
        result.exclude_from_totals = nextExclude;
        lock.exclude = true;
      }
    }

    if (rule.stop_processing) break;
  }

  const changed = {
    category: tx.category_id !== result.category_id,
    category_source: String(tx.category_source || 'import_default') !== String(result.category_source || 'import_default'),
    tags: JSON.stringify(tx.tags) !== JSON.stringify(result.tags),
    merchant: (tx.merchant_name || null) !== (result.merchant_name || null),
    income: Number(tx.is_income_override || 0) !== Number(result.is_income_override || 0),
    exclude: Number(tx.exclude_from_totals || 0) !== Number(result.exclude_from_totals || 0),
  };

  return {
    ...result,
    changed,
    changed_any: changed.category || changed.category_source || changed.tags || changed.merchant || changed.income || changed.exclude,
    blocked_income_assignments: result.blocked_rules.filter((b) => b.reason === 'income_requires_positive_amount').length,
  };
}

function applyRulesToTransactionInput(transaction, options = {}) {
  const compiledRules = options.compiledRules || getCompiledRules({
    includeLegacyTagRules: options.includeLegacyTagRules !== false,
    ruleSetId: options.rule_set_id,
  });
  return evaluateTransactionWithRules(transaction, compiledRules, {
    overwrite_category: options.overwrite_category !== false,
    overwrite_tags: options.overwrite_tags !== false,
    overwrite_merchant: options.overwrite_merchant !== false,
    overwrite_flags: options.overwrite_flags !== false,
    respect_locks: options.respect_locks !== false,
    ignore_locks: !!options.ignore_locks,
  });
}

function applyRulesToAllTransactions(options = {}) {
  const db = getDb();
  const excludeCategoryIds = Array.isArray(options.exclude_category_ids)
    ? [...new Set(options.exclude_category_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)))]
    : [];
  const opts = {
    overwrite_category: !!options.overwrite_category,
    overwrite_tags: !!options.overwrite_tags,
    overwrite_merchant: !!options.overwrite_merchant,
    overwrite_flags: !!options.overwrite_flags,
    only_uncategorized: !!options.only_uncategorized,
    includeLegacyTagRules: options.includeLegacyTagRules !== false,
    exclude_category_ids: excludeCategoryIds,
    skip_transfers: !!options.skip_transfers,
    skip_excluded_from_totals: !!options.skip_excluded_from_totals,
    dry_run: !!options.dry_run,
    sample_limit: Math.min(200, Math.max(10, Number(options.sample_limit) || 40)),
    allow_negative_income_category: !!options.allow_negative_income_category,
    respect_locks: options.respect_locks !== false,
    ignore_locks: !!options.ignore_locks,
    rule_set_id: options.rule_set_id !== undefined && options.rule_set_id !== null && options.rule_set_id !== ''
      ? Number(options.rule_set_id)
      : null,
  };

  const compiledRules = getCompiledRules({
    includeLegacyTagRules: opts.includeLegacyTagRules,
    ruleSetId: opts.rule_set_id,
  });

  const where = [];
  const params = [];
  if (opts.only_uncategorized) {
    where.push('category_id IS NULL');
  }
  if (opts.skip_transfers) {
    where.push('COALESCE(is_transfer, 0) = 0');
  }
  if (opts.skip_excluded_from_totals) {
    where.push('COALESCE(exclude_from_totals, 0) = 0');
  }
  if (opts.exclude_category_ids.length > 0) {
    const placeholders = opts.exclude_category_ids.map(() => '?').join(', ');
    where.push(`(category_id IS NULL OR category_id NOT IN (${placeholders}))`);
    params.push(...opts.exclude_category_ids);
  }

  const sql = `
    SELECT id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals, category_source, category_locked, tags_locked, lock_category, lock_tags, lock_merchant
    FROM transactions
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `;
  const rows = db.prepare(sql).all(...params);

  const update = db.prepare(`
    UPDATE transactions
    SET category_id = ?, tags = ?, merchant_name = ?, is_income_override = ?, exclude_from_totals = ?, category_source = ?
    WHERE id = ?
  `);
  const categoryChanges = new Map();
  const changeSamples = [];
  const changedMerchants = new Map();

  const stats = {
    scanned: rows.length,
    updated: 0,
    matched_transactions: 0,
    category_updates: 0,
    tag_updates: 0,
    merchant_updates: 0,
    income_updates: 0,
    exclude_updates: 0,
    dry_run: opts.dry_run,
    blocked_income_assignments: 0,
    category_change_buckets: [],
    sample_changes: [],
    top_changed_merchants: [],
  };
  const incomeCategoryIds = getIncomeCategoryIds(options);

  db.transaction(() => {
    for (const row of rows) {
      const evaluated = evaluateTransactionWithRules({
        ...row,
        tags: parseJsonSafe(row.tags, []),
      }, compiledRules, opts);
      stats.blocked_income_assignments += Number(evaluated.blocked_income_assignments || 0);

      if (evaluated.matched_rule_ids.length) stats.matched_transactions += 1;
      if (!evaluated.changed_any) continue;

      if (!opts.dry_run) {
        update.run(
          evaluated.category_id ?? null,
          JSON.stringify(evaluated.tags || []),
          evaluated.merchant_name || null,
          evaluated.is_income_override ? 1 : 0,
          evaluated.exclude_from_totals ? 1 : 0,
          evaluated.category_source || row.category_source || 'import_default',
          row.id
        );
      }

      stats.updated += 1;
      if (evaluated.changed.category) {
        stats.category_updates += 1;
        const from = row.category_id === undefined ? null : row.category_id;
        const to = evaluated.category_id === undefined ? null : evaluated.category_id;
        const key = `${from ?? 'null'}->${to ?? 'null'}`;
        categoryChanges.set(key, {
          from_category_id: from,
          to_category_id: to,
          from_is_income: from !== null && from !== undefined ? incomeCategoryIds.has(Number(from)) : false,
          to_is_income: to !== null && to !== undefined ? incomeCategoryIds.has(Number(to)) : false,
          count: (categoryChanges.get(key)?.count || 0) + 1,
        });
      }
      if (evaluated.changed.tags) stats.tag_updates += 1;
      if (evaluated.changed.merchant) stats.merchant_updates += 1;
      if (evaluated.changed.income) stats.income_updates += 1;
      if (evaluated.changed.exclude) stats.exclude_updates += 1;

      if (changeSamples.length < opts.sample_limit) {
        changeSamples.push({
          id: row.id,
          date: row.date,
          description: row.description,
          amount: row.amount,
          before: {
            category_id: row.category_id ?? null,
            merchant_name: row.merchant_name || null,
            tags: parseJsonSafe(row.tags, []),
            is_income_override: row.is_income_override ? 1 : 0,
            exclude_from_totals: row.exclude_from_totals ? 1 : 0,
            category_source: row.category_source || 'import_default',
          },
          after: {
            category_id: evaluated.category_id ?? null,
            merchant_name: evaluated.merchant_name || null,
            tags: evaluated.tags || [],
            is_income_override: evaluated.is_income_override ? 1 : 0,
            exclude_from_totals: evaluated.exclude_from_totals ? 1 : 0,
            category_source: evaluated.category_source || row.category_source || 'import_default',
          },
          winning_category_rule: evaluated.winning_category_rule || null,
          blocked_rules: evaluated.blocked_rules || [],
          matched_rules: evaluated.matched_rules || [],
        });
      }
      const merchantKey = String(evaluated.merchant_name || row.merchant_name || '').trim();
      if (merchantKey) changedMerchants.set(merchantKey, (changedMerchants.get(merchantKey) || 0) + 1);
    }
  })();

  stats.category_change_buckets = [...categoryChanges.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
  stats.sample_changes = changeSamples;
  stats.top_changed_merchants = [...changedMerchants.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([merchant_name, count]) => ({ merchant_name, count }));

  return stats;
}

/**
 * Backward-compatible wrapper.
 * boolean arg => legacy behavior for category overwrite.
 * object arg  => advanced apply options.
 */
function recategorizeAll(overwriteExisting = false) {
  if (typeof overwriteExisting === 'boolean') {
    const stats = applyRulesToAllTransactions({
      overwrite_category: overwriteExisting,
      overwrite_tags: false,
      overwrite_merchant: false,
      overwrite_flags: false,
      only_uncategorized: !overwriteExisting,
      includeLegacyTagRules: true,
    });
    return stats.category_updates;
  }

  const opts = overwriteExisting || {};
  const stats = applyRulesToAllTransactions({
    overwrite_category: !!opts.overwrite_category,
    overwrite_tags: !!opts.overwrite_tags,
    overwrite_merchant: !!opts.overwrite_merchant,
    overwrite_flags: !!opts.overwrite_flags,
    only_uncategorized: !!opts.only_uncategorized,
    includeLegacyTagRules: opts.includeLegacyTagRules !== false,
  });
  return stats.category_updates;
}

/**
 * Legacy compatibility helper used by older import flows.
 */
function categorize(input, rulesOverride = null) {
  const tx = typeof input === 'string'
    ? { description: input, amount: 0, date: '', account_id: null, tags: [] }
    : (input || {});

  const compiled = Array.isArray(rulesOverride)
    ? (rulesOverride.length && rulesOverride[0]?.conditions ? rulesOverride : compileRules(rulesOverride, { includeLegacyTagRules: true }))
    : getCompiledRules({ includeLegacyTagRules: true, ruleSetId: tx.rule_set_id });

  const evaluated = evaluateTransactionWithRules(tx, compiled, {
    overwrite_category: true,
    overwrite_tags: false,
    overwrite_merchant: false,
    overwrite_flags: false,
  });

  if (evaluated.category_id === null || evaluated.category_id === undefined) return null;
  const categoryRule = evaluated.matched_rules.find((r) => r.source !== 'legacy_tag') || null;
  return {
    category_id: evaluated.category_id,
    category_name: categoryRule?.category_name || null,
  };
}

/**
 * Seeds the rules table from the JSON categorization rules file.
 * Safe to call multiple times (skips exact duplicates in-memory).
 */
function seedRulesFromJson(rulesJson) {
  const db = getDb();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (name, color, is_system) VALUES (?, ?, 1)
  `);
  const getCategory = db.prepare(`SELECT id FROM categories WHERE name = ?`);
  const insertRule = db.prepare(`
    INSERT INTO rules (keyword, match_type, category_id, priority, source, is_enabled, conditions_json, actions_json)
    VALUES (?, ?, ?, ?, 'manual', 1, '{}', '{}')
  `);

  const existing = new Set(
    db.prepare(`SELECT UPPER(keyword) as keyword, COALESCE(category_id, -1) as category_id, match_type FROM rules`).all()
      .map((r) => `${r.keyword}|${r.category_id}|${r.match_type}`)
  );

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

  const priorityOverrides = { COSTCOGAS: 20, COSTCO: 10 };

  db.transaction(() => {
    for (const cat of (rulesJson.categories || [])) {
      const color = categoryColors[cat.category_name] || '#6366f1';
      insertCategory.run(cat.category_name, color);
      const foundCategory = getCategory.get(cat.category_name);
      if (!foundCategory) continue;

      for (const keywordRaw of (cat.keywords || [])) {
        const keyword = String(keywordRaw || '').trim();
        if (!keyword) continue;
        const matchType = cat.match_type || 'contains_case_insensitive';
        const key = `${keyword.toUpperCase()}|${foundCategory.id}|${matchType}`;
        if (existing.has(key)) continue;
        const priority = priorityOverrides[keyword.toUpperCase()] || 10;
        insertRule.run(keyword, matchType, foundCategory.id, priority);
        existing.add(key);
      }
    }
  })();
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

    const amounts = txs.map((t) => t.amount).filter((a) => a > 0);
    if (amounts.length < 3) continue;
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + ((a - avgAmount) ** 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const amountCv = avgAmount > 0 ? stdDev / avgAmount : 1;
    if (amountCv > 0.2) continue;

    const intervals = [];
    for (let i = 1; i < txs.length; i++) {
      const days = Math.round((new Date(txs[i].date) - new Date(txs[i - 1].date)) / 86400000);
      if (days > 0) intervals.push(days);
    }
    if (intervals.length < 2) continue;

    const freqDays = Math.round(median(intervals));
    if (freqDays < 20 || freqDays > 40) continue;

    const consistentIntervals = intervals.filter((d) => isWithin(d, freqDays, 4)).length;
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

module.exports = {
  normalizeForMatching,
  computeSpecificityScore,
  getActiveRuleSetId,
  getRules,
  getLegacyTagRules,
  compileRules,
  getCompiledRules,
  matchesRule,
  evaluateTransactionWithRules,
  applyRulesToTransactionInput,
  applyRulesToAllTransactions,
  categorize,
  seedRulesFromJson,
  recategorizeAll,
  detectRecurring,
};
