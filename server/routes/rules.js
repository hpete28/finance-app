// server/routes/rules.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
const { getDb } = require('../database');
const {
  compileRules,
  getRules,
  normalizeForMatching,
  applyRulesToAllTransactions,
  evaluateTransactionWithRules,
} = require('../services/categorizer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const GENERIC_BROAD_TOKENS = new Set([
  'CANADA', 'CITY', 'OTTAWA', 'SUPER', 'MART', 'STORE', 'MARKET', 'PAYMENT',
  'TRANSFER', 'PURCHASE', 'DEBIT', 'CREDIT', 'ONLINE', 'SERVICE', 'AUTOPAY',
  'RECURRING', 'FROM', 'TO', 'INC', 'LTD',
]);

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const str = String(value).toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function parseJsonObjectSafe(raw, fallback = {}) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'object') return raw || fallback;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeScope(value) {
  const scope = String(value || 'learned').toLowerCase();
  return scope === 'all' ? 'all' : 'learned';
}

function normalizeImportMode(value) {
  const mode = String(value || 'replace').toLowerCase();
  if (mode === 'merge') return 'merge';
  return 'replace';
}

function inferFormatFromFilename(filename = '') {
  const lowered = String(filename || '').toLowerCase();
  if (lowered.endsWith('.csv')) return 'csv';
  if (lowered.endsWith('.json')) return 'json';
  return null;
}

function buildRulesFilename(scope = 'learned', format = 'json') {
  const today = new Date().toISOString().slice(0, 10);
  return `rules-${scope}-${today}.${format}`;
}

function normalizeLintScope(value) {
  const scope = String(value || 'all').toLowerCase();
  if (scope === 'manual') return 'manual';
  if (scope === 'learned') return 'learned';
  return 'all';
}

function listRawRulesByScope(scope = 'all') {
  const all = getRules();
  if (scope === 'manual') return all.filter((r) => String(r.source || 'manual').toLowerCase() === 'manual');
  if (scope === 'learned') return all.filter((r) => String(r.source || 'manual').toLowerCase() === 'learned');
  return all;
}

function getIncomeCategoryIds(db) {
  return new Set(
    db.prepare(`SELECT id FROM categories WHERE COALESCE(is_income, 0) = 1`).all()
      .map((r) => Number(r.id))
      .filter((v) => Number.isFinite(v))
  );
}

function categoryNameByIdMap(db) {
  return new Map(
    db.prepare(`SELECT id, name FROM categories`).all()
      .map((r) => [Number(r.id), String(r.name || '')])
  );
}

function normalizeDescriptionPhrase(raw = '') {
  const normalized = normalizeForMatching(raw)
    .split(' ')
    .filter((t) => t.length >= 3);
  if (normalized.length < 2) return '';
  const phrase = normalized.slice(0, 5).join(' ').trim();
  if (phrase.length < 12) return '';
  return phrase;
}

function conditionFeatures(rule) {
  const c = rule.conditions || {};
  return {
    has_description: !!(c.description && c.description.value),
    has_merchant: !!(c.merchant && c.merchant.value),
    has_amount: !!c.amount,
    has_sign: !!(c.amount_sign && c.amount_sign !== 'any'),
    has_accounts: Array.isArray(c.account_ids) && c.account_ids.length > 0,
    has_date: !!c.date_range,
  };
}

function isDescriptionOnlyRule(rule) {
  const f = conditionFeatures(rule);
  return f.has_description && !f.has_merchant && !f.has_amount && !f.has_sign && !f.has_accounts && !f.has_date;
}

function broadTokenViolation(rule) {
  const c = rule.conditions || {};
  const value = String(c.description?.value || '').trim();
  if (!value) return false;
  const normalized = normalizeForMatching(value);
  const isShort = normalized.length > 0 && normalized.length < 10;
  const parts = normalized.split(' ').filter(Boolean);
  const hasGeneric = parts.some((p) => GENERIC_BROAD_TOKENS.has(p));
  return isDescriptionOnlyRule(rule) && (isShort || hasGeneric);
}

function hasLearnedScopeConstraint(rule) {
  const f = conditionFeatures(rule);
  const hasText = f.has_description || f.has_merchant;
  const hasConstraint = f.has_sign || f.has_accounts || f.has_amount || f.has_merchant;
  return hasText && hasConstraint;
}

function dominantAmountSign(rows = []) {
  let positive = 0;
  let negative = 0;
  rows.forEach((r) => {
    const n = Number(r.amount) || 0;
    if (n > 0) positive += 1;
    if (n < 0) negative += 1;
  });
  const total = positive + negative;
  if (!total) return null;
  const posRatio = positive / total;
  const negRatio = negative / total;
  if (posRatio >= 0.95) return 'income';
  if (negRatio >= 0.95) return 'expense';
  return null;
}

