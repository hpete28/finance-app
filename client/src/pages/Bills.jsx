// src/pages/Bills.jsx
import React, { useState, useEffect } from 'react';
import { Plus, AlertTriangle, RefreshCw, Trash2, Edit2, CheckCircle } from 'lucide-react';
import { billsApi, categoriesApi } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { Card, Modal, SectionHeader, EmptyState, StatCard, Badge } from '../components/ui';
import { CreditCard, Repeat } from 'lucide-react';
import useAppStore from '../stores/appStore';

function BillForm({ bill, categories, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: bill?.name || '',
    amount: bill?.amount || '',
    due_day: bill?.due_day || '',
    frequency: bill?.frequency || 'monthly',
    category_id: bill?.category_id || '',
    notes: bill?.notes || '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Bill Name</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Netflix, Mortgage..." />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Amount</label>
          <input type="number" className="input" value={form.amount} onChange={e => set('amount', e.target.value)} min="0" step="0.01" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Due Day (1-31)</label>
          <input type="number" className="input" value={form.due_day} onChange={e => set('due_day', e.target.value)} min="1" max="31" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Frequency</label>
          <select className="select" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="annual">Annual</option>
            <option value="once">One-time</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Category</label>
          <select className="select" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">Uncategorized</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Notes</label>
          <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save Bill</button>
      </div>
    </div>
  );
}

export default function Bills() {
  const { showToast } = useAppStore();
  const [data, setData] = useState({ bills: [], upcoming: [], upcomingTotal: 0, checkingBalance: 0, warning: false });
  const [patterns, setPatterns] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editBill, setEditBill] = useState(null);
  const [activeTab, setActiveTab] = useState('bills');

  const load = async () => {
    const [b, c, r] = await Promise.all([
      billsApi.list(),
      categoriesApi.list(),
      billsApi.recurring(),
    ]);
    setData(b.data);
    setCategories(c.data);
    setPatterns(r.data);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (form) => {
    await billsApi.create({
      ...form,
      amount: parseFloat(form.amount),
      due_day: parseInt(form.due_day),
      category_id: form.category_id ? parseInt(form.category_id) : null,
    });
    setShowAdd(false);
    load();
    showToast('Bill added');
  };

  const handleDelete = async (id) => {
    await billsApi.delete(id);
    load();
    showToast('Bill removed');
  };

  const totalMonthly = data.bills.reduce((s, b) => {
    if (b.frequency === 'monthly') return s + b.amount;
    if (b.frequency === 'annual') return s + b.amount / 12;
    return s;
  }, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-100">Bills & Subscriptions</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track recurring payments</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} className="inline mr-1" />Add Bill
        </button>
      </div>

      {/* Warning banner */}
      {data.warning && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 animate-slide-up">
          <AlertTriangle size={16} />
          <div>
            <p className="text-sm font-medium">Low checking balance warning</p>
            <p className="text-xs text-amber-400/70">
              Balance: {formatCurrency(data.checkingBalance)} — Bills due in 7 days: {formatCurrency(data.upcomingTotal)}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Monthly Total" value={formatCurrency(totalMonthly)} icon={CreditCard} color="indigo" />
        <StatCard label="Due Next 7 Days" value={formatCurrency(data.upcomingTotal)} icon={AlertTriangle}
          color={data.warning ? 'red' : 'amber'} />
        <StatCard label="TD Checking Balance" value={formatCurrency(data.checkingBalance)} icon={CheckCircle}
          color={data.checkingBalance < data.upcomingTotal ? 'red' : 'green'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b" style={{ borderColor: 'var(--border)' }}>
        {['bills', 'recurring'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`pb-3 text-sm font-medium capitalize transition-colors ${activeTab === t ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {t === 'bills' ? 'My Bills' : 'Detected Subscriptions'}
          </button>
        ))}
      </div>

      {activeTab === 'bills' && (
        <Card>
          {data.bills.length === 0 ? (
            <div className="p-8">
              <EmptyState icon={CreditCard} title="No bills yet"
                action={<button className="btn-primary" onClick={() => setShowAdd(true)}>Add Bill</button>} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="px-4 py-3 text-left section-title">Name</th>
                  <th className="px-4 py-3 text-left section-title">Amount</th>
                  <th className="px-4 py-3 text-left section-title">Frequency</th>
                  <th className="px-4 py-3 text-left section-title">Next Due</th>
                  <th className="px-4 py-3 text-left section-title">Category</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {data.bills.map(b => {
                  const isUpcoming = data.upcoming.some(u => u.id === b.id);
                  return (
                    <tr key={b.id} className="table-row">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isUpcoming && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                          <span className="text-slate-200">{b.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-rose-400">{formatCurrency(b.amount)}</td>
                      <td className="px-4 py-3">
                        <Badge>{b.frequency}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(b.next_due)}</td>
                      <td className="px-4 py-3">
                        {b.category_name && <Badge color="#6366f1">{b.category_name}</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button className="btn-ghost p-1" onClick={() => setEditBill(b)}><Edit2 size={13} /></button>
                          <button className="btn-ghost p-1 text-red-400" onClick={() => handleDelete(b.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {activeTab === 'recurring' && (
        <Card className="p-5">
          <SectionHeader title="Detected Recurring Transactions"
            subtitle="Based on transaction history patterns" />
          {patterns.length === 0 ? (
            <EmptyState icon={Repeat} title="No patterns detected" description="Import more transactions to detect recurring charges." />
          ) : (
            <div className="space-y-2">
              {patterns.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}>
                  <div className="flex-1">
                    <p className="text-sm text-slate-200 truncate max-w-xs">{p.description_pattern}</p>
                    <p className="text-xs text-slate-500">~every {p.frequency_days} days · last seen {formatDate(p.last_seen)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-rose-400">{formatCurrency(p.avg_amount)}/mo avg</p>
                    {p.category_name && <Badge color="#6366f1" className="mt-1">{p.category_name}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Bill" size="md">
        <BillForm categories={categories} onSave={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>

      <Modal open={!!editBill} onClose={() => setEditBill(null)} title="Edit Bill" size="md">
        {editBill && (
          <BillForm bill={editBill} categories={categories}
            onSave={async (form) => {
              await billsApi.update(editBill.id, { ...form, amount: parseFloat(form.amount), due_day: parseInt(form.due_day) });
              setEditBill(null); load(); showToast('Bill updated');
            }}
            onCancel={() => setEditBill(null)}
          />
        )}
      </Modal>
    </div>
  );
}
