// client/src/pages/Trends.jsx
// New "Trends & Insights" page — add route in App.jsx:
//   import Trends from './pages/Trends';
//   <Route path="/trends" element={<Trends />} />
// Add to Sidebar NAV: { to: '/trends', label: 'Trends', icon: Activity }

import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Area, AreaChart
} from 'recharts';
import {
  Activity, TrendingUp, TrendingDown, AlertTriangle, RefreshCw,
  ChevronDown, ChevronRight, DollarSign, Repeat, Zap, Calendar
} from 'lucide-react';
import { analyticsApi } from '../utils/api';
import { formatCurrency, formatMonth } from '../utils/format';
import { StatCard, TrendBadge, DeltaPair, EmptyState, SkeletonCard, SectionHeading, PageHeader } from '../components/ui/Primitives';

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, valueKey = 'value' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-2xl"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 140 }}>
      <p className="font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span style={{ color: p.color || 'var(--text-secondary)' }}>{p.name}</span>
          <span className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
            {typeof p.value === 'number' ? formatCurrency(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Sparkline bar chart ──────────────────────────────────────────────────────
function Sparkline({ data, valueKey = 'total', color = 'var(--accent)', height = 32 }) {
  if (!data?.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>no data</span>;
  const max = Math.max(...data.map(d => d[valueKey] || 0));
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all"
          style={{
            height: `${max > 0 ? Math.max(4, (d[valueKey] / max) * height) : 4}px`,
            background: color,
            opacity: 0.65,
            minWidth: 3,
          }}
          title={`${d.month || i}: ${formatCurrency(d[valueKey])}`}
        />
      ))}
    </div>
  );
}

