const originalEnv = {
  JWT_SECRET: process.env.JWT_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  AUDIT_EXPORT_SIGNING_SECRET: process.env.AUDIT_EXPORT_SIGNING_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
};

process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

const mockRecordRequest = jest.fn();
const mockGetSnapshot = jest.fn(() => ({ requestCount: 1, errorCount: 0, errorRate: 0, p95LatencyMs: 12 }));
const mockWarn = jest.fn();
const mockSetAttribute = jest.fn();
const mockAddEvent = jest.fn();

jest.mock('../services/metrics.service', () => ({
  metricsService: {
    recordRequest: (...args: unknown[]) => mockRecordRequest(...args),
    getSnapshot: () => mockGetSnapshot(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@opentelemetry/api', () => ({
  context: { active: () => ({}) },
  trace: {
    getSpan: () => ({
      setAttribute: (...args: unknown[]) => mockSetAttribute(...args),
      addEvent: (...args: unknown[]) => mockAddEvent(...args),
    }),
  },
}), { virtual: true });

import { observabilityMiddleware } from '../middleware/observability';

describe('observability middleware APM span enrichment', () => {
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
  });

  beforeEach(() => {
    mockRecordRequest.mockReset();
    mockGetSnapshot.mockClear();
    mockWarn.mockReset();
    mockSetAttribute.mockReset();
    mockAddEvent.mockReset();
  });

  it('attaches request-id and tenant/user metadata to the active span', () => {
    const handlers: Record<string, () => void> = {};
    const req = {
      method: 'GET',
      path: '/api/v1/financials/summary',
      route: { path: '/financials/summary' },
      requestId: 'req-123',
      user: { id: 'u-1', organization_id: 'org-1' },
    };
    const res = {
      statusCode: 200,
      on: (event: string, cb: () => void) => { handlers[event] = cb; },
    };

    observabilityMiddleware(req as never, res as never, jest.fn());
    handlers.finish();

    expect(mockRecordRequest).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('http.request_id', 'req-123');
    expect(mockSetAttribute).toHaveBeenCalledWith('tenant.organization_id', 'org-1');
    expect(mockSetAttribute).toHaveBeenCalledWith('enduser.id', 'u-1');
    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it('adds failure event to span when status is 5xx', () => {
    const handlers: Record<string, () => void> = {};
    const req = { method: 'POST', path: '/api/v1/billing/webhook', requestId: 'req-500' };
    const res = {
      statusCode: 500,
      on: (event: string, cb: () => void) => { handlers[event] = cb; },
    };

    observabilityMiddleware(req as never, res as never, jest.fn());
    handlers.finish();

    expect(mockAddEvent).toHaveBeenCalledWith(
      'http.request.failed',
      expect.objectContaining({ 'request.id': 'req-500', 'http.status_code': 500 }),
    );
  });
});
