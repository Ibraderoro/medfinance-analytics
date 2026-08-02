process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

const mockXadd = jest.fn();
const mockCall = jest.fn();
const mockQuery = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../config/redis', () => ({
  getRedis: () => ({
    xadd: (...args: unknown[]) => mockXadd(...args),
    call: (...args: unknown[]) => mockCall(...args),
  }),
}));

jest.mock('../config/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { AnalyticsService } from '../services/analytics.service';

describe('AnalyticsService.enqueueApiTelemetry', () => {
  beforeEach(() => {
    mockXadd.mockReset();
    mockCall.mockReset();
    mockQuery.mockReset();
    mockLoggerError.mockReset();
  });

  it('uses xadd when available', async () => {
    mockXadd.mockResolvedValue('1-0');

    const service = new AnalyticsService();
    await service.enqueueApiTelemetry({
      endpoint: 'GET /api/v1/financials',
      method: 'GET',
      statusCode: 200,
      latencyMs: 42,
      userId: 'u1',
      organizationId: 'org1',
      capturedAt: new Date('2026-01-01').toISOString(),
    });

    expect(mockXadd).toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('falls back to call when xadd is missing', async () => {
    const redisNoXadd = { call: mockCall };
    const service = new AnalyticsService() as unknown as { enqueueApiTelemetry: AnalyticsService["enqueueApiTelemetry"]; redis: { call: typeof mockCall } };
    service.redis = redisNoXadd;
    mockCall.mockResolvedValue('1-0');

    await service.enqueueApiTelemetry({
      endpoint: 'GET /api/v1/compliance',
      method: 'GET',
      statusCode: 200,
      latencyMs: 10,
      capturedAt: new Date('2026-01-01').toISOString(),
    });

    expect(mockCall).toHaveBeenCalledWith('XADD', expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String));
  });
});


describe('AnalyticsService.processOneBatch', () => {
  beforeEach(() => {
    mockXadd.mockReset();
    mockCall.mockReset();
    mockQuery.mockReset();
    mockLoggerError.mockReset();
  });

  it('reads one batch via XREADGROUP, persists it, and acks the entries', async () => {
    mockCall.mockImplementation((command: string) => {
      if (command === 'XGROUP') return Promise.resolve('OK');
      if (command === 'XREADGROUP') {
        return Promise.resolve([
          ['api_telemetry_stream', [['1-0', ['endpoint', '/x', 'method', 'GET', 'status_code', '200', 'latency_ms', '10', 'user_id', '', 'organization_id', '', 'captured_at', '2026-01-01T00:00:00.000Z']]]],
        ]);
      }
      if (command === 'XACK') return Promise.resolve(1);
      return Promise.resolve(undefined);
    });
    mockQuery.mockResolvedValue([]);

    const service = new AnalyticsService();
    const didWork = await service.processOneBatch();

    expect(didWork).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO api_request_metrics'), expect.any(Array));
    expect(mockCall).toHaveBeenCalledWith('XACK', 'api_telemetry_stream', 'analytics_workers', '1-0');
  });

  it('returns false when there are no newly-delivered entries', async () => {
    mockCall.mockImplementation((command: string) => {
      if (command === 'XGROUP') return Promise.resolve('OK');
      if (command === 'XREADGROUP') return Promise.resolve(null);
      return Promise.resolve(undefined);
    });

    const service = new AnalyticsService();
    const didWork = await service.processOneBatch();

    expect(didWork).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('AnalyticsService.reclaimPendingOnce', () => {
  beforeEach(() => {
    mockXadd.mockReset();
    mockCall.mockReset();
    mockQuery.mockReset();
    mockLoggerError.mockReset();
  });

  it('drains pending entries via XAUTOCLAIM until none remain', async () => {
    let autoclaimCalls = 0;
    mockCall.mockImplementation((command: string) => {
      if (command === 'XGROUP') return Promise.resolve('OK');
      if (command === 'XAUTOCLAIM') {
        autoclaimCalls += 1;
        if (autoclaimCalls === 1) {
          return Promise.resolve(['1-0', [['0-1', ['endpoint', '/y', 'method', 'GET', 'status_code', '200', 'latency_ms', '5', 'user_id', '', 'organization_id', '', 'captured_at', '2026-01-01T00:00:00.000Z']]]]);
        }
        return Promise.resolve(['0-0', []]);
      }
      if (command === 'XACK') return Promise.resolve(1);
      return Promise.resolve(undefined);
    });
    mockQuery.mockResolvedValue([]);

    const service = new AnalyticsService();
    await service.reclaimPendingOnce();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(autoclaimCalls).toBe(2);
  });
});

describe('AnalyticsService.enforceRetention', () => {
  beforeEach(() => {
    mockXadd.mockReset();
    mockCall.mockReset();
    mockQuery.mockReset();
    mockLoggerError.mockReset();
  });

  it('archives and deletes old metrics using parameterized interval SQL', async () => {
    mockQuery.mockResolvedValue([]);

    const service = new AnalyticsService();
    await service.enforceRetention();

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("NOW() - ($1::text)::interval"),
      ['90 days'],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("NOW() - ($1::text)::interval"),
      ['90 days'],
    );
    expect(mockQuery.mock.calls[0][0]).not.toContain('INTERVAL "90 days"');
    expect(mockQuery.mock.calls[1][0]).not.toContain('INTERVAL "90 days"');
  });

  it('logs and rethrows retention errors', async () => {
    const retentionError = new Error('retention failed');
    mockQuery.mockRejectedValueOnce(retentionError);

    const service = new AnalyticsService();
    await expect(service.enforceRetention()).rejects.toThrow('retention failed');

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Analytics retention enforcement failed',
      expect.objectContaining({
        message: 'retention failed',
        stack: retentionError.stack,
        error: retentionError,
      }),
    );
  });
});
