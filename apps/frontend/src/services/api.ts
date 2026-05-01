import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

function readCookie(name: string): string | null {
  const pair = document.cookie.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  if (!pair) return null;
  return decodeURIComponent(pair.split('=').slice(1).join('='));
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const csrfToken = readCookie('csrf_token');
  if (csrfToken && config.method && !['get', 'head', 'options'].includes(config.method.toLowerCase())) {
    config.headers['x-csrf-token'] = csrfToken;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('auth_session_active');
      window.dispatchEvent(new Event('auth-session-changed'));
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const authApi = {
  login: (email: string, password: string, organizationId: string) => apiClient.post('/auth/login', { email, password, organizationId }),
  register: (data: { email: string; password: string; firstName: string; lastName: string; organizationId: string; role?: string }) => apiClient.post('/auth/register', data),
  refresh: () => apiClient.post('/auth/refresh', {}),
  logout: () => apiClient.post('/auth/logout', {}),
};

export const financialsApi = {
  getKpis: (year?: number) => apiClient.get('/financials/kpis', { params: { year } }),
  getSummary: (year?: number) => apiClient.get('/financials/summary', { params: { year } }),
  getRevenue: (startDate?: string, endDate?: string) => apiClient.get('/financials/revenue', { params: { startDate, endDate } }),
  getExpenses: (startDate?: string, endDate?: string) => apiClient.get('/financials/expenses', { params: { startDate, endDate } }),
  getCashFlow: (startDate?: string, endDate?: string) => apiClient.get('/financials/cash-flow', { params: { startDate, endDate } }),
};

export const forecastingApi = {
  getForecast: (months?: number, metric?: string) => apiClient.get('/forecasting/forecast', { params: { months, metric } }),
  getBudgetVariance: (year?: number) => apiClient.get('/forecasting/budget-variance', { params: { year } }),
};

export const complianceApi = {
  getStatus: () => apiClient.get('/compliance/status'),
  getAuditLog: (page = 1, limit = 50) => apiClient.get('/compliance/audit-log', { params: { page, limit } }),
  getAlerts: (severity?: string) => apiClient.get('/compliance/alerts', { params: { severity } }),
};

export const insightsApi = { getInsights: () => apiClient.get('/insights') };
