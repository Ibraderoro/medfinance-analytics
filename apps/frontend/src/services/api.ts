import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

const tokenStore = {
  getAccessToken: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  setAccessToken: (value: string) => localStorage.setItem(ACCESS_TOKEN_KEY, value),
  clearAccessToken: () => localStorage.removeItem(ACCESS_TOKEN_KEY),
  getRefreshToken: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),
  setRefreshToken: (value: string) => sessionStorage.setItem(REFRESH_TOKEN_KEY, value),
  clearRefreshToken: () => sessionStorage.removeItem(REFRESH_TOKEN_KEY),
  clearAll: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// Attach JWT from localStorage to every request
apiClient.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshingPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshingPromise) {
    refreshingPromise = (async () => {
      const refreshToken = tokenStore.getRefreshToken();
      if (!refreshToken) return null;

      try {
        const response = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
          `${BASE_URL}/auth/refresh`,
          { refreshToken },
          { timeout: 15_000 },
        );

        tokenStore.setAccessToken(response.data.data.accessToken);
        tokenStore.setRefreshToken(response.data.data.refreshToken);
        return response.data.data.accessToken;
      } catch {
        tokenStore.clearAll();
        return null;
      } finally {
        refreshingPromise = null;
      }
    })();
  }

  return refreshingPromise;
}

// Global error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as { _retry?: boolean; headers?: Record<string, string> };

    if (error.response?.status === 401 && !originalRequest?._retry) {
      originalRequest._retry = true;
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        originalRequest.headers = {
          ...(originalRequest.headers ?? {}),
          Authorization: `Bearer ${newAccessToken}`,
        };
        return apiClient.request(originalRequest as never);
      }

      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<{ data: { accessToken: string; refreshToken: string } }>(
      '/auth/login',
      { email, password },
    ),
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationId: string;
    role?: string;
  }) =>
    apiClient.post<{ data: { accessToken: string; refreshToken: string } }>(
      '/auth/register',
      data,
    ),
  refresh: (refreshToken: string) =>
    apiClient.post<{ data: { accessToken: string; refreshToken: string } }>(
      '/auth/refresh',
      { refreshToken },
    ),
  logout: (refreshToken?: string) =>
    apiClient.post('/auth/logout', { refreshToken }),
};

// ── Financials ──────────────────────────────────────────────────────────────
export const financialsApi = {
  getKpis: (year?: number) =>
    apiClient.get('/financials/kpis', { params: { year } }),
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


// ── Insights ────────────────────────────────────────────────────────────────
export const insightsApi = {
  getInsights: () => apiClient.get('/insights'),
};
