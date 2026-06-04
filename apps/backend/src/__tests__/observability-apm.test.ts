const originalEnv = {
  JWT_SECRET: process.env.JWT_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  AUDIT_EXPORT_SIGNING_SECRET: process.env.AUDIT_EXPORT_SIGNING_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  TRACE_SAMPLE_RATE: process.env.TRACE_SAMPLE_RATE,
};

process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';
process.env.TRACE_SAMPLE_RATE = '1';

const mockRecordRequest = jest.fn();
const mockWarn = jest.fn();

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    recordRequest: (...args: unknown[]) => mockRecordRequest(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { observabilityMiddleware } from '../middleware/observability';

describe('observability middleware trace correlation and RED metrics', () => {
  afterAll(() => {
    const restore = (key: keyof typeof originalEnv): void => {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };

    restore('JWT_SECRET');
    restore('REFRESH_TOKEN_SECRET');
    restore('AUDIT_EXPORT_SIGNING_SECRET');
    restore('DATABASE_URL');
    restore('TRACE_SAMPLE_RATE');
  });

  beforeEach(() => {
    mockRecordRequest.mockReset();
    mockWarn.mockReset();
  });

  function responseDouble(statusCode: number) {
    const handlers: Record<string, () => void> = {};
    const headers: Record<string, string> = {};
    return {
      handlers,
      res: {
        statusCode,
        on: (event: string, cb: () => void) => { handlers[event] = cb; },
        setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
      },
      headers,
    };
  }

  it('continues inbound trace context and records route/status RED labels', () => {
    const incomingTraceId = '11111111111111111111111111111111';
    const { handlers, res, headers } = responseDouble(200);
    const req = {
      method: 'GET',
      path: '/api/v1/financials/123',
      originalUrl: '/api/v1/financials/123?limit=1',
      baseUrl: '/api/v1/financials',
      route: { path: '/:id' },
      requestId: 'req-123',
      header: (name: string) => (name === 'traceparent' ? `00-${incomingTraceId}-2222222222222222-01` : undefined),
    };

    observabilityMiddleware(req as never, res as never, jest.fn());
    handlers.finish();

    expect(headers['x-trace-id']).toBe(incomingTraceId);
    expect(headers.traceparent).toMatch(new RegExp(`^00-${incomingTraceId}-[0-9a-f]{16}-01$`));
    expect(mockRecordRequest).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      method: 'GET',
      route: '/api/v1/financials/:id',
      status_code: 200,
      status_class: '2xx',
      outcome: 'success',
    }));
  });

  it('logs 5xx completions with request and route context', () => {
    const { handlers, res } = responseDouble(500);
    const req = {
      method: 'POST',
      path: '/api/v1/billing/webhook',
      originalUrl: '/api/v1/billing/webhook',
      requestId: 'req-500',
      header: () => undefined,
    };

    observabilityMiddleware(req as never, res as never, jest.fn());
    handlers.finish();

    expect(mockRecordRequest).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ status_code: 500, outcome: 'error' }));
    expect(mockWarn).toHaveBeenCalledWith('HTTP request completed with server error', expect.objectContaining({ requestId: 'req-500', statusCode: 500 }));
  });
});
