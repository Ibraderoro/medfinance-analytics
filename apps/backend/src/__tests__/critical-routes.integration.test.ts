process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
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
        email: 'viewer@example.com',
        role: 'viewer',
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


async function closeServer(server: http.Server, requestError?: unknown): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    if (!requestError) throw error;
  }
}

async function post(path: string, body: JsonObject, headers: Record<string, string> = {}): Promise<RequestResult> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const payload = JSON.stringify(body);
  let requestError: unknown;

  try {
    const response = await new Promise<{ status: number; payload: JsonObject }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
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
      req.write(payload);
      req.end();
    });

    return { status: response.status, body: response.payload };
  } catch (error) {
    requestError = error;
    throw error;
  } finally {
    await closeServer(server, requestError);
  }
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


  it('POST /auth/refresh accepts a valid refresh cookie without a body token', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    mockQuery
      .mockResolvedValueOnce([{ user_id: 'user-1', expires_at: futureDate }])
      .mockResolvedValueOnce([{ id: 'user-1', email: 'viewer@example.com', role: 'viewer', organization_id: 'org-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await post(
      '/api/v1/auth/refresh',
      {},
      {
        Cookie: 'csrf_token=csrf123; medfinance_refresh_token=refresh_cookie_token',
        'x-csrf-token': 'csrf123',
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual({ session: 'refreshed' });
  });

  it('POST /auth/register rejects privileged public registration roles', async () => {
    const result = await post('/api/v1/auth/register', {
      email: 'admin@example.com',
      password: 'password123',
      firstName: 'Ada',
      lastName: 'Admin',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'admin',
    });

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
