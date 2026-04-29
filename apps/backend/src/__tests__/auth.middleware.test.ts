/**
 * Unit tests for apps/backend/src/middleware/auth.ts
 *
 * Covers the changes introduced in this PR:
 *  - isRole() now returns `role is RbacRole` (the type narrowing used inside authorize())
 *  - authenticate() middleware behaviour
 *  - authorize() middleware (uses isRole / RbacRole internally)
 *  - requireAuthenticatedUser() helper
 */

// Environment variables must be set before any module that reads env is imported.
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_chars!!';
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_secret_at_least_32_chars!!';
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';

jest.mock('../config/env', () => ({
  env: {
    JWT_SECRET: 'test_jwt_secret_at_least_32_chars!!',
    JWT_EXPIRES_IN: '1h',
    REFRESH_TOKEN_SECRET: 'test_refresh_secret_at_least_32_chars!!',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    JWT_ISSUER: 'medfinance-api',
    JWT_AUDIENCE: 'medfinance-client',
    isDevelopment: () => false,
  },
}));

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import {
  authenticate,
  authorize,
  requireAuthenticatedUser,
  AuthenticatedRequest,
  RbacRole,
} from '../middleware/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test_jwt_secret_at_least_32_chars!!';
const JWT_ISSUER = 'medfinance-api';
const JWT_AUDIENCE = 'medfinance-client';

function makeToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    ...options,
  });
}

function makeValidPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role: 'viewer',
    organization_id: 'org-1',
    ...overrides,
  };
}

/** Build a minimal Express-like mock request. */
function mockReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    headers: {},
    ...overrides,
  } as AuthenticatedRequest;
}

/** Build a mock response that records the last json() call. */
function mockRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  } as Response & { _status: number; _body: unknown };
  return res;
}

// ---------------------------------------------------------------------------
// authenticate()
// ---------------------------------------------------------------------------

