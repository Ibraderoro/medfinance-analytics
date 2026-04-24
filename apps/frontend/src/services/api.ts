import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT from localStorage to every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Global error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ── Financials ──────────────────────────────────────────────────────────────
export const financialsApi = {
  getSummary: (year?: number) =>
    apiClient.get('/financials/summary', { params: { year } }),
  getRevenue: (startDate?: string, endDate?: string) =>
    apiClient.get('/financials/revenue', { params: { startDate, endDate } }),
  getExpenses: (startDate?: string, endDate?: string) =>
    apiClient.get('/financials/expenses', { params: { startDate, endDate } }),
  getCashFlow: (startDate?: string, endDate?: string) =>
    apiClient.get('/financials/cash-flow', { params: { startDate, endDate } }),
};

// ── Forecasting ─────────────────────────────────────────────────────────────
export const forecastingApi = {
  getForecast: (months?: number, metric?: string) =>
    apiClient.get('/forecasting/forecast', { params: { months, metric } }),
  getBudgetVariance: (year?: number) =>
    apiClient.get('/forecasting/budget-variance', { params: { year } }),
};

// ── Compliance ──────────────────────────────────────────────────────────────
export const complianceApi = {
  getStatus: () => apiClient.get('/compliance/status'),
  getAuditLog: (page = 1, limit = 50) =>
    apiClient.get('/compliance/audit-log', { params: { page, limit } }),
  getAlerts: (severity?: string) =>
    apiClient.get('/compliance/alerts', { params: { severity } }),
};
