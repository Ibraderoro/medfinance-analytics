import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';

const mockEnv = {
  JWT_SECRET: 'test_jwt_secret_that_is_at_least_32_chars',
  JWT_ISSUER: 'medfinance-api',
  JWT_AUDIENCE: 'medfinance-client',
};

jest.mock('../config/env', () => ({ env: mockEnv }));

import jwt from 'jsonwebtoken';
import { authenticate, authorize, requireAuthenticatedUser } from '../middleware/auth';

function makeMocks() {
  const req = {
    headers: {},
    user: undefined,
  } as unknown as AuthenticatedRequest;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

function makeValidToken(payload: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      id: 'user-1',
      email: 'test@example.com',
      role: 'viewer',
      organization_id: 'org-abc',
      ...payload,
    },
    mockEnv.JWT_SECRET,
    { issuer: mockEnv.JWT_ISSUER, audience: mockEnv.JWT_AUDIENCE },
  );
}

describe('authenticate middleware', () => {
  it('returns 401 when no Authorization header and no cookie are present', () => {
    const { req, res, next } = makeMocks();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('extracts the token from a Bearer Authorization header and sets req.user', () => {
    const token = makeValidToken();
    const { req, res, next } = makeMocks();
    req.headers.authorization = `Bearer ${token}`;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('user-1');
    expect(req.user?.email).toBe('test@example.com');
    expect(req.user?.role).toBe('viewer');
    expect(req.user?.organization_id).toBe('org-abc');
  });

  it('extracts the token from the medfinance_access_token cookie', () => {
    const token = makeValidToken();
    const { req, res, next } = makeMocks();
    req.headers.cookie = `other=x; medfinance_access_token=${token}; another=y`;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('user-1');
  });

  it('returns 401 for an expired or invalid JWT', () => {
    const { req, res, next } = makeMocks();
    req.headers.authorization = 'Bearer not.a.valid.jwt';

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT payload is missing required fields', () => {
    const badToken = jwt.sign(
      { sub: 'missing-fields' },
      mockEnv.JWT_SECRET,
      { issuer: mockEnv.JWT_ISSUER, audience: mockEnv.JWT_AUDIENCE },
    );
    const { req, res, next } = makeMocks();
    req.headers.authorization = `Bearer ${badToken}`;

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when organization_id is absent from the token payload', () => {
    const tokenWithoutOrg = jwt.sign(
      { id: 'u1', email: 'a@a.com', role: 'viewer' },
      mockEnv.JWT_SECRET,
      { issuer: mockEnv.JWT_ISSUER, audience: mockEnv.JWT_AUDIENCE },
    );
    const { req, res, next } = makeMocks();
    req.headers.authorization = `Bearer ${tokenWithoutOrg}`;

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts organisationId as a legacy alternate field for organization_id', () => {
    const token = jwt.sign(
      { id: 'u2', email: 'b@b.com', role: 'analyst', organisationId: 'org-legacy' },
      mockEnv.JWT_SECRET,
      { issuer: mockEnv.JWT_ISSUER, audience: mockEnv.JWT_AUDIENCE },
    );
    const { req, res, next } = makeMocks();
    req.headers.authorization = `Bearer ${token}`;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.organization_id).toBe('org-legacy');
  });

  it('accepts organizationId camelCase as an alternate field for organization_id', () => {
    const token = jwt.sign(
      { id: 'u3', email: 'c@c.com', role: 'admin', organizationId: 'org-camel' },
      mockEnv.JWT_SECRET,
      { issuer: mockEnv.JWT_ISSUER, audience: mockEnv.JWT_AUDIENCE },
    );
    const { req, res, next } = makeMocks();
    req.headers.authorization = `Bearer ${token}`;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.organization_id).toBe('org-camel');
  });
});

describe('requireAuthenticatedUser helper', () => {
  it('returns the user when req.user is populated', () => {
    const req = {
      user: { id: 'u1', email: 'e@e.com', role: 'admin', organization_id: 'org-1' },
    } as AuthenticatedRequest;

    const user = requireAuthenticatedUser(req);

    expect(user.id).toBe('u1');
  });

  it('throws a 401 AppError when req.user is undefined', () => {
    const req = { user: undefined } as AuthenticatedRequest;

    expect(() => requireAuthenticatedUser(req)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'AUTH_REQUIRED' }),
    );
  });
});

describe('authorize middleware', () => {
  function makeAuthedReq(role: string): AuthenticatedRequest {
    return {
      user: { id: 'u1', email: 'e@e.com', role, organization_id: 'org-1' },
      headers: {},
    } as unknown as AuthenticatedRequest;
  }

  it('calls next() when the user role meets or exceeds the required level', () => {
    const { res, next } = makeMocks();
    const req = makeAuthedReq('admin');

    authorize('viewer')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when the user role is below the required level', () => {
    const { res, next } = makeMocks();
    const req = makeAuthedReq('viewer');

    authorize('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 with AUTH_INVALID_ROLE when the role string is unrecognised', () => {
    const { res, next } = makeMocks();
    const req = makeAuthedReq('superuser');

    authorize('viewer')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as jest.Mock).mock.calls[0][0] as { error?: { code?: string } };
    expect(body.error?.code).toBe('AUTH_INVALID_ROLE');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is missing (unauthenticated call)', () => {
    const { req, res, next } = makeMocks();

    expect(() => authorize('viewer')(req, res, next)).toThrow();
  });

  it('allows analyst to access analyst-level routes', () => {
    const { res, next } = makeMocks();
    const req = makeAuthedReq('analyst');

    authorize('analyst')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
