process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

import http from 'http';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const mockQuery = jest.fn();

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

type RequestResult = {
  status: number;
  body: JsonObject;
};

jest.mock('../middleware/analytics', () => ({
  trackApiAnalytics: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
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

async function request(path: string): Promise<RequestResult> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const response = await new Promise<{ status: number; payload: JsonObject }>((resolve, reject) => {
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
          const parsed: JsonObject = JSON.parse(data || '{}') as JsonObject;
          resolve({ status: res.statusCode ?? 0, payload: parsed });
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

  return { status: response.status, body: response.payload };
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
    const errorBody = result.body.error;
    expect(errorBody && typeof errorBody === 'object' && 'code' in errorBody ? errorBody.code : undefined).toBe('VALIDATION_ERROR');
  });

  it('GET /compliance/status returns empty array when no rows exist', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await request('/api/v1/compliance/status');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual([]);
  });
});
