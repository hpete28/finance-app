// client/src/components/ui/FilterChips.jsx
// Chip-based filter presets + saved view management
import React, { useState } from 'react';
import { X, Bookmark, BookmarkCheck, ChevronDown } from 'lucide-react';

// ─── Single chip ──────────────────────────────────────────────────────────────
export function Chip({ label, active, color, onRemove, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
      style={{
        background: active
          ? (color ? color + '22' : 'var(--accent-glow)')
          : 'var(--bg-card)',
        border: `1px solid ${active ? (color || 'var(--accent)') : 'var(--border)'}`,
        color: active ? (color || 'var(--accent)') : 'var(--text-secondary)',
      }}
    >
      {label}
      {count != null && (
        <span className="ml-0.5 opacity-60">{count}</span>
      )}
      {onRemove && active && (
        <X size={10} className="ml-0.5 opacity-70 hover:opacity-100" onClick={e => { e.stopPropagation(); onRemove(); }} />
      )}
    </button>
  );
}

// ─── Preset chip row ──────────────────────────────────────────────────────────
const PRESETS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_30',    label: 'Last 30 days' },
  { id: 'last_90',    label: 'Last 90 days' },
  { id: 'ytd',        label: 'Year to date' },
  { id: 'uncategorized', label: 'Uncategorized' },
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'large',      label: '>$100' },
  { id: 'recurring',  label: 'Recurring' },
];

export function PresetChips({ active, onChange, extra = [] }) {
  const all = [...PRESETS, ...extra];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map(p => (
        <Chip
          key={p.id}
          label={p.label}
          color={p.color}
          active={active === p.id}
          onClick={() => onChange(active === p.id ? null : p.id)}
        />
      ))}
    </div>
  );
}

// ─── Active filter tags (show what's currently filtered) ──────────────────────
export function ActiveFilterTags({ filters, onRemove, onClearAll }) {
  const entries = Object.entries(filters).filter(([, v]) => v != null && v !== '' && v !== false);
  if (!entries.length) return null;

  const LABELS = {
    category: 'Category',
    account: 'Account',
    start_date: 'From',
    end_date: 'To',
    search: 'Search',
    min_amount: 'Min $',
    max_amount: 'Max $',
    tags: 'Tag',
    preset: 'Preset',
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Active:</span>
      {entries.map(([key, val]) => (
        <Chip
          key={key}
          label={`${LABELS[key] ?? key}: ${val}`}
          active
          onRemove={() => onRemove(key)}
        />
      ))}
      <button
        onClick={onClearAll}
        className="text-xs underline"
        style={{ color: 'var(--text-muted)' }}
      >
        Clear all
      </button>
    </div>
  );
}

// ─── Saved Views ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'finance_saved_views';

export function useSavedViews() {
  const [views, setViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });

  const save = (name, filters) => {
    const next = [...views.filter(v => v.name !== name), { name, filters, ts: Date.now() }];
    setViews(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const remove = (name) => {
    const next = views.filter(v => v.name !== name);
    setViews(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return { views, save, remove };
}

export function SavedViewsMenu({ views, onLoad, onSave, onDelete, currentFilters }) {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        <Bookmark size={13} />
        Views
        <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-9 z-50 rounded-xl shadow-2xl p-3 min-w-56"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          {/* Save current */}
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Save current view</p>
          <div className="flex gap-1.5 mb-3">
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="View name…"
              className="flex-1 px-2 py-1 rounded-lg text-xs"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) { onSave(saveName.trim(), currentFilters); setSaveName(''); } }}
            />
            <button
              disabled={!saveName.trim()}
              onClick={() => { onSave(saveName.trim(), currentFilters); setSaveName(''); }}
              className="px-2 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Save
            </button>
          </div>

          {/* Saved list */}
          {views.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Saved views</p>
              {views.map(v => (
                <div key={v.name} className="flex items-center gap-1.5 group">
                  <button
                    onClick={() => { onLoad(v.filters); setOpen(false); }}
                    className="flex-1 text-left px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <BookmarkCheck size={11} className="inline mr-1.5 opacity-60" />
                    {v.name}
                  </button>
                  <button
                    onClick={() => onDelete(v.name)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded"
                    style={{ color: 'var(--danger)' }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </>
          )}

          {views.length === 0 && (
            <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>No saved views yet</p>
          )}
        </div>
      )}
    </div>
  );
}
