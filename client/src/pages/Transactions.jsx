// src/pages/Transactions.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, SplitSquareHorizontal, CheckSquare, Square,
  ChevronLeft, ChevronRight, Edit2, X, Calendar, Filter
} from 'lucide-react';
import { transactionsApi, categoriesApi } from '../utils/api';
import { formatCurrency, formatDate, amountClass } from '../utils/format';
import { Card, Badge, Modal, SectionHeader, EmptyState, Spinner } from '../components/ui';
import useAppStore from '../stores/appStore';

// ─── Date Range Picker ─────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'This month',    preset: 'this_month' },
  { label: 'Last month',    preset: 'last_month' },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'This year',     preset: 'this_year' },
  { label: 'Last year',     preset: 'last_year' },
  { label: 'All time',      preset: 'all' },
];

function getPresetDates(preset, days) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (days) {
    const s = new Date(now); s.setDate(s.getDate() - days);
    return { start: fmt(s), end: fmt(now) };
  }
  switch (preset) {
    case 'this_month': return { start: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, end: fmt(now) };
    case 'last_month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: fmt(d), end: fmt(e) };
    }
    case 'this_year': return { start: `${now.getFullYear()}-01-01`, end: fmt(now) };
    case 'last_year': return { start: `${now.getFullYear()-1}-01-01`, end: `${now.getFullYear()-1}-12-31` };
    case 'all': return { start: '2000-01-01', end: fmt(now) };
    default: return { start: '', end: '' };
  }
}

