import type { AxiosRequestConfig } from 'axios';

const requestUse = jest.fn();
const responseUse = jest.fn();
const axiosCreate = jest.fn((config: unknown) => {
  void config;
  return {
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
    get: jest.fn(),
    post: jest.fn(),
  };
});

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: (config: unknown) => axiosCreate(config),
  },
}));

describe('api service', () => {
  beforeEach(() => {
    jest.resetModules();
    requestUse.mockClear();
    responseUse.mockClear();
    axiosCreate.mockClear();
    sessionStorage.clear();
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    window.history.pushState({}, '', '/dashboard');
  });

  it('configures the API client with credentials, timeout, and JSON headers', async () => {
    await import('../services/api');

    expect(axiosCreate).toHaveBeenCalledWith(expect.objectContaining({
      timeout: 15_000,
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('adds the CSRF header to unsafe requests when the csrf cookie exists', async () => {
    document.cookie = 'csrf_token=csrf123; path=/';
    await import('../services/api');
    const requestInterceptor = requestUse.mock.calls[0][0] as (config: AxiosRequestConfig) => AxiosRequestConfig;

    const config = requestInterceptor({ method: 'post', headers: {} });

    expect(config.headers?.['x-csrf-token' as keyof typeof config.headers]).toBe('csrf123');
  });


  it('creates request headers before adding CSRF when Axios provides none', async () => {
    document.cookie = 'csrf_token=csrf456; path=/';
    await import('../services/api');
    const requestInterceptor = requestUse.mock.calls[0][0] as (config: AxiosRequestConfig) => AxiosRequestConfig;

    const config = requestInterceptor({ method: 'put' });

    expect(config.headers?.['x-csrf-token' as keyof typeof config.headers]).toBe('csrf456');
  });


  it('does not add CSRF headers to safe requests, requests without methods, or requests without a cookie', async () => {
    await import('../services/api');
    const requestInterceptor = requestUse.mock.calls[0][0] as (config: AxiosRequestConfig) => AxiosRequestConfig;

    expect(requestInterceptor({ method: 'get', headers: {} }).headers?.['x-csrf-token' as never]).toBeUndefined();
    expect(requestInterceptor({ headers: {} }).headers?.['x-csrf-token' as never]).toBeUndefined();
    expect(requestInterceptor({ method: 'delete', headers: {} }).headers?.['x-csrf-token' as never]).toBeUndefined();
  });

  it('leaves non-401 errors and existing login locations unchanged', async () => {
    await import('../services/api');
    const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: { response?: { status?: number } }) => Promise<never>;

    await expect(rejectionInterceptor({ response: { status: 500 } })).rejects.toEqual({ response: { status: 500 } });
    window.history.pushState({}, '', '/login');
    await expect(rejectionInterceptor({ response: { status: 401 } })).rejects.toEqual({ response: { status: 401 } });
    expect(window.location.pathname).toBe('/login');
  });

  it('exposes typed API helpers for each backend resource', async () => {
    const api = await import('../services/api');
    const client = api.apiClient as unknown as { get: jest.Mock; post: jest.Mock };

    api.authApi.login('user@example.com', 'pw', 'org-1');
    api.authApi.register({ email: 'user@example.com', password: 'pw', firstName: 'A', lastName: 'B', organizationId: 'org-1' });
    api.authApi.refresh();
    api.authApi.logout();
    api.authApi.verifyMfa('temp', '123456');
    api.financialsApi.getKpis(2026);
    api.financialsApi.getSummary(2026);
    api.financialsApi.getRevenue('2026-01-01', '2026-01-31');
    api.financialsApi.getExpenses('2026-01-01', '2026-01-31');
    api.financialsApi.getCashFlow('2026-01-01', '2026-01-31');
    api.forecastingApi.getForecast(6, 'revenue');
    api.forecastingApi.getBudgetVariance(2026);
    api.complianceApi.getStatus();
    api.complianceApi.getAuditLog();
    api.complianceApi.getAlerts('critical');
    api.insightsApi.getInsights();
    api.billingApi.getSubscription();
    api.billingApi.createSubscription('pro');

    expect(client.post).toHaveBeenCalledWith('/auth/login', { email: 'user@example.com', password: 'pw', organizationId: 'org-1' });
    expect(client.get).toHaveBeenCalledWith('/financials/revenue', { params: { startDate: '2026-01-01', endDate: '2026-01-31' } });
    expect(client.post).toHaveBeenCalledWith('/billing/subscription', { plan: 'pro' });
  });


  it('clears session state and redirects to login after a 401 response', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    await import('../services/api');
    const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: { response?: { status?: number } }) => Promise<never>;

    await expect(rejectionInterceptor({ response: { status: 401 } })).rejects.toEqual({ response: { status: 401 } });

    expect(sessionStorage.getItem('auth_session_active')).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(Event));
    expect(window.location.pathname).toBe('/login');
    dispatchSpy.mockRestore();
  });
});
