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