function chooseDominantAccount(rows = []) {
  const counts = new Map();
  for (const r of rows) {
    const id = Number(r.account_id);
    if (!Number.isFinite(id)) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const best = commonFromMap(counts);
  if (!best) return null;
  if (best.count / Math.max(1, rows.length) < 0.9) return null;
  return Number(best.key);
}

function computeAmountBand(rows = []) {
  const abs = rows.map((r) => Math.abs(Number(r.amount) || 0)).filter((v) => v > 0);
  if (abs.length < 5) return null;
  const avg = abs.reduce((s, v) => s + v, 0) / abs.length;
  const variance = abs.reduce((s, v) => s + ((v - avg) ** 2), 0) / abs.length;
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
  if (cv > 0.15) return null;
  const min = Math.min(...abs);
  const max = Math.max(...abs);
  if ((max - min) > Math.max(8, avg * 0.15)) return null;
  return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
}

function createArchiveBatchId() {
  return `${new Date().toISOString()}::${crypto.randomUUID()}`;
}

function archiveAndDisableLearnedRules(db, reason = 'learned_reset') {
  const learnedRows = db.prepare(`
    SELECT id, name, keyword, match_type, category_id, priority,
           is_enabled, stop_processing, source, confidence,
           conditions_json, actions_json, created_at
    FROM rules
    WHERE LOWER(COALESCE(source, 'manual')) = 'learned'
  `).all();
  if (!learnedRows.length) {
    return { archive_batch_id: null, archived_count: 0, disabled_count: 0 };
  }
  const batchId = createArchiveBatchId();
  const insertArchive = db.prepare(`
    INSERT INTO rules_archived (
      archive_batch_id, archived_reason, original_rule_id,
      name, keyword, match_type, category_id, priority,
      is_enabled, stop_processing, source, confidence,
      conditions_json, actions_json, original_created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const disableLearned = db.prepare(`
    UPDATE rules
    SET is_enabled = 0
    WHERE LOWER(COALESCE(source, 'manual')) = 'learned'
      AND is_enabled = 1
  `);

  db.transaction(() => {
    learnedRows.forEach((r) => {
      insertArchive.run(
        batchId,
        reason,
        r.id,
        r.name,
        r.keyword || '',
        r.match_type || 'contains_case_insensitive',
        r.category_id,
        r.priority ?? 10,
        r.is_enabled ? 1 : 0,
        r.stop_processing ? 1 : 0,
        r.source || 'learned',
        r.confidence,
        r.conditions_json || '{}',
        r.actions_json || '{}',
        r.created_at || null
      );
    });
  })();

  const disableInfo = disableLearned.run();
  return {
    archive_batch_id: batchId,
    archived_count: learnedRows.length,
    disabled_count: disableInfo.changes || 0,
  };
}

function dedupeManualRules(db) {
  const manualRows = listRawRulesByScope('manual').filter((r) => r.is_enabled);
  const compiled = compileRules(manualRows, { includeLegacyTagRules: false });
  const seen = new Map();
  const duplicateIds = [];

  for (const rule of compiled) {
    const signature = buildRuleSignature(rule);
    if (!seen.has(signature)) {
      seen.set(signature, rule.id);
      continue;
    }
    duplicateIds.push(Number(rule.id));
  }
  if (!duplicateIds.length) {
    return { duplicate_groups: 0, disabled_duplicates: 0, duplicate_rule_ids: [] };
  }
  const placeholders = duplicateIds.map(() => '?').join(', ');
  const info = db.prepare(`
    UPDATE rules
    SET is_enabled = 0
    WHERE id IN (${placeholders})
  `).run(...duplicateIds);

  return {
    duplicate_groups: duplicateIds.length,
    disabled_duplicates: info.changes || 0,
    duplicate_rule_ids: duplicateIds,
  };
}

function backfillIncomeSignGuards(db) {
  const incomeIds = getIncomeCategoryIds(db);
  if (!incomeIds.size) {
    return { scanned: 0, updated: 0, updated_rule_ids: [] };
  }

  const rows = db.prepare(`
    SELECT id, category_id, conditions_json, actions_json
    FROM rules
  `).all();
  const update = db.prepare(`UPDATE rules SET conditions_json = ? WHERE id = ?`);

  let updated = 0;
  const updatedRuleIds = [];
  db.transaction(() => {
    for (const row of rows) {
      const conditions = parseJsonObjectSafe(row.conditions_json, {});
      const actions = parseJsonObjectSafe(row.actions_json, {});
      const targetCategory = toNumberOrNull(
        actions.set_category_id !== undefined ? actions.set_category_id : row.category_id
      );
      if (targetCategory === null || !incomeIds.has(Number(targetCategory))) continue;
      if (String(conditions.amount_sign || 'any').toLowerCase() === 'income') continue;

      conditions.amount_sign = 'income';
      update.run(JSON.stringify(conditions || {}), row.id);
      updated += 1;
      updatedRuleIds.push(Number(row.id));
    }
  })();

  return {
    scanned: rows.length,
    updated,
    updated_rule_ids: updatedRuleIds,
  };
}

function buildLintReport(db, scope = 'all') {
  const lintScope = normalizeLintScope(scope);
  const rawRows = listRawRulesByScope(lintScope);
  const compiled = compileRules(rawRows, { includeLegacyTagRules: false });
  const incomeIds = getIncomeCategoryIds(db);
  const categoryNames = categoryNameByIdMap(db);

  const bySignature = new Map();
  for (const r of compiled) {
    const sig = buildRuleSignature(r);
    const list = bySignature.get(sig) || [];
    list.push({
      id: r.id,
      source: r.source,
      priority: r.priority,
      name: r.name || null,
      keyword: r.keyword || '',
      category_name: r.category_name || null,
    });
    bySignature.set(sig, list);
  }
  const duplicateSignatures = [...bySignature.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);

  const byDescriptionNeedle = new Map();
  for (const r of compiled) {
    const desc = r.conditions?.description;
    const categoryId = r.actions?.set_category_id;
    if (!desc || categoryId === undefined || categoryId === null) continue;
    const key = normalizeForMatching(desc.value || '');
    if (!key) continue;
    const row = byDescriptionNeedle.get(key) || [];
    row.push({
      id: r.id,
      source: r.source,
      priority: r.priority,
      category_id: Number(categoryId),
      category_name: categoryNames.get(Number(categoryId)) || r.category_name || null,
      keyword: r.keyword || '',
      has_sign: !!(r.conditions?.amount_sign && r.conditions.amount_sign !== 'any'),
      account_scope: Array.isArray(r.conditions?.account_ids) ? r.conditions.account_ids.length : 0,
    });
    byDescriptionNeedle.set(key, row);
  }
  const crossCategoryConflicts = [...byDescriptionNeedle.entries()]
    .map(([needle, rules]) => ({
      description_needle: needle,
      category_count: new Set(rules.map((r) => r.category_id)).size,
      rules,
    }))
    .filter((g) => g.category_count > 1)
    .sort((a, b) => b.rules.length - a.rules.length);

  const broadTokenViolations = compiled
    .filter((r) => String(r.source || '').toLowerCase() === 'learned' && broadTokenViolation(r))
    .map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name || null,
      keyword: r.keyword || '',
      category_name: r.category_name || null,
      priority: r.priority,
      condition: r.conditions?.description?.value || null,
    }));

  const missingIncomeSignGuard = compiled
    .filter((r) => {
      const target = r.actions?.set_category_id;
      if (target === undefined || target === null) return false;
      if (!incomeIds.has(Number(target))) return false;
      return String(r.conditions?.amount_sign || 'any').toLowerCase() !== 'income';
    })
    .map((r) => ({
      id: r.id,
      source: r.source,
      priority: r.priority,
      name: r.name || null,
      keyword: r.keyword || '',
      category_name: r.category_name || null,
      amount_sign: r.conditions?.amount_sign || 'any',
    }));

  const txRows = db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals
    FROM transactions
  `).all();
  const matchCountByRule = new Map();
  let blockedIncomeAssignments = 0;

  for (const row of txRows) {
    const evaluated = evaluateTransactionWithRules({
      ...row,
      tags: parseTags(row.tags),
    }, compiled, {
      overwrite_category: true,
      overwrite_tags: true,
      overwrite_merchant: true,
      overwrite_flags: true,
    });
    blockedIncomeAssignments += Number(evaluated.blocked_income_assignments || 0);
    for (const rid of evaluated.matched_rule_ids) {
      matchCountByRule.set(rid, (matchCountByRule.get(rid) || 0) + 1);
    }
  }

  const predictedBlast = compiled
    .map((r) => {
      const count = matchCountByRule.get(r.id) || 0;
      return {
        id: r.id,
        name: r.name || null,
        source: r.source,
        priority: r.priority,
        keyword: r.keyword || '',
        category_name: r.category_name || null,
        match_count: count,
        match_ratio: txRows.length ? Number((count / txRows.length).toFixed(4)) : 0,
      };
    })
    .filter((r) => r.match_count > 0)
    .sort((a, b) => b.match_count - a.match_count)
    .slice(0, 80);

  const riskScore = Math.max(0, 100
    - (duplicateSignatures.length * 3)
    - (crossCategoryConflicts.length * 4)
    - (broadTokenViolations.length * 2)
    - (missingIncomeSignGuard.length * 5)
  );

  const summary = {
    scope: lintScope,
    total_rules_in_scope: rawRows.length,
    enabled_rules_in_scope: compiled.length,
    duplicate_signature_groups: duplicateSignatures.length,
    cross_category_conflicts: crossCategoryConflicts.length,
    broad_token_violations: broadTokenViolations.length,
    missing_income_sign_guard: missingIncomeSignGuard.length,
    predicted_blast_rules: predictedBlast.length,
    blocked_income_assignments: blockedIncomeAssignments,
    risk_score: Math.round(riskScore),
    generated_at: new Date().toISOString(),
  };

  return {
    summary,
    findings: {
      duplicate_signatures: duplicateSignatures.slice(0, 80),
      cross_category_conflicts: crossCategoryConflicts.slice(0, 80),
      broad_token_violations: broadTokenViolations.slice(0, 120),
      missing_income_sign_guard: missingIncomeSignGuard.slice(0, 120),
      predicted_blast: predictedBlast,
    },
  };
}

function persistLintReport(db, scope, summary, findings) {
  db.prepare(`
    INSERT INTO rule_lint_reports (scope, summary_json, findings_json)
    VALUES (?, ?, ?)
  `).run(
    normalizeLintScope(scope),
    JSON.stringify(summary || {}),
    JSON.stringify(findings || {})
  );
}

function insertRebuildRun(db, { config, suggestions, appliedCount, status }) {
  const info = db.prepare(`
    INSERT INTO rule_rebuild_runs (config_json, suggestions_json, applied_count, status)
    VALUES (?, ?, ?, ?)
  `).run(
    JSON.stringify(config || {}),
    JSON.stringify(suggestions || []),
    Number(appliedCount) || 0,
    String(status || 'preview')
  );
  return Number(info.lastInsertRowid);
}

function enforceIncomeSignGuard(db, normalizedRule) {
  const categoryId = normalizedRule?.category_id;
  if (categoryId === undefined || categoryId === null || categoryId === '') return;
  const row = db.prepare(`SELECT COALESCE(is_income, 0) as is_income, name FROM categories WHERE id = ?`).get(categoryId);
  if (!row || !row.is_income) return;
  const amountSign = String(normalizedRule?.conditions?.amount_sign || 'any').toLowerCase();
  if (amountSign !== 'income') {
    throw new Error(`Income category rules must include amount_sign='income' (category: ${row.name || categoryId}).`);
  }
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

function getDominantSign(rows = []) {
  let positive = 0;
  let negative = 0;
  rows.forEach((r) => {
    const amount = Number(r.amount) || 0;
    if (amount > 0) positive += 1;
    if (amount < 0) negative += 1;
  });
  const total = positive + negative;
  if (!total) return null;
  const posRatio = positive / total;
  const negRatio = negative / total;
  if (posRatio >= 0.95) return 'income';
  if (negRatio >= 0.95) return 'expense';
  return null;
}

function analyzeSuggestionPrecision(categorizedRows, compiledRule, categoryId) {
  let matched = 0;
  let matchingCategory = 0;
  let conflictingCategory = 0;

  for (const row of categorizedRows) {
    const evaluated = evaluateTransactionWithRules({
      ...row,
      tags: parseTags(row.tags),
    }, [compiledRule], {
      overwrite_category: true,
      overwrite_tags: true,
      overwrite_merchant: true,
      overwrite_flags: true,
    });
    if (!evaluated.matched_rule_ids.length) continue;
    matched += 1;
    if (Number(row.category_id) === Number(categoryId)) matchingCategory += 1;
    else conflictingCategory += 1;
  }

  const precision = matched > 0 ? matchingCategory / matched : 0;
  return {
    matched,
    matching_category: matchingCategory,
    conflicting_category: conflictingCategory,
    precision: Number(precision.toFixed(3)),
  };
}

function buildLearnSuggestions(db, { min_count = 3, max_suggestions = 60 } = {}) {
  const categoryNames = new Map(
    db.prepare(`SELECT id, name FROM categories`).all().map((c) => [Number(c.id), c.name])
  );
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
    if (group.rows.length < Math.max(min_count, 4)) continue;

    const byCategory = new Map();
    group.rows.forEach((r) => byCategory.set(r.category_id, (byCategory.get(r.category_id) || 0) + 1));
    const dominantCategory = commonFromMap(byCategory);
    if (!dominantCategory) continue;

    const dominantRows = group.rows.filter((r) => r.category_id === Number(dominantCategory.key));
    const purity = dominantRows.length / group.rows.length;
    if (dominantRows.length < Math.max(min_count, 4) || purity < 0.9) continue;

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
      const weakTokens = new Set([
        'PAYMENT', 'TRANSFER', 'PURCHASE', 'DEBIT', 'CREDIT', 'CARD', 'ONLINE', 'PREAUTH',
        'POS', 'CANADA', 'STORE', 'MARKET', 'SERVICE', 'AUTOPAY', 'RECURRING',
      ]);
      const tokenCounts = new Map();
      dominantRows.forEach((r) => {
        const tokens = normalizeForMatching(r.description || '')
          .split(' ')
          .filter((t) => t.length >= 5 && !weakTokens.has(t));
        tokens.forEach((t) => tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1));
      });
      const bestToken = commonFromMap(tokenCounts);
      if (!bestToken || bestToken.count < Math.ceil(dominantRows.length * 0.85)) continue;
      conditions.description = { operator: 'contains', value: bestToken.key, case_sensitive: false };
      rationale.push('Derived from recurring description token');
    }

    const dominantSign = getDominantSign(dominantRows);
    if (dominantSign) {
      conditions.amount_sign = dominantSign;
      rationale.push(`Constrained to ${dominantSign} transactions`);
    }

    const accountCounts = new Map();
    dominantRows.forEach((r) => {
      if (r.account_id !== null && r.account_id !== undefined) {
        accountCounts.set(Number(r.account_id), (accountCounts.get(Number(r.account_id)) || 0) + 1);
      }
    });
    const topAccount = commonFromMap(accountCounts);
    if (topAccount && topAccount.count >= Math.ceil(dominantRows.length * 0.9)) {
      conditions.account_ids = [Number(topAccount.key)];
      rationale.push('Scoped to dominant account');
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

    const categoryId = Number(dominantCategory.key);
    const categoryName = categoryNames.get(categoryId) || `Category ${categoryId}`;
    const suggestion = {
      name: `${categoryName} · ${group.kind === 'merchant' ? 'merchant' : 'description'} rule`,
      keyword: chooseKeywordFallback(conditions, ''),
      match_type: 'contains_case_insensitive',
      category_id: actions.set_category_id,
      category_name: categoryName,
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

    const precision = analyzeSuggestionPrecision(rows, compiled, actions.set_category_id);
    if (precision.matched < Math.max(min_count, 4)) continue;
    if (precision.precision < 0.9) continue;
    if (precision.conflicting_category >= 3 && precision.precision < 0.95) continue;

    const preview = previewRule(db, compiled, 5);
    const hasScope = !!compiled.conditions.amount
      || !!compiled.conditions.merchant
      || !!compiled.conditions.amount_sign
      || (compiled.conditions.account_ids || []).length > 0
      || !!compiled.conditions.date_range;
    if (preview.match_ratio > 0.25) continue;
    if (!hasScope && preview.match_ratio > 0.12) continue;

    suggestion.preview = {
      match_count: preview.match_count,
      match_ratio: preview.match_ratio,
      warnings: preview.warnings,
    };
    suggestion.stats.precision = precision.precision;
    suggestion.stats.conflicting_matches = precision.conflicting_category;
    suggestion.signature = signature;
    suggestions.push(suggestion);
    seenSuggestionSignatures.add(signature);
  }

  suggestions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return suggestions.slice(0, Math.max(1, Number(max_suggestions) || 60));
}

function getLearnedCompiledRules() {
  const learnedRows = getRules().filter((r) => String(r.source || 'manual').toLowerCase() === 'learned');
  return compileRules(learnedRows, { includeLegacyTagRules: false });
}

function getTransactionsForExplain(db, payload = {}) {
  const ids = Array.isArray(payload?.transaction_ids)
    ? payload.transaction_ids.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  const limit = Math.min(200, Math.max(1, Number(payload?.limit) || 30));

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    return db.prepare(`
      SELECT id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals
      FROM transactions
      WHERE id IN (${placeholders})
      ORDER BY date DESC
      LIMIT ?
    `).all(...ids, limit);
  }

  const where = [];
  const params = [];
  if (payload?.start_date) {
    where.push('date >= ?');
    params.push(String(payload.start_date));
  }
  if (payload?.end_date) {
    where.push('date <= ?');
    params.push(String(payload.end_date));
  }
  if (payload?.search) {
    where.push('UPPER(description) LIKE ?');
    params.push(`%${String(payload.search).toUpperCase()}%`);
  }
  if (payload?.category_id === null || payload?.category_id === 'null') {
    where.push('category_id IS NULL');
  } else if (payload?.category_id !== undefined && payload?.category_id !== '') {
    where.push('category_id = ?');
    params.push(Number(payload.category_id));
  }

  return db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals
    FROM transactions
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY date DESC
    LIMIT ?
  `).all(...params, limit);
}

function buildRebuildSuggestions(db, {
  max_suggestions = 120,
  min_support = 5,
  min_purity = 0.97,
  max_conflict_rate = 0.03,
  max_match_ratio = 0.08,
  exclude_category_ids = [],
  include_reviewed_trusted = true,
} = {}) {
  const incomeIds = getIncomeCategoryIds(db);
  const excludedSet = new Set((exclude_category_ids || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)));
  const includeReviewedTrusted = !!include_reviewed_trusted;
  const baseRows = db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, tags, merchant_name, is_income_override, exclude_from_totals, reviewed
    FROM transactions
    WHERE category_id IS NOT NULL
      AND COALESCE(is_transfer, 0) = 0
      AND COALESCE(exclude_from_totals, 0) = 0
  `).all().filter((r) => !excludedSet.has(Number(r.category_id)));

  const manualRows = listRawRulesByScope('manual').filter((r) => r.is_enabled);
  const manualCompiled = compileRules(manualRows, { includeLegacyTagRules: false });
  const trustedById = new Map();

  function markTrusted(row, source) {
    const key = String(row.id);
    const existing = trustedById.get(key);
    if (!existing) {
      trustedById.set(key, { row, sources: new Set([source]) });
      return;
    }
    existing.sources.add(source);
  }

  for (const row of baseRows) {
    const evaluated = evaluateTransactionWithRules({
      ...row,
      tags: parseTags(row.tags),
    }, manualCompiled, {
      overwrite_category: true,
      overwrite_tags: true,
      overwrite_merchant: true,
      overwrite_flags: true,
    });
    if (!evaluated.matched_rule_ids.length) continue;
    if (evaluated.category_id === null || evaluated.category_id === undefined) continue;
    if (Number(evaluated.category_id) !== Number(row.category_id)) continue;
    markTrusted(row, 'manual_rule');
  }

  if (includeReviewedTrusted) {
    for (const row of baseRows) {
      if (Number(row.reviewed || 0) !== 1) continue;
      markTrusted(row, 'reviewed_label');
    }
  }
  const trustedRows = [...trustedById.values()].map((v) => v.row);
  let trustedRowsManual = 0;
  let trustedRowsReviewed = 0;
  for (const entry of trustedById.values()) {
    if (entry.sources.has('manual_rule')) trustedRowsManual += 1;
    if (entry.sources.has('reviewed_label')) trustedRowsReviewed += 1;
  }

  const byMerchant = new Map();
  const byPhrase = new Map();
  for (const row of trustedRows) {
    const merchantKey = normalizeForMatching(row.merchant_name || '');
    if (merchantKey && merchantKey.length >= 10) {
      const list = byMerchant.get(merchantKey) || [];
      list.push(row);
      byMerchant.set(merchantKey, list);
    }

    const phrase = normalizeDescriptionPhrase(row.description || '');
    if (phrase) {
      const list = byPhrase.get(phrase) || [];
      list.push(row);
      byPhrase.set(phrase, list);
    }
  }

  const existingSignatures = new Set(
    compileRules(getRules(), { includeLegacyTagRules: false }).map(buildRuleSignature)
  );
  const candidateByDescription = new Map();
  const suggestions = [];

  function pushCandidate(kind, key, rows) {
    if (rows.length < min_support) return;
    const byCategory = new Map();
    rows.forEach((r) => byCategory.set(Number(r.category_id), (byCategory.get(Number(r.category_id)) || 0) + 1));
    const dominant = commonFromMap(byCategory);
    if (!dominant) return;
    const categoryId = Number(dominant.key);
    const support = Number(dominant.count || 0);
    const purity = support / rows.length;
    const conflictRate = 1 - purity;
    if (support < min_support || purity < min_purity || conflictRate > max_conflict_rate) return;

    const sign = dominantAmountSign(rows.filter((r) => Number(r.category_id) === categoryId));
    if (!sign) return;
    if (incomeIds.has(categoryId) && sign !== 'income') return;

    const dominantRows = rows.filter((r) => Number(r.category_id) === categoryId);
    const conditions = {};
    if (kind === 'merchant') {
      conditions.merchant = { operator: 'contains', value: key, case_sensitive: false };
    } else {
      conditions.description = { operator: 'contains', value: key, case_sensitive: false };
    }
    conditions.amount_sign = sign;
    const account = chooseDominantAccount(dominantRows);
    if (account !== null && account !== undefined) {
      conditions.account_ids = [Number(account)];
    }
    const amountBand = computeAmountBand(dominantRows);
    if (amountBand) {
      conditions.amount = amountBand;
    }

    const actions = { set_category_id: categoryId };
    if (kind === 'merchant') actions.set_merchant_name = key;

    const suggestionPayload = {
      name: `${kind === 'merchant' ? 'Merchant' : 'Description'} rebuild rule`,
      keyword: key,
      match_type: 'contains_case_insensitive',
      category_id: categoryId,
      conditions,
      actions,
      behavior: {
        priority: 4,
        is_enabled: true,
        stop_processing: false,
        source: 'learned',
        confidence: null,
      },
    };
    const normalized = normalizeRulePayload(suggestionPayload);
    normalized.source = 'learned';
    normalized.priority = Math.min(4, normalizePriority(normalized.priority, 4));
    const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
    if (!compiled || !compiled.conditions?.has_any || !hasMeaningfulActions(compiled.actions)) return;
    if (broadTokenViolation(compiled)) return;

    const signature = buildRuleSignature(compiled);
    if (existingSignatures.has(signature)) return;

    let matchCount = 0;
    for (const tx of baseRows) {
      const e = evaluateTransactionWithRules({
        ...tx,
        tags: parseTags(tx.tags),
      }, [compiled], {
        overwrite_category: true,
        overwrite_tags: true,
        overwrite_merchant: true,
        overwrite_flags: true,
      });
      if (e.matched_rule_ids.length) matchCount += 1;
    }
    const matchRatio = baseRows.length ? (matchCount / baseRows.length) : 0;
    if (kind !== 'merchant' && matchRatio > max_match_ratio) return;

    const confidence = Number(Math.min(
      0.99,
      0.55 + Math.min(0.25, support / 200) + Math.max(0, (purity - min_purity) * 2)
      + (conditions.account_ids ? 0.05 : 0) + (conditions.amount ? 0.05 : 0)
    ).toFixed(2));

    const candidate = {
      name: normalized.name || null,
      keyword: normalized.keyword,
      match_type: normalized.match_type,
      category_id: normalized.category_id,
      conditions: normalized.conditions,
      actions: normalized.actions,
      behavior: {
        priority: 4,
        is_enabled: true,
        stop_processing: false,
        source: 'learned',
        confidence,
      },
      confidence,
      signature,
      stats: {
        support_count: support,
        group_count: rows.length,
        purity: Number(purity.toFixed(3)),
        conflict_rate: Number(conflictRate.toFixed(3)),
        estimated_match_count: matchCount,
        estimated_match_ratio: Number(matchRatio.toFixed(4)),
      },
      source_kind: kind,
      pattern: key,
    };

    if (kind === 'description') {
      const existing = candidateByDescription.get(key);
      if (!existing || (candidate.stats.support_count > existing.stats.support_count)) {
        candidateByDescription.set(key, candidate);
      }
      return;
    }
    suggestions.push(candidate);
    existingSignatures.add(signature);
  }

  for (const [merchant, rows] of byMerchant.entries()) pushCandidate('merchant', merchant, rows);
  for (const [phrase, rows] of byPhrase.entries()) pushCandidate('description', phrase, rows);
  for (const candidate of candidateByDescription.values()) {
    if (!existingSignatures.has(candidate.signature)) {
      suggestions.push(candidate);
      existingSignatures.add(candidate.signature);
    }
  }

  suggestions.sort((a, b) => {
    if ((b.confidence || 0) !== (a.confidence || 0)) return (b.confidence || 0) - (a.confidence || 0);
    return (b.stats?.support_count || 0) - (a.stats?.support_count || 0);
  });

  return {
    trusted_rows: trustedRows.length,
    trusted_rows_manual: trustedRowsManual,
    trusted_rows_reviewed: trustedRowsReviewed,
    candidate_groups: byMerchant.size + byPhrase.size,
    suggestions: suggestions.slice(0, Math.max(1, Number(max_suggestions) || 120)),
  };
}

