// src/components/Sidebar.jsx
import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X,
  LayoutDashboard, List, PiggyBank, CreditCard,
  BarChart2, TrendingUp, Settings, Upload, Wallet, Activity
} from 'lucide-react';

const NAV = [
  { to: '/',             label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/budgets',      label: 'Budgets',      icon: PiggyBank },
  { to: '/bills',        label: 'Bills & Subs', icon: CreditCard },
  { to: '/analytics',    label: 'Analytics',    icon: BarChart2 },
  { to: '/trends',       label: 'Trends',        icon: Activity },
  { to: '/networth',     label: 'Net Worth',    icon: TrendingUp },
  { to: '/settings',     label: 'Settings',     icon: Settings },
  { to: '/import',       label: 'Import Data',  icon: Upload },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="flex-1 px-3 space-y-0.5">
      <p className="section-title px-2 mb-2 mt-1">Menu</p>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
             ${isActive
               ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
               : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={17} className={isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg"
        style={{ boxShadow: '0 0 16px rgba(99,102,241,0.5)' }}>
        <Wallet size={15} className="text-white" />
      </div>
      <div>
        <span className="font-display text-lg text-white tracking-tight">Ledger</span>
        <p className="text-xs text-slate-600 leading-none">Personal Finance</p>
      </div>
    </div>
  );
}

// ── Desktop sidebar (always visible ≥ lg) ─────────────────────────────────────
export function DesktopSidebar() {
  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-full w-56 flex-col z-40"
      style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
      <div className="px-5 py-6">
        <Logo />
      </div>
      <NavItems />
      <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs text-slate-600">Self-hosted · Local data</p>
      </div>
    </aside>
  );
}

// ── Mobile drawer ─────────────────────────────────────────────────────────────
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button
        className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div className={`lg:hidden fixed left-0 top-0 h-full w-64 z-50 flex flex-col transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5">
          <Logo />
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <NavItems onNavigate={() => setOpen(false)} />

        <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs text-slate-600">Self-hosted · Local data</p>
        </div>
      </div>
    </>
  );
}

// Default export — both desktop + mobile triggers
export default function Sidebar() {
  return <DesktopSidebar />;
}