describe('authenticate middleware', () => {
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  it('returns 401 when Authorization header is absent', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_MISSING_HEADER');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with "Bearer "', () => {
    const req = mockReq({ headers: { authorization: 'Basic abc123' } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_MISSING_HEADER');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a malformed / garbage token string', () => {
    const req = mockReq({ headers: { authorization: 'Bearer not.a.jwt' } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired token', () => {
    const token = makeToken(makeValidPayload(), { expiresIn: -1 }); // already expired
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is signed with wrong secret', () => {
    const token = jwt.sign(makeValidPayload(), 'wrong_secret', {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 when token payload is missing required fields', () => {
    // Payload without `email`
    const token = makeToken({ id: 'user-1', role: 'viewer', organization_id: 'org-1' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_PAYLOAD');
  });

  it('returns 401 when token payload has no organization identifier', () => {
    const token = makeToken({ id: 'user-1', email: 'u@example.com', role: 'viewer' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(res._status).toBe(401);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_PAYLOAD');
  });

  it('accepts organisationId as alternative to organization_id', () => {
    const token = makeToken({
      id: 'user-1',
      email: 'u@example.com',
      role: 'viewer',
      organisationId: 'org-alt',
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.organization_id).toBe('org-alt');
  });

  it('accepts organizationId (camelCase) as alternative to organization_id', () => {
    const token = makeToken({
      id: 'user-1',
      email: 'u@example.com',
      role: 'viewer',
      organizationId: 'org-camel',
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.organization_id).toBe('org-camel');
  });

  it('populates req.user correctly for a valid token and calls next()', () => {
    const token = makeToken(makeValidPayload({ role: 'admin' }));
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      role: 'admin',
      organization_id: 'org-1',
    });
  });
});

// ---------------------------------------------------------------------------
// requireAuthenticatedUser()
// ---------------------------------------------------------------------------

describe('requireAuthenticatedUser', () => {
  it('returns the user object when req.user is set', () => {
    const user = { id: 'u1', email: 'u@x.com', role: 'viewer', organization_id: 'o1' };
    const req = mockReq({ user });
    expect(requireAuthenticatedUser(req)).toBe(user);
  });

  it('throws an error with statusCode 401 and code AUTH_REQUIRED when req.user is undefined', () => {
    const req = mockReq();
    expect(() => requireAuthenticatedUser(req)).toThrow('Unauthorized');
    try {
      requireAuthenticatedUser(req);
    } catch (err) {
      const e = err as Error & { statusCode?: number; code?: string; isOperational?: boolean };
      expect(e.statusCode).toBe(401);
      expect(e.code).toBe('AUTH_REQUIRED');
      expect(e.isOperational).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// authorize() — tests RbacRole type narrowing (the changed isRole() function)
// ---------------------------------------------------------------------------

describe('authorize middleware', () => {
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  function makeAuthedReq(role: string): AuthenticatedRequest {
    return mockReq({
      user: { id: 'u1', email: 'u@x.com', role, organization_id: 'o1' },
    });
  }

  // ── Role hierarchy: viewer(1) < analyst(2) < admin(3) ──────────────────

  describe('requiredRole = "viewer"', () => {
    it('allows viewer', () => {
      const req = makeAuthedReq('viewer');
      const res = mockRes();
      authorize('viewer')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows analyst (higher rank)', () => {
      const req = makeAuthedReq('analyst');
      const res = mockRes();
      authorize('viewer')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows admin (highest rank)', () => {
      const req = makeAuthedReq('admin');
      const res = mockRes();
      authorize('viewer')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('requiredRole = "analyst"', () => {
    it('denies viewer', () => {
      const req = makeAuthedReq('viewer');
      const res = mockRes();
      authorize('analyst')(req, res, next);
      expect(res._status).toBe(403);
      expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_FORBIDDEN');
      expect(next).not.toHaveBeenCalled();
    });

    it('allows analyst', () => {
      const req = makeAuthedReq('analyst');
      const res = mockRes();
      authorize('analyst')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows admin', () => {
      const req = makeAuthedReq('admin');
      const res = mockRes();
      authorize('analyst')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('requiredRole = "admin"', () => {
    it('denies viewer', () => {
      const req = makeAuthedReq('viewer');
      const res = mockRes();
      authorize('admin')(req, res, next);
      expect(res._status).toBe(403);
      expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_FORBIDDEN');
      expect(next).not.toHaveBeenCalled();
    });

    it('denies analyst', () => {
      const req = makeAuthedReq('analyst');
      const res = mockRes();
      authorize('admin')(req, res, next);
      expect(res._status).toBe(403);
      expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_FORBIDDEN');
      expect(next).not.toHaveBeenCalled();
    });

    it('allows admin', () => {
      const req = makeAuthedReq('admin');
      const res = mockRes();
      authorize('admin')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  it('returns 403 AUTH_INVALID_ROLE for an unknown role string', () => {
    const req = makeAuthedReq('superuser'); // not a valid RbacRole
    const res = mockRes();
    authorize('viewer')(req, res, next);
    expect(res._status).toBe(403);
    expect((res._body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_ROLE');
    expect(next).not.toHaveBeenCalled();
  });

  it('throws (via requireAuthenticatedUser) when req.user is not set', () => {
    const req = mockReq(); // no user attached
    const res = mockRes();
    // authorize() calls requireAuthenticatedUser which throws; the middleware
    // itself does not catch it — the error propagates.
    expect(() => authorize('viewer')(req, res, next)).toThrow();
  });

  // Boundary / regression: isRole() must accept exactly the three valid roles
  it.each<RbacRole>(['admin', 'analyst', 'viewer'])(
    'isRole accepts valid RbacRole "%s"',
    (role) => {
      const req = makeAuthedReq(role);
      const res = mockRes();
      authorize(role)(req, res, next);
      // No AUTH_INVALID_ROLE response means isRole() accepted the value
      expect((res._body as { error?: { code: string } } | undefined)?.error?.code).not.toBe('AUTH_INVALID_ROLE');
    },
  );
});