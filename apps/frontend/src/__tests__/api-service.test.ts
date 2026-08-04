import type { AxiosRequestConfig } from 'axios';

const requestUse = jest.fn();
const responseUse = jest.fn();
const apiClientCallMock = jest.fn();

const axiosCreate = jest.fn((config: unknown) => {
  void config;
  return Object.assign(apiClientCallMock, {
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  });
});

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: (config: unknown) => axiosCreate(config),
  },
}));

const silentRefreshMock = jest.fn();
const logoutMock = jest.fn();

jest.mock('../store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ silentRefresh: silentRefreshMock, logout: logoutMock }),
  },
}));

describe('api service', () => {
  beforeEach(() => {
    jest.resetModules();
    requestUse.mockClear();
    responseUse.mockClear();
    axiosCreate.mockClear();
    apiClientCallMock.mockClear();
    silentRefreshMock.mockReset();
    logoutMock.mockReset();
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

  it('exposes typed API helpers for each backend resource, including the new session endpoint', async () => {
    const api = await import('../services/api');
    const client = api.apiClient as unknown as { get: jest.Mock; post: jest.Mock; delete: jest.Mock };

    const registerPayload = { email: 'user@example.com', password: 'pw', firstName: 'A', lastName: 'B', invitationToken: 'invite-token' };
    const createInvitePayload = { email: 'new@example.com', role: 'viewer' as const, expiresInHours: 24 };

    api.authApi.login('user@example.com', 'pw', 'org-1');
    api.authApi.register(registerPayload);
    api.authApi.verifyInvitation('invite-token');
    api.authApi.createInvitation(createInvitePayload);
    api.authApi.revokeInvitation('invite-id');
    api.authApi.refresh();
    api.authApi.logout();
    api.authApi.verifyMfa('temp', '123456');
    api.authApi.getSession();
    api.authApi.initiateOidc('user@example.com', 'org-1');
    api.authApi.completeOidc('state-1', 'code-1');
    api.authApi.generateRecoveryCodes();
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
    expect(client.post).toHaveBeenCalledWith('/auth/register', registerPayload);
    expect(client.get).toHaveBeenCalledWith('/auth/invitations/verify', { headers: { 'x-invitation-token': 'invite-token' } });
    expect(client.post).toHaveBeenCalledWith('/auth/invitations', createInvitePayload);
    expect(client.delete).toHaveBeenCalledWith('/auth/invitations/invite-id');
    expect(client.get).toHaveBeenCalledWith('/auth/me');
    expect(client.post).toHaveBeenCalledWith('/auth/oidc/initiate', { email: 'user@example.com', organizationId: 'org-1' });
    expect(client.post).toHaveBeenCalledWith('/auth/oidc/callback', { state: 'state-1', code: 'code-1' });
    expect(client.post).toHaveBeenCalledWith('/auth/recovery-codes', {});
    expect(client.get).toHaveBeenCalledWith('/financials/revenue', { params: { startDate: '2026-01-01', endDate: '2026-01-31' } });
    expect(client.post).toHaveBeenCalledWith('/billing/subscription', { plan: 'pro' });
  });

  describe('401 response interceptor', () => {
    it('passes successful responses through unchanged', async () => {
      await import('../services/api');
      const successInterceptor = responseUse.mock.calls[0][0] as (response: unknown) => unknown;

      const response = { data: 'ok' };
      expect(successInterceptor(response)).toBe(response);
    });

    it('leaves non-401 errors unchanged', async () => {
      await import('../services/api');
      const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: unknown) => Promise<never>;

      await expect(rejectionInterceptor({ response: { status: 500 } })).rejects.toEqual({ response: { status: 500 } });
      expect(silentRefreshMock).not.toHaveBeenCalled();
    });

    it('does not attempt a refresh for 401s from auth bootstrap endpoints', async () => {
      await import('../services/api');
      const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: unknown) => Promise<never>;
      const error = { response: { status: 401 }, config: { url: '/auth/refresh' } };

      await expect(rejectionInterceptor(error)).rejects.toEqual(error);
      expect(silentRefreshMock).not.toHaveBeenCalled();
    });

    it('refreshes once and retries the original request on a 401 from a regular endpoint', async () => {
      await import('../services/api');
      const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: unknown) => Promise<unknown>;
      silentRefreshMock.mockResolvedValueOnce(true);
      apiClientCallMock.mockResolvedValueOnce({ data: 'retried-ok' });
      const config = { url: '/financials/kpis' };

      const result = await rejectionInterceptor({ response: { status: 401 }, config });

      expect(silentRefreshMock).toHaveBeenCalledTimes(1);
      expect(apiClientCallMock).toHaveBeenCalledWith(expect.objectContaining({ url: '/financials/kpis', _retried: true }));
      expect(result).toEqual({ data: 'retried-ok' });
      expect(logoutMock).not.toHaveBeenCalled();
    });

    it('does not retry a request a second time (prevents infinite retry loops)', async () => {
      await import('../services/api');
      const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: unknown) => Promise<never>;
      const error = { response: { status: 401 }, config: { url: '/financials/kpis', _retried: true } };

      await expect(rejectionInterceptor(error)).rejects.toEqual(error);
      expect(silentRefreshMock).not.toHaveBeenCalled();
    });

    it('logs out and does not retry when the refresh itself fails', async () => {
      await import('../services/api');
      const rejectionInterceptor = responseUse.mock.calls[0][1] as (error: unknown) => Promise<never>;
      silentRefreshMock.mockResolvedValueOnce(false);
      const error = { response: { status: 401 }, config: { url: '/financials/kpis' } };

      await expect(rejectionInterceptor(error)).rejects.toEqual(error);

      expect(logoutMock).toHaveBeenCalledWith({ reason: 'expired' });
      expect(apiClientCallMock).not.toHaveBeenCalled();
    });
  });
});
