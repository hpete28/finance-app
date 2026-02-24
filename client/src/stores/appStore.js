// src/stores/appStore.js
import { create } from 'zustand';
import { currentMonth } from '../utils/format';

const savedTheme = localStorage.getItem('ledger_theme') || 'dark';

const useAppStore = create((set, get) => ({
  selectedMonth: currentMonth(),
  selectedAccount: null,
  categories: [],
  accounts: [],
  toast: null,
  theme: savedTheme,

  setMonth:      (month) => set({ selectedMonth: month }),
  setAccount:    (accountId) => set({ selectedAccount: accountId }),
  setCategories: (categories) => set({ categories }),
  setAccounts:   (accounts) => set({ accounts }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ledger_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },

  showToast: (message, type = 'success') => {
    set({ toast: { message, type, id: Date.now() } });
    setTimeout(() => set({ toast: null }), 3500);
  },
  dismissToast: () => set({ toast: null }),
}));

// Apply theme on load
document.documentElement.setAttribute('data-theme', savedTheme);

export default useAppStore;
