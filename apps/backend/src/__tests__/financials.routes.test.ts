/**
 * Integration tests for apps/backend/src/routes/financials.ts
 *
 * Covers the changes introduced in this PR:
 *  - `authorize` is now imported from '../middleware/auth' and applied on each
 *    route handler, enforcing role-based access control on all financial endpoints.
 *
 * Key behaviours verified:
 *  - Unauthenticated requests are rejected by `authenticate` (401)
 *  - Routes that require 'viewer' accept viewer / analyst / admin tokens
 *  - Routes that require 'analyst' reject viewer tokens with 403
 *  - The full middleware chain runs: authenticate → tenantContext → blockTenantOverride
 *    → auditFinancialAccess → authorize(role) → controller
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_jwt_secret_at_least_32_chars!!';
process.env.REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET ?? 'test_refresh_secret_at_least_32_chars!!';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

import http from 'http';
import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

// ─── Mock analytics middleware ────────────────────────────────────────────────
jest.mock('../middleware/analytics', () => ({
  trackApiAnalytics: (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next(),
}));

// ─── Mock audit middleware to avoid DB side-effects ──────────────────────────
jest.mock('../middleware/audit', () => ({
  auditFinancialAccess: (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next(),
}));

// ─── Mock database ───────────────────────────────────────────────────────────
const mockQuery = jest.fn();

jest.mock('../config/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({
    connect: async () => ({ release: () => undefined }),
  }),
}));

// ─── Mock redis ──────────────────────────────────────────────────────────────
jest.mock('../config/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    setex: async () => 'OK',
    del: async () => 1,
    scan: async () => ['0', []],
    ping: async () => 'PONG',
  }),
}));

// ─── Import app AFTER all mocks ───────────────────────────────────────────────
import { app } from '../app';
import jwt from 'jsonwebtoken';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type JsonObject = { [k: string]: JsonValue };

interface RequestResult {
  status: number;
  body: JsonObject;
}

interface RequestOptions {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function makeRequest(options: RequestOptions): Promise<RequestResult> {
  const { path, method = 'GET', headers = {}, body } = options;

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const result = await new Promise<RequestResult>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(data || '{}') as JsonObject,
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );

  return result;
}

function signToken(role: string, organizationId = 'org-1'): string {
  return jwt.sign(
    { id: 'user-1', email: 'user@example.com', role, organization_id: organizationId },
    process.env.JWT_SECRET as string,
    {
      algorithm: 'HS256',
      issuer: 'medfinance-api',
      audience: 'medfinance-client',
      expiresIn: '1h',
    },
  );
}

function authHeader(role: string): Record<string, string> {
  return { Authorization: `Bearer ${signToken(role)}` };
}

function errorCode(body: JsonObject): unknown {
  const error = body.error;
  return error && typeof error === 'object' && 'code' in error
    ? (error as JsonObject).code
    : undefined;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Financials routes — authorize() import and usage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ── authenticate runs first on all routes ─────────────────────────────────

  describe('unauthenticated requests are rejected by authenticate', () => {
    it.each([
      ['GET', '/api/v1/financials/kpis'],
      ['GET', '/api/v1/financials/summary'],
      ['GET', '/api/v1/financials/revenue'],
      ['GET', '/api/v1/financials/expenses'],
      ['GET', '/api/v1/financials/cash-flow'],
      ['GET', '/api/v1/financials/live'],
    ])('%s %s returns 401 without a token', async (method, path) => {
      const result = await makeRequest({ path, method });
      expect(result.status).toBe(401);
      expect(errorCode(result.body)).toBe('AUTH_MISSING_HEADER');
    });

    it.each([
      ['POST', '/api/v1/financials/live/events/transaction-added'],
      ['POST', '/api/v1/financials/live/events/forecast-changed'],
    ])('%s %s returns 401 without a token', async (method, path) => {
      const result = await makeRequest({ path, method });
      expect(result.status).toBe(401);
      expect(errorCode(result.body)).toBe('AUTH_MISSING_HEADER');
    });
  });

  // ── authorize('viewer') — GET endpoints ──────────────────────────────────

  describe("routes requiring authorize('viewer')", () => {
    // Seed a minimal DB response so the controllers can return 200
    function seedKpiResponse() {
      mockQuery
        .mockResolvedValueOnce([]) // planAccess / org plan check (may or may not fire)
        .mockResolvedValueOnce([{ total_revenue: '0', total_expenses: '0', net_income: '0' }]);
    }

    it('allows a viewer token on GET /kpis', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/kpis?year=2026',
        headers: authHeader('viewer'),
      });
      // Must not be rejected by auth/authorize
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows an analyst token on GET /kpis', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/kpis?year=2026',
        headers: authHeader('analyst'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows an admin token on GET /kpis', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/kpis?year=2026',
        headers: authHeader('admin'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows a viewer token on GET /summary', async () => {
      mockQuery.mockResolvedValue([{ total_revenue: '0', total_expenses: '0', net_income: '0' }]);
      const result = await makeRequest({
        path: '/api/v1/financials/summary?year=2026&period=monthly',
        headers: authHeader('viewer'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows a viewer token on GET /revenue', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/revenue?startDate=2026-01-01&endDate=2026-12-31',
        headers: authHeader('viewer'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows a viewer token on GET /expenses', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/expenses?startDate=2026-01-01&endDate=2026-12-31',
        headers: authHeader('viewer'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows a viewer token on GET /cash-flow', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/cash-flow?startDate=2026-01-01&endDate=2026-12-31',
        headers: authHeader('viewer'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows a viewer token on GET /live', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/live',
        headers: authHeader('viewer'),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });
  });

  // ── authorize('analyst') — POST event endpoints ──────────────────────────

  describe("routes requiring authorize('analyst')", () => {
    it('returns 403 for a viewer token on POST /live/events/transaction-added', async () => {
      const result = await makeRequest({
        path: '/api/v1/financials/live/events/transaction-added',
        method: 'POST',
        headers: authHeader('viewer'),
        body: JSON.stringify({}),
      });
      expect(result.status).toBe(403);
      expect(errorCode(result.body)).toBe('AUTH_FORBIDDEN');
    });

    it('returns 403 for a viewer token on POST /live/events/forecast-changed', async () => {
      const result = await makeRequest({
        path: '/api/v1/financials/live/events/forecast-changed',
        method: 'POST',
        headers: authHeader('viewer'),
        body: JSON.stringify({}),
      });
      expect(result.status).toBe(403);
      expect(errorCode(result.body)).toBe('AUTH_FORBIDDEN');
    });

    it('allows an analyst token on POST /live/events/transaction-added', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/live/events/transaction-added',
        method: 'POST',
        headers: authHeader('analyst'),
        body: JSON.stringify({}),
      });
      // Not blocked by authorize — controller takes over
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });

    it('allows an admin token on POST /live/events/forecast-changed', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await makeRequest({
        path: '/api/v1/financials/live/events/forecast-changed',
        method: 'POST',
        headers: authHeader('admin'),
        body: JSON.stringify({}),
      });
      expect(result.status).not.toBe(401);
      expect(errorCode(result.body)).not.toBe('AUTH_FORBIDDEN');
    });
  });

  // ── Regression: unknown role must be rejected ─────────────────────────────

  it('returns 403 AUTH_INVALID_ROLE for an unknown role on any route', async () => {
    const result = await makeRequest({
      path: '/api/v1/financials/kpis?year=2026',
      headers: authHeader('superuser'), // not a valid RbacRole
    });
    expect(result.status).toBe(403);
    expect(errorCode(result.body)).toBe('AUTH_INVALID_ROLE');
  });
});
