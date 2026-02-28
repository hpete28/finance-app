// src/pages/Settings.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Pencil, Check, X, Zap, RefreshCw, Eye, AlertTriangle, Sparkles, CheckSquare, Square,
} from 'lucide-react';
import { categoriesApi, rulesApi, rulesetsApi, tagRulesApi, aiApi } from '../utils/api';
import { Card, Modal, SectionHeader, Badge, EmptyState, Spinner } from '../components/ui';
import useAppStore from '../stores/appStore';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#64748b', '#a3e635', '#fb923c'];
const MATCH_OPTIONS = [
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'equals', label: 'Exact equals' },
  { value: 'regex', label: 'Regex (advanced)' },
];
const BOOL_MODES = [
  { value: 'ignore', label: 'Do not change' },
  { value: 'true', label: 'Set to true' },
  { value: 'false', label: 'Set to false' },
];

const emptyRuleForm = {
  id: null,
  name: '',
  description_operator: 'contains',
  description_match_semantics: 'token_default',
  description_value: '',
  description_case_sensitive: false,
  merchant_enabled: false,
  merchant_operator: 'contains',
  merchant_match_semantics: 'token_default',
  merchant_value: '',
  merchant_case_sensitive: false,
  amount_mode: 'any',
  amount_exact: '',
  amount_min: '',
  amount_max: '',
  amount_sign: 'any',
  account_ids: [],
  date_from: '',
  date_to: '',
  action_category_id: '',
  action_tags_mode: 'append',
  action_tags_values: '',
  action_set_merchant_name: '',
  action_income_override: 'ignore',
  action_exclude_totals: 'ignore',
  priority: 10,
  is_enabled: true,
  stop_processing: false,
  source: 'manual',
  confidence: '',
};

function parseTagsInput(raw) {
  return [...new Set(String(raw || '').split(',').map((t) => t.trim()).filter(Boolean))];
}

function boolModeToValue(mode) {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return undefined;
}

function buildRulePayload(form, forceSave = false) {
  const conditions = {};
  if (form.description_value.trim()) {
    conditions.description = {
      operator: form.description_operator,
      value: form.description_value.trim(),
      case_sensitive: !!form.description_case_sensitive,
      match_semantics: form.description_operator === 'contains'
        ? (form.description_match_semantics || 'token_default')
        : undefined,
    };
  }
  if (form.merchant_enabled && form.merchant_value.trim()) {
    conditions.merchant = {
      operator: form.merchant_operator,
      value: form.merchant_value.trim(),
      case_sensitive: !!form.merchant_case_sensitive,
      match_semantics: form.merchant_operator === 'contains'
        ? (form.merchant_match_semantics || 'token_default')
        : undefined,
    };
  }
  if (form.amount_mode === 'exact' && form.amount_exact !== '') conditions.amount = { exact: Number(form.amount_exact) };
  if (form.amount_mode === 'range') {
    const amount = {};
    if (form.amount_min !== '') amount.min = Number(form.amount_min);
    if (form.amount_max !== '') amount.max = Number(form.amount_max);
    if (Object.keys(amount).length) conditions.amount = amount;
  }
  if (form.amount_sign !== 'any') conditions.amount_sign = form.amount_sign;
  if (form.account_ids.length) conditions.account_ids = form.account_ids.map((v) => Number(v));
  if (form.date_from || form.date_to) conditions.date_range = { from: form.date_from || null, to: form.date_to || null };

  const actions = {};
  if (form.action_category_id) actions.set_category_id = Number(form.action_category_id);
  const tagValues = parseTagsInput(form.action_tags_values);
  if (tagValues.length) actions.tags = { mode: form.action_tags_mode, values: tagValues };
  if (form.action_set_merchant_name.trim()) actions.set_merchant_name = form.action_set_merchant_name.trim();
  const incomeOverride = boolModeToValue(form.action_income_override);
  if (incomeOverride !== undefined) actions.set_is_income_override = incomeOverride;
  const excludeTotals = boolModeToValue(form.action_exclude_totals);
  if (excludeTotals !== undefined) actions.set_exclude_from_totals = excludeTotals;

  return {
    name: form.name.trim() || null,
    keyword: form.description_value.trim() || form.merchant_value.trim() || '',
    match_type: 'contains_case_insensitive',
    category_id: actions.set_category_id ?? null,
    conditions,
    actions,
    behavior: {
      priority: Number(form.priority) || 10,
      is_enabled: !!form.is_enabled,
      stop_processing: !!form.stop_processing,
      source: form.source || 'manual',
      confidence: form.confidence === '' ? null : Number(form.confidence),
    },
    priority: Number(form.priority) || 10,
    is_enabled: !!form.is_enabled,
    stop_processing: !!form.stop_processing,
    source: form.source || 'manual',
    confidence: form.confidence === '' ? null : Number(form.confidence),
    match_semantics: conditions.description?.match_semantics || conditions.merchant?.match_semantics || 'token_default',
    force_save: !!forceSave,
  };
}

function ruleToForm(rule) {
  const c = rule.conditions || {};
  const a = rule.actions || {};
  const d = c.description || {};
  const m = c.merchant || {};
  const amt = c.amount || {};
  let amountMode = 'any';
  if (amt.exact !== undefined && amt.exact !== null) amountMode = 'exact';
  else if (amt.min !== undefined || amt.max !== undefined) amountMode = 'range';

  return {
    ...emptyRuleForm,
    id: rule.id,
    name: rule.name || '',
    description_operator: d.operator || 'contains',
    description_match_semantics: d.match_semantics || 'token_default',
    description_value: d.value || rule.keyword || '',
    description_case_sensitive: !!d.case_sensitive,
    merchant_enabled: !!m.value,
    merchant_operator: m.operator || 'contains',
    merchant_match_semantics: m.match_semantics || 'token_default',
    merchant_value: m.value || '',
    merchant_case_sensitive: !!m.case_sensitive,
    amount_mode: amountMode,
    amount_exact: amt.exact ?? '',
    amount_min: amt.min ?? '',
    amount_max: amt.max ?? '',
    amount_sign: c.amount_sign || 'any',
    account_ids: Array.isArray(c.account_ids) ? c.account_ids.map((v) => Number(v)) : [],
    date_from: c?.date_range?.from || '',
    date_to: c?.date_range?.to || '',
    action_category_id: a.set_category_id ?? rule.category_id ?? '',
    action_tags_mode: a?.tags?.mode || 'append',
    action_tags_values: (a?.tags?.values || []).join(', '),
    action_set_merchant_name: a.set_merchant_name || '',
    action_income_override:
      a.set_is_income_override === true || a.set_is_income_override === 1 ? 'true' :
      (a.set_is_income_override === false || a.set_is_income_override === 0 ? 'false' : 'ignore'),
    action_exclude_totals:
      a.set_exclude_from_totals === true || a.set_exclude_from_totals === 1 ? 'true' :
      (a.set_exclude_from_totals === false || a.set_exclude_from_totals === 0 ? 'false' : 'ignore'),
    priority: rule.priority ?? 10,
    is_enabled: !!rule.is_enabled,
    stop_processing: !!rule.stop_processing,
    source: rule.source || 'manual',
    confidence: rule.confidence ?? '',
  };
}

