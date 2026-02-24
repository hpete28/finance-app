// src/App.jsx
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import Sidebar, { MobileNav } from './components/Sidebar';
import { Toast } from './components/ui';
import useAppStore from './stores/appStore';
import { categoriesApi, analyticsApi } from './utils/api';
import { currentMonth } from './utils/format';

import Dashboard    from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Budgets      from './pages/Budgets';
import Bills        from './pages/Bills';
import Analytics    from './pages/Analytics';
import NetWorth     from './pages/NetWorth';
import Settings     from './pages/Settings';
import Import       from './pages/Import';
import Trends       from './pages/Trends';

function MonthSelector() {
  const { selectedMonth, setMonth } = useAppStore();
  const navigate = (dir) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`);
  };
  const label = new Date(selectedMonth + '-01').toLocaleDateString('en-CA', { year: 'numeric', month: 'long' });
  return (
    <div className="flex items-center gap-1 rounded-lg px-1 py-0.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <button className="w-6 h-6 flex items-center justify-center rounded transition-colors text-sm" style={{ color: 'var(--text-muted)' }} onClick={() => navigate(-1)}>‹</button>
      <span className="text-sm px-2 min-w-36 text-center" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <button className="w-6 h-6 flex items-center justify-center rounded transition-colors text-sm" style={{ color: 'var(--text-muted)' }} onClick={() => navigate(1)}>›</button>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useAppStore();
  return (
    <button
      onClick={toggleTheme}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function Layout({ children }) {
  const { toast, dismissToast } = useAppStore();
  return (
    <div className="flex min-h-screen grid-pattern">
      <Sidebar />
      <main className="flex-1 lg:ml-56">
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8 py-3"
          style={{ background: 'rgba(8,13,26,0.88)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--border)' }}>
          <MobileNav />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <MonthSelector />
          </div>
        </div>
        <div className="px-4 lg:px-8 py-5 lg:py-7">
          {children}
        </div>
      </main>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  const { setCategories, setAccounts } = useAppStore();
  useEffect(() => {
    categoriesApi.list().then(r => setCategories(r.data)).catch(() => {});
    analyticsApi.accountsSummary().then(r => setAccounts(r.data)).catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets"      element={<Budgets />} />
          <Route path="/bills"        element={<Bills />} />
          <Route path="/analytics"    element={<Analytics />} />
          <Route path="/trends"       element={<Trends />} />
          <Route path="/networth"     element={<NetWorth />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/import"       element={<Import />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
