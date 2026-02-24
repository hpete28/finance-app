// client/src/pages/Trends.jsx
import React, { useState, useEffect } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart
} from 'recharts';
import {
  Activity, TrendingUp, TrendingDown, AlertTriangle,
  DollarSign, Repeat, Zap, Calendar, ChevronDown, ChevronRight
} from 'lucide-react';
import api from '../utils/api';
import { formatCurrency, formatMonth } from '../utils/format';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const get = (path, params = {}) => api.get(path, { params });

// ─── Shared mini-components ───────────────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`card ${className}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '0.75rem' }}>
      {children}
    </div>
  );
}

function SectionHead({ title, sub, actions }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function Empty({ icon: Icon, title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && (
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
          style={{ background: 'var(--accent-glow)', border: '1px solid var(--border)' }}>
          <Icon size={20} style={{ color: 'var(--accent)', opacity: 0.8 }} />
        </div>
      )}
      <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>
      {desc && <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
    </div>
  );
}

function Skeleton({ h = 48 }) {
  return <div className="rounded-xl animate-pulse w-full" style={{ height: h, background: 'var(--border)' }} />;
}

function KpiCard({ label, value, icon: Icon, color }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</span>
        {Icon && <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: (color || 'var(--accent)') + '20' }}>
          <Icon size={14} style={{ color: color || 'var(--accent)' }} />
        </span>}
      </div>
      <p className="text-xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function TrendChip({ delta, inverse = false }) {
  if (delta == null || isNaN(delta)) return null;
  const up = delta > 0;
  const neutral = Math.abs(delta) < 0.5;
  const bad = neutral ? false : (up !== inverse);
  const color = neutral ? 'var(--text-muted)' : bad ? 'var(--danger)' : 'var(--success)';
  const Icon = neutral ? Activity : up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium"
      style={{ color, background: neutral ? 'transparent' : color + '18', border: `1px solid ${color}30` }}>
      <Icon size={10} />
      {neutral ? '~0%' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
    </span>
  );
}

function AnomalyBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24' }}>
      {children}
    </span>
  );
}

function WinBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
      style={{
        background: active ? 'var(--accent)' : 'var(--bg-card)',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
      }}>
      {children}
    </button>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-2xl"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 140 }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</p>
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

function Sparkline({ data = [], color = 'var(--accent)', height = 28 }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.total || 0));
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 rounded-t-sm"
          style={{ height: `${max > 0 ? Math.max(3, (d.total / max) * height) : 3}px`, background: color, opacity: 0.65, minWidth: 3 }}
          title={`${d.month || i}: ${formatCurrency(d.total)}`} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Rolling Trends