function summarizeRule(rule, categoriesById = {}) {
  const parts = [];
  const c = { ...(rule.conditions || {}) };
  const a = { ...(rule.actions || {}) };
  // Legacy fallback so old rules still show meaningful list summaries.
  if ((!c.description || !c.description.value) && rule.keyword) {
    c.description = {
      operator:
        rule.match_type === 'exact' ? 'equals' :
        rule.match_type === 'starts_with' ? 'starts_with' :
        rule.match_type === 'regex' ? 'regex' : 'contains',
      value: rule.keyword,
      case_sensitive: false,
    };
  }
  if (a.set_category_id === undefined && rule.category_id) {
    a.set_category_id = rule.category_id;
  }
  if (c.description?.value) parts.push(`desc ${c.description.operator} "${c.description.value}"`);
  if (c.merchant?.value) parts.push(`merchant ${c.merchant.operator} "${c.merchant.value}"`);
  if (c.amount?.exact !== undefined) parts.push(`amt = ${c.amount.exact}`);
  if (c.amount?.min !== undefined || c.amount?.max !== undefined) parts.push(`amt ${c.amount.min ?? '-inf'}..${c.amount.max ?? '+inf'}`);
  if (c.amount_sign && c.amount_sign !== 'any') parts.push(c.amount_sign);
  if (c.account_ids?.length) parts.push(`${c.account_ids.length} account filter`);
  if (c.date_range?.from || c.date_range?.to) parts.push(`date ${c.date_range.from || '*'} to ${c.date_range.to || '*'}`);

  const actionParts = [];
  if (a.set_category_id) actionParts.push(`category: ${categoriesById[a.set_category_id] || a.set_category_id}`);
  if (a.tags?.values?.length) actionParts.push(`${a.tags.mode} tags: ${a.tags.values.join(', ')}`);
  if (a.set_merchant_name) actionParts.push(`merchant -> ${a.set_merchant_name}`);
  if (a.set_is_income_override !== undefined) actionParts.push(`income override -> ${a.set_is_income_override ? 'true' : 'false'}`);
  if (a.set_exclude_from_totals !== undefined) actionParts.push(`exclude totals -> ${a.set_exclude_from_totals ? 'true' : 'false'}`);

  return {
    conditions: parts.length ? parts.join(' · ') : 'No conditions',
    actions: actionParts.length ? actionParts.join(' · ') : 'No actions',
  };
}

function getRuleDisplayName(rule) {
  const explicit = String(rule?.name || '').trim();
  if (explicit && !/^rule\s*#?\s*\d+$/i.test(explicit)) return explicit;
  const keyword = String(rule?.keyword || '').trim();
  if (keyword) return keyword;
  const descriptionValue = String(rule?.conditions?.description?.value || '').trim();
  if (descriptionValue) return descriptionValue;
  const merchantValue = String(rule?.conditions?.merchant?.value || '').trim();
  if (merchantValue) return merchantValue;
  return `Rule #${rule?.id ?? '?'}`;
}

function parseFilenameFromDisposition(disposition) {
  const raw = String(disposition || '');
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(utf8Match[1]); } catch { return utf8Match[1]; }
  }
  const quotedMatch = raw.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const basicMatch = raw.match(/filename=([^;]+)/i);
  if (basicMatch?.[1]) return basicMatch[1].trim();
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function inferRuleFileFormat(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.json')) return 'json';
  return undefined;
}

