// client/src/components/ui/Primitives.jsx
// Shared display primitives: EmptyState, StatCard, TrendBadge, SkeletonLine, PageHeader
import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && (
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'var(--accent-glow)', border: '1px solid var(--border)' }}
        >
          <Icon size={22} style={{ color: 'var(--accent)', opacity: 0.8 }} />
        </div>
      )}
      <p className="font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>
      {description && (
        <p className="text-sm max-w-xs mb-4" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
      {action}
    </div>
  );
}

// ─── Trend badge ──────────────────────────────────────────────────────────────
// delta: signed number (positive = more spending/worse for expenses, better for income)
// inverse: flip color logic (for income, positive delta is good)
export function TrendBadge({ delta, suffix = '%', inverse = false, size = 'sm' }) {
  if (delta == null || isNaN(delta)) return null;
  const up = delta > 0;
  const neutral = Math.abs(delta) < 0.5;

  // For expenses: up = bad (red). For income: up = good (green) [use inverse=true]
  const color = neutral
    ? 'var(--text-muted)'
    : (up !== inverse) ? 'var(--danger)' : 'var(--success)';

  const Icon = neutral ? Minus : up ? TrendingUp : TrendingDown;
  const fontSize = size === 'xs' ? 10 : size === 'sm' ? 11 : 13;
  const iconSize = size === 'xs' ? 10 : 12;

  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium"
      style={{
        fontSize,
        color,
        background: neutral ? 'transparent' : `${color}18`,
        border: `1px solid ${color}30`,
      }}
    >
      <Icon size={iconSize} />
      {neutral ? '~0' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix}`}
    </span>
  );
}

// MoM / YoY delta pair
export function DeltaPair({ mom, yoy }) {
  return (
    <div className="flex items-center gap-1.5">
      {mom != null && (
        <span className="inline-flex items-center gap-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          MoM <TrendBadge delta={mom} size="xs" />
        </span>
      )}
      {yoy != null && (
        <span className="inline-flex items-center gap-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          YoY <TrendBadge delta={yoy} size="xs" />
        </span>
      )}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, trend, icon: Icon, color, loading, onClick, className = '' }) {
  return (
    <div
      className={`rounded-xl p-4 transition-all ${onClick ? 'cursor-pointer hover:scale-[1.01]' : ''} ${className}`}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
      }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {label}
        </span>
        {Icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: (color || 'var(--accent)') + '20' }}
          >
            <Icon size={14} style={{ color: color || 'var(--accent)' }} />
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-7 w-24 rounded animate-pulse" style={{ background: 'var(--border)' }} />
      ) : (
        <p className="text-2xl font-bold tracking-tight" style={{ color: color || 'var(--text-primary)' }}>
          {value}
        </p>
      )}

      {(sub || trend) && (
        <div className="flex items-center gap-2 mt-1.5">
          {sub && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
          {trend}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton lines ───────────────────────────────────────────────────────────
export function SkeletonLine({ w = 'full', h = 4 }) {
  return (
    <div
      className={`w-${w} h-${h} rounded animate-pulse`}
      style={{ background: 'var(--border)' }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <SkeletonLine w="1/3" h={3} />
      <SkeletonLine w="1/2" h={7} />
      <SkeletonLine w="full" h={2} />
    </div>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        {description && <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
export function SectionHeading({ title, sub, actions }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

// ─── Focus-visible ring (accessibility utility) ───────────────────────────────
// Use on interactive elements: className={focusRing}
export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
