// client/src/components/ui/StickyTable.jsx
// Composable sticky-header table with column visibility toggles + bulk actions
import React, { useState, useRef, useCallback } from 'react';
import { Settings2, ChevronUp, ChevronDown, Check, Minus } from 'lucide-react';

// ─── Column visibility toggle popover ─────────────────────────────────────────
export function ColumnToggle({ columns, visible, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        title="Toggle columns"
      >
        <Settings2 size={13} />
        Columns
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-9 z-50 rounded-xl shadow-2xl p-3 min-w-44"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Show columns</p>
            {columns.map(col => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-white/5 text-xs"
                style={{ color: 'var(--text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={visible.includes(col.key)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...visible, col.key]
                      : visible.filter(k => k !== col.key);
                    onChange(next);
                  }}
                  className="sr-only"
                />
                <span
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    background: visible.includes(col.key) ? 'var(--accent)' : 'var(--bg-input)',
                    border: `1px solid ${visible.includes(col.key) ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {visible.includes(col.key) && <Check size={10} color="#fff" />}
                </span>
                {col.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sort header cell ─────────────────────────────────────────────────────────
export function SortableHeader({ label, sortKey, currentSort, onSort, align = 'left' }) {
  const isActive = currentSort?.key === sortKey;
  const dir = isActive ? currentSort.dir : null;

  return (
    <th
      className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{
        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
        textAlign: align,
        letterSpacing: '0.06em',
        background: 'var(--bg-secondary)',
      }}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col" style={{ opacity: isActive ? 1 : 0.3 }}>
          <ChevronUp size={10} style={{ marginBottom: -2, color: dir === 'asc' ? 'var(--accent)' : undefined }} />
          <ChevronDown size={10} style={{ color: dir === 'desc' ? 'var(--accent)' : undefined }} />
        </span>
      </span>
    </th>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────
export function BulkActionBar({ selected, total, onSelectAll, onDeselectAll, actions }) {
  if (selected.length === 0) return null;
  const allSelected = selected.length === total;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm animate-slide-up"
      style={{
        background: 'var(--accent-glow)',
        border: '1px solid var(--accent)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Selection count + toggle */}
      <button
        onClick={allSelected ? onDeselectAll : onSelectAll}
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--accent)', border: '1px solid var(--accent)' }}
        title={allSelected ? 'Deselect all' : 'Select all'}
      >
        {allSelected ? <Check size={11} color="#fff" /> : <Minus size={11} color="#fff" />}
      </button>

      <span className="font-medium" style={{ color: 'var(--accent)' }}>
        {selected.length} selected
      </span>

      <span className="opacity-30">|</span>

      {/* Action buttons */}
      {actions.map(a => (
        <button
          key={a.label}
          onClick={() => a.onClick(selected)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
          style={{
            background: a.danger ? 'rgba(239,68,68,0.15)' : 'var(--bg-card)',
            border: `1px solid ${a.danger ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
            color: a.danger ? 'var(--danger)' : 'var(--text-primary)',
          }}
        >
          {a.icon && <a.icon size={12} />}
          {a.label}
        </button>
      ))}

      <div className="flex-1" />
      <button onClick={onDeselectAll} style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        Clear
      </button>
    </div>
  );
}

// ─── Composable sticky table wrapper ─────────────────────────────────────────
// Usage:
//   <StickyTable maxHeight="calc(100vh - 280px)">
//     <thead>…</thead>
//     <tbody>…</tbody>
//   </StickyTable>
export function StickyTable({ children, maxHeight = '60vh', className = '' }) {
  return (
    <div
      className={`overflow-auto rounded-xl ${className}`}
      style={{
        maxHeight,
        border: '1px solid var(--border)',
      }}
    >
      <table
        className="w-full border-collapse"
        style={{ borderSpacing: 0 }}
      >
        {children}
      </table>
    </div>
  );
}

// ─── Sticky thead ─────────────────────────────────────────────────────────────
export function StickyThead({ children }) {
  return (
    <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      {children}
    </thead>
  );
}

// ─── Row hover + selection ────────────────────────────────────────────────────
export function SelectableRow({ selected, onSelect, onClick, children, style = {} }) {
  return (
    <tr
      onClick={onClick}
      className="transition-colors cursor-pointer"
      style={{
        background: selected ? 'var(--accent-glow)' : undefined,
        borderBottom: '1px solid var(--border)',
        ...style,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = ''; }}
    >
      <td className="px-3 py-2.5 w-8" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="w-3.5 h-3.5 rounded"
          style={{ accentColor: 'var(--accent)' }}
        />
      </td>
      {children}
    </tr>
  );
}