function CategoriesTab() {
  const { showToast } = useAppStore();
  const [cats, setCats] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', color: '#6366f1', parent_id: '', is_income: false });
  const [editForm, setEditForm] = useState({});
  const [learning, setLearning] = useState(false);
  const [revertingLearned, setRevertingLearned] = useState(false);
  const [learnResult, setLearnResult] = useState(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [previewingSuggestionIdx, setPreviewingSuggestionIdx] = useState(null);
  const [suggestionPreview, setSuggestionPreview] = useState(null);
  const [showSuggestionPreview, setShowSuggestionPreview] = useState(false);

  const load = () => categoriesApi.list().then((r) => setCats(r.data));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    await categoriesApi.create({ name: form.name, color: form.color, parent_id: form.parent_id || null, is_income: form.is_income });
    setShowAdd(false);
    setForm({ name: '', color: '#6366f1', parent_id: '', is_income: false });
    load();
    showToast('Category created');
  };

  const startEdit = (cat) => {
    setEditId(cat.id);
    setEditForm({ name: cat.name, color: cat.color, is_income: !!cat.is_income });
  };

  const saveEdit = async (id) => {
    await categoriesApi.update(id, editForm);
    setEditId(null);
    load();
    showToast('Category updated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this category? Transactions will become uncategorized.')) return;
    await categoriesApi.delete(id);
    load();
    showToast('Category deleted');
  };

  const handleLearn = async () => {
    setLearning(true);
    setLearnResult(null);
    try {
      const res = await rulesApi.learn({ min_count: 3, max_suggestions: 60 });
      const data = res.data;
      setLearnResult(data);
      const initial = new Set((data.suggestions || []).map((_, i) => i));
      setSelectedSuggestions(initial);
      showToast(`Generated ${data.suggestions_count || 0} suggestions`);
    } catch {
      showToast('Learning failed', 'error');
    } finally {
      setLearning(false);
    }
  };

  const applySuggestions = async () => {
    if (!learnResult?.suggestions?.length) return;
    const picked = learnResult.suggestions.filter((_, idx) => selectedSuggestions.has(idx));
    if (!picked.length) return;
    setApplyingSuggestions(true);
    try {
      const res = await rulesApi.applyLearned(picked, picked.length);
      showToast(`Applied ${res.data.created} learned rules`);
      setLearnResult(null);
    } catch {
      showToast('Failed to apply learned suggestions', 'error');
    } finally {
      setApplyingSuggestions(false);
    }
  };

  const handleRevertLearned = async () => {
    setRevertingLearned(true);
    try {
      const createdFromInput = window.prompt('Optional start created_at (YYYY-MM-DD HH:MM:SS). Leave blank for no lower bound.', '');
      if (createdFromInput === null) return;
      const createdToInput = window.prompt('Optional end created_at (YYYY-MM-DD HH:MM:SS). Leave blank for no upper bound.', '');
      if (createdToInput === null) return;
      const created_from = String(createdFromInput || '').trim() || undefined;
      const created_to = String(createdToInput || '').trim() || undefined;

      const previewRes = await rulesApi.revertLearned({
        apply: false,
        sample_limit: 20,
        created_from,
        created_to,
        only_unreviewed: true,
      });
      const preview = previewRes.data || {};
      const count = Number(preview.match_count || 0);
      if (!count) {
        showToast('No learned-rule matches found to uncategorize');
        return;
      }

      const topWindows = Array.isArray(preview.created_at_histogram)
        ? preview.created_at_histogram.slice(0, 5).map((h) => `${h.minute}: ${h.count}`).join('\n')
        : '';
      const confirmText = `Found ${count} unreviewed transactions currently matching learned category rules.${created_from || created_to ? '\n(Filter applied)' : ''}\n\nTop created_at windows:\n${topWindows || 'n/a'}\n\nUncategorize these now?\n\nTip: choose OK to proceed, Cancel to keep as-is.`;
      if (!window.confirm(confirmText)) return;

      const disableLearned = window.confirm('Also disable all learned rules to prevent re-categorizing them again?');
      const applyRes = await rulesApi.revertLearned({
        apply: true,
        disable_learned_rules: disableLearned,
        created_from,
        created_to,
        only_unreviewed: true,
      });
      const data = applyRes.data || {};
      showToast(
        disableLearned
          ? `Uncategorized ${data.uncategorized || 0} transactions and disabled ${data.disabled_learned_rules || 0} learned rules`
          : `Uncategorized ${data.uncategorized || 0} transactions matched by learned rules`
      );
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to revert learned categorization', 'error');
    } finally {
      setRevertingLearned(false);
    }
  };

  const toggleSuggestion = (index) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handlePreviewSuggestion = async (suggestion, idx) => {
    setPreviewingSuggestionIdx(idx);
    try {
      const res = await rulesApi.preview(suggestion, 50);
      setSuggestionPreview({
        name: suggestion.name || 'Suggested rule',
        ...res.data,
      });
      setShowSuggestionPreview(true);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to preview suggestion', 'error');
    } finally {
      setPreviewingSuggestionIdx(null);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Categories"
        subtitle={`${cats.length} categories`}
        actions={(
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handleLearn} disabled={learning}>
              {learning ? <Spinner size={12} /> : <Sparkles size={12} />}
              {learning ? 'Learning…' : 'Auto-learn suggestions'}
            </button>
            <button className="btn-secondary text-xs" onClick={handleRevertLearned} disabled={revertingLearned}>
              {revertingLearned ? 'Reverting…' : 'Revert learned categories'}
            </button>
            <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add Category
            </button>
          </div>
        )}
      />

      {learnResult && (
        <div className="mt-3 mb-5 p-3 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <p className="text-sm font-semibold text-emerald-300">Auto-learn suggestions</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {learnResult.suggestions_count || 0} candidate rules from {learnResult.analyzed} categorized transactions.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Suggestions are generated from repeated categorized patterns. Nothing is written until you click Apply selected.
          </p>
          {learnResult?.thresholds && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Policy {learnResult.policy || 'default'} · support ≥ {learnResult.thresholds.min_support} · confidence ≥ {Math.round((learnResult.thresholds.min_confidence || 0) * 100)}% · max match ratio {(Number(learnResult.thresholds.max_match_ratio || 0) * 100).toFixed(1)}%
            </p>
          )}
          {learnResult?.dropped_reason_counts && Object.keys(learnResult.dropped_reason_counts).length > 0 && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Filtered out: {Object.entries(learnResult.dropped_reason_counts).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </p>
          )}
          <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
            {(learnResult.suggestions || []).map((s, idx) => {
              const targetCategoryId = Number(s.actions?.set_category_id ?? s.category_id);
              const targetCategoryName = categoriesById[targetCategoryId] || s.category_name || null;
              const descPattern = s.conditions?.description?.value || s.pattern || s.keyword || '';
              const amountSign = s.conditions?.amount_sign || 'any';
              const accountIds = Array.isArray(s.conditions?.account_ids) ? s.conditions.account_ids : [];
              const supportCount = Number(s.stats?.support_count || 0);
              const estimatedMatchCount = Number(s.stats?.estimated_match_count || 0);
              const estimatedMatchRatio = Number(s.stats?.estimated_match_ratio || 0);
              return (
                <label key={idx} className="flex gap-3 p-2 rounded-lg cursor-pointer" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <input type="checkbox" checked={selectedSuggestions.has(idx)} onChange={() => toggleSuggestion(idx)} />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-200">{s.name || (targetCategoryName ? `${targetCategoryName} · learned rule` : 'Learned rule')} <span className="text-emerald-400">({Math.round((s.confidence || 0) * 100)}%)</span></p>
                    {!!descPattern && (
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Pattern: {descPattern}
                      </p>
                    )}
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Will apply:
                      {' '}
                      {targetCategoryName ? `Category ${targetCategoryName}` : 'No category action'}
                      {s.actions?.tags?.values?.length ? ` · ${s.actions.tags.mode} tags: ${s.actions.tags.values.join(', ')}` : ''}
                      {s.actions?.set_merchant_name ? ` · Merchant ${s.actions.set_merchant_name}` : ''}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Constraints:
                      {' '}
                      {amountSign === 'any' ? 'any sign' : amountSign}
                      {accountIds.length ? ` · account ${accountIds.join(', ')}` : ''}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Seen in {supportCount} categorized tx
                      {estimatedMatchCount > 0 ? ` · estimated matches ${estimatedMatchCount} (${(estimatedMatchRatio * 100).toFixed(2)}%)` : ''}
                    </p>
                    {(s.rationale || []).length > 0 && (
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{(s.rationale || []).join(' · ')}</p>
                    )}
                    <button
                      className="btn-ghost text-[11px] mt-1 px-2 py-1"
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePreviewSuggestion(s, idx); }}
                      disabled={previewingSuggestionIdx === idx}
                    >
                      {previewingSuggestionIdx === idx ? 'Loading…' : 'View matches'}
                    </button>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button className="btn-secondary text-xs" onClick={() => setLearnResult(null)}>Dismiss</button>
            <button className="btn-primary text-xs" disabled={applyingSuggestions || !selectedSuggestions.size} onClick={applySuggestions}>
              {applyingSuggestions ? 'Applying…' : `Apply selected (${selectedSuggestions.size})`}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {cats.map((c) => (
          <div key={c.id} className={`rounded-xl overflow-hidden ${c.parent_id ? 'ml-8' : ''}`} style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            {editId === c.id ? (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2">{COLORS.map((col) => <button key={col} onClick={() => setEditForm((f) => ({ ...f, color: col }))} className="w-5 h-5 rounded-full" style={{ background: col, outline: editForm.color === col ? '2px solid white' : 'none' }} />)}</div>
                <input className="input flex-1 py-1.5 text-sm" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && saveEdit(c.id)} autoFocus />
                <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={editForm.is_income} onChange={(e) => setEditForm((f) => ({ ...f, is_income: e.target.checked }))} />Income</label>
                <button className="btn-primary text-xs py-1 px-3" onClick={() => saveEdit(c.id)}><Check size={12} /></button>
                <button className="btn-ghost text-xs py-1 px-2" onClick={() => setEditId(null)}><X size={12} /></button>
              </div>
            ) : (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</span>{c.is_income && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Income</span>}</div>
                <div className="flex items-center gap-2"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.tx_count || 0} tx</span><button onClick={() => startEdit(c)} className="btn-ghost text-xs p-1.5"><Pencil size={12} /></button>{!c.is_system && <button className="p-1.5 rounded-lg text-xs transition-colors hover:bg-red-500/10 hover:text-red-400" style={{ color: 'var(--text-muted)' }} onClick={() => handleDelete(c.id)}><Trash2 size={12} /></button>}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Category" size="sm">
        <div className="space-y-4">
          <div><label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></div>
          <div><label className="text-xs block mb-2" style={{ color: 'var(--text-muted)' }}>Color</label><div className="flex flex-wrap gap-2">{COLORS.map((col) => <button key={col} onClick={() => setForm((f) => ({ ...f, color: col }))} className="w-7 h-7 rounded-full" style={{ background: col, outline: form.color === col ? '2px solid white' : 'none' }} />)}</div></div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.is_income} onChange={(e) => setForm((f) => ({ ...f, is_income: e.target.checked }))} />Income category</label>
          <div className="flex gap-2 justify-end pt-2"><button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn-primary" onClick={handleAdd}>Create</button></div>
        </div>
      </Modal>

      <Modal
        open={showSuggestionPreview}
        onClose={() => { setShowSuggestionPreview(false); setSuggestionPreview(null); }}
        title={suggestionPreview?.name || 'Suggestion Preview'}
        size="lg"
      >
        {!suggestionPreview ? (
          <div className="py-8 flex justify-center"><Spinner size={20} /></div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Matches {suggestionPreview.match_count} / {suggestionPreview.total_count} transactions ({((suggestionPreview.match_ratio || 0) * 100).toFixed(1)}%)
            </p>
            {(suggestionPreview.warnings || []).map((w, i) => (
              <p key={i} className="text-xs" style={{ color: '#fbbf24' }}>{w}</p>
            ))}
            <div className="max-h-80 overflow-y-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
              {(suggestionPreview.sample || []).length === 0 ? (
                <p className="text-xs px-3 py-3" style={{ color: 'var(--text-muted)' }}>No sample transactions returned.</p>
              ) : (
                (suggestionPreview.sample || []).map((tx) => (
                  <div key={tx.id} className="px-3 py-2 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{tx.date}</span>
                      <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{Number(tx.amount).toFixed(2)}</span>
                    </div>
                    <p className="mt-1 truncate" style={{ color: 'var(--text-primary)' }} title={tx.description}>{tx.description}</p>
                    <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>{tx.account_name || `Account ${tx.account_id}`}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end">
              <button className="btn-secondary" onClick={() => { setShowSuggestionPreview(false); setSuggestionPreview(null); }}>Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RulesTab() {
  const { showToast } = useAppStore();
  const accounts = useAppStore((s) => s.accounts || []);
  const [rules, setRules] = useState([]);
  const [legacyTagRules, setLegacyTagRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [needsForceSave, setNeedsForceSave] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyOptions, setApplyOptions] = useState({
    overwrite_category: false,
    overwrite_tags: false,
    overwrite_merchant: false,
    overwrite_flags: false,
    only_uncategorized: true,
    skip_transfers: true,
    skip_excluded_from_totals: true,
    exclude_category_ids: [],
  });
  const [exportBusy, setExportBusy] = useState('');
  const [importingRules, setImportingRules] = useState(false);
  const [rulesImportFile, setRulesImportFile] = useState(null);
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const defaultExclusionsSeededRef = useRef(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [lintBusy, setLintBusy] = useState(false);
  const [lintScope, setLintScope] = useState('all');
  const [lintResult, setLintResult] = useState(null);
  const [lintReports, setLintReports] = useState([]);
  const [resettingLearned, setResettingLearned] = useState(false);
  const [rebuildingLearned, setRebuildingLearned] = useState(false);
  const [rebuildResult, setRebuildResult] = useState(null);
  const [rebuildRuns, setRebuildRuns] = useState([]);
  const [previewApplyBusy, setPreviewApplyBusy] = useState(false);
  const [applyPreview, setApplyPreview] = useState(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainIdsRaw, setExplainIdsRaw] = useState('');
  const [explainResult, setExplainResult] = useState(null);
  const [ruleSetsState, setRuleSetsState] = useState({ active_rule_set_id: null, rule_sets: [] });
  const [ruleSetsBusy, setRuleSetsBusy] = useState(false);
  const [shadowCompareBusy, setShadowCompareBusy] = useState(false);
  const [shadowCompareResult, setShadowCompareResult] = useState(null);
  const [cleanupPreviewBusy, setCleanupPreviewBusy] = useState(false);
  const [cleanupPreviewResult, setCleanupPreviewResult] = useState(null);
  const [cleanupApplyBusy, setCleanupApplyBusy] = useState(false);
  const [form, setForm] = useState({ ...emptyRuleForm });

  const categoriesById = useMemo(() => {
    const map = {};
    cats.forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [cats]);

  const load = () => Promise.all([
    rulesApi.list().then((r) => setRules(r.data || [])),
    categoriesApi.list().then((r) => setCats(r.data || [])),
    tagRulesApi.list().then((r) => setLegacyTagRules(r.data || [])),
    rulesetsApi.list().then((r) => setRuleSetsState(r.data || { active_rule_set_id: null, rule_sets: [] })).catch(() => {}),
    rulesApi.lintReports(10).then((r) => setLintReports(r.data || [])).catch(() => {}),
    rulesApi.rebuildRuns(10).then((r) => setRebuildRuns(r.data || [])).catch(() => {}),
  ]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!cats.length) return;
    setApplyOptions((prev) => {
      const valid = new Set(cats.map((c) => Number(c.id)));
      let excludeIds = (prev.exclude_category_ids || []).filter((id) => valid.has(Number(id)));

      if (!defaultExclusionsSeededRef.current) {
        const ccPayment = cats.find((c) => String(c.name || '').toLowerCase() === 'cc payment');
        if (ccPayment) {
          excludeIds = [...new Set([...excludeIds, Number(ccPayment.id)])];
        }
        defaultExclusionsSeededRef.current = true;
      }

      return { ...prev, exclude_category_ids: excludeIds };
    });
  }, [cats]);

  const openNew = () => { setForm({ ...emptyRuleForm }); setPreview(null); setNeedsForceSave(false); setShowBuilder(true); };
  const openEdit = (rule) => { setForm(ruleToForm(rule)); setPreview(null); setNeedsForceSave(false); setShowBuilder(true); };

  const runPreview = async () => {
    setPreviewing(true);
    setNeedsForceSave(false);
    try {
      const res = await rulesApi.preview(buildRulePayload(form, false), 30);
      setPreview(res.data);
      if (res.data?.requires_force) setNeedsForceSave(true);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Preview failed', 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = buildRulePayload(form, needsForceSave);
      if (form.id) await rulesApi.update(form.id, payload);
      else await rulesApi.create(payload);
      setShowBuilder(false);
      setForm({ ...emptyRuleForm });
      setPreview(null);
      setNeedsForceSave(false);
      await load();
      showToast('Rule saved');
    } catch (err) {
      const data = err?.response?.data;
      if (data?.requires_force) {
        setPreview(data.preview || null);
        setNeedsForceSave(true);
        showToast('Rule is broad. Review preview and save again to confirm.', 'error');
      } else {
        showToast(data?.error || 'Failed to save rule', 'error');
      }
    } finally { setSaving(false); }
  };

  const deleteRule = async (id) => { await rulesApi.delete(id); await load(); showToast('Rule deleted'); };
  const toggleRuleEnabled = async (rule) => {
    try {
      await rulesApi.update(rule.id, { is_enabled: !rule.is_enabled });
      await load();
      showToast(rule.is_enabled ? 'Rule disabled' : 'Rule enabled');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to toggle rule', 'error');
    }
  };

  const handleApply = async () => {
    setApplyBusy(true);
    try {
      const res = await rulesApi.apply({
        ...applyOptions,
        dry_run: false,
        sample_limit: 80,
        rule_set_id: activeRuleSetId || undefined,
      });
      showToast(`Updated ${res.data.updated} transactions`);
      setApplyPreview(null);
    } catch {
      showToast('Failed to apply rules', 'error');
    } finally { setApplyBusy(false); }
  };

  const handlePreviewApply = async () => {
    setPreviewApplyBusy(true);
    try {
      const res = await rulesApi.apply({
        ...applyOptions,
        dry_run: true,
        sample_limit: 80,
        rule_set_id: activeRuleSetId || undefined,
      });
      setApplyPreview(res.data || null);
      showToast(`Dry run: ${res?.data?.updated || 0} transactions would change`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to preview apply', 'error');
    } finally {
      setPreviewApplyBusy(false);
    }
  };

  const runLint = async () => {
    setLintBusy(true);
    try {
      const res = await rulesApi.lint({ scope: lintScope, persist: true });
      setLintResult(res.data || null);
      const reports = await rulesApi.lintReports(10);
      setLintReports(reports.data || []);
      showToast(`Lint complete (risk score ${res?.data?.summary?.risk_score ?? 'n/a'})`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Lint failed', 'error');
    } finally {
      setLintBusy(false);
    }
  };

  const downloadLint = () => {
    if (!lintResult) return;
    const blob = new Blob([JSON.stringify(lintResult, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `rules-lint-${lintScope}.json`);
  };

  const handleSnapshot = async () => {
    setSnapshotBusy(true);
    try {
      const res = await rulesApi.snapshot();
      showToast(`Snapshot created: ${res?.data?.file_name || 'backup'}`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to create snapshot', 'error');
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleResetLearned = async () => {
    setResettingLearned(true);
    try {
      const res = await rulesApi.resetLearned({ reason: 'wizard_reset', manual_dedupe: true });
      await load();
      setRebuildResult(null);
      showToast(`Archived ${res?.data?.archive?.archived_count || 0} learned rules and disabled ${res?.data?.archive?.disabled_count || 0}`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to reset learned rules', 'error');
    } finally {
      setResettingLearned(false);
    }
  };

  const handleRebuildLearned = async (apply = false) => {
    setRebuildingLearned(true);
    try {
      const res = await rulesApi.rebuildLearned({
        apply,
        reset_learned: false,
        max_suggestions: 120,
        min_support: 2,
        include_reviewed_trusted: true,
      });
      setRebuildResult(res.data || null);
      const runs = await rulesApi.rebuildRuns(10);
      setRebuildRuns(runs.data || []);
      if (apply) {
        await load();
        showToast(`Applied ${res?.data?.apply_summary?.created || 0} rebuilt learned rules`);
      } else {
        showToast(`Generated ${res?.data?.suggestions_count || 0} rebuild suggestions`);
      }
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to rebuild learned rules', 'error');
    } finally {
      setRebuildingLearned(false);
    }
  };

  const handleExplain = async () => {
    const ids = [...new Set(String(explainIdsRaw || '').split(/[,\s]+/).map((v) => v.trim()).filter(Boolean))];
    if (!ids.length) {
      showToast('Enter at least one transaction ID', 'error');
      return;
    }
    setExplainBusy(true);
    try {
      const res = await rulesApi.explain({ transaction_ids: ids, include_legacy_tag_rules: true, limit: 30 });
      setExplainResult(res.data || null);
      showToast(`Explained ${res?.data?.count || 0} transactions`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to explain transactions', 'error');
    } finally {
      setExplainBusy(false);
    }
  };

  const handleExport = async (scope, format) => {
    const busyKey = `${scope}:${format}`;
    setExportBusy(busyKey);
    try {
      const res = await rulesApi.exportFile({ scope, format });
      const filename =
        parseFilenameFromDisposition(res?.headers?.['content-disposition'])
        || `rules-${scope}.${format}`;
      downloadBlob(res.data, filename);
      showToast(`Exported ${scope} rules (${format.toUpperCase()})`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to export rules', 'error');
    } finally {
      setExportBusy('');
    }
  };

  const handleImportRules = async () => {
    if (!rulesImportFile) return;
    setImportingRules(true);
    setLastImportSummary(null);
    try {
      const format = inferRuleFileFormat(rulesImportFile);
      const res = await rulesApi.importFile(rulesImportFile, {
        scope: 'learned',
        mode: 'replace',
        format,
      });
      setLastImportSummary(res.data || null);
      await load();
      setRulesImportFile(null);
      showToast(`Imported ${res?.data?.created_rules || 0} learned rules`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to import rules', 'error');
    } finally {
      setImportingRules(false);
    }
  };

  const activeRuleSetId = Number(ruleSetsState?.active_rule_set_id || 0) || null;

  const refreshRuleSets = async () => {
    setRuleSetsBusy(true);
    try {
      const res = await rulesetsApi.list();
      setRuleSetsState(res.data || { active_rule_set_id: null, rule_sets: [] });
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to load rulesets', 'error');
    } finally {
      setRuleSetsBusy(false);
    }
  };

  const handleCreateRuleSet = async () => {
    const suggested = `ruleset_v3_candidate_${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('New ruleset name', suggested);
    if (!name) return;
    setRuleSetsBusy(true);
    try {
      await rulesetsApi.create({
        name,
        description: 'Candidate ruleset (v3)',
        clone_from_rule_set_id: activeRuleSetId,
        clone_rules: true,
      });
      await refreshRuleSets();
      showToast('Ruleset created');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to create ruleset', 'error');
    } finally {
      setRuleSetsBusy(false);
    }
  };

  const handleActivateRuleSet = async (id) => {
    if (!window.confirm('Activate this ruleset now?')) return;
    setRuleSetsBusy(true);
    try {
      await rulesetsApi.activate(id);
      await load();
      showToast('Ruleset activated');
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to activate ruleset', 'error');
    } finally {
      setRuleSetsBusy(false);
    }
  };

  const handleShadowCompare = async (ruleSetId) => {
    setShadowCompareBusy(true);
    setShadowCompareResult(null);
    try {
      const res = await rulesetsApi.shadowCompare(ruleSetId, {
        baseline_rule_set_id: activeRuleSetId,
        sample_limit: 120,
      });
      setShadowCompareResult(res.data || null);
      showToast(`Shadow compare complete: ${res?.data?.total_diffs || 0} diffs`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed shadow compare', 'error');
    } finally {
      setShadowCompareBusy(false);
    }
  };

  const handleExtractProtected = async (ruleSetId) => {
    setRuleSetsBusy(true);
    try {
      const res = await rulesetsApi.extractProtected(ruleSetId, { from_rule_set_id: activeRuleSetId });
      await load();
      showToast(`Extracted ${res?.data?.extracted || 0} protected rules`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Failed to extract protected rules', 'error');
    } finally {
      setRuleSetsBusy(false);
    }
  };

  const handleCleanupPreview = async (ruleSetId) => {
    setCleanupPreviewBusy(true);
    try {
      const res = await rulesetsApi.cleanupPreview(ruleSetId);
      setCleanupPreviewResult(res.data || null);
      showToast(`Cleanup preview: ${(res?.data?.safe_disable_count || 0)} safe candidates`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Cleanup preview failed', 'error');
    } finally {
      setCleanupPreviewBusy(false);
    }
  };

  const handleCleanupApply = async (ruleSetId) => {
    if (!window.confirm('Disable all safe cleanup candidates in this ruleset?')) return;
    setCleanupApplyBusy(true);
    try {
      const res = await rulesetsApi.cleanupApply(ruleSetId);
      await load();
      showToast(`Disabled ${res?.data?.disabled || 0} rules`);
    } catch (err) {
      showToast(err?.response?.data?.error || 'Cleanup apply failed', 'error');
    } finally {
      setCleanupApplyBusy(false);
    }
  };

  const summaryRows = rules.map((rule) => ({ rule, summary: summarizeRule(rule, categoriesById) }));

  return (
    <div>
      <SectionHeader title="Rules Engine" subtitle={`${rules.length} rules · deterministic order`} actions={<div className="flex gap-2"><button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handleApply} disabled={applyBusy}>{applyBusy ? <Spinner size={12} /> : <RefreshCw size={12} />}{applyBusy ? 'Applying…' : 'Apply rules'}</button><button className="btn-primary text-xs flex items-center gap-1.5" onClick={openNew}><Plus size={12} /> New Rule</button></div>} />

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-3">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Rulesets (v3 shadow rollout)</p>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={refreshRuleSets} disabled={ruleSetsBusy}>
                  {ruleSetsBusy ? 'Refreshing…' : 'Refresh rulesets'}
                </button>
                <button className="btn-primary text-xs" onClick={handleCreateRuleSet} disabled={ruleSetsBusy}>
                  Create candidate ruleset
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-1.5">
              {(ruleSetsState?.rule_sets || []).map((rs) => (
                <div key={rs.id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      #{rs.id} {rs.name} {rs.is_active ? '· active' : ''}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      rules {rs.rule_count} (enabled {rs.enabled_rule_count}) · manual-fix {rs.manual_fix_count} · protected {rs.protected_core_count} · generated {rs.generated_curated_count}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!rs.is_active && <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => handleActivateRuleSet(rs.id)} disabled={ruleSetsBusy}>Activate</button>}
                    <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => handleShadowCompare(rs.id)} disabled={shadowCompareBusy}>Shadow</button>
                    <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => handleExtractProtected(rs.id)} disabled={ruleSetsBusy}>Extract protected</button>
                    <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => handleCleanupPreview(rs.id)} disabled={cleanupPreviewBusy}>Cleanup preview</button>
                    <button className="btn-secondary text-[11px] px-2 py-1" onClick={() => handleCleanupApply(rs.id)} disabled={cleanupApplyBusy}>Cleanup apply</button>
                  </div>
                </div>
              ))}
              {(ruleSetsState?.rule_sets || []).length === 0 && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No rulesets found.</p>
              )}
            </div>
            {shadowCompareResult && (
              <div className="mt-2 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Shadow diff: total {shadowCompareResult.total_diffs || 0} · category {shadowCompareResult.category_diffs || 0} · tags {shadowCompareResult.tags_diffs || 0} · merchant {shadowCompareResult.merchant_diffs || 0} · flags {shadowCompareResult.flag_diffs || 0}
                </p>
              </div>
            )}
            {cleanupPreviewResult && (
              <div className="mt-2 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Cleanup preview (ruleset {cleanupPreviewResult.rule_set_id}): safe disable {cleanupPreviewResult.safe_disable_count || 0}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg p-3 h-fit" style={{ border: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(99,102,241,0.14), rgba(16,185,129,0.08))' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recommended Workflow</p>
            <ol className="mt-2 space-y-1 text-[11px] pl-4 list-decimal" style={{ color: 'var(--text-secondary)' }}>
              <li>Create candidate ruleset from active.</li>
              <li>Run Shadow on candidate and check diff counts.</li>
              <li>Run Cleanup preview, then Cleanup apply if safe count looks good.</li>
              <li>Use top-level Apply rules to reapply to transactions.</li>
              <li>Activate candidate only after results look correct.</li>
            </ol>

            <p className="text-sm font-semibold mt-3" style={{ color: 'var(--text-primary)' }}>Button Meanings</p>
            <div className="mt-2 space-y-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Shadow:</span> compare this ruleset vs active without writing changes.</p>
              <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Extract protected:</span> copy protected logic from active into this ruleset.</p>
              <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Cleanup preview:</span> show rules likely safe to disable.</p>
              <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Cleanup apply:</span> disable those safe cleanup candidates.</p>
              <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Activate:</span> make this ruleset the default for future imports/reapply.</p>
            </div>

            <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
              Tip: applying with <code>rule_set_id</code> uses that ruleset for one run, even if another ruleset is active.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Apply options</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Use these toggles to control how aggressive re-apply is.
            Safe default: keep overwrite options off, keep only uncategorized on.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Overwrite category/tags/merchant will replace existing values. Skip transfers/excluded prevents touching those transactions.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.overwrite_category} onChange={(e) => setApplyOptions((v) => ({ ...v, overwrite_category: e.target.checked, only_uncategorized: e.target.checked ? false : v.only_uncategorized }))} />Overwrite existing category</label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.overwrite_tags} onChange={(e) => setApplyOptions((v) => ({ ...v, overwrite_tags: e.target.checked }))} />Overwrite existing tags</label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.overwrite_merchant} onChange={(e) => setApplyOptions((v) => ({ ...v, overwrite_merchant: e.target.checked }))} />Overwrite existing merchant</label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.only_uncategorized} onChange={(e) => setApplyOptions((v) => ({ ...v, only_uncategorized: e.target.checked }))} />Only uncategorized rows</label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.skip_transfers} onChange={(e) => setApplyOptions((v) => ({ ...v, skip_transfers: e.target.checked }))} />Skip transfer transactions</label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={applyOptions.skip_excluded_from_totals} onChange={(e) => setApplyOptions((v) => ({ ...v, skip_excluded_from_totals: e.target.checked }))} />Skip already excluded transactions</label>
        </div>
        <div className="mt-3">
          <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Exclude categories from re-apply</label>
          <select
            multiple
            className="select h-24 w-full"
            value={(applyOptions.exclude_category_ids || []).map(String)}
            onChange={(e) => setApplyOptions((v) => ({
              ...v,
              exclude_category_ids: [...e.target.selectedOptions].map((o) => Number(o.value)),
            }))}
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Selected: {(applyOptions.exclude_category_ids || []).length}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Rules portability</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Export to back up rules or move them between machines. Import replaces learned rules only; manual/protected rules stay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => handleExport('learned', 'json')} disabled={!!exportBusy}>
            {exportBusy === 'learned:json' ? 'Exporting…' : 'Export learned JSON'}
          </button>
          <button className="btn-secondary text-xs" onClick={() => handleExport('learned', 'csv')} disabled={!!exportBusy}>
            {exportBusy === 'learned:csv' ? 'Exporting…' : 'Export learned CSV'}
          </button>
          <button className="btn-secondary text-xs" onClick={() => handleExport('all', 'json')} disabled={!!exportBusy}>
            {exportBusy === 'all:json' ? 'Exporting…' : 'Export all JSON'}
          </button>
          <button className="btn-secondary text-xs" onClick={() => handleExport('all', 'csv')} disabled={!!exportBusy}>
            {exportBusy === 'all:csv' ? 'Exporting…' : 'Export all CSV'}
          </button>
          <input
            type="file"
            accept=".json,.csv"
            onChange={(e) => setRulesImportFile(e.target.files?.[0] || null)}
            className="input text-xs"
            style={{ maxWidth: 280 }}
          />
          <button className="btn-primary text-xs" onClick={handleImportRules} disabled={!rulesImportFile || importingRules}>
            {importingRules ? 'Importing…' : 'Import (replace learned)'}
          </button>
          {rulesImportFile && <span style={{ color: 'var(--text-muted)' }}>{rulesImportFile.name}</span>}
        </div>
        {lastImportSummary && (
          <div className="mt-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Parsed {lastImportSummary.parsed_count || 0} | Created {lastImportSummary.created_rules || 0} | Removed {lastImportSummary.removed_rules || 0} | Invalid {lastImportSummary.skipped_invalid || 0} | Duplicate {lastImportSummary.skipped_duplicates || 0}
            </p>
            {!!(lastImportSummary.created_categories || []).length && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Auto-created categories: {(lastImportSummary.created_categories || []).map((c) => c.name).join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Rules health (lint)</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Lint finds risky rules: duplicates, conflicts, overly broad matches, and missing safeguards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="select text-xs" value={lintScope} onChange={(e) => setLintScope(e.target.value)}>
            <option value="all">Scope: all</option>
            <option value="manual">Scope: manual</option>
            <option value="learned">Scope: learned</option>
          </select>
          <button className="btn-secondary text-xs" onClick={runLint} disabled={lintBusy}>
            {lintBusy ? 'Running lint…' : 'Run lint'}
          </button>
          <button className="btn-secondary text-xs" onClick={downloadLint} disabled={!lintResult}>
            Download lint JSON
          </button>
        </div>
        {lintResult?.summary && (
          <div className="mt-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Risk score {lintResult.summary.risk_score} | Duplicate groups {lintResult.summary.duplicate_signature_groups} | Cross-category conflicts {lintResult.summary.cross_category_conflicts} | Broad learned violations {lintResult.summary.broad_token_violations} | Missing income sign guard {lintResult.summary.missing_income_sign_guard}
            </p>
            {!!lintResult?.findings?.cross_category_conflicts?.length && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Top conflict: {(lintResult.findings.cross_category_conflicts[0]?.description_needle || '').slice(0, 60)}
              </p>
            )}
          </div>
        )}
        {!!lintReports.length && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Recent lint reports: {lintReports.map((r) => `#${r.id}`).join(', ')}
          </p>
        )}
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Rebuild wizard</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Step 1 makes a database safety snapshot. Step 2 disables learned rules. Step 3 generates safer suggestions. Step 4 applies selected rebuilt learned rules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={handleSnapshot} disabled={snapshotBusy}>
            {snapshotBusy ? 'Creating snapshot…' : '1) Snapshot DB'}
          </button>
          <button className="btn-secondary text-xs" onClick={handleResetLearned} disabled={resettingLearned}>
            {resettingLearned ? 'Resetting…' : '2) Archive + disable learned'}
          </button>
          <button className="btn-secondary text-xs" onClick={() => handleRebuildLearned(false)} disabled={rebuildingLearned}>
            {rebuildingLearned ? 'Building…' : '3) Build suggestions'}
          </button>
          <button className="btn-primary text-xs" onClick={() => handleRebuildLearned(true)} disabled={rebuildingLearned || !(rebuildResult?.suggestions_count > 0)}>
            {rebuildingLearned ? 'Applying…' : '4) Apply rebuilt learned'}
          </button>
        </div>
        {rebuildResult && (
          <div className="mt-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Trusted rows {rebuildResult.trusted_rows || 0} (manual {rebuildResult.trusted_rows_manual || 0}, reviewed {rebuildResult.trusted_rows_reviewed || 0}) | Candidate groups {rebuildResult.candidate_groups || 0} | Suggestions {rebuildResult.suggestions_count || 0} | Applied {rebuildResult.apply_summary?.created || 0}
            </p>
            {!!(rebuildResult.suggestions || []).length && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                {(rebuildResult.suggestions || []).slice(0, 20).map((s, idx) => (
                  <div key={`${s.signature || s.keyword}-${idx}`} className="px-2 py-1 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      {s.pattern || s.keyword}{' -> '}{categoriesById[s.category_id] || s.category_id} ({Math.round((s.confidence || 0) * 100)}%)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!!rebuildRuns.length && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Recent rebuild runs: {rebuildRuns.map((r) => `#${r.id}(${r.status})`).join(', ')}
          </p>
        )}
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Shadow reapply (dry run)</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Preview only. Shows how many transactions would change without writing anything.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={handlePreviewApply} disabled={previewApplyBusy}>
            {previewApplyBusy ? 'Previewing…' : 'Preview reapply'}
          </button>
        </div>
        {applyPreview && (
          <div className="mt-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Would update {applyPreview.updated || 0} rows | category {applyPreview.category_updates || 0} | blocked negative-income {applyPreview.blocked_income_assignments || 0}
            </p>
            {!!(applyPreview.category_change_buckets || []).length && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Top category change: {(applyPreview.category_change_buckets[0]?.from_category_id ?? 'null')}{' -> '}{(applyPreview.category_change_buckets[0]?.to_category_id ?? 'null')} ({applyPreview.category_change_buckets[0]?.count || 0})
                </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Explain categorization</p>
        <div className="mb-3 p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card-hover)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Paste transaction IDs to see the winning rule, matched rules, and blocked rules for each transaction.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <textarea
            className="input text-xs"
            style={{ minHeight: 72 }}
            value={explainIdsRaw}
            onChange={(e) => setExplainIdsRaw(e.target.value)}
            placeholder="Paste transaction IDs (comma or newline separated)"
          />
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={handleExplain} disabled={explainBusy}>
              {explainBusy ? 'Explaining…' : 'Explain IDs'}
            </button>
          </div>
        </div>
        {explainResult?.explanations?.length > 0 && (
          <div className="mt-3 max-h-52 overflow-y-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
            {explainResult.explanations.map((item) => (
              <div key={item.transaction.id} className="px-2 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[11px]" style={{ color: 'var(--text-primary)' }}>
                    {item.transaction.id}{' -> '}{categoriesById[item.outcome.category_id] || item.outcome.category_id || 'Uncategorized'}
                  </p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  winning rule: {item.outcome.winning_category_rule?.id || 'none'} | blocked: {(item.outcome.blocked_rules || []).length}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {summaryRows.length === 0 && <EmptyState icon={Zap} title="No rules yet" description="Create an advanced rule with conditions and actions." />}
        {summaryRows.map(({ rule, summary }) => (
          <div key={rule.id} className="rounded-xl p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><Badge color={rule.category_color || '#6366f1'}>{getRuleDisplayName(rule)}</Badge><span className="text-xs" style={{ color: 'var(--text-muted)' }}>priority {rule.priority}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>source {rule.source || 'manual'}</span>{rule.stop_processing ? <span className="text-xs text-amber-300">stop processing</span> : null}{!rule.is_enabled ? <span className="text-xs text-slate-400">disabled</span> : null}</div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{summary.conditions}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{summary.actions}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0"><button className="btn-ghost text-xs p-1.5" onClick={() => toggleRuleEnabled(rule)}>{rule.is_enabled ? <CheckSquare size={13} /> : <Square size={13} />}</button><button className="btn-ghost text-xs p-1.5" onClick={() => openEdit(rule)}><Pencil size={13} /></button><button className="btn-ghost text-xs p-1.5 text-red-400" onClick={() => deleteRule(rule.id)}><Trash2 size={13} /></button></div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <SectionHeader title="Legacy Tag Rules" subtitle={`${legacyTagRules.length} legacy rules still evaluated for compatibility`} />
        <div className="mt-3 space-y-1.5">
          {legacyTagRules.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No legacy tag rules.</p>}
          {legacyTagRules.map((r) => <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}><div className="flex items-center gap-2 min-w-0"><Badge>{r.tag}</Badge><span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.keyword}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.match_type}</span></div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>priority {r.priority}</span></div>)}
        </div>
      </div>

      <Modal open={showBuilder} onClose={() => setShowBuilder(false)} title={form.id ? 'Edit Rule' : 'New Rule'} size="xxl">
        <div className="space-y-4 pr-2">
          <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border)' }}>Build conditions with AND logic. Use Preview before saving.</div>
          <div><label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Rule name</label><input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Netflix monthly" /></div>
          <div className="space-y-3 p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Conditions (AND)</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2"><select className="select" value={form.description_operator} onChange={(e) => setForm((f) => ({ ...f, description_operator: e.target.value }))}>{MATCH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input className="input md:col-span-2" value={form.description_value} onChange={(e) => setForm((f) => ({ ...f, description_value: e.target.value }))} placeholder="Description pattern" /></div>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.description_case_sensitive} onChange={(e) => setForm((f) => ({ ...f, description_case_sensitive: e.target.checked }))} />Description case-sensitive</label>
            {form.description_operator === 'contains' && (
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={form.description_match_semantics === 'substring_explicit'}
                  onChange={(e) => setForm((f) => ({ ...f, description_match_semantics: e.target.checked ? 'substring_explicit' : 'token_default' }))}
                />
                Use broad substring matching (advanced)
              </label>
            )}
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.merchant_enabled} onChange={(e) => setForm((f) => ({ ...f, merchant_enabled: e.target.checked }))} />Add merchant condition</label>
            {form.merchant_enabled && <div className="space-y-2"><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><select className="select" value={form.merchant_operator} onChange={(e) => setForm((f) => ({ ...f, merchant_operator: e.target.value }))}>{MATCH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input className="input md:col-span-2" value={form.merchant_value} onChange={(e) => setForm((f) => ({ ...f, merchant_value: e.target.value }))} placeholder="Merchant value" /></div>{form.merchant_operator === 'contains' && <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.merchant_match_semantics === 'substring_explicit'} onChange={(e) => setForm((f) => ({ ...f, merchant_match_semantics: e.target.checked ? 'substring_explicit' : 'token_default' }))} />Use broad substring matching for merchant (advanced)</label>}</div>}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2"><select className="select" value={form.amount_mode} onChange={(e) => setForm((f) => ({ ...f, amount_mode: e.target.value }))}><option value="any">Any amount</option><option value="exact">Exact amount</option><option value="range">Amount range</option></select>{form.amount_mode === 'exact' && <input className="input md:col-span-3" type="number" step="0.01" value={form.amount_exact} onChange={(e) => setForm((f) => ({ ...f, amount_exact: e.target.value }))} placeholder="Exact amount" />}{form.amount_mode === 'range' && <><input className="input md:col-span-1" type="number" step="0.01" value={form.amount_min} onChange={(e) => setForm((f) => ({ ...f, amount_min: e.target.value }))} placeholder="Min" /><input className="input md:col-span-2" type="number" step="0.01" value={form.amount_max} onChange={(e) => setForm((f) => ({ ...f, amount_max: e.target.value }))} placeholder="Max" /></>}</div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Amount uses absolute value; combine with sign for income/expense.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2"><select className="select" value={form.amount_sign} onChange={(e) => setForm((f) => ({ ...f, amount_sign: e.target.value }))}><option value="any">Any sign</option><option value="expense">Expense (negative)</option><option value="income">Income (positive)</option></select><select multiple className="select md:col-span-2 h-24" value={form.account_ids.map(String)} onChange={(e) => setForm((f) => ({ ...f, account_ids: [...e.target.selectedOptions].map((o) => Number(o.value)) }))}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2"><input type="date" className="input" value={form.date_from} onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value }))} /><input type="date" className="input" value={form.date_to} onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))} /></div>
          </div>
          <div className="space-y-3 p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Actions</p>
            <select className="select w-full" value={form.action_category_id} onChange={(e) => setForm((f) => ({ ...f, action_category_id: e.target.value }))}><option value="">No category change</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2"><select className="select" value={form.action_tags_mode} onChange={(e) => setForm((f) => ({ ...f, action_tags_mode: e.target.value }))}><option value="append">Append tags</option><option value="replace">Replace tags</option><option value="remove">Remove tags</option></select><input className="input md:col-span-2" value={form.action_tags_values} onChange={(e) => setForm((f) => ({ ...f, action_tags_values: e.target.value }))} placeholder="tag1, tag2" /></div>
            <input className="input" value={form.action_set_merchant_name} onChange={(e) => setForm((f) => ({ ...f, action_set_merchant_name: e.target.value }))} placeholder="Set merchant normalized name" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2"><select className="select" value={form.action_income_override} onChange={(e) => setForm((f) => ({ ...f, action_income_override: e.target.value }))}>{BOOL_MODES.map((o) => <option key={o.value} value={o.value}>Income override: {o.label}</option>)}</select><select className="select" value={form.action_exclude_totals} onChange={(e) => setForm((f) => ({ ...f, action_exclude_totals: e.target.value }))}>{BOOL_MODES.map((o) => <option key={o.value} value={o.value}>Exclude from totals: {o.label}</option>)}</select></div>
          </div>
          <div className="space-y-3 p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}><p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Behavior</p><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><input className="input" type="number" min={1} max={1000} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 10 }))} /><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.target.checked }))} />Enabled</label><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={form.stop_processing} onChange={(e) => setForm((f) => ({ ...f, stop_processing: e.target.checked }))} />Stop processing</label></div></div>

          {preview && (
            <div
              className="p-3 rounded-lg"
              style={{
                border: `1px solid ${preview.requires_force ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                background: preview.requires_force ? 'rgba(245,158,11,0.08)' : 'var(--bg-card)',
              }}
            >
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Preview: {preview.match_count} / {preview.total_count} matches ({(preview.match_ratio * 100).toFixed(1)}%)
              </p>
              {(preview.warnings || []).map((w, i) => (
                <p key={i} className="text-xs mt-1 flex items-center gap-1" style={{ color: '#fbbf24' }}>
                  <AlertTriangle size={12} /> {w}
                </p>
              ))}

              <div className="mt-3">
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Sample matching transactions
                </p>
                {(preview.sample || []).length === 0 ? (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    No sample transactions returned.
                  </p>
                ) : (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                    {(preview.sample || []).map((tx) => {
                      const amount = Number(tx.amount || 0);
                      const categoryLabel = tx.category_id ? (categoriesById[tx.category_id] || `Category ${tx.category_id}`) : 'Uncategorized';
                      return (
                        <div key={tx.id} className="px-3 py-2 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{tx.date}</span>
                            <span className={`font-mono ${amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {amount < 0 ? '-' : '+'}${Math.abs(amount).toFixed(2)}
                            </span>
                          </div>
                          <p className="mt-1 truncate" style={{ color: 'var(--text-primary)' }} title={tx.description}>
                            {tx.description}
                          </p>
                          <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {tx.account_name || `Account ${tx.account_id}`} · {categoryLabel}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-between pt-1"><button className="btn-secondary flex items-center gap-1.5" onClick={runPreview} disabled={previewing}>{previewing ? <Spinner size={12} /> : <Eye size={12} />}Preview</button><div className="flex gap-2"><button className="btn-secondary" onClick={() => setShowBuilder(false)}>Cancel</button><button className="btn-primary" onClick={saveRule} disabled={saving}>{saving ? 'Saving…' : (needsForceSave ? 'Save anyway (force)' : 'Save rule')}</button></div></div>
        </div>
      </Modal>
    </div>
  );
}

function IncomeSourcesTab() {
  const { showToast } = useAppStore();
  const [sources, setSources] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ keyword: '', match_type: 'contains', notes: '' });

  const load = () => fetch('/api/income-sources').then((r) => r.json()).then(setSources);
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.keyword.trim()) return;
    await fetch('/api/income-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowAdd(false);
    setForm({ keyword: '', match_type: 'contains', notes: '' });
    load();
    showToast('Income source added');
  };

  const handleDelete = async (id) => { await fetch(`/api/income-sources/${id}`, { method: 'DELETE' }); load(); showToast('Income source removed'); };
  const handlePreview = async () => { setLoadingPreview(true); const data = await fetch('/api/income-sources/preview').then((r) => r.json()); setPreview(data); setLoadingPreview(false); };

  return (
    <div>
      <SectionHeader title="Income Sources" subtitle="Keyword rules for income recognition" actions={<div className="flex gap-2"><button className="btn-secondary text-xs" onClick={handlePreview} disabled={loadingPreview}>{loadingPreview ? <Spinner size={12} /> : 'Verify matches'}</button><button className="btn-primary text-xs" onClick={() => setShowAdd(true)}><Plus size={12} /> Add Source</button></div>} />
      <div className="mt-4 space-y-1.5">{sources.length === 0 && <EmptyState icon={Zap} title="No income sources" description="Add merchant/description keywords for income." />}{sources.map((s) => <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}><div className="flex items-center gap-3 min-w-0"><span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{s.keyword}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.match_type}</span>{s.notes && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.notes}</span>}</div><button className="btn-ghost text-xs p-1.5 text-red-400" onClick={() => handleDelete(s.id)}><Trash2 size={12} /></button></div>)}</div>
      {preview && <div className="mt-5 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}><div className="px-4 py-3" style={{ background: 'rgba(99,102,241,0.1)' }}><p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Matched transactions: {preview.transactions?.length || 0}</p><p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Total: ${preview.total?.toFixed?.(2) || '0.00'}</p></div></div>}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Income Source" size="sm"><div className="space-y-4"><div><label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Keyword</label><input className="input font-mono" value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value.toUpperCase() }))} autoFocus /></div><div><label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Match type</label><select className="select w-full" value={form.match_type} onChange={(e) => setForm((f) => ({ ...f, match_type: e.target.value }))}><option value="contains">Contains</option><option value="exact">Exact</option></select></div><div><label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Notes</label><input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div><div className="flex gap-2 justify-end"><button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn-primary" onClick={handleAdd}>Add</button></div></div></Modal>
    </div>
  );
}

function AiFeaturesPanel() {
  const { aiEnabled, setAiEnabled } = useAppStore();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshStatus = async () => {
    setLoading(true);
    try {
      const res = await aiApi.status();
      setStatus(res.data || null);
    } catch (err) {
      setStatus({
        available: false,
        error: err?.response?.data?.error || err?.message || 'Status check failed',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshStatus(); }, []);

  const availabilityText = (() => {
    if (!aiEnabled) return 'Disabled in this browser';
    if (loading) return 'Checking AI providers...';
    if (status?.available) return `Available (${status.model || 'model'})`;
    return status?.error || 'Unavailable';
  })();

  const providerMode = status?.primary_provider
    ? `${status.primary_provider}${status.fallback_provider ? ` -> ${status.fallback_provider}` : ''}`
    : 'ollama';
  const geminiConfigured = !!status?.providers?.gemini?.configured;
  const ollamaConfigured = !!status?.providers?.ollama?.configured;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI Providers</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Suggestions are optional and review-only. UI toggle only controls this browser.
          </p>
          <p className="text-xs mt-1.5" style={{ color: status?.available ? '#34d399' : 'var(--text-muted)' }}>
            Status: {availabilityText}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Mode: {providerMode} · Gemini key: {geminiConfigured ? 'configured' : 'missing'} · Ollama: {ollamaConfigured ? 'configured' : 'missing'}
          </p>
          {status?.privacy_mode && (
            <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
              privacy amount_shared={String(!!status.privacy_mode.share_amount)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={!!aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            Enable AI features
          </label>
          <button className="btn-secondary text-xs" onClick={refreshStatus} disabled={loading}>
            {loading ? <Spinner size={12} /> : 'Refresh'}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('income');
  const tabs = [{ id: 'income', label: 'Income Sources' }, { id: 'categories', label: 'Categories' }, { id: 'rules', label: 'Rules Engine' }];

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div><h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Settings</h1><p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Income sources, categories, and advanced transaction rules</p></div>
      <AiFeaturesPanel />
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>{tabs.map((t) => <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === t.id ? 'text-white shadow-sm' : 'hover:opacity-80'}`} style={{ background: activeTab === t.id ? 'var(--accent)' : 'transparent', color: activeTab === t.id ? 'white' : 'var(--text-muted)' }}>{t.label}</button>)}</div>
      <Card className="p-6">{activeTab === 'income' && <IncomeSourcesTab />}{activeTab === 'categories' && <CategoriesTab />}{activeTab === 'rules' && <RulesTab />}</Card>
    </div>
  );
}
