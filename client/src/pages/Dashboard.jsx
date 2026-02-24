// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, TrendingDown, TrendingUp, Activity, AlertTriangle, ArrowRight } from 'lucide-react';
import { Card, ProgressBar, EmptyState, Spinner } from '../components/ui';
import { analyticsApi, budgetsApi, billsApi } from '../utils/api';
import { formatCurrency, formatMonth } from '../utils/format';
import useAppStore from '../stores/appStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-2xl" style={{ border: '1px solid rgba(99,102,241,0.3)' }}>
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>)}
    </div>
  );
}

// Clickable stat tile with explanation tooltip
function StatTile({ label, value, sub, color, icon: Icon, onClick, explanation }) {
  const [showTip, setShowTip] = useState(false);
  const colors = {
    green:  { bg: 'from-emerald-500/10',  border: 'border-emerald-500/20',  icon: 'bg-emerald-500/10 text-emerald-400',  val: 'text-emerald-400' },
    red:    { bg: 'from-red-500/10',       border: 'border-red-500/20',       icon: 'bg-red-500/10 text-red-400',           val: 'text-rose-400' },
    indigo: { bg: 'from-indigo-500/10',    border: 'border-indigo-500/20',    icon: 'bg-indigo-500/10 text-indigo-400',     val: 'text-indigo-300' },
    amber:  { bg: 'from-amber-500/10',     border: 'border-amber-500/20',     icon: 'bg-amber-500/10 text-amber-400',       val: 'text-amber-400' },
  };
  const c = colors[color] || colors.indigo;

  return (
    <div className="relative">
      <div
        onClick={onClick}
        className={`card p-5 bg-gradient-to-br ${c.bg} to-transparent ${c.border} border
          ${onClick ? 'cursor-pointer hover:border-opacity-60 hover:scale-[1.02] transition-all duration-150 group' : ''}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
            {explanation && (
              <button
                className="w-4 h-4 rounded-full text-xs text-slate-600 hover:text-slate-400 transition-colors flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onClick={e => { e.stopPropagation(); setShowTip(!showTip); }}
              >?</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onClick && <ArrowRight size={13} className="text-slate-600 group-hover:text-slate-400 transition-colors" />}
            {Icon && <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.icon}`}><Icon size={14} /></div>}
          </div>
        </div>
        <div className={`font-mono text-2xl font-semibold tracking-tight ${c.val}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </div>

      {/* Explanation tooltip */}
      {showTip && explanation && (
        <div className="absolute top-full left-0 mt-2 z-50 p-3 rounded-xl text-xs text-slate-300 shadow-2xl w-64 animate-slide-up"
          style={{ background: '#111827', border: '1px solid rgba(99,102,241,0.4)' }}>
          <p className="font-semibold text-slate-200 mb-1">{label}</p>
          <p className="text-slate-400 leading-relaxed">{explanation}</p>
          <button className="mt-2 text-indigo-400 hover:text-indigo-300" onClick={() => setShowTip(false)}>Close ×</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { selectedMonth } = useAppStore();
  const [trend, setTrend] = useState([]);
  const [pieData, setPieData] = useState([]);
  const [budgets, setBudgets] = useState({ budgets: [], summary: {} });
  const [bills, setBills] = useState({ warning: false, upcoming: [], upcomingTotal: 0, checkingBalance: 0 });
  const [loading, setLoading] = useState(true);

  const [dashSummary, setDashSummary] = useState({ income: 0, expenses: 0 });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.monthlyTrend({ months: 12 }),
      analyticsApi.spendingByCategory({ month: selectedMonth }),
      budgetsApi.list(selectedMonth),
      billsApi.list(),
      fetch(`/api/analytics/dashboard-summary?month=${selectedMonth}`).then(r => r.json()),
    ]).then(([t, pie, b, bi, ds]) => {
      setTrend(t.data);
      setPieData(pie.data.slice(0, 8));
      setBudgets(b.data);
      setBills(bi.data);
      setDashSummary(ds);
    }).finally(() => setLoading(false));
  }, [selectedMonth]);

  const income   = dashSummary.income   || 0;
  const expenses = dashSummary.expenses || 0;
  const net      = income - expenses;
  const totalBudgeted = budgets.budgets?.reduce((s, b) => s + b.amount, 0) || 0;
  const leftover = income - totalBudgeted;

  // Navigation helpers
  const goToTx = (params) => navigate(`/transactions?${new URLSearchParams(params)}`);

  const goIncome   = () => goToTx({ month: selectedMonth, type: 'income' });
  const goExpenses = () => goToTx({ month: selectedMonth, type: 'expense' });
  const goNet      = () => goToTx({ month: selectedMonth });
  const goCat      = (catId) => goToTx({ month: selectedMonth, category_id: catId, type: 'expense' });

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={32} /></div>;

  const COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#3b82f6','#ec4899','#14b8a6'];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">{formatMonth(selectedMonth)} · Click any tile to see transactions</p>
        </div>
        {bills.warning && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
            <AlertTriangle size={14} />
            <span>Low balance — bills due soon!</span>
          </div>
        )}
      </div>

      {/* ── Stat Tiles ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatTile
          label="Monthly Income"
          value={formatCurrency(income)}
          icon={TrendingUp}
          color="green"
          onClick={goIncome}
          explanation="Sum of all transactions with a positive amount, plus any transactions assigned to an 'Income' category, for the selected month."
        />
        <StatTile
          label="Monthly Expenses"
          value={formatCurrency(expenses)}
          icon={TrendingDown}
          color="red"
          onClick={goExpenses}
          explanation="Sum of all negative transactions (charges, purchases) for the selected month, excluding any transactions assigned to an Income category."
        />
        <StatTile
          label="Net"
          value={formatCurrency(net)}
          icon={Activity}
          color={net >= 0 ? 'green' : 'red'}
          onClick={goNet}
          explanation="Income minus Expenses for the month. Positive = you earned more than you spent. Negative = you spent more than you earned."
        />
        <StatTile
          label="Left Over"
          value={formatCurrency(leftover)}
          sub={totalBudgeted > 0 ? `Income $${income.toFixed(0)} − Budgeted $${totalBudgeted.toFixed(0)}` : 'No budgets set yet'}
          icon={DollarSign}
          color={leftover >= 0 ? 'indigo' : 'red'}
          explanation={`Income (${formatCurrency(income)}) minus the total amount you have budgeted across all categories (${formatCurrency(totalBudgeted)}). Shows how much income is still unallocated.`}
        />
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monthly trend */}
        <Card className="col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Income vs Expenses</h2>
              <p className="text-xs text-slate-500 mt-0.5">Last 12 months · Click bars to drill in</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} barCategoryGap="30%"
              onClick={data => { if (data?.activePayload) goToTx({ month: data.activeLabel }); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={m => m?.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="income"   name="Income"   fill="#10b981" radius={[3,3,0,0]} className="cursor-pointer" />
              <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[3,3,0,0]} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Spending pie — clickable slices */}
        <Card className="p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-200">By Category</h2>
            <p className="text-xs text-slate-500 mt-0.5">Click slice → see transactions</p>
          </div>
          {pieData.length === 0 ? (
            <EmptyState icon={Activity} title="No spending data" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} dataKey="total" nameKey="category"
                    cx="50%" cy="50%" outerRadius={70} innerRadius={30}
                    onClick={d => { if (d?.category_id) goCat(d.category_id); }}
                    className="cursor-pointer"
                  >
                    {pieData.map((_, i) => <Cell key={i} fill={_.color || COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {pieData.slice(0, 5).map((d, i) => (
                  <button key={i} onClick={() => d.category_id && goCat(d.category_id)}
                    className="w-full flex items-center justify-between hover:bg-white/5 px-1 py-0.5 rounded transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: d.color || COLORS[i % COLORS.length] }} />
                      <span className="text-xs text-slate-400 truncate max-w-24">{d.category}</span>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{formatCurrency(d.total)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Budget + Bills ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Budget Progress</h2>
              <p className="text-xs text-slate-500 mt-0.5">Click row → see those transactions</p>
            </div>
          </div>
          {budgets.budgets?.length === 0 ? (
            <EmptyState icon={DollarSign} title="No budgets set" description="Go to Budgets to set up envelope budgets." />
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {budgets.budgets?.slice(0, 8).map(b => (
                <button key={b.id} className="w-full text-left hover:bg-white/5 rounded-lg p-1 -mx-1 transition-colors"
                  onClick={() => goCat(b.category_id)}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: b.category_color }} />
                      <span className="text-slate-300 text-xs">{b.category_name}</span>
                      {b.status === 'over' && <span className="text-xs text-red-400">Over!</span>}
                    </div>
                    <span className={`font-mono text-xs ${b.status === 'over' ? 'text-red-400' : b.status === 'warning' ? 'text-amber-400' : 'text-slate-500'}`}>
                      {formatCurrency(b.spent)} / {formatCurrency(b.effective_budget)}
                    </span>
                  </div>
                  <ProgressBar pct={b.pct} />
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-200">Upcoming Bills</h2>
            <p className="text-xs text-slate-500 mt-0.5">Next 7 days</p>
          </div>
          {bills.upcoming?.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-slate-500 text-sm">No bills due in the next 7 days</p>
              <p className="text-slate-600 text-xs mt-1">Checking balance: {formatCurrency(bills.checkingBalance)}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bills.upcoming.map(b => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-sm text-slate-200">{b.name}</p>
                    <p className="text-xs text-slate-500">Due {b.next_due}</p>
                  </div>
                  <span className="font-mono text-sm text-rose-400">{formatCurrency(b.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <span className="text-xs text-slate-500">Total due · </span>
                  <span className="text-xs text-slate-600">Balance: {formatCurrency(bills.checkingBalance)}</span>
                </div>
                <span className={`font-mono text-sm font-semibold ${bills.warning ? 'text-red-400' : 'text-rose-400'}`}>
                  {formatCurrency(bills.upcomingTotal)}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