function DateRangePicker({ startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = startDate && endDate ? `${startDate} → ${endDate}` : startDate ? `From ${startDate}` : 'All dates';
  const isActive = !!(startDate || endDate);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
        style={{
          background: isActive ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${isActive ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
          color: isActive ? '#a5b4fc' : '#94a3b8'
        }}>
        <Calendar size={13} />
        <span className="max-w-48 truncate text-xs">{label}</span>
        {isActive && <X size={12} onClick={e => { e.stopPropagation(); onChange('', ''); }} className="hover:text-white" />}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl p-4 min-w-72 animate-slide-up"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(99,102,241,0.3)' }}>
          <p className="section-title mb-2">Quick select</p>
          <div className="grid grid-cols-2 gap-1 mb-4">
            {PRESETS.map(p => (
              <button key={p.label}
                onClick={() => { const d = getPresetDates(p.preset, p.days); onChange(d.start, d.end); setOpen(false); }}
                className="px-2 py-1.5 rounded-lg text-xs text-left text-slate-300 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)' }}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="section-title mb-2">Custom range</p>
          <div className="flex items-center gap-2">
            <input type="date" className="input text-xs flex-1" value={startDate}
              onChange={e => onChange(e.target.value, endDate)} />
            <span className="text-slate-600 text-xs">to</span>
            <input type="date" className="input text-xs flex-1" value={endDate}
              onChange={e => onChange(startDate, e.target.value)} />
          </div>
          <button className="btn-primary w-full mt-3 text-xs" onClick={() => setOpen(false)}>Apply</button>
        </div>
      )}
    </div>
  );
}

// ─── Merchant Autocomplete ─────────────────────────────────────────────────────
function MerchantSearch({ value, onChange, startDate, endDate }) {
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const timer = useRef();

  useEffect(() => {
    clearTimeout(timer.current);
    if (!value || value.length < 2) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: value });
        if (startDate) params.set('start_date', startDate);
        if (endDate)   params.set('end_date', endDate);
        const res = await fetch(`/api/analytics/merchant-search?${params}`);
        setSuggestions(await res.json());
      } catch {}
    }, 250);
    return () => clearTimeout(timer.current);
  }, [value, startDate, endDate]);

  return (
    <div className="relative flex-1 min-w-52">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
      <input className="input pl-8 pr-7"
        placeholder="Search merchant or description..."
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {value && (
        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          onClick={() => { onChange(''); setSuggestions([]); }}>
          <X size={13} />
        </button>
      )}
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden animate-slide-up"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(99,102,241,0.3)' }}>
          {suggestions.map((s, i) => (
            <button key={i} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors border-b last:border-0"
              style={{ borderColor: 'var(--border)' }}
              onMouseDown={() => { onChange(s.description); setSuggestions([]); }}>
              <div>
                <p className="text-xs text-slate-200 truncate max-w-56">{s.description}</p>
                <p className="text-xs text-slate-600">{s.count} transactions · {s.first_seen} to {s.last_seen}</p>
              </div>
              <span className="text-xs font-mono text-rose-400 shrink-0 ml-2">{formatCurrency(s.total)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Summary Bar ────────────────────────────────────────────────────────
function FilterSummary({ transactions, filterType }) {
  if (!transactions.length) return null;

  const expenses   = transactions.filter(t => t.amount < 0);
  const income     = transactions.filter(t => t.amount > 0);
  const totalExp   = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalInc   = income.reduce((s, t) => s + t.amount, 0);

  const dates = transactions.map(t => t.date).sort();
  const first = new Date(dates[0] + 'T00:00:00');
  const last  = new Date(dates[dates.length - 1] + 'T00:00:00');
  const monthsSpanned = Math.max(1,
    (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth()) + 1
  );
  const monthlyAvg = filterType === 'income' ? totalInc / monthsSpanned : totalExp / monthsSpanned;
  const isIncome = filterType === 'income' || (totalInc > 0 && totalExp === 0);

  return (
    <div className="flex items-center gap-6 px-5 py-3 rounded-xl text-sm animate-slide-up"
      style={{ background: isIncome ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.08)',
               border: isIncome ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(99,102,241,0.2)' }}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">Transactions:</span>
        <span className="font-semibold text-slate-200">{transactions.length}</span>
      </div>
      {isIncome && totalInc > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Total income:</span>
            <span className="font-mono font-semibold text-emerald-400">{formatCurrency(totalInc)}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <span className="text-xs text-emerald-600">Monthly avg:</span>
            <span className="font-mono font-bold text-emerald-400">{formatCurrency(monthlyAvg)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Over:</span>
            <span className="text-xs text-slate-300">{monthsSpanned} month{monthsSpanned !== 1 ? 's' : ''}</span>
            <span className="text-xs text-slate-600">({formatDate(dates[0])} → {formatDate(dates[dates.length - 1])})</span>
          </div>
        </>
      )}
      {!isIncome && totalExp > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Total spent:</span>
            <span className="font-mono font-semibold text-rose-400">{formatCurrency(totalExp)}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <span className="text-xs text-amber-500">Monthly avg:</span>
            <span className="font-mono font-bold text-amber-400">{formatCurrency(monthlyAvg)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Over:</span>
            <span className="text-xs text-slate-300">{monthsSpanned} month{monthsSpanned !== 1 ? 's' : ''}</span>
            <span className="text-xs text-slate-600">({formatDate(dates[0])} → {formatDate(dates[dates.length - 1])})</span>
          </div>
        </>
      )}
      {!isIncome && totalInc > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Income/refunds:</span>
          <span className="font-mono font-semibold text-emerald-400">{formatCurrency(totalInc)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Split Modal ───────────────────────────────────────────────────────────────
function SplitModal({ open, onClose, transaction, categories, onSave }) {
  const [splits, setSplits] = useState([]);
  const total = transaction ? Math.abs(transaction.amount) : 0;
  const splitSum = splits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0);
  const diff = Math.abs(total - splitSum);

  useEffect(() => {
    if (transaction) setSplits([
      { category_id: transaction.category_id || '', amount: Math.abs(transaction.amount), notes: '' },
      { category_id: '', amount: 0, notes: '' },
    ]);
  }, [transaction]);

  const add    = () => setSplits(s => [...s, { category_id: '', amount: 0, notes: '' }]);
  const remove = (i) => setSplits(s => s.filter((_, idx) => idx !== i));
  const update = (i, f, v) => setSplits(s => s.map((sp, idx) => idx === i ? { ...sp, [f]: v } : sp));

  return (
    <Modal open={open} onClose={onClose} title="Split Transaction" size="md">
      {transaction && (
        <div>
          <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            <p className="text-sm text-slate-300">{transaction.description}</p>
            <p className="font-mono text-base font-semibold text-rose-400 mt-1">{formatCurrency(Math.abs(transaction.amount))}</p>
          </div>
          <div className="space-y-3 mb-4">
            {splits.map((sp, i) => (
              <div key={i} className="grid grid-cols-5 gap-2">
                <select className="select col-span-2" value={sp.category_id} onChange={e => update(i, 'category_id', e.target.value)}>
                  <option value="">Category...</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input type="number" className="input col-span-1" placeholder="Amount"
                  value={sp.amount} onChange={e => update(i, 'amount', e.target.value)} min="0" step="0.01" />
                <input type="text" className="input col-span-1" placeholder="Notes"
                  value={sp.notes} onChange={e => update(i, 'notes', e.target.value)} />
                <button onClick={() => remove(i)} className="btn-danger text-xs">✕</button>
              </div>
            ))}
          </div>
          <button onClick={add} className="btn-ghost text-xs mb-4">+ Add split</button>
          <div className="flex items-center justify-between">
            <span className={`text-sm ${diff > 0.01 ? 'text-red-400' : 'text-emerald-400'}`}>
              {diff > 0.01 ? `Difference: ${formatCurrency(diff)}` : '✓ Balanced'}
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={async () => { if (diff > 0.01) return; await onSave(splits); onClose(); }}
                disabled={diff > 0.01}>Save Split</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ open, onClose, transaction, categories, onSave }) {
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (transaction) {
      setCategoryId(transaction.category_id || '');
      setNotes(transaction.notes || '');
      setTags((transaction.tags || []).join(', '));
    }
  }, [transaction]);

  return (
    <Modal open={open} onClose={onClose} title="Edit Transaction" size="sm">
      {transaction && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="text-xs text-slate-500 mb-1">{formatDate(transaction.date)}</p>
            <p className="text-sm text-slate-200">{transaction.description}</p>
            <p className={`font-mono text-sm font-semibold mt-1 ${amountClass(transaction.amount)}`}>
              {formatCurrency(transaction.amount)}
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Category</label>
            <select className="select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Notes</label>
            <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Tags (comma-separated)</label>
            <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="vacation, work..." />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={async () => {
              await onSave({ category_id: categoryId || null, notes,
                tags: tags.split(',').map(t => t.trim()).filter(Boolean), reviewed: true });
              onClose();
            }}>Save</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Transactions() {
  const { showToast } = useAppStore();
  const accounts = useAppStore(s => s.accounts);
  const [searchParams] = useSearchParams();

  const [transactions, setTransactions] = useState([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);

  // Compute initial dates from URL params synchronously (avoids race conditions)
  const initDates = () => {
    const sd = searchParams.get('start_date');
    const ed = searchParams.get('end_date');
    const m  = searchParams.get('month');
    if (sd) return { start: sd, end: ed || '' };
    if (m) {
      const [y, mo] = m.split('-').map(Number);
      const last = new Date(y, mo, 0).getDate();
      return { start: `${m}-01`, end: `${m}-${String(last).padStart(2,'0')}` };
    }
    return { start: '', end: '' };
  };
  const _initD = initDates();

  const [page, setPage]                   = useState(1);
  const [search, setSearch]               = useState(searchParams.get('search') || '');
  const [filterCategory, setFilterCategory] = useState(
    searchParams.get('category_id') && searchParams.get('category_id') !== 'null'
      ? searchParams.get('category_id') : ''
  );
  const [filterAccount, setFilterAccount] = useState(searchParams.get('account_id') || '');
  const [filterType, setFilterType]       = useState(searchParams.get('type') || '');
  const [startDate, setStartDate]         = useState(_initD.start);
  const [endDate, setEndDate]             = useState(_initD.end);
  const [showUncategorized, setShowUncategorized] = useState(
    searchParams.get('uncategorized') === 'true' || searchParams.get('category_id') === 'null'
  );
  const [sort, setSort]         = useState('date');
  const [order, setOrder]       = useState('desc');
  const [amountSearch, setAmountSearch] = useState('');  // live amount filter

  const [selected, setSelected]     = useState(new Set());
  const [splitTx, setSplitTx]       = useState(null);
  const [editTx, setEditTx]         = useState(null);
  const [bulkCategory, setBulkCategory] = useState('');

  const hasFilters = search || filterCategory || filterAccount || startDate || endDate || showUncategorized || filterType || amountSearch;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 200, sort, order };
      if (search)            params.search = search;
      if (filterAccount)     params.account_id = filterAccount;
      if (startDate)         params.start_date = startDate;
      if (endDate)           params.end_date = endDate;
      if (showUncategorized) params.uncategorized = true;
      else if (filterCategory) params.category_id = filterCategory;

      // Pass type filter to server (income uses income_sources, expense excludes income cats)
      if (filterType) params.type = filterType;
      if (amountSearch) params.amount_search = amountSearch;

      const res = await transactionsApi.list(params);
      const txs = res.data.transactions;

      setTransactions(txs);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } finally { setLoading(false); }
  }, [page, search, filterCategory, filterAccount, startDate, endDate, showUncategorized, filterType, sort, order, amountSearch]);

  useEffect(() => { setPage(1); setSelected(new Set()); },
    [search, filterCategory, filterAccount, startDate, endDate, showUncategorized, filterType, amountSearch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { categoriesApi.list().then(r => setCategories(r.data)); }, []);

  const setDateRange = (s, e) => { setStartDate(s); setEndDate(e); };
  const clearFilters = () => {
    setSearch(''); setFilterCategory(''); setFilterAccount('');
    setStartDate(''); setEndDate(''); setShowUncategorized(false); setFilterType('');
    setAmountSearch('');
  };

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected(
    selected.size === transactions.length ? new Set() : new Set(transactions.map(t => t.id))
  );

  const handleIncomeOverride = async (tx, value) => {
    await transactionsApi.update(tx.id, { is_income_override: value });
    showToast(value ? `Marked as income: ${tx.description}` : 'Income tag removed');
    load();
  };

  const handleBulkUpdate = async () => {
    await transactionsApi.bulk({ ids: [...selected], category_id: bulkCategory || null });
    setSelected(new Set()); setBulkCategory(''); load();
    showToast(`✅ Updated ${selected.size} transactions`);
  };

  const handleBulkIncome = async (value) => {
    const count = selected.size;
    // Use individual PATCH since bulk endpoint doesn't have income_override yet
    await Promise.all([...selected].map(id => transactionsApi.update(id, { is_income_override: value })));
    setSelected(new Set()); load();
    showToast(value ? `💰 Marked ${count} transactions as income` : `Removed income tag from ${count} transactions`);
  };

  const handleSort = (col) => {
    if (sort === col) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setOrder('desc'); }
  };

  const SortArrow = ({ col }) => sort === col
    ? <span className="text-indigo-400 ml-0.5">{order === 'asc' ? '↑' : '↓'}</span>
    : null;

  const rowTotal = transactions.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Transactions" subtitle={`${total.toLocaleString()} matching records`} />

      {/* ── Filter Bar ── */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MerchantSearch value={search} onChange={setSearch} startDate={startDate} endDate={endDate} />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">$</span>
            <input
              className="input pl-7 w-32 font-mono"
              placeholder="amount..."
              value={amountSearch}
              onChange={e => setAmountSearch(e.target.value.replace(/[^0-9.]/g, ''))}
              title="Filter by amount (e.g. 432 shows $432.xx)"
            />
          </div>
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={setDateRange} />
          <select className="select w-44" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="select w-32" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All types</option>
            <option value="expense">Expenses only</option>
            <option value="income">Income only</option>
          </select>
          {hasFilters && (
            <button className="btn-ghost text-xs text-slate-500 flex items-center gap-1" onClick={clearFilters}>
              <X size={12} /> Clear all
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={12} className="text-slate-600" />
            <select className="select w-52" value={filterCategory}
              onChange={e => { setFilterCategory(e.target.value); setShowUncategorized(false); }}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={showUncategorized}
              onChange={e => { setShowUncategorized(e.target.checked); setFilterCategory(''); }} />
            Uncategorized only
          </label>

          {/* Year quick-jump buttons */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-slate-600 mr-1">Jump to year:</span>
            {[2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(y => (
              <button key={y}
                onClick={() => setDateRange(`${y}-01-01`, `${y}-12-31`)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  startDate === `${y}-01-01` && endDate === `${y}-12-31`
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
                }`}>{y}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Summary Stats ── */}
      {hasFilters && <FilterSummary transactions={transactions} filterType={filterType} />}

      {/* ── Bulk Action Bar ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl animate-slide-up flex-wrap"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
          <span className="text-sm font-semibold text-indigo-300">{selected.size} selected</span>
          <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
          <select className="select text-xs w-48" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>
            <option value="">Assign category…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-primary text-xs" onClick={handleBulkUpdate}>Apply category</button>
          <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
          <button
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5"
            style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}
            onClick={() => handleBulkIncome(true)}
            title="Mark all selected transactions as income">
            💰 Mark as income
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            onClick={() => handleBulkIncome(false)}>
            Remove income tag
          </button>
          <button className="btn-ghost text-xs ml-auto" onClick={() => setSelected(new Set())}>✕ Clear</button>
        </div>
      )}

      {/* ── Table ── */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>
        ) : transactions.length === 0 ? (
          <EmptyState icon={Search} title="No transactions found" description="Try adjusting your filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="w-10 px-4 py-3">
                    <button onClick={toggleAll} className="text-slate-500 hover:text-slate-300">
                      {selected.size === transactions.length && transactions.length > 0
                        ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left section-title w-24 cursor-pointer hover:text-slate-300" onClick={() => handleSort('date')}>
                    Date <SortArrow col="date" />
                  </th>
                  <th className="px-4 py-3 text-left section-title cursor-pointer hover:text-slate-300" onClick={() => handleSort('description')}>
                    Description <SortArrow col="description" />
                  </th>
                  <th className="px-4 py-3 text-left section-title w-36">Account</th>
                  <th className="px-4 py-3 text-left section-title w-40">Category</th>
                  <th className="px-4 py-3 text-right section-title w-28 cursor-pointer hover:text-slate-300" onClick={() => handleSort('amount')}>
                    Amount <SortArrow col="amount" />
                  </th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="table-row group" onClick={() => toggleSelect(tx.id)}>
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(tx.id); }}>
                      {selected.has(tx.id)
                        ? <CheckSquare size={15} className="text-indigo-400" />
                        : <Square size={15} className="text-slate-700 group-hover:text-slate-500" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{formatDate(tx.date)}</td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs">
                      <div className="flex items-center gap-2">
                        {tx.reviewed && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                        <span className="truncate">{tx.description}</span>
                        {tx.tags?.length > 0 && tx.tags.slice(0, 2).map(tag => <Badge key={tag} className="text-xs">{tag}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{tx.account_name}</td>
                    <td className="px-4 py-3">
                      {tx.category_name
                        ? <Badge color={tx.category_color}>{tx.category_name}</Badge>
                        : <span className="text-xs text-slate-600 italic">Uncategorized</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                      <div className="flex items-center justify-end gap-1.5">
                        {tx.is_income_override ? (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-sans font-normal">
                            ✦ income
                          </span>
                        ) : null}
                        <span className={amountClass(tx.amount)}>{formatCurrency(tx.amount, tx.currency)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className={`p-1 rounded text-xs transition-colors ${tx.is_income_override ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-600 hover:text-emerald-400'}`}
                          title={tx.is_income_override ? 'Remove income tag' : 'Mark as income'}
                          onClick={e => { e.stopPropagation(); handleIncomeOverride(tx, !tx.is_income_override); }}
                        >✦</button>
                        <button className="btn-ghost p-1" title="Edit"
                          onClick={e => { e.stopPropagation(); setEditTx(tx); }}><Edit2 size={13} /></button>
                        <button className="btn-ghost p-1" title="Split" disabled={tx.amount >= 0}
                          onClick={e => { e.stopPropagation(); setSplitTx(tx); }}><SplitSquareHorizontal size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={5} className="px-4 py-2.5 text-xs text-slate-600">
                    {transactions.length} of {total} shown
                    {total > 200 && <span className="ml-2 text-amber-500">· Showing first 200 — refine your filters for full results</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">
                    <span className={amountClass(rowTotal)}>{formatCurrency(rowTotal)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs text-slate-500">{total} total records</span>
            <div className="flex items-center gap-2">
              <button className="btn-ghost p-1" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-slate-400">Page {page} of {pages}</span>
              <button className="btn-ghost p-1" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Card>

      <SplitModal open={!!splitTx} onClose={() => setSplitTx(null)}
        transaction={splitTx} categories={categories}
        onSave={async (splits) => { await transactionsApi.split(splitTx.id, splits); load(); showToast('Split saved'); }} />
      <EditModal open={!!editTx} onClose={() => setEditTx(null)}
        transaction={editTx} categories={categories}
        onSave={async (data) => { await transactionsApi.update(editTx.id, data); load(); showToast('Updated'); }} />
    </div>
  );
}
