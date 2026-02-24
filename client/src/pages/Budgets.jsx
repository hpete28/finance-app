// src/pages/Budgets.jsx
import React, { useState, useEffect } from 'react';
import { Plus, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { budgetsApi, categoriesApi } from '../utils/api';
import { formatCurrency, formatMonth, pctColor } from '../utils/format';
import { Card, Modal, SectionHeader, EmptyState, ProgressBar, StatCard } from '../components/ui';
import { DollarSign, TrendingDown, TrendingUp, PiggyBank } from 'lucide-react';
import useAppStore from '../stores/appStore';

function BudgetCard({ budget, categories, onSave }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(budget.amount);
  const [rollover, setRollover] = useState(!!budget.rollover);

  const handleSave = async () => {
    await onSave({ category_id: budget.category_id, amount: parseFloat(amount), rollover });
    setEditing(false);
  };

  const barColor = pctColor(budget.pct);

  return (
    <div className="card card-hover p-4 animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: budget.category_color }} />
          <span className="text-sm font-medium text-slate-200">{budget.category_name}</span>
          {budget.rollover && budget.rollover_amount !== 0 && (
            <span className={`text-xs font-mono ${budget.rollover_amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {budget.rollover_amount > 0 ? '+' : ''}{formatCurrency(budget.rollover_amount)} rolled
            </span>
          )}
        </div>
        <button
          className="btn-ghost text-xs py-0.5 px-2"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Monthly Budget</label>
            <input
              type="number"
              className="input"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0"
              step="10"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setRollover(!rollover)} className="text-slate-400 hover:text-indigo-400 transition-colors">
                {rollover ? <ToggleRight size={20} className="text-indigo-400" /> : <ToggleLeft size={20} />}
              </button>
              <span className="text-xs text-slate-400">Rollover unused budget</span>
            </div>
            <button className="btn-primary text-xs" onClick={handleSave}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2">
            <ProgressBar pct={budget.pct} color={barColor} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <div>
              <span className="font-mono font-medium" style={{ color: barColor }}>
                {formatCurrency(budget.spent)}
              </span>
              <span className="text-slate-600"> / {formatCurrency(budget.effective_budget)}</span>
            </div>
            <div className={`font-mono ${budget.remaining >= 0 ? 'text-slate-400' : 'text-red-400'}`}>
              {budget.remaining >= 0 ? '' : '−'}{formatCurrency(Math.abs(budget.remaining))} {budget.remaining >= 0 ? 'left' : 'over'}
            </div>
          </div>
          {budget.status === 'over' && (
            <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
              ⚠ Over budget by {formatCurrency(Math.abs(budget.remaining))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddBudgetModal({ open, onClose, categories, month, onSave }) {
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [rollover, setRollover] = useState(false);

  const handleSave = async () => {
    if (!categoryId || !amount) return;
    await onSave({ category_id: parseInt(categoryId), month, amount: parseFloat(amount), rollover });
    setCategoryId(''); setAmount('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Budget" size="sm">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Category</label>
          <select className="select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">Select category...</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Monthly Amount</label>
          <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" min="0" step="10" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={rollover} onChange={e => setRollover(e.target.checked)} />
          <span className="text-sm text-slate-400">Enable rollover</span>
        </label>
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Add Budget</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Budgets() {
  const { selectedMonth, setMonth, showToast } = useAppStore();
  const [data, setData] = useState({ budgets: [], summary: {} });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        budgetsApi.list(selectedMonth),
        categoriesApi.list(),
      ]);
      setData(b.data);
      setCategories(c.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedMonth]);

  const handleSave = async (budgetData) => {
    await budgetsApi.upsert({ ...budgetData, month: selectedMonth });
    load();
    showToast('Budget saved');
  };

  const handleRollover = async () => {
    await budgetsApi.rollover(selectedMonth);
    showToast('Rollover applied to next month');
  };

  const navigateMonth = (dir) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const summary = data.summary || {};
  const income = summary.income || 0;
  const expenses = summary.expenses || 0;
  const totalBudgeted = data.budgets.reduce((s, b) => s + b.effective_budget, 0);
  const leftover = income - totalBudgeted;

  const statusGroups = {
    over: data.budgets.filter(b => b.status === 'over'),
    warning: data.budgets.filter(b => b.status === 'warning'),
    safe: data.budgets.filter(b => b.status === 'safe'),
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-100">Budgets</h1>
          <p className="text-sm text-slate-500 mt-0.5">Envelope budgeting</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month nav */}
          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            <button className="btn-ghost p-1" onClick={() => navigateMonth(-1)}><ChevronLeft size={14} /></button>
            <span className="text-sm text-slate-300 px-2 min-w-32 text-center">{formatMonth(selectedMonth)}</span>
            <button className="btn-ghost p-1" onClick={() => navigateMonth(1)}><ChevronRight size={14} /></button>
          </div>
          <button className="btn-secondary text-xs" onClick={handleRollover} title="Apply rollover to next month">
            <RefreshCw size={12} className="inline mr-1" />
            Rollover
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} className="inline mr-1" />
            Add Budget
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Income" value={formatCurrency(income)} icon={TrendingUp} color="green" />
        <StatCard label="Expenses" value={formatCurrency(expenses)} icon={TrendingDown} color="red" />
        <StatCard label="Total Budgeted" value={formatCurrency(totalBudgeted)} icon={PiggyBank} color="indigo" />
        <StatCard
          label="Left Over"
          value={formatCurrency(leftover)}
          icon={DollarSign}
          color={leftover >= 0 ? 'green' : 'red'}
          sub={leftover < 0 ? 'Over budget!' : 'Unallocated'}
        />
      </div>

      {/* Budget cards by status */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading...</div>
      ) : data.budgets.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={PiggyBank}
            title="No budgets set"
            description="Start by adding budgets for your spending categories."
            action={<button className="btn-primary" onClick={() => setShowAdd(true)}>Add Budget</button>}
          />
        </Card>
      ) : (
        <>
          {statusGroups.over.length > 0 && (
            <div>
              <p className="section-title mb-3 text-red-400">⚠ Over Budget</p>
              <div className="grid grid-cols-3 gap-4">
                {statusGroups.over.map(b => (
                  <BudgetCard key={b.id} budget={b} categories={categories} onSave={handleSave} />
                ))}
              </div>
            </div>
          )}
          {statusGroups.warning.length > 0 && (
            <div>
              <p className="section-title mb-3 text-amber-400">Approaching Limit</p>
              <div className="grid grid-cols-3 gap-4">
                {statusGroups.warning.map(b => (
                  <BudgetCard key={b.id} budget={b} categories={categories} onSave={handleSave} />
                ))}
              </div>
            </div>
          )}
          {statusGroups.safe.length > 0 && (
            <div>
              <p className="section-title mb-3 text-emerald-400">On Track</p>
              <div className="grid grid-cols-3 gap-4">
                {statusGroups.safe.map(b => (
                  <BudgetCard key={b.id} budget={b} categories={categories} onSave={handleSave} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AddBudgetModal
        open={showAdd} onClose={() => setShowAdd(false)}
        categories={categories} month={selectedMonth}
        onSave={handleSave}
      />
    </div>
  );
}