function applyLearnedSuggestionSet(db, suggestions = []) {
  const incoming = Array.isArray(suggestions) ? suggestions : [];
  if (!incoming.length) return { created: 0, skipped: 0 };
  const existingSignatures = new Set(compileRules(getRules(), { includeLegacyTagRules: false }).map(buildRuleSignature));
  const insert = db.prepare(`
    INSERT INTO rules (
      name, keyword, match_type, category_id, priority,
      is_enabled, stop_processing, source, confidence,
      conditions_json, actions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let created = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const raw of incoming) {
      const normalized = normalizeRulePayload(raw || {});
      normalized.source = 'learned';
      normalized.priority = 4;
      try {
        enforceIncomeSignGuard(db, normalized);
      } catch {
        skipped += 1;
        continue;
      }
      const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
      if (!compiled || !compiled.conditions?.has_any || !hasMeaningfulActions(compiled.actions)) {
        skipped += 1;
        continue;
      }
      if (broadTokenViolation(compiled)) {
        skipped += 1;
        continue;
      }
      const sig = buildRuleSignature(compiled);
      if (existingSignatures.has(sig)) {
        skipped += 1;
        continue;
      }
      insert.run(
        normalized.name || 'Rebuilt learned rule',
        normalized.keyword || '',
        normalized.match_type || 'contains_case_insensitive',
        normalized.category_id,
        4,
        1,
        normalized.stop_processing ? 1 : 0,
        'learned',
        normalized.confidence ?? null,
        JSON.stringify(normalized.conditions || {}),
        JSON.stringify(normalized.actions || {})
      );
      existingSignatures.add(sig);
      created += 1;
    }
  })();
  return { created, skipped };
}

function scanTransactionsMatchedByLearnedCategoryRules(db, {
  sample_limit = 50,
  created_from = null,
  created_to = null,
  only_unreviewed = false,
} = {}) {
  const learnedRules = getLearnedCompiledRules();
  if (!learnedRules.length) {
    return {
      scanned: 0,
      learned_rules_count: 0,
      match_count: 0,
      transaction_ids: [],
      sample: [],
      created_at_histogram: [],
    };
  }

  const where = ['t.category_id IS NOT NULL'];
  const params = [];
  if (created_from) {
    where.push('t.created_at >= ?');
    params.push(created_from);
  }
  if (created_to) {
    where.push('t.created_at <= ?');
    params.push(created_to);
  }
  if (only_unreviewed) {
    where.push('COALESCE(t.reviewed, 0) = 0');
  }

  const rows = db.prepare(`
    SELECT
      t.id, t.account_id, t.date, t.description, t.amount, t.category_id,
      t.tags, t.merchant_name, t.is_income_override, t.exclude_from_totals, t.reviewed, t.created_at,
      a.name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.date DESC
  `).all(...params);

  const txIds = [];
  const sample = [];
  const seen = new Set();
  const minuteHistogram = new Map();

  for (const row of rows) {
    const evaluated = evaluateTransactionWithRules({
      ...row,
      tags: parseTags(row.tags),
    }, learnedRules, {
      overwrite_category: true,
      overwrite_tags: true,
      overwrite_merchant: true,
      overwrite_flags: true,
    });

    if (!evaluated.matched_rule_ids.length) continue;
    if (evaluated.category_id === null || evaluated.category_id === undefined) continue;
    // conservative: only target rows currently in the same category the learned rule would assign
    if (Number(row.category_id) !== Number(evaluated.category_id)) continue;
    if (seen.has(String(row.id))) continue;

    seen.add(String(row.id));
    txIds.push(String(row.id));
    const minute = String(row.created_at || '').slice(0, 16);
    minuteHistogram.set(minute, (minuteHistogram.get(minute) || 0) + 1);
    if (sample.length < sample_limit) {
      sample.push({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: row.amount,
        account_id: row.account_id,
        account_name: row.account_name,
        category_id: row.category_id,
        merchant_name: row.merchant_name,
        tags: parseTags(row.tags),
        reviewed: row.reviewed ? 1 : 0,
        created_at: row.created_at,
      });
    }
  }

  const createdAtHistogram = [...minuteHistogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([minute, count]) => ({ minute, count }));

  return {
    scanned: rows.length,
    learned_rules_count: learnedRules.length,
    match_count: txIds.length,
    transaction_ids: txIds,
    sample,
    created_at_histogram: createdAtHistogram,
  };
}

function getRuleWhereForScope(scope = 'learned') {
  if (scope === 'all') return { whereSql: '1 = 1', params: [] };
  return { whereSql: "LOWER(COALESCE(r.source, 'manual')) = 'learned'", params: [] };
}

function listRulesForApi(db, scope = 'all') {
  const { whereSql, params } = getRuleWhereForScope(scope);
  return db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM rules r
    LEFT JOIN categories c ON c.id = r.category_id
    WHERE ${whereSql}
    ORDER BY r.priority DESC,
      CASE LOWER(COALESCE(r.source, 'manual'))
        WHEN 'manual' THEN 0
        WHEN 'learned' THEN 1
        ELSE 2
      END ASC,
      r.id ASC
  `).all(...params).map((rule) => {
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
}

function rulesToCsv(rules = []) {
  const columns = [
    'id',
    'source',
    'name',
    'keyword',
    'match_type',
    'category_id',
    'category_name',
    'priority',
    'is_enabled',
    'stop_processing',
    'confidence',
    'conditions_json',
    'actions_json',
  ];
  const lines = [columns.join(',')];
  for (const rule of rules) {
    const row = {
      id: rule.id ?? '',
      source: rule.source || 'manual',
      name: rule.name || '',
      keyword: rule.keyword || '',
      match_type: rule.match_type || 'contains_case_insensitive',
      category_id: rule.category_id ?? '',
      category_name: rule.category_name || '',
      priority: rule.priority ?? 10,
      is_enabled: rule.is_enabled ? 1 : 0,
      stop_processing: rule.stop_processing ? 1 : 0,
      confidence: rule.confidence ?? '',
      conditions_json: JSON.stringify(rule.conditions || {}),
      actions_json: JSON.stringify(rule.actions || {}),
    };
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function parseImportedRules({ format, fileText }) {
  if (format === 'json') {
    const parsed = JSON.parse(fileText);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.rules)) return parsed.rules;
    throw new Error('JSON file must contain a rules array');
  }

  const rows = parseCsv(fileText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  return rows;
}

function buildCategoryResolver(db) {
  const existing = db.prepare(`SELECT id, name FROM categories`).all();
  const byId = new Map(existing.map((c) => [Number(c.id), { id: Number(c.id), name: c.name }]));
  const byName = new Map(existing.map((c) => [String(c.name || '').trim().toLowerCase(), { id: Number(c.id), name: c.name }]));
  const created = [];
  const insertCategory = db.prepare(`
    INSERT INTO categories (name, color, is_system, is_income)
    VALUES (?, ?, 0, ?)
  `);

  return {
    created,
    resolve(rawId, rawName) {
      const nameCandidate = String(rawName || '').trim();
      if (nameCandidate) {
        const key = nameCandidate.toLowerCase();
        const found = byName.get(key);
        if (found) return found.id;
        const isIncome = nameCandidate.toUpperCase().includes('INCOME') ? 1 : 0;
        const info = insertCategory.run(nameCandidate, '#6366f1', isIncome);
        const next = { id: Number(info.lastInsertRowid), name: nameCandidate };
        byName.set(key, next);
        byId.set(next.id, next);
        created.push(next);
        return next.id;
      }

      const n = toNumberOrNull(rawId);
      if (n === null) return null;
      return byId.has(n) ? n : null;
    },
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const rules = listRulesForApi(db, 'all');
  res.json(rules);
});

router.get('/export', (req, res) => {
  try {
    const db = getDb();
    const scope = normalizeScope(req.query?.scope);
    const format = String(req.query?.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
    const rules = listRulesForApi(db, scope);
    const categories = db.prepare(`
      SELECT id, name, color, is_income
      FROM categories
      ORDER BY name ASC
    `).all();
    const filename = buildRulesFilename(scope, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(rulesToCsv(rules));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify({
      version: 1,
      exported_at: new Date().toISOString(),
      scope,
      rules: rules.map((rule) => ({
        id: rule.id,
        source: rule.source || 'manual',
        name: rule.name || null,
        keyword: rule.keyword || '',
        match_type: rule.match_type || 'contains_case_insensitive',
        category_id: rule.category_id ?? null,
        category_name: rule.category_name || null,
        priority: rule.priority ?? 10,
        is_enabled: !!rule.is_enabled,
        stop_processing: !!rule.stop_processing,
        confidence: rule.confidence ?? null,
        conditions: rule.conditions || {},
        actions: rule.actions || {},
        behavior: rule.behavior || {
          priority: rule.priority ?? 10,
          is_enabled: !!rule.is_enabled,
          stop_processing: !!rule.stop_processing,
          source: rule.source || 'manual',
          confidence: rule.confidence ?? null,
        },
      })),
      categories,
    }, null, 2));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to export rules' });
  }
});

router.post('/snapshot', async (req, res) => {
  try {
    const db = getDb();
    const backupsDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `finance-backup-${stamp}.db`;
    const fullPath = path.join(backupsDir, fileName);
    await db.backup(fullPath);
    res.json({
      ok: true,
      file_name: fileName,
      file_path: fullPath,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create DB snapshot' });
  }
});

router.post('/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const db = getDb();
    const scope = normalizeScope(req.body?.scope);
    const mode = normalizeImportMode(req.body?.mode);
    const explicitFormat = req.body?.format ? String(req.body.format).toLowerCase() : null;
    const inferredFormat = inferFormatFromFilename(req.file.originalname || '');
    const format = explicitFormat === 'csv' || explicitFormat === 'json'
      ? explicitFormat
      : (inferredFormat || 'json');
    const fileText = req.file.buffer.toString('utf8');
    const importedRows = parseImportedRules({ format, fileText });
    if (!Array.isArray(importedRows) || importedRows.length === 0) {
      return res.status(400).json({ error: 'No rules found in uploaded file' });
    }

    const insert = db.prepare(`
      INSERT INTO rules (
        name, keyword, match_type, category_id, priority,
        is_enabled, stop_processing, source, confidence,
        conditions_json, actions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteScoped = scope === 'all'
      ? db.prepare(`DELETE FROM rules`)
      : db.prepare(`DELETE FROM rules WHERE LOWER(COALESCE(source, 'manual')) = 'learned'`);

    const scopedExistingRows = scope === 'all'
      ? getRules()
      : getRules().filter((r) => String(r.source || 'manual').toLowerCase() === 'learned');
    const signatures = mode === 'replace'
      ? new Set()
      : new Set(compileRules(scopedExistingRows, { includeLegacyTagRules: false }).map(buildRuleSignature));

    const resolver = buildCategoryResolver(db);
    const stats = {
      parsed_count: importedRows.length,
      created_rules: 0,
      skipped_invalid: 0,
      skipped_duplicates: 0,
      removed_rules: 0,
      scope,
      mode,
      created_categories: [],
      errors: [],
    };

    const run = db.transaction(() => {
      const inserts = [];
      for (let i = 0; i < importedRows.length; i += 1) {
        const raw = importedRows[i] || {};
        try {
          const conditions = parseJsonObjectSafe(raw.conditions ?? raw.conditions_json, {});
          const actions = parseJsonObjectSafe(raw.actions ?? raw.actions_json, {});

          const categoryNameCandidate = String(
            raw.category_name
            ?? actions.set_category_name
            ?? (!Number.isFinite(Number(raw.category_id)) ? (raw.category_id ?? '') : '')
            ?? ''
          ).trim();
          const categoryIdCandidate = toNumberOrUndefined(raw.category_id);
          const actionCategoryIdCandidate = toNumberOrUndefined(actions.set_category_id);
          const resolvedCategoryId = resolver.resolve(
            categoryIdCandidate ?? actionCategoryIdCandidate,
            categoryNameCandidate || null
          );

          if (resolvedCategoryId !== null) {
            actions.set_category_id = resolvedCategoryId;
          } else if (actions.set_category_id !== undefined) {
            delete actions.set_category_id;
          }

          const payload = {
            name: raw.name ?? null,
            keyword: raw.keyword ?? '',
            match_type: raw.match_type ?? 'contains_case_insensitive',
            category_id: resolvedCategoryId,
            priority: raw.priority,
            is_enabled: raw.is_enabled !== undefined ? asBool(raw.is_enabled, true) : undefined,
            stop_processing: raw.stop_processing !== undefined ? asBool(raw.stop_processing, false) : undefined,
            source: raw.source,
            confidence: raw.confidence,
            conditions,
            actions,
            behavior: {
              priority: raw.priority,
              is_enabled: raw.is_enabled !== undefined ? asBool(raw.is_enabled, true) : undefined,
              stop_processing: raw.stop_processing !== undefined ? asBool(raw.stop_processing, false) : undefined,
              source: raw.source,
              confidence: raw.confidence,
            },
          };

          const normalized = normalizeRulePayload(payload);
          normalized.source = scope === 'learned'
            ? 'learned'
            : normalizeSource(raw.source, normalized.source || 'manual');
          enforceIncomeSignGuard(db, normalized);

          const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
          if (!compiled?.conditions?.has_any || !hasMeaningfulActions(compiled.actions)) {
            stats.skipped_invalid += 1;
            stats.errors.push({ index: i, error: 'Rule must include meaningful conditions and actions.' });
            continue;
          }

          const signature = buildRuleSignature(compiled);
          if (signatures.has(signature)) {
            stats.skipped_duplicates += 1;
            continue;
          }

          inserts.push(normalized);
          signatures.add(signature);
        } catch (err) {
          stats.skipped_invalid += 1;
          stats.errors.push({ index: i, error: err.message || 'Failed to parse row' });
        }
      }

      if (mode === 'replace' && inserts.length === 0) {
        throw new Error('Import contains no valid rules; refusing to replace existing rules.');
      }

      if (mode === 'replace') {
        const info = deleteScoped.run();
        stats.removed_rules = info.changes || 0;
      }

      for (const normalized of inserts) {
        insert.run(
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
        stats.created_rules += 1;
      }

      stats.created_categories = resolver.created;
    });

    run();

    return res.json(stats);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to import rules' });
  }
});

router.get('/lint', (req, res) => {
  try {
    const db = getDb();
    const scope = normalizeLintScope(req.query?.scope);
    const persist = req.query?.persist !== undefined ? asBool(req.query.persist, true) : true;
    const report = buildLintReport(db, scope);
    if (persist) persistLintReport(db, scope, report.summary, report.findings);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to compute lint report' });
  }
});

router.get('/lint/reports', (req, res) => {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 20));
  const rows = db.prepare(`
    SELECT id, created_at, scope, summary_json, findings_json
    FROM rule_lint_reports
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  res.json(rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    scope: r.scope,
    summary: parseJsonObjectSafe(r.summary_json, {}),
    findings: parseJsonObjectSafe(r.findings_json, {}),
  })));
});

router.post('/explain', (req, res) => {
  try {
    const db = getDb();
    const includeLegacyTagRules = req.body?.include_legacy_tag_rules !== undefined
      ? asBool(req.body.include_legacy_tag_rules, true)
      : true;
    const rows = getTransactionsForExplain(db, req.body || {});
    if (!rows.length) return res.status(404).json({ error: 'No matching transactions found' });

    const compiled = compileRules(getRules(), { includeLegacyTagRules });
    const explained = rows.map((row) => {
      const evaluated = evaluateTransactionWithRules({
        ...row,
        tags: parseTags(row.tags),
      }, compiled, {
        overwrite_category: true,
        overwrite_tags: true,
        overwrite_merchant: true,
        overwrite_flags: true,
      });
      return {
        transaction: {
          id: row.id,
          date: row.date,
          description: row.description,
          amount: row.amount,
          category_id: row.category_id ?? null,
          merchant_name: row.merchant_name || null,
          tags: parseTags(row.tags),
          is_income_override: row.is_income_override ? 1 : 0,
          exclude_from_totals: row.exclude_from_totals ? 1 : 0,
        },
        outcome: {
          category_id: evaluated.category_id ?? null,
          merchant_name: evaluated.merchant_name || null,
          tags: evaluated.tags || [],
          is_income_override: evaluated.is_income_override ? 1 : 0,
          exclude_from_totals: evaluated.exclude_from_totals ? 1 : 0,
          winning_category_rule: evaluated.winning_category_rule || null,
          blocked_rules: evaluated.blocked_rules || [],
          matched_rules: evaluated.matched_rules || [],
          matched_rule_ids: evaluated.matched_rule_ids || [],
        },
      };
    });

    res.json({
      count: explained.length,
      include_legacy_tag_rules: includeLegacyTagRules,
      explanations: explained,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to explain transactions' });
  }
});

router.post('/learn/reset', (req, res) => {
  try {
    const db = getDb();
    const reason = String(req.body?.reason || 'learned_reset').trim() || 'learned_reset';
    const runManualDedupe = req.body?.manual_dedupe !== undefined ? asBool(req.body.manual_dedupe, true) : true;
    const archived = archiveAndDisableLearnedRules(db, reason);
    const dedupe = runManualDedupe ? dedupeManualRules(db) : { duplicate_groups: 0, disabled_duplicates: 0, duplicate_rule_ids: [] };
    const incomeGuardBackfill = backfillIncomeSignGuards(db);
    db.prepare(`UPDATE categories SET is_income = 0 WHERE UPPER(name) = 'INCOME TAXES'`).run();
    res.json({
      ok: true,
      archive: archived,
      manual_dedupe: dedupe,
      income_sign_guard_backfill: incomeGuardBackfill,
      income_taxes_is_income: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reset learned rules' });
  }
});

router.post('/learn/rebuild', (req, res) => {
  try {
    const db = getDb();
    const incomeGuardBackfill = backfillIncomeSignGuards(db);
    const apply = asBool(req.body?.apply, false);
    const resetLearned = req.body?.reset_learned !== undefined ? asBool(req.body.reset_learned, false) : false;
    const includeReviewedTrusted = req.body?.include_reviewed_trusted !== undefined
      ? asBool(req.body.include_reviewed_trusted, true)
      : true;
    const maxSuggestions = Math.min(300, Math.max(10, Number(req.body?.max_suggestions) || 120));
    const minSupport = Math.max(2, Number(req.body?.min_support) || 5);
    const minPurity = Math.min(0.999, Math.max(0.9, Number(req.body?.min_purity) || 0.97));
    const maxConflictRate = Math.min(0.2, Math.max(0, Number(req.body?.max_conflict_rate) || 0.03));
    const maxMatchRatio = Math.min(0.4, Math.max(0.01, Number(req.body?.max_match_ratio) || 0.08));
    const ccPaymentCategory = db.prepare(`SELECT id FROM categories WHERE LOWER(name) = 'cc payment' LIMIT 1`).get();
    const excludedIds = Array.isArray(req.body?.exclude_category_ids)
      ? req.body.exclude_category_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : (ccPaymentCategory ? [Number(ccPaymentCategory.id)] : []);

    let resetSummary = null;
    if (resetLearned) {
      const archived = archiveAndDisableLearnedRules(db, 'rebuild_reset');
      const dedupe = dedupeManualRules(db);
      resetSummary = { archive: archived, manual_dedupe: dedupe };
    }

    const rebuild = buildRebuildSuggestions(db, {
      max_suggestions: maxSuggestions,
      min_support: minSupport,
      min_purity: minPurity,
      max_conflict_rate: maxConflictRate,
      max_match_ratio: maxMatchRatio,
      exclude_category_ids: excludedIds,
      include_reviewed_trusted: includeReviewedTrusted,
    });
    let applySummary = { created: 0, skipped: 0 };
    if (apply) {
      applySummary = applyLearnedSuggestionSet(db, rebuild.suggestions);
    }

    const config = {
      apply,
      reset_learned: resetLearned,
      max_suggestions: maxSuggestions,
      min_support: minSupport,
      min_purity: minPurity,
      max_conflict_rate: maxConflictRate,
      max_match_ratio: maxMatchRatio,
      exclude_category_ids: excludedIds,
      include_reviewed_trusted: includeReviewedTrusted,
    };
    const runId = insertRebuildRun(db, {
      config,
      suggestions: rebuild.suggestions,
      appliedCount: applySummary.created,
      status: apply ? 'applied' : 'preview',
    });

    res.json({
      run_id: runId,
      mode: apply ? 'applied' : 'preview',
      income_sign_guard_backfill: incomeGuardBackfill,
      reset_summary: resetSummary,
      trusted_rows: rebuild.trusted_rows,
      trusted_rows_manual: rebuild.trusted_rows_manual,
      trusted_rows_reviewed: rebuild.trusted_rows_reviewed,
      candidate_groups: rebuild.candidate_groups,
      suggestions_count: rebuild.suggestions.length,
      suggestions: rebuild.suggestions,
      apply_summary: applySummary,
      config,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to rebuild learned rules' });
  }
});

router.get('/learn/rebuild/runs', (req, res) => {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 20));
  const rows = db.prepare(`
    SELECT id, created_at, config_json, suggestions_json, applied_count, status
    FROM rule_rebuild_runs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  res.json(rows.map((r) => {
    const suggestions = parseJsonObjectSafe(r.suggestions_json, []);
    return {
      id: r.id,
      created_at: r.created_at,
      config: parseJsonObjectSafe(r.config_json, {}),
      suggestions_count: Array.isArray(suggestions) ? suggestions.length : 0,
      suggestions: Array.isArray(suggestions) ? suggestions : [],
      applied_count: Number(r.applied_count) || 0,
      status: r.status || 'preview',
    };
  }));
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
  try {
    enforceIncomeSignGuard(db, normalized);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
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
  try {
    enforceIncomeSignGuard(db, normalized);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
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
    exclude_category_ids: Array.isArray(req.body?.exclude_category_ids)
      ? req.body.exclude_category_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [],
    skip_transfers: req.body?.skip_transfers !== undefined ? asBool(req.body.skip_transfers) : false,
    skip_excluded_from_totals: req.body?.skip_excluded_from_totals !== undefined
      ? asBool(req.body.skip_excluded_from_totals)
      : false,
    dry_run: req.body?.dry_run !== undefined ? asBool(req.body.dry_run) : false,
    sample_limit: req.body?.sample_limit !== undefined ? Number(req.body.sample_limit) : 40,
    allow_negative_income_category: req.body?.allow_negative_income_category !== undefined
      ? asBool(req.body.allow_negative_income_category)
      : false,
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
  const minSupport = Math.max(2, parseInt(req.body?.min_count, 10) || parseInt(req.body?.min_support, 10) || 5);
  const maxSuggestions = Math.min(300, Math.max(10, parseInt(req.body?.max_suggestions, 10) || parseInt(req.body?.max_new_rules, 10) || 120));
  const includeReviewedTrusted = req.body?.include_reviewed_trusted !== undefined
    ? asBool(req.body.include_reviewed_trusted, true)
    : true;
  const ccPayment = db.prepare(`SELECT id FROM categories WHERE LOWER(name) = 'cc payment' LIMIT 1`).get();
  const rebuild = buildRebuildSuggestions(db, {
    max_suggestions: maxSuggestions,
    min_support: minSupport,
    min_purity: 0.97,
    max_conflict_rate: 0.03,
    max_match_ratio: 0.08,
    exclude_category_ids: ccPayment ? [Number(ccPayment.id)] : [],
    include_reviewed_trusted: includeReviewedTrusted,
  });

  res.json({
    mode: 'suggestions',
    analyzed: rebuild.trusted_rows,
    analyzed_manual: rebuild.trusted_rows_manual,
    analyzed_reviewed: rebuild.trusted_rows_reviewed,
    created: 0,
    skipped: 0,
    min_count: minSupport,
    candidate_groups: rebuild.candidate_groups,
    suggestions_count: rebuild.suggestions.length,
    suggestions: rebuild.suggestions,
  });
});

// POST /api/rules/learn/apply — persist selected suggestions
router.post('/learn/apply', (req, res) => {
  const db = getDb();
  const incoming = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
  if (!incoming.length) return res.status(400).json({ error: 'No suggestions provided' });

  const incomeIds = getIncomeCategoryIds(db);
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
      normalized.priority = Math.min(4, normalizePriority(raw?.behavior?.priority ?? raw?.priority, 4));
      normalized.is_enabled = asBool(raw?.behavior?.is_enabled ?? raw?.is_enabled, true) ? 1 : 0;
      normalized.stop_processing = asBool(raw?.behavior?.stop_processing ?? raw?.stop_processing, false) ? 1 : 0;
      try {
        enforceIncomeSignGuard(db, normalized);
      } catch {
        skipped += 1;
        continue;
      }

      const compiled = compileRules([toRuleRowForCompile(normalized)], { includeLegacyTagRules: false })[0];
      if (!compiled?.conditions?.has_any || !hasMeaningfulActions(compiled.actions) || !hasLearnedScopeConstraint(compiled)) {
        skipped += 1;
        continue;
      }
      if (broadTokenViolation(compiled)) {
        skipped += 1;
        continue;
      }
      if (incomeIds.has(Number(compiled.actions?.set_category_id)) && String(compiled.conditions?.amount_sign || 'any') !== 'income') {
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
        4,
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

// POST /api/rules/learn/revert — preview/apply uncategorization for learned-rule matches
router.post('/learn/revert', (req, res) => {
  const db = getDb();
  const apply = asBool(req.body?.apply, false);
  const disableLearnedRules = asBool(req.body?.disable_learned_rules, false);
  const sampleLimit = Math.min(200, Math.max(5, Number(req.body?.sample_limit) || 50));
  const createdFrom = String(req.body?.created_from || '').trim() || null;
  const createdTo = String(req.body?.created_to || '').trim() || null;
  const onlyUnreviewed = req.body?.only_unreviewed !== undefined
    ? asBool(req.body.only_unreviewed, true)
    : true;

  const scan = scanTransactionsMatchedByLearnedCategoryRules(db, {
    sample_limit: sampleLimit,
    created_from: createdFrom,
    created_to: createdTo,
    only_unreviewed: onlyUnreviewed,
  });
  if (!apply) {
    return res.json({
      mode: 'preview',
      ...scan,
      filters: {
        created_from: createdFrom,
        created_to: createdTo,
        only_unreviewed: onlyUnreviewed,
      },
    });
  }

  let uncategorized = 0;
  const updateOne = db.prepare(`UPDATE transactions SET category_id = NULL WHERE id = ?`);
  const disableLearned = db.prepare(`UPDATE rules SET is_enabled = 0 WHERE LOWER(COALESCE(source, 'manual')) = 'learned'`);
  let disabledRules = 0;

  db.transaction(() => {
    for (const txId of scan.transaction_ids) {
      const info = updateOne.run(txId);
      uncategorized += info.changes || 0;
    }
    if (disableLearnedRules) {
      const info = disableLearned.run();
      disabledRules = info.changes || 0;
    }
  })();

  res.json({
    mode: 'applied',
    scanned: scan.scanned,
    matched: scan.match_count,
    uncategorized,
    disabled_learned_rules: disabledRules,
    filters: {
      created_from: createdFrom,
      created_to: createdTo,
      only_unreviewed: onlyUnreviewed,
    },
  });
});

module.exports = router;