// ─────────────────────────────────────────────────────────────────────────────
function RollingTrends({ accountId }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin]       = useState(18);

  useEffect(() => {
    setLoading(true);
    get('/analytics/rolling-trends', { months: win, ...(accountId && { account_id: accountId }) })
      .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [win, accountId]);

  const latest = data?.monthly?.slice(-1)[0];

  return (
    <section>
      <SectionHead
        title="Spending & Income Trends"
        sub="Rolling monthly view with MoM & YoY deltas"
        actions={<div className="flex gap-1">{[6,12,18,24].map(w => <WinBtn key={w} active={win===w} onClick={() => setWin(w)}>{w}mo</WinBtn>)}</div>}
      />

      {data?.windows && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KpiCard label="30-day spend"   value={formatCurrency(data.windows.r30_expenses)} icon={TrendingDown} color="var(--danger)" />
          <KpiCard label="90-day spend"   value={formatCurrency(data.windows.r90_expenses)} icon={Activity} />
          <KpiCard label="30-day income"  value={formatCurrency(data.windows.r30_income)}  icon={TrendingUp}  color="var(--success)" />
          <KpiCard label="90-day income"  value={formatCurrency(data.windows.r90_income)}  icon={DollarSign}  color="var(--success)" />
        </div>
      )}

      {loading ? <Skeleton h={240} /> : data?.monthly?.length ? (
        <Card className="p-4">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="expenses" name="Expenses" fill="var(--danger)"  opacity={0.7} radius={[3,3,0,0]} />
              <Bar dataKey="income"   name="Income"   fill="var(--success)" opacity={0.7} radius={[3,3,0,0]} />
              <Line dataKey="net" name="Net" stroke="var(--accent)" strokeWidth={2} dot={false} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
            </ComposedChart>
          </ResponsiveContainer>

          {latest && (
            <div className="flex flex-wrap gap-5 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              {[
                { l: 'Expenses MoM', d: latest.mom_expenses, inv: false },
                { l: 'Income MoM',   d: latest.mom_income,   inv: true },
                { l: 'Expenses YoY', d: latest.yoy_expenses, inv: false },
                { l: 'Income YoY',   d: latest.yoy_income,   inv: true },
              ].map(({ l, d, inv }) => (
                <div key={l}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>{l}</p>
                  <TrendChip delta={d} inverse={inv} />
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Empty icon={Activity} title="No trend data yet" desc="Import transactions to see your spending trends." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Merchant Concentration
// ─────────────────────────────────────────────────────────────────────────────
function MerchantConcentration({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [months, setMonths]   = useState(6);

  useEffect(() => {
    setLoading(true);
    get('/analytics/merchant-concentration', { months, ...(accountId && { account_id: accountId }) })
      .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [months, accountId]);

  const top5Share = data?.merchants?.slice(0, 5).reduce((s, m) => s + m.share_pct, 0) || 0;

  return (
    <section>
      <SectionHead
        title="Merchant Concentration"
        sub="Where your money goes — share of wallet by merchant"
        actions={<div className="flex gap-1">{[3,6,12].map(w => <WinBtn key={w} active={months===w} onClick={() => setMonths(w)}>{w}mo</WinBtn>)}</div>}
      />

      {loading ? (
        <div className="space-y-2"><Skeleton h={56} /><Skeleton h={56} /><Skeleton h={56} /></div>
      ) : data?.merchants?.length ? (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Top 5 share of wallet:</span>
            <span className="font-bold text-sm" style={{ color: top5Share > 60 ? 'var(--warning)' : 'var(--text-primary)' }}>{top5Share.toFixed(0)}%</span>
            {top5Share > 60 && <AnomalyBadge><AlertTriangle size={10} /> Concentrated</AnomalyBadge>}
          </div>

          {data.merchants.map((m, i) => (
            <div key={m.merchant}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                onClick={() => setExpanded(expanded === i ? null : i)}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span className="w-5 text-xs font-bold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>#{i+1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.merchant}</span>
                    <span className="font-mono text-sm font-semibold ml-3" style={{ color: 'var(--text-primary)' }}>{formatCurrency(m.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full" style={{ width: `${m.share_pct}%`, background: `hsl(${240 - i*30}, 70%, 60%)` }} />
                  </div>
                  <div className="flex gap-3">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.share_pct.toFixed(1)}% of spend</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.tx_count} txns</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>avg {formatCurrency(m.avg_tx)}</span>
                  </div>
                </div>
                <div className="w-16 flex-shrink-0">
                  <Sparkline data={m.sparkline} color={`hsl(${240 - i*30}, 70%, 60%)`} />
                </div>
                <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: expanded === i ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
              </button>

              {expanded === i && (
                <div className="px-4 py-3 animate-fade-in" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Monthly spend — {m.merchant}</p>
                  {m.sparkline?.length ? (
                    <ResponsiveContainer width="100%" height={90}>
                      <BarChart data={m.sparkline} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                        <Tooltip content={<ChartTip />} />
                        <Bar dataKey="total" name="Spend" fill={`hsl(${240-i*30},70%,60%)`} radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No monthly breakdown available.</p>}
                  <a href={`/transactions?search=${encodeURIComponent(m.merchant)}`}
                    className="inline-flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
                    View all transactions <ChevronRight size={11} />
                  </a>
                </div>
              )}
            </div>
          ))}
        </Card>
      ) : (
        <Empty icon={Activity} title="No merchant data" desc="Import transactions to analyse merchant concentration." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Subscription Creep
// ─────────────────────────────────────────────────────────────────────────────
function SubscriptionCreep({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    get('/analytics/subscription-creep', accountId ? { account_id: accountId } : {})
      .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [accountId]);

  const subs    = data?.subscriptions || [];
  const visible = showAll ? subs : subs.slice(0, 8);

  return (
    <section>
      <SectionHead
        title="Recurring & Subscriptions"
        sub="Detected recurring charges — flagged ones have rising costs"
        actions={data && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Est. annual: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(data.total_annual)}</strong>
            </span>
            {data.creeping_count > 0 && <AnomalyBadge><TrendingUp size={10} /> {data.creeping_count} creeping</AnomalyBadge>}
          </div>
        )}
      />

      {loading ? <div className="space-y-2"><Skeleton h={56} /><Skeleton h={56} /><Skeleton h={56} /></div>
       : subs.length ? (
        <>
          <Card className="overflow-hidden">
            {visible.map((s, i) => (
              <div key={s.merchant} className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <Repeat size={14} style={{ color: s.is_creeping ? 'var(--warning)' : 'var(--accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.merchant}</span>
                    {s.is_creeping && <AnomalyBadge><TrendingUp size={9} /> +{s.creep_pct?.toFixed(0)}%</AnomalyBadge>}
                  </div>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.tx_count} charges</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatCurrency(s.min_amount)} – {formatCurrency(s.max_amount)}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(s.avg_amount)}<span className="text-xs font-normal opacity-60">/mo</span>
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatCurrency(s.annual_estimate)}/yr</p>
                </div>
                <div className="w-16 flex-shrink-0">
                  <Sparkline data={s.monthly} color={s.is_creeping ? 'var(--warning)' : 'var(--accent)'} />
                </div>
              </div>
            ))}
          </Card>
          {subs.length > 8 && (
            <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs" style={{ color: 'var(--accent)' }}>
              {showAll ? 'Show less' : `Show all ${subs.length} subscriptions`}
            </button>
          )}
        </>
      ) : (
        <Empty icon={Repeat} title="No recurring patterns detected"
          desc="Patterns appear after 3+ similar charges from the same merchant." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Anomaly Flags
// ─────────────────────────────────────────────────────────────────────────────
function Anomalies({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    get('/analytics/anomalies', accountId ? { account_id: accountId } : {})
      .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [accountId]);

  return (
    <section>
      <SectionHead
        title="Anomaly Flags"
        sub="Transactions significantly higher than your typical spend at that merchant"
        actions={data?.count > 0 && <AnomalyBadge><AlertTriangle size={10} /> {data.count} flagged</AnomalyBadge>}
      />

      {loading ? <div className="space-y-2"><Skeleton h={64} /><Skeleton h={64} /></div>
       : data?.anomalies?.length ? (
        <Card className="overflow-hidden">
          {data.category_surges?.length > 0 && (
            <div className="px-4 py-3" style={{ background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--warning)' }}>
                <AlertTriangle size={11} className="inline mr-1" />Category Surges This Month
              </p>
              <div className="flex flex-wrap gap-2">
                {data.category_surges.map(c => (
                  <span key={c.category_id} className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: 'var(--warning)' }}>
                    {c.category_name}: +{c.surge_pct?.toFixed(0)}%
                    <span className="opacity-60 ml-1">({formatCurrency(c.this_month)} vs avg {formatCurrency(c.avg_total)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {data.anomalies.map((a, i) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: i < data.anomalies.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <Zap size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm truncate font-medium" style={{ color: 'var(--text-primary)' }}>{a.merchant}</span>
                  <AnomalyBadge>z={a.z_score?.toFixed(1)}</AnomalyBadge>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.date} · {a.reason}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Expected ~{formatCurrency(a.expected_amount)} · Overage +{formatCurrency(a.overage)}</p>
              </div>
              <span className="font-mono font-semibold text-sm flex-shrink-0" style={{ color: 'var(--danger)' }}>
                {formatCurrency(Math.abs(a.amount))}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <Empty icon={Zap} title="No anomalies detected"
          desc="Anomalies appear when a merchant charge is 2.5σ above your typical spend." />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Income Volatility
// ─────────────────────────────────────────────────────────────────────────────
function IncomeVolatility({ accountId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    get('/analytics/income-volatility', { months: 12, ...(accountId && { account_id: accountId }) })
      .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [accountId]);

  const stabilityColor = { stable: 'var(--success)', moderate: 'var(--warning)', volatile: 'var(--danger)' };
  const sc = stabilityColor[data?.stability] || 'var(--text-muted)';

  return (
    <section>
      <SectionHead
        title="Income Volatility"
        sub="Month-to-month income consistency and pay-cycle detection"
        actions={data?.stability && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ color: sc, background: sc + '18', border: `1px solid ${sc}30` }}>
            <Calendar size={11} />{data.stability}
          </span>
        )}
      />

      {loading ? <Skeleton h={200} />
       : data?.monthly?.length ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Avg monthly"     value={formatCurrency(data.stats.avg)}           icon={DollarSign} color="var(--success)" />
            <KpiCard label="Std deviation"   value={formatCurrency(data.stats.std_dev)}       icon={Activity} />
            <KpiCard label="Variability (CV)" value={`${data.stats.cv_pct?.toFixed(1)}%`}    icon={TrendingUp} color={sc} />
            <KpiCard label="Pay cycle"
              value={data.pay_cycle.likely_biweekly ? 'Bi-weekly' : data.pay_cycle.likely_monthly ? 'Monthly' : 'Irregular'}
              icon={Calendar} />
          </div>
          <Card className="p-4">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--success)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTip />} />
                <ReferenceLine y={data.stats.avg} stroke="var(--success)" strokeDasharray="4 4" opacity={0.6} />
                <Area dataKey="income" name="Income" stroke="var(--success)" fill="url(#incomeGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            {data.pay_cycle.peaks?.length > 0 && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={11} className="inline mr-1" />
                Income typically arrives around day{data.pay_cycle.peaks.length > 1 ? 's' : ''}: {data.pay_cycle.peaks.join(', ')} of the month
              </p>
            )}
          </Card>
        </div>
      ) : (
        <Empty icon={DollarSign} title="No income data" desc="Configure income sources in Settings to see volatility analysis." />
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
    get('/analytics/accounts-summary')
      .then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-10 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Trends &amp; Insights</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Rolling analysis, patterns, and anomaly detection</p>
        </div>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <RollingTrends       accountId={accountId} />
      <MerchantConcentration accountId={accountId} />
      <SubscriptionCreep   accountId={accountId} />
      <Anomalies           accountId={accountId} />
      <IncomeVolatility    accountId={accountId} />
    </div>
  );
}