// ─── Drilldown wrapper ────────────────────────────────────────────────────────
function Drilldown({ open, children }) {
  if (!open) return null;
  return (
    <div className="drilldown-panel mt-2 border-t" style={{ borderColor: 'var(--border)' }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Rolling Trends
// ─────────────────────────────────────────────────────────────────────────────
function RollingTrendsSection({ accountId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState(18);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get('/rolling-trends', { params: { months: window, account_id: accountId || undefined } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [window, accountId]);

  const latest = data?.monthly?.slice(-1)[0];
  const prev   = data?.monthly?.slice(-2, -1)[0];

  return (
    <section>
      <SectionHeading
        title="Spending & Income Trends"
        sub={`Rolling ${window}-month view with MoM deltas`}
        actions={
          <div className="flex gap-1.5">
            {[6, 12, 18, 24].map(w => (
              <button key={w}
                onClick={() => setWindow(w)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: window === w ? 'var(--accent)' : 'var(--bg-card)',
                  color: window === w ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >{w}mo</button>
            ))}
          </div>
        }
      />

      {/* Window KPIs */}
      {data?.windows && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard label="30-day spend" value={formatCurrency(data.windows.r30_expenses)}
            icon={TrendingDown} color="var(--danger)" />
          <StatCard label="90-day spend" value={formatCurrency(data.windows.r90_expenses)}
            icon={Activity} />
          <StatCard label="30-day income" value={formatCurrency(data.windows.r30_income)}
            icon={TrendingUp} color="var(--success)" />
          <StatCard label="90-day income" value={formatCurrency(data.windows.r90_income)}
            icon={DollarSign} color="var(--success)" />
        </div>
      )}

      {/* Main chart */}
      {loading ? (
        <div className="h-56 rounded-xl skeleton" />
      ) : data?.monthly?.length ? (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="expenses" name="Expenses" fill="var(--danger)" opacity={0.7} radius={[3,3,0,0]} />
              <Bar dataKey="income"   name="Income"   fill="var(--success)" opacity={0.7} radius={[3,3,0,0]} />
              <Line dataKey="net" name="Net" stroke="var(--accent)" strokeWidth={2} dot={false} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
            </ComposedChart>
          </ResponsiveContainer>

          {/* MoM delta row */}
          {latest && (
            <div className="flex flex-wrap gap-4 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div>
                <p className="text-label mb-0.5">Expenses MoM</p>
                <TrendBadge delta={latest.mom_expenses} />
              </div>
              <div>
                <p className="text-label mb-0.5">Income MoM</p>
                <TrendBadge delta={latest.mom_income} inverse />
              </div>
              <div>
                <p className="text-label mb-0.5">Expenses YoY</p>
                <TrendBadge delta={latest.yoy_expenses} />
              </div>
              <div>
                <p className="text-label mb-0.5">Income YoY</p>
                <TrendBadge delta={latest.yoy_income} inverse />
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon={Activity} title="No trend data yet" description="Import transactions to see your spending trends." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Merchant Concentration
// ─────────────────────────────────────────────────────────────────────────────
function MerchantConcentrationSection({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [months, setMonths]   = useState(6);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get('/merchant-concentration', { params: { months, account_id: accountId || undefined } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [months, accountId]);

  // Top 5 share of wallet
  const top5Share = data?.merchants?.slice(0, 5).reduce((s, m) => s + m.share_pct, 0) || 0;

  return (
    <section>
      <SectionHeading
        title="Merchant Concentration"
        sub={`Where your money goes — top merchants by spend share`}
        actions={
          <div className="flex gap-1.5">
            {[3, 6, 12].map(w => (
              <button key={w} onClick={() => setMonths(w)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: months === w ? 'var(--accent)' : 'var(--bg-card)',
                  color: months === w ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >{w}mo</button>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : data?.merchants?.length ? (
        <div className="card overflow-hidden">
          {/* Concentration KPI */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Top 5 share of wallet:</span>
            <span className="font-bold text-sm" style={{ color: top5Share > 60 ? 'var(--warning)' : 'var(--text-primary)' }}>
              {top5Share.toFixed(0)}%
            </span>
            {top5Share > 60 && (
              <span className="anomaly-badge"><AlertTriangle size={10} /> Concentrated</span>
            )}
          </div>

          {data.merchants.map((m, i) => (
            <div key={m.merchant}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                onClick={() => setExpanded(expanded === i ? null : i)}
                style={{ borderBottom: i < data.merchants.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                {/* Rank */}
                <span className="w-5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>#{i + 1}</span>

                {/* Merchant + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.merchant}</span>
                    <span className="font-mono text-sm font-semibold ml-3" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${m.share_pct}%`, background: `hsl(${240 - i * 30}, 80%, 65%)` }} />
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.share_pct.toFixed(1)}% of spend</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.tx_count} txns</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>avg {formatCurrency(m.avg_tx)}</span>
                  </div>
                </div>

                {/* Sparkline */}
                <div className="w-20 flex-shrink-0">
                  <Sparkline data={m.sparkline} color={`hsl(${240 - i * 30}, 80%, 65%)`} height={28} />
                </div>

                <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: expanded === i ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
              </button>

              {/* Drilldown: monthly breakdown for this merchant */}
              <Drilldown open={expanded === i}>
                <div className="px-4 py-3">
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Monthly spend — {m.merchant}</p>
                  {m.sparkline?.length ? (
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={m.sparkline} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="total" name="Spend" fill={`hsl(${240 - i * 30}, 80%, 65%)`} radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No monthly breakdown available.</p>
                  )}
                  <a
                    href={`/transactions?merchant=${encodeURIComponent(m.merchant)}`}
                    className="inline-flex items-center gap-1 text-xs mt-2"
                    style={{ color: 'var(--accent)' }}
                  >
                    View all transactions <ChevronRight size={11} />
                  </a>
                </div>
              </Drilldown>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Activity} title="No merchant data" description="Import transactions to analyze merchant concentration." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Subscription Creep
// ─────────────────────────────────────────────────────────────────────────────
function SubscriptionCreepSection({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get('/subscription-creep', { params: { account_id: accountId || undefined } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [accountId]);

  const subs = data?.subscriptions || [];
  const visible = showAll ? subs : subs.slice(0, 8);

  return (
    <section>
      <SectionHeading
        title="Recurring & Subscriptions"
        sub="Detected recurring charges — flagged ones have rising costs"
        actions={
          data && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Est. annual: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(data.total_annual)}</strong>
              </span>
              {data.creeping_count > 0 && (
                <span className="anomaly-badge">
                  <TrendingUp size={10} /> {data.creeping_count} creeping
                </span>
              )}
            </div>
          )
        }
      />

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : subs.length ? (
        <>
          <div className="card overflow-hidden">
            {visible.map((s, i) => (
              <div
                key={s.merchant}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <Repeat size={14} style={{ color: s.is_creeping ? 'var(--warning)' : 'var(--accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.merchant}</span>
                    {s.is_creeping && (
                      <span className="anomaly-badge">
                        <TrendingUp size={9} /> +{s.creep_pct?.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.tx_count} charges</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {formatCurrency(s.min_amount)} – {formatCurrency(s.max_amount)}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(s.avg_amount)}<span className="text-xs font-normal opacity-60">/mo</span>
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatCurrency(s.annual_estimate)}/yr</p>
                </div>
                <div className="w-16 flex-shrink-0">
                  <Sparkline data={s.monthly} color={s.is_creeping ? 'var(--warning)' : 'var(--accent)'} height={24} />
                </div>
              </div>
            ))}
          </div>
          {subs.length > 8 && (
            <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs" style={{ color: 'var(--accent)' }}>
              {showAll ? 'Show less' : `Show all ${subs.length} subscriptions`}
            </button>
          )}
        </>
      ) : (
        <EmptyState icon={Repeat} title="No recurring patterns detected"
          description="Patterns appear after 3+ similar charges from the same merchant." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Anomaly Flags
// ─────────────────────────────────────────────────────────────────────────────
function AnomaliesSection({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get('/anomalies', { params: { account_id: accountId || undefined } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [accountId]);

  return (
    <section>
      <SectionHeading
        title="Anomaly Flags"
        sub="Transactions significantly higher than your typical spend at that merchant"
        actions={
          data?.count > 0 && (
            <span className="anomaly-badge"><AlertTriangle size={10} /> {data.count} flagged</span>
          )
        }
      />

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : data?.anomalies?.length ? (
        <div className="card overflow-hidden">
          {/* Category surges first */}
          {data.category_surges?.length > 0 && (
            <div className="px-4 py-3" style={{ background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--warning)' }}>
                <AlertTriangle size={11} className="inline mr-1" />Category Surges This Month
              </p>
              <div className="flex flex-wrap gap-2">
                {data.category_surges.map(c => (
                  <div key={c.category_id} className="text-xs px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: 'var(--warning)' }}>
                    {c.category_name}: +{c.surge_pct?.toFixed(0)}%
                    <span className="opacity-60 ml-1">({formatCurrency(c.this_month)} vs avg {formatCurrency(c.avg_total)})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transaction anomalies */}
          {data.anomalies.map((a, i) => (
            <div
              key={a.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: i < data.anomalies.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <Zap size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm truncate font-medium" style={{ color: 'var(--text-primary)' }}>{a.merchant}</span>
                  <span className="anomaly-badge">z={a.z_score?.toFixed(1)}</span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {a.date} · {a.reason}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Expected: ~{formatCurrency(a.expected_amount)} · Overage: +{formatCurrency(a.overage)}
                </p>
              </div>
              <span className="font-mono font-semibold text-sm flex-shrink-0" style={{ color: 'var(--danger)' }}>
                {formatCurrency(Math.abs(a.amount))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Zap} title="No anomalies detected"
          description="Anomalies appear when a merchant charge is 2.5σ above your typical spend. Keep transacting and they'll surface naturally." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Income Volatility
// ─────────────────────────────────────────────────────────────────────────────
function IncomeVolatilitySection({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get('/income-volatility', { params: { months: 12, account_id: accountId || undefined } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [accountId]);

  const stabilityColor = { stable: 'var(--success)', moderate: 'var(--warning)', volatile: 'var(--danger)' };

  return (
    <section>
      <SectionHeading
        title="Income Volatility"
        sub="Consistency of income across months + pay-cycle detection"
        actions={
          data?.stability && (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                color: stabilityColor[data.stability],
                background: stabilityColor[data.stability] + '18',
                border: `1px solid ${stabilityColor[data.stability]}30`,
              }}
            >
              <Calendar size={11} />
              {data.stability}
            </span>
          )
        }
      />

      {loading ? (
        <SkeletonCard />
      ) : data?.monthly?.length ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Avg monthly" value={formatCurrency(data.stats.avg)} icon={DollarSign} color="var(--success)" />
            <StatCard label="Std deviation" value={formatCurrency(data.stats.std_dev)} icon={Activity} />
            <StatCard label="Variability (CV)" value={`${data.stats.cv_pct?.toFixed(1)}%`}
              icon={TrendingUp} color={stabilityColor[data.stability]} />
            <StatCard
              label="Pay cycle"
              value={data.pay_cycle.likely_biweekly ? 'Bi-weekly' : data.pay_cycle.likely_monthly ? 'Monthly' : 'Irregular'}
              icon={Calendar}
            />
          </div>

          <div className="card p-4">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={data.stats.avg} stroke="var(--success)" strokeDasharray="4 4" opacity={0.6} label={{ value: 'avg', position: 'right', fontSize: 10, fill: 'var(--success)' }} />
                <Area dataKey="income" name="Income" stroke="var(--success)" fill="url(#incomeGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            {data.pay_cycle.peaks?.length > 0 && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={11} className="inline mr-1" />
                Income typically arrives around day{data.pay_cycle.peaks.length > 1 ? 's' : ''}: {data.pay_cycle.peaks.join(', ')} of the month
              </p>
            )}
          </div>
        </div>
      ) : (
        <EmptyState icon={DollarSign} title="No income data" description="Configure income sources in Settings to see volatility analysis." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Trends() {
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts]   = useState([]);

  useEffect(() => {
    analyticsApi.get('/accounts-summary')
      .then(r => setAccounts(r.data || []))
      .catch(() => {});
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <PageHeader
        title="Trends & Insights"
        description="Rolling analysis, patterns, and anomaly detection"
        actions={
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        }
      />

      <RollingTrendsSection accountId={accountId} />
      <MerchantConcentrationSection accountId={accountId} />
      <SubscriptionCreepSection accountId={accountId} />
      <AnomaliesSection accountId={accountId} />
      <IncomeVolatilitySection accountId={accountId} />
    </div>
  );
}
