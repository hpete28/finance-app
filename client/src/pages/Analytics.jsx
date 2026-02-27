// src/pages/Analytics.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { analyticsApi, categoriesApi, transactionsApi } from '../utils/api';
import { formatCurrency, formatMonth, formatDate, amountClass } from '../utils/format';
import { Card, SectionHeader, EmptyState, Spinner, Badge, Modal } from '../components/ui';
import { BarChart2, TrendingDown, Calendar, ArrowRight, ChevronUp, ChevronDown, X, Edit2 } from 'lucide-react';
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import useAppStore from '../stores/appStore';

const COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#84cc16','#f97316'];
const TRAVEL_TAG_FILTER_OPTIONS = [
  '',
  'travel:airfare',
  'travel:hotel',
  'travel:dining',
  'travel:transport',
  'travel:groceries',
  'travel:other',
  'review:non_travel_candidate',
];

const PRESETS = [
  { label: 'This month', preset: 'this_month' },
  { label: 'Last month', preset: 'last_month' },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'This year', preset: 'this_year' },
  { label: 'Last year', preset: 'last_year' },
  { label: 'All time', preset: 'all' },
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

function QuickRangePicker({ startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = startDate && endDate ? `${startDate} → ${endDate}` : startDate ? `From ${startDate}` : 'All dates';

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="btn-secondary text-xs flex items-center gap-1.5">
        <Calendar size={12} /> {label}
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
            <input type="date" className="input text-xs flex-1" value={startDate} onChange={e => onChange(e.target.value, endDate)} />
            <span className="text-slate-600 text-xs">to</span>
            <input type="date" className="input text-xs flex-1" value={endDate} onChange={e => onChange(startDate, e.target.value)} />
          </div>
          <button className="btn-primary w-full mt-3 text-xs" onClick={() => setOpen(false)}>Apply</button>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-2xl" style={{ border: '1px solid rgba(99,102,241,0.3)' }}>
      <p className="text-slate-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>)}
    </div>
  );
}

