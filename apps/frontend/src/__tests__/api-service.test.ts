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
