process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

import http from 'http';

const mockQuery = jest.fn();


jest.mock('../middleware/analytics', () => ({
  trackApiAnalytics: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        email: 'cfo@example.com',
        role: 'cfo',
        organization_id: 'org-1',
      };
      next();
    },
  };
});

jest.mock('../config/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({
    connect: async () => ({ release: () => undefined }),
  }),
}));

jest.mock('../config/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    setex: async () => 'OK',
    del: async () => 1,
    scan: async () => ['0', []],
    ping: async () => 'PONG',
  }),
}));

import { app } from '../app';

async function request(path: string): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const body = await new Promise<any>((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, payload: JSON.parse(data || '{}') });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  return { status: body.status, body: body.payload };
}

describe('Critical route integration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('GET /financials/summary returns safe defaults with empty db', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total_revenue: '0', total_expenses: '0', net_income: '0' }]);

    const result = await request('/api/v1/financials/summary?year=2026&period=monthly');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual({ total_revenue: '0', total_expenses: '0', net_income: '0' });
  });

  it('GET /forecasting/forecast validates invalid inputs', async () => {
    const result = await request('/api/v1/forecasting/forecast?months=-2');

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /compliance/status returns empty array when no rows exist', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await request('/api/v1/compliance/status');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual([]);
  });
});
