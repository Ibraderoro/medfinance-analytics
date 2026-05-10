process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_secret';

import crypto from 'crypto';
import http from 'http';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const mockQuery = jest.fn();
const mockRedisSet = jest.fn(async (): Promise<string | null> => 'OK') as jest.Mock<Promise<string | null>, unknown[]>;
const mockRedisGet = jest.fn(async (): Promise<string | null> => null) as jest.Mock<Promise<string | null>, unknown[]>;
const mockRedisDel = jest.fn(async (): Promise<number> => 1) as jest.Mock<Promise<number>, unknown[]>;

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
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: async () => 'OK',
    del: (...args: unknown[]) => mockRedisDel(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
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

async function rawPost(path: string, payload: Buffer, headers: Record<string, string> = {}): Promise<RequestResult> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
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
          'Content-Length': payload.length,
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

function stripeSignature(payload: Buffer): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET ?? '')
    .update(`${timestamp}.${payload.toString('utf8')}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('Critical route integration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRedisSet.mockReset();
    mockRedisSet.mockResolvedValue('OK');
    mockRedisGet.mockReset();
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockReset();
    mockRedisDel.mockResolvedValue(1);
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

  it('GET /financials/revenue returns a structured envelope when free history date is missing', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await request('/api/v1/financials/revenue');

    expect(result.status).toBe(403);
    expect(result.body.success).toBe(false);
    expect(result.body.data).toBeNull();
    const errorBody = result.body.error;
    expect(errorBody && typeof errorBody === 'object' && 'code' in errorBody ? errorBody.code : undefined).toBe('PLAN_HISTORY_WINDOW_EXCEEDED');
  });

  it('POST /billing/webhook rejects malformed JSON with a structured client error', async () => {
    const payload = Buffer.from('{not-json');

    const result = await rawPost('/api/v1/billing/webhook', payload, {
      'stripe-signature': stripeSignature(payload),
    });

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    const errorBody = result.body.error;
    expect(errorBody && typeof errorBody === 'object' && 'code' in errorBody ? errorBody.code : undefined).toBe('BILLING_WEBHOOK_INVALID_JSON');
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
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

  it('POST /billing/webhook records Stripe event dedupe only after successful handling', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const payload = Buffer.from(JSON.stringify({
      id: 'evt_processed',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_processed',
          subscription: 'sub_processed',
          lines: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    }));

    const result = await rawPost('/api/v1/billing/webhook', payload, {
      'stripe-signature': stripeSignature(payload),
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual({ received: true });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'billing:webhook:event:evt_processed',
      '1',
      'EX',
      60 * 60 * 24,
      'NX',
    );
  });

  it('POST /billing/webhook clears reserved dedupe when event handling fails', async () => {
    const payload = Buffer.from(JSON.stringify({
      id: 'evt_retryable_failure',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_retry',
          subscription: 'sub_retry',
          lines: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    }));
    mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await rawPost('/api/v1/billing/webhook', payload, {
      'stripe-signature': stripeSignature(payload),
    });

    expect(result.status).toBe(500);
    expect(result.body.success).toBe(false);
    expect(mockRedisSet).toHaveBeenCalledWith(
      'billing:webhook:event:evt_retryable_failure',
      '1',
      'EX',
      60 * 60 * 24,
      'NX',
    );
    expect(mockRedisDel).toHaveBeenCalledWith('billing:webhook:event:evt_retryable_failure');
  });

  it('POST /billing/webhook skips handling when dedupe reservation already exists', async () => {
    mockRedisSet.mockResolvedValueOnce(null);
    const payload = Buffer.from(JSON.stringify({
      id: 'evt_duplicate_before_handling',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_duplicate',
          subscription: 'sub_duplicate',
          lines: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    }));

    const result = await rawPost('/api/v1/billing/webhook', payload, {
      'stripe-signature': stripeSignature(payload),
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual({ received: true, duplicate: true });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRedisSet).toHaveBeenCalledWith(
      'billing:webhook:event:evt_duplicate_before_handling',
      '1',
      'EX',
      60 * 60 * 24,
      'NX',
    );
  });

  it('POST /billing/webhook does not process when dedupe reservation fails', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('redis unavailable'));
    const payload = Buffer.from(JSON.stringify({
      id: 'evt_redis_failure',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_duplicate',
          subscription: 'sub_duplicate',
          lines: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    }));

    const result = await rawPost('/api/v1/billing/webhook', payload, {
      'stripe-signature': stripeSignature(payload),
    });

    expect(result.status).toBe(500);
    expect(result.body.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
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
