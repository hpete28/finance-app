// src/pages/Settings.jsx
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Play, DollarSign, Building2, Pencil, Check, X, Zap, RefreshCw, Tag } from 'lucide-react';
import { categoriesApi, rulesApi, tagRulesApi } from '../utils/api';
import { Card, Modal, SectionHeader, Badge, EmptyState, Spinner } from '../components/ui';
import useAppStore from '../stores/appStore';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#64748b','#a3e635','#fb923c'];

// ─── Categories Tab ────────────────────────────────────────────────────────────
function CategoriesTab() {
  const { showToast } = useAppStore();
  const [cats, setCats]     = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId]   = useState(null);
  const [form, setForm]     = useState({ name: '', color: '#6366f1', parent_id: '', is_income: false });
  const [editForm, setEditForm] = useState({});
  const [learning, setLearning] = useState(false);
  const [learnResult, setLearnResult] = useState(null);

  const load = () => categoriesApi.list().then(r => setCats(r.data));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    await categoriesApi.create({ name: form.name, color: form.color, parent_id: form.parent_id || null, is_income: form.is_income });
    setShowAdd(false); setForm({ name: '', color: '#6366f1', parent_id: '', is_income: false }); load();
    showToast('✅ Category created');
  };

  const startEdit = (cat) => {
    setEditId(cat.id);
    setEditForm({ name: cat.name, color: cat.color, is_income: !!cat.is_income });
  };

  const saveEdit = async (id) => {
    await categoriesApi.update(id, editForm);
    setEditId(null); load(); showToast('✅ Category updated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this category? Transactions will become uncategorized.')) return;
    await categoriesApi.delete(id); load(); showToast('🗑 Category deleted');
  };

  const handleToggleIncome = async (cat) => {
    await categoriesApi.update(cat.id, { is_income: cat.is_income ? 0 : 1 });
    load(); showToast(cat.is_income ? 'Income flag removed' : '💰 Marked as income category');
  };

  // Auto-learn: creates rules from manually categorized transactions
  const handleLearn = async () => {
    setLearning(true); setLearnResult(null);
    try {
      const res = await fetch('/api/rules/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ min_count: 3, max_new_rules: 60 }) });
      const data = await res.json();
      setLearnResult(data);
      showToast(`🧠 Learned ${data.created} new rules (${data.analyzed} analyzed)`);
    } catch (e) { showToast('Learning failed', 'error'); }
    finally { setLearning(false); }
  };

  return (
    <div>
      <SectionHeader title="🏷️ Categories" subtitle={`${cats.length} categories · sorted alphabetically`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handleLearn} disabled={learning}>
              {learning ? <Spinner size={12} /> : <Zap size={12} />}
              {learning ? 'Learning…' : 'Auto-learn rules'}
            </button>
            <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add Category
            </button>
          </div>
        } />

      {learnResult && (
        <div className="mt-3 mb-4 p-3 rounded-xl text-sm animate-slide-up"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <p className="text-emerald-300 font-semibold">🧠 Learning complete</p>
          <p className="text-slate-400 text-xs mt-1">Analyzed {learnResult.analyzed} manually-categorized transactions →
            created <strong className="text-emerald-400">{learnResult.created}</strong> new rules,
            skipped {learnResult.skipped} (already existed).</p>
          <button className="text-xs text-slate-500 hover:text-slate-300 mt-1" onClick={() => setLearnResult(null)}>Dismiss</button>
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {cats.map(c => (
          <div key={c.id}
            className={`rounded-xl overflow-hidden ${c.parent_id ? 'ml-8' : ''}`}
            style={{ border: `1px solid ${editId === c.id ? 'var(--border-strong)' : 'var(--border)'}`, background: 'var(--bg-card)' }}>
            {editId === c.id ? (
              // ── Edit row ──
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {COLORS.map(col => (
                    <button key={col} onClick={() => setEditForm(f => ({...f, color: col}))}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                      style={{ background: col, outline: editForm.color === col ? `2px solid white` : 'none', outlineOffset: '2px' }} />
                  ))}
                </div>
                <input className="input flex-1 py-1.5 text-sm" value={editForm.name}
                  onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
                  onKeyDown={e => e.key === 'Enter' && saveEdit(c.id)} autoFocus />
                <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={editForm.is_income} onChange={e => setEditForm(f => ({...f, is_income: e.target.checked}))} />
                  Income
                </label>
                <button className="btn-primary text-xs py-1 px-3" onClick={() => saveEdit(c.id)}><Check size={12} /></button>
                <button className="btn-ghost text-xs py-1 px-2" onClick={() => setEditId(null)}><X size={12} /></button>
              </div>
            ) : (
              // ── View row ──
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  {c.is_income && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">💰 Income</span>}
                  {c.is_system && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>system</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.tx_count || 0} tx</span>
                  <button onClick={() => startEdit(c)} className="btn-ghost text-xs p-1.5" title="Edit">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => handleToggleIncome(c)} title={c.is_income ? 'Remove income flag' : 'Mark as income'}
                    className={`p-1.5 rounded-lg text-xs transition-colors ${c.is_income ? 'text-emerald-400 bg-emerald-500/10' : 'hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                    style={{ color: c.is_income ? undefined : 'var(--text-muted)' }}>
                    <DollarSign size={12} />
                  </button>
                  {!c.is_system && (
                    <button className="p-1.5 rounded-lg text-xs transition-colors hover:bg-red-500/10 hover:text-red-400"
                      style={{ color: 'var(--text-muted)' }} onClick={() => handleDelete(c.id)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="➕ Add Category" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label>
            <input className="input" placeholder="e.g. Entertainment"
              value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
          </div>
          <div>
            <label className="text-xs block mb-2" style={{ color: 'var(--text-muted)' }}>Color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(col => (
                <button key={col} onClick={() => setForm(f => ({...f, color: col}))}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{ background: col, outline: form.color === col ? '2px solid white' : 'none', outlineOffset: '2px' }} />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_income} onChange={e => setForm(f => ({...f, is_income: e.target.checked}))} />
            <div>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Income category</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Transactions here count as income, not expenses</p>
            </div>
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Create</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Rules Tab ─────────────────────────────────────────────────────────────────
function RulesTab() {
  const { showToast } = useAppStore();
  const [rules, setRules] = useState([]);
  const [tagRules, setTagRules] = useState([]);
  const [cats, setCats]   = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddTagRule, setShowAddTagRule] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingTags, setApplyingTags] = useState(false);
  const [form, setForm] = useState({ keyword: '', match_type: 'contains_case_insensitive', category_id: '', priority: 10 });
  const [tagForm, setTagForm] = useState({ keyword: '', match_type: 'contains_case_insensitive', tag: '', priority: 10 });

  const load = () => Promise.all([
    rulesApi.list().then(r => setRules(r.data)),
    tagRulesApi.list().then(r => setTagRules(r.data)),
  ]);
  useEffect(() => {
    load();
    categoriesApi.list().then(r => setCats(r.data));
  }, []);

  const handleAdd = async () => {
    if (!form.keyword || !form.category_id) return;
    await rulesApi.create(form); setShowAdd(false); load();
    setForm({ keyword: '', match_type: 'contains_case_insensitive', category_id: '', priority: 10 });
    showToast('✅ Rule created');
  };

  const handleDelete = async (id) => { await rulesApi.delete(id); load(); showToast('🗑 Rule deleted'); };
  const handleDeleteTagRule = async (id) => { await tagRulesApi.delete(id); load(); showToast('🗑 Tag rule deleted'); };

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await rulesApi.apply(false);
      showToast(`⚡ Applied to ${res.data.categorized} transactions`);
    } finally { setApplying(false); }
  };

  const handleAddTagRule = async () => {
    if (!tagForm.keyword || !tagForm.tag) return;
    await tagRulesApi.create(tagForm);
    setShowAddTagRule(false);
    setTagForm({ keyword: '', match_type: 'contains_case_insensitive', tag: '', priority: 10 });
    load();
    showToast('✅ Tag rule created');
  };

  const handleApplyTagRules = async () => {
    setApplyingTags(true);
    try {
      const res = await tagRulesApi.apply(false);
      showToast(`🏷️ Tagged ${res.data.tagged} transactions`);
    } finally { setApplyingTags(false); }
  };

  const matchLabels = {
    contains_case_insensitive: 'Contains',
    starts_with: 'Starts with',
    exact: 'Exact',
    regex: 'Regex',
  };

  return (
    <div>
      <SectionHeader title="⚡ Rules Engine" subtitle={`${rules.length} active rules · applied in priority order`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handleApply} disabled={applying}>
              {applying ? <Spinner size={12} /> : <RefreshCw size={12} />}
              {applying ? 'Applying…' : 'Apply to all'}
            </button>
            <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add Rule
            </button>
          </div>
        } />

      <div className="mt-4 space-y-1.5">
        {rules.length === 0 && <EmptyState icon={Zap} title="No rules yet" description="Add rules to auto-categorize transactions. Or use Auto-learn in Categories." />}
        {rules.map(r => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3 min-w-0">
              <Badge color={r.category_color || '#6366f1'}>{r.category_name}</Badge>
              <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{r.keyword}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)' }}>
                {matchLabels[r.match_type] || r.match_type}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>priority {r.priority}</span>
            </div>
            <button className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-400 shrink-0"
              style={{ color: 'var(--text-muted)' }} onClick={() => handleDelete(r.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
        <SectionHeader title="🏷️ Tag Rules" subtitle={`${tagRules.length} active tag rules · append tags by keyword match`}
          actions={
            <div className="flex gap-2">
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handleApplyTagRules} disabled={applyingTags}>
                {applyingTags ? <Spinner size={12} /> : <RefreshCw size={12} />}
                {applyingTags ? 'Applying…' : 'Apply tags'}
              </button>
              <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setShowAddTagRule(true)}>
                <Tag size={12} /> Add Tag Rule
              </button>
            </div>
          } />

        <div className="mt-4 space-y-1.5">
          {tagRules.length === 0 && <EmptyState icon={Tag} title="No tag rules yet" description="Create tag rules to add detail labels automatically." />}
          {tagRules.map(r => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <Badge className="text-xs">{r.tag}</Badge>
                <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{r.keyword}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)' }}>
                  {matchLabels[r.match_type] || r.match_type}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>priority {r.priority}</span>
              </div>
              <button className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-400 shrink-0"
                style={{ color: 'var(--text-muted)' }} onClick={() => handleDeleteTagRule(r.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="➕ Add Categorization Rule" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Keyword / Pattern</label>
            <input className="input font-mono" placeholder="e.g. AMAZON"
              value={form.keyword} onChange={e => setForm(f => ({...f, keyword: e.target.value}))} autoFocus />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Match type</label>
            <select className="select w-full" value={form.match_type} onChange={e => setForm(f => ({...f, match_type: e.target.value}))}>
              <option value="contains_case_insensitive">Contains (case-insensitive) — recommended</option>
              <option value="starts_with">Starts with</option>
              <option value="exact">Exact match</option>
              <option value="regex">Regex</option>
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Category</label>
            <select className="select w-full" value={form.category_id} onChange={e => setForm(f => ({...f, category_id: e.target.value}))}>
              <option value="">Select category…</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Priority (higher = checked first)</label>
            <input className="input" type="number" min={1} max={100} value={form.priority}
              onChange={e => setForm(f => ({...f, priority: parseInt(e.target.value) || 10}))} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Add Rule</button>
          </div>
        </div>
      </Modal>

      <Modal open={showAddTagRule} onClose={() => setShowAddTagRule(false)} title="➕ Add Tag Rule" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Keyword / Pattern</label>
            <input className="input font-mono" placeholder="e.g. REBATE"
              value={tagForm.keyword} onChange={e => setTagForm(f => ({...f, keyword: e.target.value}))} autoFocus />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Tag label</label>
            <input className="input" placeholder="e.g. cashback"
              value={tagForm.tag} onChange={e => setTagForm(f => ({...f, tag: e.target.value}))} />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Match type</label>
            <select className="select w-full" value={tagForm.match_type} onChange={e => setTagForm(f => ({...f, match_type: e.target.value}))}>
              <option value="contains_case_insensitive">Contains (case-insensitive) — recommended</option>
              <option value="starts_with">Starts with</option>
              <option value="exact">Exact match</option>
              <option value="regex">Regex</option>
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Priority (higher = checked first)</label>
            <input className="input" type="number" min={1} max={100} value={tagForm.priority}
              onChange={e => setTagForm(f => ({...f, priority: parseInt(e.target.value) || 10}))} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary" onClick={() => setShowAddTagRule(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAddTagRule}>Add Tag Rule</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Income Sources Tab ────────────────────────────────────────────────────────
function IncomeSourcesTab() {
  const { showToast } = useAppStore();
  const [sources, setSources] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ keyword: '', match_type: 'contains', notes: '' });

  const load = () => fetch('/api/income-sources').then(r => r.json()).then(setSources);
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.keyword.trim()) return;
    await fetch('/api/income-sources', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) });
    setShowAdd(false); setForm({ keyword: '', match_type: 'contains', notes: '' }); load();
    showToast('💰 Income source added');
  };

  const handleDelete = async (id) => {
    await fetch(`/api/income-sources/${id}`, { method: 'DELETE' }); load();
    showToast('🗑 Income source removed');
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    const res = await fetch('/api/income-sources/preview'); const data = await res.json();
    setPreview(data); setLoadingPreview(false);
  };

  return (
    <div>
      <SectionHeader title="💰 Income Sources"
        subtitle="Define which merchant keywords count as income. Only matching positive transactions are treated as income."
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={handlePreview} disabled={loadingPreview}>
              {loadingPreview ? <Spinner size={12}/> : <Play size={12}/>}
              Verify matches
            </button>
            <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12}/> Add Source
            </button>
          </div>
        } />

      <div className="mt-3 mb-5 p-4 rounded-xl text-xs" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
        <p className="font-semibold text-emerald-300 mb-1">How this works</p>
        <p style={{ color: 'var(--text-muted)' }}>
          Add a keyword for each income source — your employer's payroll description, "DIRECT DEPOSIT", "PAYROLL", a freelance client name, etc.
          Any <strong style={{ color: 'var(--text-primary)' }}>positive transaction</strong> matching a keyword counts as income.
          Payments, refunds and transfers that don't match are <strong style={{ color: 'var(--text-primary)' }}>excluded from income totals</strong>.
          <br/><span className="text-emerald-400 mt-1 block">✓ Sources are saved instantly when added — no extra apply step needed.</span>
        </p>
      </div>

      <div className="space-y-1.5">
        {sources.length === 0 && <EmptyState icon={Building2} title="No income sources" description="Add keywords to start recognizing income transactions." />}
        {sources.map(s => (
          <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <Building2 size={14} className="text-emerald-500 shrink-0" />
              <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{s.keyword}</span>
              <span className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{s.match_type}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">✓ active</span>
              {s.notes && <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>{s.notes}</span>}
            </div>
            <button className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-400"
              style={{ color: 'var(--text-muted)' }} onClick={() => handleDelete(s.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {preview && (
        <div className="mt-5 rounded-xl overflow-hidden animate-slide-up" style={{ border: '1px solid var(--border-strong)' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: 'rgba(99,102,241,0.1)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Matched income transactions (all time)</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {preview.transactions?.length} shown · Total: <span className="font-mono text-emerald-400">${preview.total?.toFixed(2)}</span>
              </p>
            </div>
            <button className="text-xs hover:text-slate-300" style={{ color: 'var(--text-muted)' }} onClick={() => setPreview(null)}>Close ×</button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {preview.transactions?.length === 0
              ? <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No transactions matched</p>
              : preview.transactions?.map((t, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-xs border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex gap-4">
                    <span className="font-mono w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>{t.date}</span>
                    <span className="truncate max-w-72" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
                  </div>
                  <span className="font-mono text-emerald-400 shrink-0 ml-4">${t.amount?.toFixed(2)}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="➕ Add Income Source" size="sm">
        <div className="space-y-4">
          <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)' }}>
            Look at your positive transactions to find the description pattern. Examples:
            <span className="block font-mono text-indigo-300 mt-1">NAV CANADA PAY · CANADA PAY · CHILD TAX BEN CCB</span>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Keyword</label>
            <input className="input font-mono" placeholder="e.g. EMPLOYER NAME"
              value={form.keyword} onChange={e => setForm(f => ({...f, keyword: e.target.value.toUpperCase()}))} autoFocus />
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Match type</label>
            <select className="select w-full" value={form.match_type} onChange={e => setForm(f => ({...f, match_type: e.target.value}))}>
              <option value="contains">Contains — matches anywhere (recommended)</option>
              <option value="exact">Exact match only</option>
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Notes (optional)</label>
            <input className="input" placeholder="e.g. Main salary" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Add Source</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('income');
  const tabs = [
    { id: 'income',     label: '💰 Income Sources' },
    { id: 'categories', label: '🏷️ Categories' },
    { id: 'rules',      label: '⚡ Rules Engine' },
  ];
  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>⚙️ Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Income sources, categories & categorization rules</p>
      </div>
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === t.id ? 'text-white shadow-sm' : 'hover:opacity-80'}`}
            style={{ background: activeTab === t.id ? 'var(--accent)' : 'transparent', color: activeTab === t.id ? 'white' : 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>
      <Card className="p-6">
        {activeTab === 'income'     && <IncomeSourcesTab />}
        {activeTab === 'categories' && <CategoriesTab />}
        {activeTab === 'rules'      && <RulesTab />}
      </Card>
    </div>
  );
}
