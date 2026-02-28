// src/utils/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Transactions
export const transactionsApi = {
  list: (params) => api.get('/transactions', { params }),
  tags: (params) => api.get('/transactions/tags', { params }),
  get: (id) => api.get(`/transactions/${id}`),
  update: (id, data) => api.patch(`/transactions/${id}`, data),
  updateLock: (id, data) => api.patch(`/transactions/${id}/lock`, data),
  delete: (id) => api.delete(`/transactions/${id}`),
  bulk: (data) => api.post('/transactions/bulk', data),
  bulkDelete: (ids) => api.delete('/transactions/bulk', { data: { ids } }),
  restore: (transactions) => api.post('/transactions/restore', { transactions }),
  split: (id, splits) => api.post(`/transactions/${id}/split`, { splits }),
  monthlySummary: (params) => api.get('/transactions/summary/monthly', { params }),
  exportCsv: (params) => api.get('/transactions/export.csv', { params, responseType: 'blob' }),
  transferCandidates: (params) => api.get('/transactions/transfer-candidates', { params }),
  applyTransferCandidates: (data) => api.post('/transactions/apply-transfer-candidates', data),
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
  snapshot: () => api.post('/rules/snapshot'),
  lint: ({ scope = 'all', persist = true } = {}) => api.get('/rules/lint', { params: { scope, persist } }),
  lintReports: (limit = 20) => api.get('/rules/lint/reports', { params: { limit } }),
  explain: (data) => api.post('/rules/explain', data),
  resetLearned: (data = {}) => api.post('/rules/learn/reset', data),
  rebuildLearned: (data = {}) => api.post('/rules/learn/rebuild', data),
  rebuildRuns: (limit = 20) => api.get('/rules/learn/rebuild/runs', { params: { limit } }),
  exportFile: ({ scope = 'learned', format = 'json' } = {}) => api.get('/rules/export', {
    params: { scope, format },
    responseType: 'blob',
  }),
  importFile: (file, { scope = 'learned', mode = 'replace', format } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('scope', scope);
    fd.append('mode', mode);
    if (format) fd.append('format', format);
    return api.post('/rules/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  preview: (rule, sample_limit = 20) => api.post('/rules/preview', { rule, sample_limit }),
  apply: (options = {}) => {
    if (typeof options === 'boolean') return api.post('/rules/apply', { overwrite: options });
    return api.post('/rules/apply', options);
  },
  learn: (data = {}) => api.post('/rules/learn', data),
  applyLearned: (suggestions, max_create) => api.post('/rules/learn/apply', { suggestions, max_create }),
  revertLearned: (data = {}) => api.post('/rules/learn/revert', data),
};

export const rulesetsApi = {
  list: () => api.get('/rulesets'),
  create: (data) => api.post('/rulesets', data),
  activate: (id) => api.post(`/rulesets/${id}/activate`),
  shadowCompare: (id, data = {}) => api.post(`/rulesets/${id}/shadow-compare`, data),
  extractProtected: (id, data = {}) => api.post(`/rulesets/${id}/extract-protected`, data),
  cleanupPreview: (id) => api.post(`/rulesets/${id}/cleanup/preview`),
  cleanupApply: (id) => api.post(`/rulesets/${id}/cleanup/apply`),
};


export const tagRulesApi = {
  list: () => api.get('/tag-rules'),
  create: (data) => api.post('/tag-rules', data),
  update: (id, data) => api.patch(`/tag-rules/${id}`, data),
  delete: (id) => api.delete(`/tag-rules/${id}`),
  apply: (overwrite = false) => api.post('/tag-rules/apply', { overwrite }),
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

// Local AI (Ollama)
export const aiApi = {
  status: () => api.get('/ai/status'),
  suggestTransactions: (data) => api.post('/ai/suggestions/transactions', data),
  suggestRules: (data) => api.post('/ai/rules/suggest', data),
};

// Health
export const healthApi = { check: () => api.get('/health') };

export default api;
