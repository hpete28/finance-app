// src/pages/NetWorth.jsx
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, TrendingUp } from 'lucide-react';
import { networthApi } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { Card, StatCard, Modal, SectionHeader, EmptyState, Badge } from '../components/ui';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import useAppStore from '../stores/appStore';

export default function NetWorth() {
  const { showToast } = useAppStore();
  const [current, setCurrent] = useState({ totalAssets: 0, totalLiabilities: 0, netWorth: 0, breakdown: {} });
  const [history, setHistory] = useState([]);
  const [assets, setAssets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', type: 'asset', value: '', notes: '' });

  const load = async () => {
    const [c, h, a] = await Promise.all([
      networthApi.current(),
      networthApi.history(36),
      networthApi.assets.list(),
    ]);
    setCurrent(c.data);
    setHistory(h.data);
    setAssets(a.data);
  };

  useEffect(() => { load(); }, []);

  const handleSnapshot = async () => {
    await networthApi.snapshot();
    load();
    showToast('Net worth snapshot saved');
  };

  const handleAddAsset = async () => {
    await networthApi.assets.create({ ...addForm, value: parseFloat(addForm.value) });
    setShowAdd(false);
    setAddForm({ name: '', type: 'asset', value: '', notes: '' });
    load();
    showToast('Asset added');
  };

  const handleDeleteAsset = async (id) => {
    await networthApi.assets.delete(id);
    load();
    showToast('Asset removed');
  };

  const breakdown = current.breakdown || {};
  const accountRows = breakdown.accounts || [];
  const manualRows = breakdown.manual || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-100">Net Worth</h1>
          <p className="text-sm text-slate-500 mt-0.5">Assets minus liabilities</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={handleSnapshot}>
            <RefreshCw size={12} className="inline mr-1" />Snapshot Today
          </button>
          <button className="btn-primary text-xs" onClick={() => setShowAdd(true)}>
            <Plus size={12} className="inline mr-1" />Add Asset
          </button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total Assets"
          value={formatCurrency(current.totalAssets)}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          label="Total Liabilities"
          value={formatCurrency(current.totalLiabilities)}
          icon={TrendingUp}
          color="red"
        />
        <div className="card p-5 bg-gradient-to-br from-indigo-500/10 to-transparent border-indigo-500/20 glow-indigo">
          <p className="section-title mb-2">Net Worth</p>
          <p className={`font-mono text-3xl font-bold ${current.netWorth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {formatCurrency(current.netWorth)}
          </p>
          {history.length >= 2 && (
            <p className={`text-xs mt-2 ${
              current.netWorth >= history[history.length - 2]?.net_worth ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {current.netWorth >= (history[history.length - 2]?.net_worth || 0) ? '↑' : '↓'}
              {formatCurrency(Math.abs(current.netWorth - (history[history.length - 2]?.net_worth || 0)))} since last snapshot
            </p>
          )}
        </div>
      </div>

      {/* History chart */}
      {history.length > 1 && (
        <Card className="p-5">
          <SectionHeader title="Net Worth History" subtitle="Saved snapshots over time" />
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={d => d.slice(0, 7)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={v => formatCurrency(v)}
                contentStyle={{ background: '#111827', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
              <Area type="monotone" dataKey="net_worth" name="Net Worth" stroke="#10b981"
                fill="url(#nwGrad)" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Accounts breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <SectionHeader title="Account Balances" />
          <div className="space-y-3">
            {accountRows.map((acc, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm text-slate-200">{acc.name}</p>
                  <Badge>{acc.type.replace('_', ' ')}</Badge>
                </div>
                <span className={`font-mono text-sm ${acc.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatCurrency(acc.balance, acc.currency)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            title="Manual Assets & Liabilities"
            actions={
              <button className="btn-ghost text-xs" onClick={() => setShowAdd(true)}>
                <Plus size={12} className="inline mr-0.5" />Add
              </button>
            }
          />
          {manualRows.length === 0 && assets.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No manual assets"
              description="Add home value, vehicles, investments, etc." />
          ) : (
            <div className="space-y-2">
              {assets.map(a => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-sm text-slate-200">{a.name}</p>
                    <Badge color={a.type === 'asset' ? '#10b981' : '#ef4444'}>{a.type}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${a.type === 'asset' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {a.type === 'liability' ? '−' : ''}{formatCurrency(a.value)}
                    </span>
                    <button className="btn-ghost p-1 text-red-400" onClick={() => handleDeleteAsset(a.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Add Asset Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Asset / Liability" size="sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Name</label>
            <input className="input" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Home, Vehicle, Student Loan..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Type</label>
              <select className="select" value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}>
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Value</label>
              <input type="number" className="input" value={addForm.value}
                onChange={e => setAddForm(f => ({ ...f, value: e.target.value }))}
                min="0" step="100" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Notes</label>
            <input className="input" value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAddAsset}>Add</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
