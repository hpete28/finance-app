// server/routes/rules.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const {
  compileRules,
  getRules,
  normalizeForMatching,
  applyRulesToAllTransactions,
  evaluateTransactionWithRules,
} = require('../services/categorizer');

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const str = String(value).toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}

function normalizePriority(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(1000, Math.round(n)));
}

function normalizeSource(value, fallback = 'manual') {
  const source = String(value || fallback).toLowerCase();
  if (source === 'learned') return 'learned';
  if (source === 'legacy_tag') return 'legacy_tag';
  return 'manual';
}

function parseTags(rawTags) {
  try {
    const parsed = JSON.parse(rawTags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasMeaningfulActions(actions = {}) {
  if (actions.set_category_id !== undefined && actions.set_category_id !== null && actions.set_category_id !== '') return true;
  if (actions.set_merchant_name && String(actions.set_merchant_name).trim()) return true;
  if (actions.set_is_income_override !== undefined) return true;
  if (actions.set_exclude_from_totals !== undefined) return true;
  if (actions.tags && Array.isArray(actions.tags.values) && actions.tags.values.length) return true;
  return false;
}

function chooseKeywordFallback(conditions, fallback = '') {
  const fromDescription = conditions?.description?.value;
  const fromMerchant = conditions?.merchant?.value;
  const text = String(fromDescription || fromMerchant || fallback || '').trim();
  return text.slice(0, 120);
}

function normalizeRulePayload(payload, existing = null) {
  const body = payload || {};
  const behavior = body.behavior || {};
  const conditions = body.conditions !== undefined ? body.conditions : (existing?.conditions || {});
  const actions = body.actions !== undefined ? body.actions : (existing?.actions || {});

  const explicitCategory = body.category_id !== undefined
    ? (body.category_id === null || body.category_id === '' ? null : Number(body.category_id))
    : undefined;
  const actionCategory = actions && actions.set_category_id !== undefined
    ? (actions.set_category_id === null || actions.set_category_id === '' ? null : Number(actions.set_category_id))
    : undefined;

  const categoryId = explicitCategory !== undefined
    ? explicitCategory
    : (actionCategory !== undefined ? actionCategory : (existing ? existing.category_id : null));

  const keyword = body.keyword !== undefined
    ? String(body.keyword || '').trim()
    : chooseKeywordFallback(conditions, existing?.keyword || '');
  const matchType = body.match_type !== undefined
    ? String(body.match_type || 'contains_case_insensitive')
    : (existing?.match_type || 'contains_case_insensitive');

  const priority = normalizePriority(
    behavior.priority !== undefined ? behavior.priority : body.priority,
    existing?.priority ?? 10
  );
  const isEnabled = asBool(
    behavior.is_enabled !== undefined ? behavior.is_enabled : body.is_enabled,
    existing?.is_enabled !== undefined ? !!existing.is_enabled : true
  );
  const stopProcessing = asBool(
    behavior.stop_processing !== undefined ? behavior.stop_processing : body.stop_processing,
    existing?.stop_processing !== undefined ? !!existing.stop_processing : false
  );
  const source = normalizeSource(
    behavior.source !== undefined ? behavior.source : body.source,
    existing?.source || 'manual'
  );
  const confidence = behavior.confidence !== undefined
    ? Number(behavior.confidence)
    : (body.confidence !== undefined ? Number(body.confidence) : (existing?.confidence ?? null));

  return {
    id: existing?.id || null,
    name: body.name !== undefined ? String(body.name || '').trim() || null : (existing?.name || null),
    keyword,
    match_type: matchType,
    category_id: categoryId,
    priority,
    is_enabled: isEnabled ? 1 : 0,
    stop_processing: stopProcessing ? 1 : 0,
    source,
    confidence: Number.isFinite(confidence) ? confidence : null,
    conditions,
    actions,
  };
}

function toRuleRowForCompile(record) {
  return {
    id: record.id || -1,
    name: record.name,
    keyword: record.keyword || '',
    match_type: record.match_type || 'contains_case_insensitive',
    category_id: record.category_id,
    priority: record.priority ?? 10,
    is_enabled: record.is_enabled ?? 1,
    stop_processing: record.stop_processing ?? 0,
    source: record.source || 'manual',
    confidence: record.confidence ?? null,
    conditions_json: JSON.stringify(record.conditions || {}),
    actions_json: JSON.stringify(record.actions || {}),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function isRuleMatchDefinitionChanged(existingRule, nextRule) {
  const prev = {
    keyword: String(existingRule.keyword || '').trim(),
    match_type: String(existingRule.match_type || 'contains_case_insensitive'),
    category_id: existingRule.category_id === null || existingRule.category_id === undefined ? null : Number(existingRule.category_id),
    conditions: canonicalize(existingRule.conditions || {}),
    actions: canonicalize(existingRule.actions || {}),
  };
  const next = {
    keyword: String(nextRule.keyword || '').trim(),
    match_type: String(nextRule.match_type || 'contains_case_insensitive'),
    category_id: nextRule.category_id === null || nextRule.category_id === undefined ? null : Number(nextRule.category_id),
    conditions: canonicalize(nextRule.conditions || {}),
    actions: canonicalize(nextRule.actions || {}),
  };
  return JSON.stringify(prev) !== JSON.stringify(next);
}

function buildRuleSignature(compiledRule) {
  const cond = compiledRule.conditions || {};
  const actions = compiledRule.actions || {};
  const sig = {
    description: cond.description ? {
      operator: cond.description.operator,
      case_sensitive: !!cond.description.case_sensitive,
      value: cond.description.case_sensitive
        ? cond.description.value
        : normalizeForMatching(cond.description.value || ''),
    } : null,
    merchant: cond.merchant ? {
      operator: cond.merchant.operator,
      case_sensitive: !!cond.merchant.case_sensitive,
      value: cond.merchant.case_sensitive
        ? cond.merchant.value
        : normalizeForMatching(cond.merchant.value || ''),
    } : null,
    amount: cond.amount ? {
      exact: cond.amount.exact ?? null,
      min: cond.amount.min ?? null,
      max: cond.amount.max ?? null,
    } : null,
    amount_sign: cond.amount_sign || 'any',
    account_ids: [...(cond.account_ids || [])].sort((a, b) => a - b),
    date_range: cond.date_range || null,
    set_category_id: actions.set_category_id ?? null,
    tags: actions.tags ? {
      mode: actions.tags.mode || 'append',
      values: [...(actions.tags.values || [])].map((t) => normalizeForMatching(t)).sort(),
    } : null,
    set_merchant_name: actions.set_merchant_name ? normalizeForMatching(actions.set_merchant_name) : null,
    set_is_income_override: actions.set_is_income_override ?? null,
    set_exclude_from_totals: actions.set_exclude_from_totals ?? null,
  };
  return JSON.stringify(sig);
}

function analyzeRuleRisk(compiledRule, matchCount, totalCount) {
  const ratio = totalCount > 0 ? matchCount / totalCount : 0;
  const cond = compiledRule.conditions || {};
  const desc = cond.description;
  const hasStrongScope =
    !!cond.amount ||
    (cond.account_ids || []).length > 0 ||
    !!cond.date_range ||
    !!cond.merchant ||
    (desc && ['equals', 'starts_with'].includes(desc.operator));
  const normalizedNeedleLen = normalizeForMatching(desc?.value || '').length;

  const warnings = [];
  if (desc && desc.operator === 'contains' && normalizedNeedleLen > 0 && normalizedNeedleLen < 4) {
    warnings.push('Description contains value is very short and may over-match.');
  }
  if (ratio >= 0.2) {
    warnings.push(`Rule matches ${(ratio * 100).toFixed(1)}% of transactions.`);
  }
  if (!hasStrongScope && ratio >= 0.12) {
    warnings.push('Rule is broad and missing amount/account/date/merchant constraints.');
  }

  const requiresForce =
    ratio >= 0.35 ||
    (!hasStrongScope && ratio >= 0.2) ||
    (desc && desc.operator === 'contains' && normalizedNeedleLen > 0 && normalizedNeedleLen < 3);

  return { ratio, warnings, requires_force: requiresForce };
}

function previewRule(db, compiledRule, limit = 20) {
  const rows = db.prepare(`
    SELECT
      t.id, t.date, t.description, t.amount, t.account_id, t.category_id,
      t.tags, t.merchant_name, t.is_income_override, t.exclude_from_totals,
      a.name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    ORDER BY t.date DESC
  `).all();

  let matches = 0;
  const samples = [];

  for (const row of rows) {
    const evaluated = evaluateTransactionWithRules({
      ...row,
      tags: parseTags(row.tags),
    }, [compiledRule], {
      overwrite_category: true,
      overwrite_tags: true,
      overwrite_merchant: true,
      overwrite_flags: true,
    });

    if (evaluated.matched_rule_ids.length) {
      matches += 1;
      if (samples.length < limit) {
        samples.push({
          id: row.id,
          date: row.date,
          description: row.description,
          amount: row.amount,
          account_id: row.account_id,
          account_name: row.account_name,
          category_id: row.category_id,
          merchant_name: row.merchant_name,
          tags: parseTags(row.tags),
        });
      }
    }
  }

  const risk = analyzeRuleRisk(compiledRule, matches, rows.length);
  return {
    total_count: rows.length,
    match_count: matches,
    match_ratio: risk.ratio,
    warnings: risk.warnings,
    requires_force: risk.requires_force,
    estimate_kind: 'exact',
    sample: samples,
  };
}

function commonFromMap(map) {
  let best = null;
  for (const [key, value] of map.entries()) {
    if (!best || value > best.count) best = { key, count: value };
  }
  return best;
}

function normalizeLearnKey(row) {
  const merchant = normalizeForMatching(row.merchant_name || '');
  if (merchant && merchant.length >= 3) return { key: `M:${merchant}`, kind: 'merchant' };
  const normalizedDesc = normalizeForMatching(row.description || '');
  const compact = normalizedDesc.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { key: `D:${compact.slice(0, 48)}`, kind: 'description' };
}

function buildLearnSuggestions(db, { min_count = 3, max_suggestions = 60 } = {}) {
  const rows = db.prepare(`
    SELECT
      t.id, t.account_id, t.date, t.description, t.amount, t.category_id, t.tags, t.merchant_name
    FROM transactions t
    WHERE t.category_id IS NOT NULL
      AND t.is_transfer = 0
  `).all();

  const grouped = new Map();
  for (const row of rows) {
    const keyInfo = normalizeLearnKey(row);
    if (!keyInfo.key || keyInfo.key === 'D:') continue;
    const g = grouped.get(keyInfo.key) || { key: keyInfo.key, kind: keyInfo.kind, rows: [] };
    g.rows.push(row);
    grouped.set(keyInfo.key, g);
  }

  const existingCompiled = compileRules(getRules(), { includeLegacyTagRules: false });
  const existingSignatures = new Set(existingCompiled.map(buildRuleSignature));
  const suggestions = [];
  const seenSuggestionSignatures = new Set();

  for (const group of grouped.values()) {
    if (group.rows.length < min_count) continue;

    const byCategory = new Map();
    group.rows.forEach((r) => byCategory.set(r.category_id, (byCategory.get(r.category_id) || 0) + 1));
    const dominantCategory = commonFromMap(byCategory);
    if (!dominantCategory) continue;

    const dominantRows = group.rows.filter((r) => r.category_id === Number(dominantCategory.key));
    const purity = dominantRows.length / group.rows.length;
    if (dominantRows.length < min_count || purity < 0.85) continue;

    const conditions = {};
    const actions = { set_category_id: Number(dominantCategory.key) };
    const rationale = [];

    if (group.kind === 'merchant') {
      const merchantMap = new Map();
      dominantRows.forEach((r) => {
        const m = String(r.merchant_name || '').trim();
        if (m) merchantMap.set(m, (merchantMap.get(m) || 0) + 1);
      });
      const bestMerchant = commonFromMap(merchantMap);
      if (!bestMerchant) continue;
      conditions.merchant = { operator: 'contains', value: bestMerchant.key, case_sensitive: false };
      actions.set_merchant_name = bestMerchant.key;
      rationale.push('Uses merchant-normalized matching');
    } else {
      const tokenCounts = new Map();
      dominantRows.forEach((r) => {
        const tokens = normalizeForMatching(r.description || '')
          .split(' ')
          .filter((t) => t.length >= 4 && !['PAYMENT', 'TRANSFER', 'PURCHASE', 'DEBIT', 'CREDIT', 'CARD'].includes(t));
        tokens.forEach((t) => tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1));
      });
      const bestToken = commonFromMap(tokenCounts);
      if (!bestToken || bestToken.count < Math.ceil(dominantRows.length * 0.7)) continue;
      conditions.description = { operator: 'contains', value: bestToken.key, case_sensitive: false };
      rationale.push('Derived from recurring description token');
    }

    const absAmounts = dominantRows.map((r) => Math.abs(Number(r.amount) || 0)).filter((v) => v > 0);
    if (absAmounts.length >= 3) {
      const avg = absAmounts.reduce((s, v) => s + v, 0) / absAmounts.length;
      const variance = absAmounts.reduce((s, v) => s + ((v - avg) ** 2), 0) / absAmounts.length;
      const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
      if (cv <= 0.03) {
        conditions.amount = { exact: Number(avg.toFixed(2)) };
        rationale.push('Stable recurring amount detected');
      } else if (cv <= 0.12) {
        const min = Math.min(...absAmounts);
        const max = Math.max(...absAmounts);
        if ((max - min) <= Math.max(5, avg * 0.1)) {
          conditions.amount = { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
          rationale.push('Narrow amount range detected');
        }
      }
    }

    const tagCounts = new Map();
    dominantRows.forEach((r) => {
      parseTags(r.tags).forEach((tag) => {
        const clean = String(tag || '').trim();
        if (!clean) return;
        tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
      });
    });
    const learnedTags = [...tagCounts.entries()]
      .filter(([, count]) => count >= Math.ceil(dominantRows.length * 0.7))
      .map(([tag]) => tag)
      .slice(0, 4);
    if (learnedTags.length) {
      actions.tags = { mode: 'append', values: learnedTags };
      rationale.push('Common tags included');
    }

    const confidence = Number((
      Math.min(0.45, dominantRows.length / 100) +
      (purity * 0.45) +
      (conditions.amount ? 0.05 : 0) +
      (group.kind === 'merchant' ? 0.05 : 0)
    ).toFixed(2));

    const suggestion = {
      name: `Learned ${group.kind === 'merchant' ? 'merchant' : 'description'} rule`,
      keyword: chooseKeywordFallback(conditions, ''),
      match_type: 'contains_case_insensitive',
      category_id: actions.set_category_id,
      conditions,
      actions,
      behavior: {
        priority: 4,
        is_enabled: true,
        stop_processing: false,
        source: 'learned',
        confidence,
      },
      confidence,
      stats: {
        support_count: dominantRows.length,
        group_count: group.rows.length,
        purity: Number(purity.toFixed(3)),
      },
      rationale,
    };

    const compiled = compileRules([toRuleRowForCompile(normalizeRulePayload(suggestion))], { includeLegacyTagRules: false })[0];
    if (!compiled || !compiled.conditions?.has_any || !hasMeaningfulActions(compiled.actions)) continue;
    const signature = buildRuleSignature(compiled);
    if (existingSignatures.has(signature) || seenSuggestionSignatures.has(signature)) continue;

    const preview = previewRule(db, compiled, 5);
    if (preview.match_ratio > 0.2 && !compiled.conditions.amount && !(compiled.conditions.account_ids || []).length) continue;

    suggestion.preview = {
      match_count: preview.match_count,
      match_ratio: preview.match_ratio,
      warnings: preview.warnings,
    };
    suggestion.signature = signature;
    suggestions.push(suggestion);
    seenSuggestionSignatures.add(signature);
  }

  suggestions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return suggestions.slice(0, Math.max(1, Number(max_suggestions) || 60));
}

router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM rules r
    LEFT JOIN categories c ON c.id = r.category_id
    ORDER BY r.priority DESC,
      CASE LOWER(COALESCE(r.source, 'manual'))
        WHEN 'manual' THEN 0
        WHEN 'learned' THEN 1
        ELSE 2
      END ASC,
      r.id ASC
  `).all().map((rule) => {
    const conditions = (() => { try { return JSON.parse(rule.conditions_json || '{}'); } catch { return {}; } })();
    const actions = (() => { try { return JSON.parse(rule.actions_json || '{}'); } catch { return {}; } })();

    if ((!conditions.description || !conditions.description.value) && rule.keyword) {
      conditions.description = {
        operator:
          rule.match_type === 'exact' ? 'equals' :
          rule.match_type === 'starts_with' ? 'starts_with' :
          rule.match_type === 'regex' ? 'regex' : 'contains',
        value: rule.keyword,
        case_sensitive: false,
      };
    }
    if (actions.set_category_id === undefined && rule.category_id !== null && rule.category_id !== undefined) {
      actions.set_category_id = rule.category_id;
    }

    return {
      ...rule,
      conditions,
      actions,
      behavior: {
        priority: rule.priority,
        is_enabled: !!rule.is_enabled,
        stop_processing: !!rule.stop_processing,
        source: rule.source || 'manual',
        confidence: rule.confidence,
      },
    };
  });
  res.json(rules);
});

router.post('/preview', (req, res) => {
  const db = getDb();
  const payload = req.body?.rule || req.body || {};
  const normalized = normalizeRulePayload(payload);
  const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];

  if (!compiled?.conditions?.has_any) {
    return res.status(400).json({ error: 'At least one matching condition is required for preview.' });
  }
  if (!hasMeaningfulActions(compiled.actions)) {
    return res.status(400).json({ error: 'At least one action is required for preview.' });
  }

  res.json(previewRule(db, compiled, Math.min(50, Math.max(5, Number(req.body?.sample_limit) || 20))));
});

router.post('/', (req, res) => {
  const db = getDb();
  const normalized = normalizeRulePayload(req.body || {});
  const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
  if (!compiled?.conditions?.has_any) {
    return res.status(400).json({ error: 'At least one condition is required.' });
  }
  if (!hasMeaningfulActions(compiled.actions)) {
    return res.status(400).json({ error: 'At least one action is required.' });
  }

  const preview = previewRule(db, compiled, 12);
  if (preview.requires_force && !asBool(req.body?.force_save, false)) {
    return res.status(409).json({
      error: 'Rule appears broad; confirm force_save to continue.',
      requires_force: true,
      preview,
    });
  }

  const info = db.prepare(`
    INSERT INTO rules (
      name, keyword, match_type, category_id, priority,
      is_enabled, stop_processing, source, confidence,
      conditions_json, actions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.name,
    normalized.keyword || '',
    normalized.match_type || 'contains_case_insensitive',
    normalized.category_id,
    normalized.priority,
    normalized.is_enabled,
    normalized.stop_processing,
    normalized.source,
    normalized.confidence,
    JSON.stringify(normalized.conditions || {}),
    JSON.stringify(normalized.actions || {})
  );

  res.json({ id: info.lastInsertRowid, preview });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const existingMerged = {
    ...existing,
    conditions: (() => { try { return JSON.parse(existing.conditions_json || '{}'); } catch { return {}; } })(),
    actions: (() => { try { return JSON.parse(existing.actions_json || '{}'); } catch { return {}; } })(),
  };

  const normalized = normalizeRulePayload(req.body || {}, existingMerged);
  const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
  if (!compiled?.conditions?.has_any) {
    return res.status(400).json({ error: 'At least one condition is required.' });
  }
  if (!hasMeaningfulActions(compiled.actions)) {
    return res.status(400).json({ error: 'At least one action is required.' });
  }

  const definitionChanged = isRuleMatchDefinitionChanged(existingMerged, normalized);
  let preview = null;
  if (definitionChanged) {
    preview = previewRule(db, compiled, 12);
    if (preview.requires_force && !asBool(req.body?.force_save, false)) {
      return res.status(409).json({
        error: 'Rule appears broad; confirm force_save to continue.',
        requires_force: true,
        preview,
      });
    }
  }

  db.prepare(`
    UPDATE rules SET
      name = ?,
      keyword = ?,
      match_type = ?,
      category_id = ?,
      priority = ?,
      is_enabled = ?,
      stop_processing = ?,
      source = ?,
      confidence = ?,
      conditions_json = ?,
      actions_json = ?
    WHERE id = ?
  `).run(
    normalized.name,
    normalized.keyword || '',
    normalized.match_type || 'contains_case_insensitive',
    normalized.category_id,
    normalized.priority,
    normalized.is_enabled,
    normalized.stop_processing,
    normalized.source,
    normalized.confidence,
    JSON.stringify(normalized.conditions || {}),
    JSON.stringify(normalized.actions || {}),
    req.params.id
  );

  res.json({ ok: true, preview });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM rules WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// POST /api/rules/apply — re-run rule engine over transactions
router.post('/apply', (req, res) => {
  const overwriteAlias = asBool(req.body?.overwrite, false);
  const hasExplicit = ['overwrite_category', 'overwrite_tags', 'overwrite_merchant', 'overwrite_flags', 'only_uncategorized']
    .some((k) => req.body && Object.prototype.hasOwnProperty.call(req.body, k));

  const opts = {
    overwrite_category: req.body?.overwrite_category !== undefined ? asBool(req.body.overwrite_category) : overwriteAlias,
    overwrite_tags: req.body?.overwrite_tags !== undefined ? asBool(req.body.overwrite_tags) : false,
    overwrite_merchant: req.body?.overwrite_merchant !== undefined ? asBool(req.body.overwrite_merchant) : false,
    overwrite_flags: req.body?.overwrite_flags !== undefined ? asBool(req.body.overwrite_flags) : false,
    includeLegacyTagRules: req.body?.include_legacy_tag_rules !== undefined ? asBool(req.body.include_legacy_tag_rules, true) : true,
    only_uncategorized: req.body?.only_uncategorized !== undefined
      ? asBool(req.body.only_uncategorized)
      : (!hasExplicit && !overwriteAlias),
  };

  const stats = applyRulesToAllTransactions(opts);
  res.json({
    ...stats,
    categorized: stats.category_updates, // backward-compatible key
    applied_options: opts,
  });
});

// POST /api/rules/learn — generate suggestions only (no writes)
router.post('/learn', (req, res) => {
  const db = getDb();
  const minCount = Math.max(2, parseInt(req.body?.min_count, 10) || 3);
  const maxSuggestions = Math.min(200, Math.max(5, parseInt(req.body?.max_suggestions, 10) || parseInt(req.body?.max_new_rules, 10) || 60));
  const suggestions = buildLearnSuggestions(db, { min_count: minCount, max_suggestions: maxSuggestions });

  res.json({
    mode: 'suggestions',
    analyzed: db.prepare(`SELECT COUNT(*) as n FROM transactions WHERE category_id IS NOT NULL AND is_transfer = 0`).get().n,
    created: 0,
    skipped: 0,
    min_count: minCount,
    suggestions_count: suggestions.length,
    suggestions,
  });
});

// POST /api/rules/learn/apply — persist selected suggestions
router.post('/learn/apply', (req, res) => {
  const db = getDb();
  const incoming = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
  if (!incoming.length) return res.status(400).json({ error: 'No suggestions provided' });

  const existingCompiled = compileRules(getRules(), { includeLegacyTagRules: false });
  const seen = new Set(existingCompiled.map(buildRuleSignature));
  const insert = db.prepare(`
    INSERT INTO rules (
      name, keyword, match_type, category_id, priority,
      is_enabled, stop_processing, source, confidence,
      conditions_json, actions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let created = 0;
  let skipped = 0;
  const maxCreate = Math.min(300, Math.max(1, parseInt(req.body?.max_create, 10) || incoming.length));

  db.transaction(() => {
    for (const raw of incoming) {
      if (created >= maxCreate) break;
      const normalized = normalizeRulePayload(raw || {});
      normalized.source = 'learned';
      normalized.priority = normalizePriority(raw?.behavior?.priority ?? raw?.priority, 4);
      normalized.is_enabled = asBool(raw?.behavior?.is_enabled ?? raw?.is_enabled, true) ? 1 : 0;
      normalized.stop_processing = asBool(raw?.behavior?.stop_processing ?? raw?.stop_processing, false) ? 1 : 0;

      const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
      if (!compiled?.conditions?.has_any || !hasMeaningfulActions(compiled.actions)) {
        skipped += 1;
        continue;
      }

      const signature = buildRuleSignature(compiled);
      if (seen.has(signature)) {
        skipped += 1;
        continue;
      }

      insert.run(
        normalized.name || 'Learned rule',
        normalized.keyword || '',
        normalized.match_type || 'contains_case_insensitive',
        normalized.category_id,
        normalized.priority,
        normalized.is_enabled,
        normalized.stop_processing,
        'learned',
        normalized.confidence,
        JSON.stringify(normalized.conditions || {}),
        JSON.stringify(normalized.actions || {})
      );
      seen.add(signature);
      created += 1;
    }
  })();

  res.json({ created, skipped, requested: incoming.length });
});

module.exports = router;