// ─── Inline Transaction Panel (shown below a chart when a bar is clicked) ──────
function TransactionPanel({ month, categoryId, categoryName, startDate, endDate, tag, onClose }) {
  const { showToast } = useAppStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [editTx, setEditTx] = useState(null);
  const [categories, setCategories] = useState([]);
  const [editCatId, setEditCatId] = useState('');
  const panelRef = useRef();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ sort, order });
    if (month)      params.set('month', month);
    if (startDate)  params.set('start_date', startDate);
    if (endDate)    params.set('end_date', endDate);
    if (tag)        params.set('tag', tag);
    if (categoryId !== undefined) params.set('category_id', categoryId === null ? 'null' : String(categoryId));

    fetch(`/api/analytics/month-transactions?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [month, categoryId, startDate, endDate, tag, sort, order]);

  useEffect(() => {
    categoriesApi.list().then(r => setCategories(r.data));
  }, []);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [month, categoryId]);

  const handleSort = (col) => {
    if (sort === col) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setOrder('desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sort !== col) return null;
    return order === 'asc' ? <ChevronUp size={12} className="inline ml-0.5 text-indigo-400" /> : <ChevronDown size={12} className="inline ml-0.5 text-indigo-400" />;
  };

  const handleUpdateCategory = async (txId, catId) => {
    await transactionsApi.update(txId, { category_id: catId || null, reviewed: true });
    // Refresh
    setLoading(true);
    const params = new URLSearchParams({ sort, order });
    if (month)      params.set('month', month);
    if (startDate)  params.set('start_date', startDate);
    if (endDate)    params.set('end_date', endDate);
    if (tag)        params.set('tag', tag);
    if (categoryId !== undefined) params.set('category_id', categoryId === null ? 'null' : String(categoryId));
    fetch(`/api/analytics/month-transactions?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
    showToast('Category updated');
    setEditTx(null);
  };

  const label = month ? formatMonth(month) : (startDate && endDate ? `${startDate} → ${endDate}` : 'Selected period');

  return (
    <div ref={panelRef} className="card animate-slide-up overflow-hidden"
      style={{ border: '1px solid rgba(99,102,241,0.35)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b"
        style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}>
        <div>
          <h3 className="font-semibold text-slate-200 text-sm">
            {categoryName || 'Transactions'} · {label}
          </h3>
          {data && !loading && (
            <p className="text-xs text-slate-500 mt-0.5">
              {data.count} transactions · Total: <span className="font-mono text-rose-400">{formatCurrency(data.total)}</span>
              {data.count > 0 && <span> · Avg: <span className="font-mono text-amber-400">{formatCurrency(data.total / data.count)}</span></span>}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-10"><Spinner size={24} /></div>
      ) : data?.transactions?.length === 0 ? (
        <EmptyState icon={BarChart2} title="No transactions found" />
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--bg-card)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="px-4 py-2.5 text-left section-title cursor-pointer hover:text-slate-300"
                  onClick={() => handleSort('date')}>Date <SortIcon col="date" /></th>
                <th className="px-4 py-2.5 text-left section-title cursor-pointer hover:text-slate-300"
                  onClick={() => handleSort('description')}>Description <SortIcon col="description" /></th>
                <th className="px-4 py-2.5 text-left section-title w-32">Account</th>
                <th className="px-4 py-2.5 text-left section-title w-36">Category</th>
                <th className="px-4 py-2.5 text-right section-title w-28 cursor-pointer hover:text-slate-300"
                  onClick={() => handleSort('amount')}>Amount <SortIcon col="amount" /></th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map(tx => (
                <tr key={tx.id} className="table-row group">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{formatDate(tx.date)}</td>
                  <td className="px-4 py-2.5 text-slate-200 max-w-xs">
                    <span className="truncate block">{tx.description}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{tx.account_name}</td>
                  <td className="px-4 py-2.5">
                    {editTx === tx.id ? (
                      <div className="flex items-center gap-1.5">
                        <select className="select text-xs py-1 w-36"
                          value={editCatId}
                          onChange={e => setEditCatId(e.target.value)}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button className="btn-primary text-xs px-2 py-1"
                          onClick={() => handleUpdateCategory(tx.id, editCatId)}>✓</button>
                        <button className="btn-ghost text-xs px-1.5 py-1"
                          onClick={() => setEditTx(null)}>✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {tx.category_name
                          ? <Badge color={tx.category_color}>{tx.category_name}</Badge>
                          : <span className="text-xs text-slate-600 italic">Uncategorized</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">
                    <span className={amountClass(tx.amount)}>{formatCurrency(tx.amount, tx.currency)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      title="Change category"
                      className="opacity-0 group-hover:opacity-100 btn-ghost p-1 transition-opacity"
                      onClick={() => { setEditTx(tx.id); setEditCatId(tx.category_id || ''); }}
                    >
                      <Edit2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={4} className="px-4 py-2 text-xs text-slate-600">{data.count} transactions</td>
                <td className="px-4 py-2 text-right font-mono text-sm font-semibold text-rose-400">
                  {formatCurrency(data.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Category Drill-Down ───────────────────────────────────────────────────────
function CategoryDrillDown({ tag }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(searchParams.get('cd_cat') || '');
  const [selectedCatName, setSelectedCatName] = useState('');
  const [startDate, setStartDate]     = useState(searchParams.get('cd_start') || '');
  const [endDate, setEndDate]         = useState(searchParams.get('cd_end') || '');
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [clickedBar, setClickedBar]   = useState(null); // { month, label }

  useEffect(() => {
    categoriesApi.list().then(r => setCategories(r.data));
  }, []);

  useEffect(() => {
    if (!selectedCat) return;
    setLoading(true);
    setClickedBar(null);
    const params = new URLSearchParams();
    params.set('category_id', selectedCat === 'uncategorized' ? 'null' : selectedCat);
    if (startDate) params.set('start_date', startDate);
    if (endDate)   params.set('end_date',   endDate);
    if (tag)       params.set('tag', tag);
    fetch(`/api/analytics/category-breakdown?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [selectedCat, startDate, endDate, tag]);

  const setYear = (y) => { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); };

  const handleBarClick = (barData) => {
    if (!barData?.activeLabel) return;
    const month = barData.activeLabel;
    if (clickedBar?.month === month) {
      setClickedBar(null); // toggle off
    } else {
      setClickedBar({ month, label: formatMonth(month) });
    }
  };

  const handleCatChange = (e) => {
    const val = e.target.value;
    setSelectedCat(val);
    const cat = categories.find(c => String(c.id) === val);
    setSelectedCatName(cat ? cat.name : val === 'uncategorized' ? 'Uncategorized' : '');
  };

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selectedCat) p.set('cd_cat', selectedCat); else p.delete('cd_cat');
    if (startDate) p.set('cd_start', startDate); else p.delete('cd_start');
    if (endDate) p.set('cd_end', endDate); else p.delete('cd_end');
    setSearchParams(p, { replace: true });
  }, [selectedCat, startDate, endDate, setSearchParams]);

  const goToFullTransactions = () => {
    const params = new URLSearchParams();
    if (selectedCat && selectedCat !== 'uncategorized') params.set('category_id', selectedCat);
    if (selectedCat === 'uncategorized') params.set('uncategorized', 'true');
    if (startDate) params.set('start_date', startDate);
    if (endDate)   params.set('end_date', endDate);
    if (tag)       params.set('tag', tag);
    navigate(`/transactions?${params}`);
  };

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select className="select w-56" value={selectedCat} onChange={handleCatChange}>
          <option value="">Select a category...</option>
          <option value="uncategorized">⬜ Uncategorized</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <QuickRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        <div className="flex items-center gap-1">
          {[2023,2024,2025,2026].map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                startDate === `${y}-01-01` && endDate === `${y}-12-31`
                  ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
              }`}>{y}</button>
          ))}
        </div>
        {selectedCat && data && (
          <button onClick={goToFullTransactions}
            className="btn-secondary text-xs flex items-center gap-1 ml-auto">
            View in Transactions <ArrowRight size={12} />
          </button>
        )}
      </div>

      {!selectedCat && (
        <EmptyState icon={BarChart2} title="Select a category"
          description="Pick any category or 'Uncategorized' to see its monthly trend and drill into specific months." />
      )}

      {loading && <div className="flex items-center justify-center py-12"><Spinner size={28} /></div>}

      {data && !loading && selectedCat && (
        <>
          {/* Summary stats — all clickable */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Spent',     value: formatCurrency(data.grandTotal), color: '#f43f5e', onClick: goToFullTransactions },
              { label: 'Monthly Average', value: formatCurrency(data.avg),        color: '#f59e0b', onClick: null },
              { label: 'Lowest Month',    value: formatCurrency(data.min),        color: '#10b981', onClick: null },
              { label: 'Highest Month',   value: formatCurrency(data.max),        color: '#f43f5e', onClick: null },
            ].map((s, i) => (
              <div key={i}
                onClick={s.onClick}
                className={`card p-4 ${s.onClick ? 'cursor-pointer hover:scale-[1.02] transition-all duration-150 group' : ''}`}
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</span>
                  {s.onClick && <ArrowRight size={12} className="text-slate-600 group-hover:text-slate-400" />}
                </div>
                <div className="font-mono text-xl font-semibold" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Bar chart — click a bar to show transactions below */}
          <Card className="p-5">
            <SectionHeader
              title="Month by Month"
              subtitle={`${data.monthly.length} months · Click any bar to see its transactions below`}
            />
            {data.monthly.length === 0 ? (
              <EmptyState icon={BarChart2} title="No data for this period" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.monthly} barCategoryGap="20%"
                  onClick={handleBarClick}
                  style={{ cursor: 'pointer' }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={m => m.slice(5)} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `$${(v/1000).toFixed(1)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={data.avg} stroke="#f59e0b" strokeDasharray="4 4"
                    label={{ value: `Avg`, fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
                  <Bar dataKey="total" name="Spent" radius={[3,3,0,0]}
                    onClick={(entry) => {
                      const m = entry.month;
                      setClickedBar(prev => prev?.month === m ? null : { month: m, label: formatMonth(m) });
                    }}>
                    {data.monthly.map((entry, i) => (
                      <Cell key={i}
                        fill={clickedBar?.month === entry.month ? '#ffffff'
                          : entry.total > data.avg ? '#f43f5e' : '#6366f1'}
                        opacity={clickedBar && clickedBar.month !== entry.month ? 0.4 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {data.monthly.length > 0 && (
              <p className="text-xs text-slate-600 mt-1">
                🔴 Above average · 🔵 Below average · ━ Monthly average · <strong>Click a bar</strong> to inspect its transactions
              </p>
            )}
          </Card>

          {/* Transaction panel appears when a bar is clicked */}
          {clickedBar && (
            <TransactionPanel
              month={clickedBar.month}
              categoryId={selectedCat === 'uncategorized' ? null : parseInt(selectedCat)}
              categoryName={`${selectedCatName} — ${clickedBar.label}`}
              tag={tag}
              onClose={() => setClickedBar(null)}
            />
          )}

          {/* Monthly table + Top merchants */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-5">
              <SectionHeader title="Monthly Detail" />
              <div className="space-y-0.5 max-h-80 overflow-y-auto">
                {data.monthly.slice().reverse().map(m => {
                  const pct = data.avg > 0 ? (m.total / data.avg) * 100 : 0;
                  const isAbove = m.total > data.avg;
                  return (
                    <button key={m.month}
                      onClick={() => setClickedBar(prev => prev?.month === m.month ? null : { month: m.month, label: formatMonth(m.month) })}
                      className={`w-full flex items-center justify-between py-2 px-2 rounded-lg border transition-all text-left ${
                        clickedBar?.month === m.month
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-transparent hover:bg-white/5'
                      }`}>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-400 w-14">{m.month}</span>
                        <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${Math.min((m.total / (data.max || 1)) * 100, 100)}%`,
                            background: isAbove ? '#f43f5e' : '#6366f1'
                          }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`font-mono text-xs font-semibold ${isAbove ? 'text-rose-400' : 'text-indigo-300'}`}>
                          {formatCurrency(m.total)}
                        </span>
                        <span className={`text-xs ml-2 ${isAbove ? 'text-rose-600' : 'text-slate-600'}`}>
                          {isAbove ? '+' : ''}{(pct - 100).toFixed(0)}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-3 border-t mt-1" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs text-slate-500">Monthly average</span>
                <span className="font-mono text-sm font-bold text-amber-400">{formatCurrency(data.avg)}</span>
              </div>
            </Card>

            <Card className="p-5">
              <SectionHeader title="Top Merchants" subtitle="In this category · period" />
              <div className="space-y-2.5 max-h-80 overflow-y-auto">
                {data.merchants.length === 0 ? (
                  <p className="text-sm text-slate-600 text-center py-4">No data</p>
                ) : data.merchants.map((m, i) => {
                  const pct = data.grandTotal > 0 ? (m.total / data.grandTotal) * 100 : 0;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 truncate max-w-40">{m.description}</span>
                        <div className="shrink-0 ml-2 text-right">
                          <span className="font-mono text-rose-400">{formatCurrency(m.total)}</span>
                          <span className="text-slate-600 ml-1.5">×{m.count}</span>
                        </div>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(pct * 3, 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Year Summary ──────────────────────────────────────────────────────────────
function YearSummary() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/year-summary?year=${year}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [year]);

  const years = Array.from({ length: 8 }, (_, i) => currentYear - i).reverse();

  const goCategory = (catId) => {
    navigate(`/transactions?start_date=${year}-01-01&end_date=${year}-12-31${catId ? `&category_id=${catId}` : '&uncategorized=true'}&type=expense`);
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`px-3 py-1.5 rounded-lg text-sm font-mono font-medium transition-all ${
              year === y ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
            style={{ background: year === y ? undefined : 'rgba(255,255,255,0.04)' }}>
            {y}
          </button>
        ))}
      </div>

      {loading && <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Income',   value: formatCurrency(data.totals?.total_income),   color: 'text-emerald-400', params: `start_date=${year}-01-01&end_date=${year}-12-31&type=income` },
              { label: 'Total Expenses', value: formatCurrency(data.totals?.total_expenses),  color: 'text-rose-400',    params: `start_date=${year}-01-01&end_date=${year}-12-31&type=expense` },
              { label: 'Net Savings',
                value: formatCurrency((data.totals?.total_income||0) - (data.totals?.total_expenses||0)),
                color: (data.totals?.total_income||0) >= (data.totals?.total_expenses||0) ? 'text-emerald-400' : 'text-rose-400',
                params: `start_date=${year}-01-01&end_date=${year}-12-31` },
            ].map((s, i) => (
              <div key={i} onClick={() => navigate(`/transactions?${s.params}`)}
                className="card p-5 cursor-pointer hover:scale-[1.01] transition-all group"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="section-title">{s.label}</span>
                  <ArrowRight size={12} className="text-slate-600 group-hover:text-slate-400" />
                </div>
                <div className={`font-mono text-2xl font-semibold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <Card className="p-5">
            <SectionHeader title={`${year} Monthly Overview`} />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.monthly} barCategoryGap="25%"
                onClick={d => d?.activeLabel && navigate(`/transactions?month=${d.activeLabel}`)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={m => m.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                <Bar dataKey="income"   name="Income"   fill="#10b981" radius={[3,3,0,0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-600 mt-1">Click any bar to view those transactions</p>
          </Card>

          {/* Category breakdown — clickable rows */}
          <Card className="p-5">
            <SectionHeader title={`${year} Spending by Category`}
              subtitle={`${formatCurrency(data.totals?.total_expenses)} total · Click row to see transactions`} />
            <div className="space-y-3">
              {data.byCategory?.map((cat, i) => {
                const pct = data.totals?.total_expenses > 0 ? (cat.total / data.totals.total_expenses) * 100 : 0;
                return (
                  <button key={i} onClick={() => goCategory(cat.category_id)}
                    className="w-full grid grid-cols-12 items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors -mx-2 group">
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
                      <span className="text-xs text-slate-300 truncate">{cat.category}</span>
                    </div>
                    <div className="col-span-5 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cat.color }} />
                    </div>
                    <div className="col-span-2 text-right font-mono text-xs text-rose-400">{formatCurrency(cat.total)}</div>
                    <div className="col-span-1 text-right text-xs text-slate-600">{pct.toFixed(1)}%</div>
                    <div className="col-span-1 text-right text-xs text-amber-500">{formatCurrency(cat.monthly_avg)}<span className="text-slate-600">/mo</span></div>
                  </button>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Monthly Breakdown ─────────────────────────────────────────────────────────
function MonthlyBreakdown({ month, tag }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData]     = useState([]);
  const [view, setView]     = useState('bar');
  const [startDate, setStartDate] = useState(searchParams.get('mb_start') || '');
  const [endDate, setEndDate] = useState(searchParams.get('mb_end') || '');

  useEffect(() => {
    const params = startDate || endDate
      ? { start_date: startDate || undefined, end_date: endDate || undefined }
      : { month };
    if (tag) params.tag = tag;
    analyticsApi.spendingByCategory(params).then(r => setData(r.data));
  }, [month, startDate, endDate, tag]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (startDate) p.set('mb_start', startDate); else p.delete('mb_start');
    if (endDate) p.set('mb_end', endDate); else p.delete('mb_end');
    setSearchParams(p, { replace: true });
  }, [startDate, endDate, setSearchParams]);

  if (!data.length) return <EmptyState icon={BarChart2} title="No spending data" />;

  const rangeQuery = startDate || endDate
    ? `${startDate ? `&start_date=${startDate}` : ''}${endDate ? `&end_date=${endDate}` : ''}`
    : `&month=${month}`;
  const goCat = (catId) => navigate(`/transactions?type=expense${rangeQuery}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${catId ? `&category_id=${catId}` : '&uncategorized=true'}`);
  const showingLabel = startDate || endDate
    ? `${startDate || '…'} → ${endDate || '…'}`
    : formatMonth(month);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-400">{showingLabel} · {formatCurrency(data.reduce((s,d)=>s+d.total,0))} total</p>
          <QuickRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        </div>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          {['bar','pie'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${v === view ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'bar' ? (
        <div className="space-y-2.5">
          {data.slice(0, 15).map((d, i) => {
            const pct = data[0]?.total > 0 ? (d.total / data[0].total) * 100 : 0;
            return (
              <button key={i} onClick={() => goCat(d.category_id)}
                className="w-full grid grid-cols-12 items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors -mx-2 group text-left">
                <div className="col-span-3 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color || COLORS[i % COLORS.length] }} />
                  <span className="text-xs text-slate-300 truncate">{d.category}</span>
                </div>
                <div className="col-span-6 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color || COLORS[i % COLORS.length] }} />
                </div>
                <div className="col-span-2 text-right font-mono text-xs text-rose-400">{formatCurrency(d.total)}</div>
                <div className="col-span-1 text-right">
                  <ArrowRight size={11} className="text-slate-600 group-hover:text-slate-400 inline" />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-4 items-center">
          <ResponsiveContainer width="50%" height={280}>
            <PieChart>
              <Pie data={data} dataKey="total" nameKey="category" cx="50%" cy="50%"
                outerRadius={100} innerRadius={50}
                onClick={d => goCat(d.category_id)} className="cursor-pointer">
                {data.map((_, i) => <Cell key={i} fill={_.color || COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2 text-xs">
            {data.slice(0, 10).map((d, i) => (
              <button key={i} onClick={() => goCat(d.category_id)}
                className="w-full flex items-center justify-between hover:bg-white/5 rounded px-1 py-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color || COLORS[i % COLORS.length] }} />
                  <span className="text-slate-300 truncate max-w-32">{d.category}</span>
                </div>
                <span className="font-mono text-slate-400">{formatCurrency(d.total)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cash Flow ─────────────────────────────────────────────────────────────────
function CashFlow({ tag }) {
  const [data, setData] = useState([]);
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().split('T')[0]; });
  const [endDate, setEndDate]     = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    analyticsApi.cashflow({ start_date: startDate, end_date: endDate, tag: tag || undefined }).then(r => setData(r.data));
  }, [startDate, endDate, tag]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <input type="date" className="input w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span className="text-slate-500 text-sm">to</span>
        <input type="date" className="input w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />
        {[3,6,12].map(m => (
          <button key={m} className="btn-secondary text-xs" onClick={() => {
            const d = new Date(); d.setMonth(d.getMonth()-m);
            setStartDate(d.toISOString().split('T')[0]);
            setEndDate(new Date().toISOString().split('T')[0]);
          }}>{m}mo</button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="runGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false}
            tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
            tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
          <Area type="monotone" dataKey="running_total" name="Running Balance" stroke="#6366f1"
            fill="url(#runGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Top Merchants ─────────────────────────────────────────────────────────────
const TOP_MERCHANT_PRESETS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' },
  { id: 'last_6_months', label: 'Last 6 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom' },
];

const TOP_MERCHANT_PRESET_LABELS = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  last_6_months: 'Last 6 months',
  ytd: 'Year to date',
  custom: 'Custom range',
  month: 'Month',
};

const TOP_MERCHANT_PRESET_IDS = new Set([
  'this_month', 'last_month', 'last_3_months', 'last_6_months', 'ytd', 'custom', 'month'
]);

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function isIsoMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function currentIsoMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function getMonthBounds(month) {
  if (!isIsoMonth(month)) return null;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad2(lastDay)}` };
}

function isValidDateRange(start, end) {
  return isIsoDate(start) && isIsoDate(end) && start <= end;
}

function getTopMerchantsPresetRange(preset) {
  const now = new Date();
  const today = toIsoDate(now);

  switch (preset) {
    case 'this_month':
      return { start: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, end: today };
    case 'last_month': {
      const y = now.getFullYear();
      const m = now.getMonth();
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return { start: toIsoDate(start), end: toIsoDate(end) };
    }
    case 'last_3_months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { start: toIsoDate(start), end: today };
    }
    case 'last_6_months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      return { start: toIsoDate(start), end: today };
    }
    case 'ytd':
      return { start: `${now.getFullYear()}-01-01`, end: today };
    default:
      return null;
  }
}

function buildInitialTopMerchantsState(searchParams, selectedMonth) {
  const rawPreset = searchParams.get('merch_preset');
  const rawMonth = searchParams.get('merch_month');
  const rawStart = searchParams.get('merch_start');
  const rawEnd = searchParams.get('merch_end');
  const safeMonth = isIsoMonth(selectedMonth) ? selectedMonth : currentIsoMonth();
  const month = isIsoMonth(rawMonth) ? rawMonth : safeMonth;
  const hasValidCustom = isValidDateRange(rawStart, rawEnd);

  if (hasValidCustom) {
    return {
      preset: 'custom',
      month,
      customStartInput: rawStart,
      customEndInput: rawEnd,
      appliedCustomStart: rawStart,
      appliedCustomEnd: rawEnd,
    };
  }

  const preset = TOP_MERCHANT_PRESET_IDS.has(rawPreset) ? rawPreset : null;
  if (preset) {
    const seedRange = preset === 'month'
      ? getMonthBounds(month)
      : preset === 'custom'
        ? getMonthBounds(month)
        : getTopMerchantsPresetRange(preset);
    return {
      preset,
      month,
      customStartInput: seedRange?.start || '',
      customEndInput: seedRange?.end || '',
      appliedCustomStart: seedRange?.start || '',
      appliedCustomEnd: seedRange?.end || '',
    };
  }

  if (isIsoMonth(rawMonth)) {
    const seedRange = getMonthBounds(month);
    return {
      preset: 'month',
      month,
      customStartInput: seedRange?.start || '',
      customEndInput: seedRange?.end || '',
      appliedCustomStart: seedRange?.start || '',
      appliedCustomEnd: seedRange?.end || '',
    };
  }

  const defaultRange = getMonthBounds(safeMonth);
  return {
    preset: 'month',
    month: safeMonth,
    customStartInput: defaultRange?.start || '',
    customEndInput: defaultRange?.end || '',
    appliedCustomStart: defaultRange?.start || '',
    appliedCustomEnd: defaultRange?.end || '',
  };
}

function TopMerchants({ tag }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedMonth } = useAppStore();
  const [initialState] = useState(() => buildInitialTopMerchantsState(searchParams, selectedMonth));

  const [preset, setPreset] = useState(initialState.preset);
  const [month, setMonth] = useState(initialState.month);
  const [customStartInput, setCustomStartInput] = useState(initialState.customStartInput);
  const [customEndInput, setCustomEndInput] = useState(initialState.customEndInput);
  const [appliedCustomStart, setAppliedCustomStart] = useState(initialState.appliedCustomStart);
  const [appliedCustomEnd, setAppliedCustomEnd] = useState(initialState.appliedCustomEnd);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  const customAppliedRange = isValidDateRange(appliedCustomStart, appliedCustomEnd)
    ? { start: appliedCustomStart, end: appliedCustomEnd }
    : null;

  let appliedRange = null;
  if (preset === 'month') appliedRange = getMonthBounds(month);
  else if (preset === 'custom') appliedRange = customAppliedRange;
  else appliedRange = getTopMerchantsPresetRange(preset);

  const appliedStart = appliedRange?.start || '';
  const appliedEnd = appliedRange?.end || '';
  const hasAppliedRange = !!(appliedStart && appliedEnd);
  const customRangeValid = isValidDateRange(customStartInput, customEndInput);
  const customHasChanges = customStartInput !== appliedCustomStart || customEndInput !== appliedCustomEnd;
  const showCustomRangeError = preset === 'custom' && customStartInput && customEndInput && customStartInput > customEndInput;
  const appliedModeLabel = TOP_MERCHANT_PRESET_LABELS[preset] || 'Custom range';
  const appliedRangeLabel = hasAppliedRange
    ? `${formatDate(appliedStart)} -> ${formatDate(appliedEnd)}`
    : 'No date range applied';

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!hasAppliedRange) {
        setData([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const params = { limit: 20 };
        if (preset === 'month') params.month = month;
        else {
          params.start_date = appliedStart;
          params.end_date = appliedEnd;
        }
        if (tag) params.tag = tag;
        const response = await analyticsApi.topMerchants(params);
        if (!cancelled) setData(response.data || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [preset, month, appliedStart, appliedEnd, hasAppliedRange, tag]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('merch_preset', preset);

    if (preset === 'month' && isIsoMonth(month)) p.set('merch_month', month);
    else p.delete('merch_month');

    if (preset === 'custom' && isValidDateRange(appliedCustomStart, appliedCustomEnd)) {
      p.set('merch_start', appliedCustomStart);
      p.set('merch_end', appliedCustomEnd);
    } else {
      p.delete('merch_start');
      p.delete('merch_end');
    }

    setSearchParams(p, { replace: true });
  }, [preset, month, appliedCustomStart, appliedCustomEnd, setSearchParams]);

  const applyCustomRange = () => {
    if (!customRangeValid) return;
    setAppliedCustomStart(customStartInput);
    setAppliedCustomEnd(customEndInput);
    setPreset('custom');
  };

  const handlePresetChange = (nextPreset) => {
    if (nextPreset === 'custom') {
      const fallback = appliedRange || getMonthBounds(month) || getTopMerchantsPresetRange('this_month');
      if (!isValidDateRange(customStartInput, customEndInput) && fallback) {
        setCustomStartInput(fallback.start);
        setCustomEndInput(fallback.end);
        setAppliedCustomStart(fallback.start);
        setAppliedCustomEnd(fallback.end);
      } else if (!isValidDateRange(appliedCustomStart, appliedCustomEnd) && isValidDateRange(customStartInput, customEndInput)) {
        setAppliedCustomStart(customStartInput);
        setAppliedCustomEnd(customEndInput);
      }
    }
    setPreset(nextPreset);
  };

  const handleMonthChange = (nextMonth) => {
    if (!isIsoMonth(nextMonth)) return;
    setMonth(nextMonth);
    setPreset('month');
  };

  const navigateToMerchantTransactions = (merchant) => {
    const params = new URLSearchParams({ search: merchant });
    if (preset === 'month') params.set('month', month);
    else if (hasAppliedRange) {
      params.set('start_date', appliedStart);
      params.set('end_date', appliedEnd);
    }
    if (tag) params.set('tag', tag);
    navigate(`/transactions?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {TOP_MERCHANT_PRESETS.map(opt => (
          <button
            key={opt.id}
            onClick={() => handlePresetChange(opt.id)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              preset === opt.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="h-5 w-px bg-slate-700 mx-1" />
        <label className="text-xs text-slate-500">Quick month</label>
        <input type="month" className="input w-36 text-xs" value={month} onChange={e => handleMonthChange(e.target.value)} />
      </div>

      {preset === 'custom' && (
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider">Start</p>
            <input
              type="date"
              className="input text-xs w-40"
              value={customStartInput}
              onChange={e => setCustomStartInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider">End</p>
            <input
              type="date"
              className="input text-xs w-40"
              value={customEndInput}
              onChange={e => setCustomEndInput(e.target.value)}
            />
          </div>
          <button
            className="btn-primary text-xs"
            disabled={!customRangeValid || !customHasChanges}
            onClick={applyCustomRange}
          >
            Apply range
          </button>
          {showCustomRangeError && (
            <span className="text-xs text-rose-400">Start date must be on or before end date.</span>
          )}
        </div>
      )}

      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
        style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <span className="text-slate-400">Applied:</span>
        <span className="font-medium text-slate-200">{appliedRangeLabel}</span>
        <span className="text-slate-500">({appliedModeLabel})</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Spinner size={24} /></div>
      ) : !hasAppliedRange ? (
        <EmptyState icon={Calendar} title="Choose a date range" description="Set a valid custom start and end date, then apply." />
      ) : data.length === 0 ? (
        <EmptyState icon={BarChart2} title="No merchants for this period" description="Try another preset or adjust the custom range." />
      ) : (
        <div className="space-y-2.5">
          {data.map((d, i) => (
            <button key={i} onClick={() => navigateToMerchantTransactions(d.description)}
              className="w-full flex items-center gap-3 text-sm hover:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors group">
              <span className="text-slate-600 font-mono text-xs w-5 shrink-0">{i+1}</span>
              <span className="flex-1 text-slate-300 text-xs text-left truncate">{d.description}</span>
              <span className="text-xs text-slate-500 shrink-0">×{d.count}</span>
              <span className="font-mono text-xs text-rose-400 w-20 text-right shrink-0">{formatCurrency(d.total)}</span>
              <ArrowRight size={11} className="text-slate-600 group-hover:text-slate-400 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Income Analysis ───────────────────────────────────────────────────────────
function IncomeAnalysis() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(searchParams.get('inc_start') || `${currentYear}-01-01`);
  const [endDate, setEndDate]     = useState(searchParams.get('inc_end') || `${currentYear}-12-31`);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);

  const setYear = (y) => { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); };
  const setMonth = (m) => {
    const [y, mo] = m.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    setStartDate(`${m}-01`); setEndDate(`${m}-${String(last).padStart(2,'0')}`);
  };

  useEffect(() => {
    if (!startDate || !endDate) return;
    setLoading(true);
    // Fetch income transactions for the period
    fetch(`/api/transactions?type=income&start_date=${startDate}&end_date=${endDate}&limit=500`)
      .then(r => r.json())
      .then(d => {
        const txs = d.transactions || [];
        // Group by month
        const byMonth = {};
        const bySource = {};
        txs.forEach(t => {
          const m = t.date.slice(0,7);
          byMonth[m] = (byMonth[m] || 0) + t.amount;
          bySource[t.description] = (bySource[t.description] || 0) + t.amount;
        });
        const monthly = Object.entries(byMonth).sort().map(([month, total]) => ({ month, total }));
        const sources = Object.entries(bySource).sort((a,b) => b[1]-a[1]).map(([desc, total]) => ({ desc, total }));
        const grandTotal = txs.reduce((s,t) => s + t.amount, 0);
        const months = monthly.length || 1;
        setData({ monthly, sources, grandTotal, monthlyAvg: grandTotal / months, txCount: txs.length, transactions: txs });
        setLoading(false);
      });
  }, [startDate, endDate]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (startDate) p.set('inc_start', startDate); else p.delete('inc_start');
    if (endDate) p.set('inc_end', endDate); else p.delete('inc_end');
    setSearchParams(p, { replace: true });
  }, [startDate, endDate, setSearchParams]);

  const goToTx = (params = {}) => {
    const p = new URLSearchParams({ type: 'income', start_date: startDate, end_date: endDate, ...params });
    navigate(`/transactions?${p}`);
  };

  const years = Array.from({ length: 8 }, (_, i) => currentYear - i).reverse();
  // Recent months for quick filter
  const recentMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }).reverse();

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                startDate === `${y}-01-01` && endDate === `${y}-12-31`
                  ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
              }`}>{y}</button>
          ))}
        </div>
        <div className="h-4 w-px bg-slate-700" />
        <input type="date" className="input w-36 text-xs" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span className="text-slate-600 text-xs">to</span>
        <input type="date" className="input w-36 text-xs" value={endDate} onChange={e => setEndDate(e.target.value)} />
        {data && !loading && (
          <button onClick={() => goToTx()} className="btn-secondary text-xs flex items-center gap-1 ml-auto">
            View all transactions <ArrowRight size={12} />
          </button>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>}

      {data && !loading && (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Income',    value: formatCurrency(data.grandTotal),  color: 'text-emerald-400' },
              { label: 'Monthly Average', value: formatCurrency(data.monthlyAvg),  color: 'text-amber-400' },
              { label: 'Transactions',    value: data.txCount,                      color: 'text-indigo-300' },
            ].map((s,i) => (
              <div key={i} onClick={() => goToTx()}
                className="card p-5 cursor-pointer hover:scale-[1.01] transition-all group"
                style={{ border: '1px solid rgba(16,185,129,0.2)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="section-title">{s.label}</span>
                  <ArrowRight size={12} className="text-slate-600 group-hover:text-emerald-500" />
                </div>
                <div className={`font-mono text-2xl font-semibold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Monthly bar chart */}
          {data.monthly.length > 0 && (
            <Card className="p-5">
              <SectionHeader title="Monthly Income" subtitle="Click any bar to see those transactions" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.monthly} barCategoryGap="25%"
                  onClick={d => d?.activeLabel && goToTx({ start_date: d.activeLabel + '-01', end_date: d.activeLabel + '-' + new Date(d.activeLabel.split('-')[0], d.activeLabel.split('-')[1], 0).getDate() })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={m => m.slice(5)} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={data.monthlyAvg} stroke="#f59e0b" strokeDasharray="4 4"
                    label={{ value: 'Avg', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
                  <Bar dataKey="total" name="Income" fill="#10b981" radius={[3,3,0,0]} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Income by source */}
          <Card className="p-5">
            <SectionHeader title="Income by Source"
              subtitle={`${data.sources.length} sources · click to filter transactions`} />
            <div className="space-y-3 mt-3">
              {data.sources.length === 0 ? (
                <p className="text-slate-600 text-sm text-center py-6">No income sources matched. Add income sources in Settings.</p>
              ) : data.sources.map((s, i) => {
                const pct = data.grandTotal > 0 ? (s.total / data.grandTotal) * 100 : 0;
                return (
                  <button key={i} onClick={() => navigate(`/transactions?type=income&start_date=${startDate}&end_date=${endDate}&search=${encodeURIComponent(s.desc)}`)}
                    className="w-full flex items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors group">
                    <span className="text-xs text-slate-400 truncate text-left flex-1">{s.desc}</span>
                    <div className="w-32 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-xs text-emerald-400 w-24 text-right shrink-0">{formatCurrency(s.total)}</span>
                    <span className="text-xs text-slate-600 w-10 text-right shrink-0">{pct.toFixed(0)}%</span>
                    <ArrowRight size={11} className="text-slate-600 group-hover:text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {!loading && data?.txCount === 0 && (
        <div className="card p-8 text-center">
          <p className="text-slate-400 mb-2">No income transactions found for this period.</p>
          <p className="text-slate-600 text-sm">Make sure you have added income sources in <button className="text-indigo-400 underline" onClick={() => navigate('/settings')}>Settings</button>.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const { selectedMonth } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'category');
  const [tagFilter, setTagFilter] = useState(searchParams.get('tag') || '');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('tab', activeTab);
    if (tagFilter) p.set('tag', tagFilter); else p.delete('tag');
    setSearchParams(p, { replace: true });
  }, [activeTab, tagFilter, setSearchParams]);

  const tabs = [
    { id: 'income',    label: '💰 Income' },
    { id: 'category',  label: 'Category Drill-Down' },
    { id: 'year',      label: 'Year Summary' },
    { id: 'overview',  label: 'Monthly Breakdown' },
    { id: 'cashflow',  label: 'Cash Flow' },
    { id: 'merchants', label: 'Top Merchants' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Click any chart, bar, or tile to drill into the underlying transactions</p>
      </div>

      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Tag filter</span>
        <select className="select w-56 text-xs" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {TRAVEL_TAG_FILTER_OPTIONS.filter(Boolean).map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      {activeTab === 'income' && (
        <Card className="p-5">
          <SectionHeader title="Income Analysis" subtitle="Includes income sources, income categories, and manual income tags" />
          <IncomeAnalysis />
        </Card>
      )}
      {activeTab === 'category' && (
        <Card className="p-5">
          <SectionHeader title="Category Drill-Down"
            subtitle="Pick a category → see monthly trend → click a bar → inspect its transactions inline" />
          <CategoryDrillDown tag={tagFilter} />
        </Card>
      )}
      {activeTab === 'year'     && <YearSummary />}
      {activeTab === 'overview' && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Spending Breakdown</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Default month: <span className="text-indigo-300 font-medium">{formatMonth(selectedMonth)}</span>
                {' '}· Use quick date range for multi-month analysis · Click any row or slice to see transactions
              </p>
            </div>
          </div>
          <MonthlyBreakdown month={selectedMonth} tag={tagFilter} />
        </Card>
      )}
      {activeTab === 'cashflow'  && <Card className="p-5"><SectionHeader title="Cash Flow" /><CashFlow tag={tagFilter} /></Card>}
      {activeTab === 'merchants' && <Card className="p-5"><SectionHeader title="Top Merchants" subtitle="Click any merchant to see its transactions" /><TopMerchants tag={tagFilter} /></Card>}
    </div>
  );
}
