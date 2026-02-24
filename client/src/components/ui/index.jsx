// src/components/ui/index.jsx
import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

// ─── Card ───────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', hover = false, glow = null }) {
  return (
    <div className={`card ${hover ? 'card-hover' : ''} ${glow ? `glow-${glow}` : ''} ${className}`}>
      {children}
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, trend, icon: Icon, color = 'indigo', className = '' }) {
  const colors = {
    indigo: 'from-indigo-500/10 to-transparent border-indigo-500/20',
    green:  'from-emerald-500/10 to-transparent border-emerald-500/20',
    red:    'from-red-500/10 to-transparent border-red-500/20',
    amber:  'from-amber-500/10 to-transparent border-amber-500/20',
  };
  const iconColors = {
    indigo: 'bg-indigo-500/10 text-indigo-400',
    green:  'bg-emerald-500/10 text-emerald-400',
    red:    'bg-red-500/10 text-red-400',
    amber:  'bg-amber-500/10 text-amber-400',
  };

  return (
    <div className={`card p-5 bg-gradient-to-br ${colors[color]} animate-fade-in ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="section-title">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColors[color]}`}>
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
      {trend !== undefined && (
        <div className={`text-xs mt-2 font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% vs last month
        </div>
      )}
    </div>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────────
export function Badge({ children, color, className = '' }) {
  return (
    <span
      className={`badge ${className}`}
      style={{
        backgroundColor: color ? color + '22' : 'rgba(99,102,241,0.15)',
        color: color || '#818cf8',
        border: `1px solid ${color ? color + '44' : 'rgba(99,102,241,0.25)'}`,
      }}
    >
      {children}
    </span>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative card w-full ${sizes[size]} animate-slide-up shadow-2xl`}
        style={{ border: '1px solid rgba(99,102,241,0.3)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold text-slate-200 text-base">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Toast ──────────────────────────────────────────────────────────────────────
export function Toast({ toast, onDismiss }) {
  if (!toast) return null;

  const config = {
    success: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    error:   { icon: AlertCircle, color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' },
    warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    info:    { icon: Info,        color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/30' },
  };

  const { icon: Icon, color, bg } = config[toast.type] || config.info;

  return (
    <div className="fixed bottom-5 right-5 z-[100] animate-slide-up">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl ${bg}`}>
        <Icon size={16} className={color} />
        <span className="text-sm text-slate-200">{toast.message}</span>
        <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 ml-2">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Spinner ────────────────────────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      className="animate-spin text-indigo-400"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="31.4 31.4" />
    </svg>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <Icon size={24} className="text-indigo-400" />
        </div>
      )}
      <h3 className="text-slate-300 font-medium mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-500 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────────
export function ProgressBar({ pct, color }) {
  const barColor = color || (pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981');
  return (
    <div className="progress-bar">
      <div
        className="progress-fill"
        style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
      />
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
            active === tab.id
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-200">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
