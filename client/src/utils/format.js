// src/utils/format.js

export function formatCurrency(amount, currency = 'CAD', compact = false) {
  if (amount === null || amount === undefined) return '—';
  const abs = Math.abs(amount);
  const opts = {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  if (compact && abs >= 1000) {
    opts.notation = 'compact';
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 1;
  }
  return new Intl.NumberFormat('en-CA', opts).format(amount);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00'); // Force local midnight
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatMonth(monthStr) {
  if (!monthStr) return '—';
  const [year, month] = monthStr.split('-');
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-CA', { year: 'numeric', month: 'long' });
}

export function currentMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function monthsBack(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function amountClass(amount) {
  if (amount > 0) return 'amount-positive';
  if (amount < 0) return 'amount-negative';
  return 'amount-neutral';
}

export function pctColor(pct) {
  if (pct >= 100) return '#ef4444';
  if (pct >= 80)  return '#f59e0b';
  return '#10b981';
}

export function truncate(str, len = 40) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}
