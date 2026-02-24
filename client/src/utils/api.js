// src/utils/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Transactions
export const transactionsApi = {
  list: (params) => api.get('/transactions', { params }),
  get: (id) => api.get(`/transactions/${id}`),
  update: (id, data) => api.patch(`/transactions/${id}`, data),
  delete: (id) => api.delete(`/transactions/${id}`),
  bulk: (data) => api.post('/transactions/bulk', data),
  bulkDelete: (ids) => api.delete('/transactions/bulk', { data: { ids } }),
  restore: (transactions) => api.post('/transactions/restore', { transactions }),
  split: (id, splits) => api.post(`/transactions/${id}/split`, { splits }),
  monthlySummary: (params) => api.get('/transactions/summary/monthly', { params }),
};

// Categories
export const categoriesApi = {
  list: () => api.get('/categories'),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.patch(`/categories/${id}`, data),
  delete: (id) => api.delete(`/categories/${id}`),
};

// Rules
export const rulesApi = {
  list: () => api.get('/rules'),
  create: (data) => api.post('/rules', data),
  update: (id, data) => api.patch(`/rules/${id}`, data),
  delete: (id) => api.delete(`/rules/${id}`),
  apply: (overwrite = false) => api.post('/rules/apply', { overwrite }),
};

// Budgets
export const budgetsApi = {
  list: (month) => api.get('/budgets', { params: { month } }),
  upsert: (data) => api.put('/budgets', data),
  rollover: (from_month) => api.post('/budgets/rollover', { from_month }),
};

// Analytics
export const analyticsApi = {
  spendingByCategory: (params) => api.get('/analytics/spending-by-category', { params }),
  monthlyTrend: (params) => api.get('/analytics/monthly-trend', { params }),
  categoryTrend: (params) => api.get('/analytics/category-trend', { params }),
  topMerchants: (params) => api.get('/analytics/top-merchants', { params }),
  cashflow: (params) => api.get('/analytics/cashflow', { params }),
  accountsSummary: () => api.get('/analytics/accounts-summary'),
  categoryBreakdown: (params) => api.get('/analytics/category-breakdown', { params }),
  merchantSearch: (params) => api.get('/analytics/merchant-search', { params }),
  yearSummary: (params) => api.get('/analytics/year-summary', { params }),
};

// Bills
export const billsApi = {
  list: () => api.get('/bills'),
  create: (data) => api.post('/bills', data),
  update: (id, data) => api.patch(`/bills/${id}`, data),
  delete: (id) => api.delete(`/bills/${id}`),
  recurring: () => api.get('/bills/recurring'),
};

// Net Worth
export const networthApi = {
  current: () => api.get('/networth/current'),
  snapshot: () => api.post('/networth/snapshot'),
  history: (limit) => api.get('/networth/history', { params: { limit } }),
  assets: {
    list: () => api.get('/networth/assets'),
    create: (data) => api.post('/networth/assets', data),
    update: (id, data) => api.patch(`/networth/assets/${id}`, data),
    delete: (id) => api.delete(`/networth/assets/${id}`),
  },
};

// Upload
export const uploadApi = {
  transactions: (files) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return api.post('/upload/transactions', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  rules: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/upload/rules', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
};


export const importHistoryApi = {
  list: (limit = 25) => api.get('/import-history', { params: { limit } }),
};

// Health
export const healthApi = { check: () => api.get('/health') };

export default api;
