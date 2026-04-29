process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';
import { EventEmitter } from 'events';
import { AuditService } from '../services/audit.service';
import { trackApiAnalytics } from '../middleware/analytics';

const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({ getRedis: () => ({ get: async () => null, setex: async () => 'OK', del: async () => 1, scan: async () => ['0', []], ping: async () => 'PONG' }) }));
const enqueueApiTelemetry = jest.fn().mockResolvedValue(undefined);

jest.mock('../config/database', () => ({ query: (...args: unknown[]) => mockQuery(...args) }));
jest.mock('../services/analytics.service', () => ({ analyticsService: { enqueueApiTelemetry: (...args: unknown[]) => enqueueApiTelemetry(...args) } }));

describe('AuditService', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('throws critical error when log insert fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(new AuditService().log({ action: 'READ', entityType: 'financial', organizationId: 'org' })).rejects.toMatchObject({ statusCode: 500 });
  });

  it('exports csv and jsonl', async () => {
    mockQuery.mockResolvedValue([{ id: '1', action: 'A', entity_type: 't', entity_id: null, performed_by: null, organization_id: 'org', metadata: {}, created_at: '2026-01-01' }]);
    const svc = new AuditService();
    expect((await svc.exportSiemLogs('org', new Date('2026-01-01'), new Date('2026-02-01'), 'csv')).includes('id,action')).toBe(true);
    expect((await svc.exportSiemLogs('org', new Date('2026-01-01'), new Date('2026-02-01'), 'jsonl')).includes('entityType')).toBe(true);
  });
});

describe('analytics middleware', () => {
  it('enqueues telemetry on finish for api paths', async () => {
    const req: any = { method: 'GET', path: '/api/v1/financials', user: { id: 'u', organization_id: 'org' } };
    const res: any = new EventEmitter();
    res.statusCode = 200;
    const next = jest.fn();
    trackApiAnalytics(req, res, next);
    res.emit('finish');
    expect(next).toHaveBeenCalled();
    expect(enqueueApiTelemetry).toHaveBeenCalled();
  });
});
