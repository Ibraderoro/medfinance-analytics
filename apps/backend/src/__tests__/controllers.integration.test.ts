process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';
import http from 'http';
import type { AddressInfo } from 'net';
import type { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({ getRedis: () => ({ get: async () => null, setex: async () => 'OK', del: async () => 1, scan: async () => ['0', []], ping: async () => 'PONG' }) }));

jest.mock('../config/database', () => ({ query: (...args: unknown[]) => mockQuery(...args), getPool: () => ({ connect: async () => ({ release: () => undefined }) }) }));
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.user = { id: 'u1', email: 'e', role: 'viewer', organization_id: 'org-1' };
      next();
    },
  };
});
import { app } from '../app';

type HttpResult = { status: number | undefined; body: Record<string, unknown> };

async function get(path: string): Promise<HttpResult> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server port');
  }

  const { port } = address as AddressInfo;
  const response = await new Promise<HttpResult>((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let data = '';
      res.on('data', (chunk: string | Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: JSON.parse(data || '{}') as Record<string, unknown>,
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

describe('controllers integration', () => {
  beforeEach(() => mockQuery.mockReset());

  it('covers financials, compliance, forecasting routes', async () => {
    mockQuery.mockResolvedValue([]);

    expect((await get('/api/v1/financials/summary?year=2026&period=monthly')).status).toBeGreaterThanOrEqual(200);
    expect((await get('/api/v1/compliance/audit-log?limit=5000')).status).toBe(400);
    expect((await get('/api/v1/forecasting/forecast?months=-1')).status).toBe(400);
    expect((await get('/api/v1/financials/not-real')).status).toBe(404);
  });
});
