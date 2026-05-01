import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organization_id: string;
  };
}

export type RbacRole = 'admin' | 'analyst' | 'viewer';

const ROLE_HIERARCHY: Record<RbacRole, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
};

function isUserPayload(payload: unknown): payload is {
  id: string;
  email: string;
  role: string;
  organization_id?: string;
  organisationId?: string;
  organizationId?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.role === 'string'
    && (typeof candidate.organization_id === 'string' || typeof candidate.organisationId === 'string' || typeof candidate.organizationId === 'string')
  );
}

function isRole(role: string): role is RbacRole {
  return role === 'admin' || role === 'analyst' || role === 'viewer';
}

/**
 * Authenticates an incoming Express request using a JWT from the `Authorization: Bearer <token>` header or the `medfinance_access_token` cookie and attaches the validated user to `req.user`.
 *
 * If no token is present, the token is invalid/expired, the decoded payload fails validation, or the payload lacks an organization identifier, the middleware responds with HTTP 401 and a JSON error body containing one of the error codes: `AUTH_MISSING_HEADER`, `AUTH_INVALID_TOKEN`, or `AUTH_INVALID_PAYLOAD`. On successful validation, `req.user` is populated with `id`, `email`, `role`, and `organization_id`, and the middleware calls `next()`.
 */
export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const cookieToken = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('medfinance_access_token='))?.split('=').slice(1).join('=');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

  if (!token) {
    res.status(401).json({
      success: false,
      error: { message: 'Missing or invalid authorization header', code: 'AUTH_MISSING_HEADER' },
    });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (!isUserPayload(payload)) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid token payload', code: 'AUTH_INVALID_PAYLOAD' },
      });
      return;
    }

    const organizationId = payload.organization_id ?? payload.organisationId ?? payload.organizationId;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid token payload', code: 'AUTH_INVALID_PAYLOAD' },
      });
      return;
    }

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      organization_id: organizationId,
    };

    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { message: 'Invalid or expired token', code: 'AUTH_INVALID_TOKEN' },
    });
  }
}

export function requireAuthenticatedUser(req: AuthenticatedRequest): NonNullable<AuthenticatedRequest['user']> {
  if (!req.user) {
    const error = new Error('Unauthorized') as Error & { statusCode?: number; isOperational?: boolean; code?: string };
    error.statusCode = 401;
    error.isOperational = true;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  return req.user;
}

export function authorize(requiredRole: RbacRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = requireAuthenticatedUser(req);

    if (!isRole(user.role)) {
      res.status(403).json({
        success: false,
        error: { message: 'Unknown role', code: 'AUTH_INVALID_ROLE' },
      });
      return;
    }

    if (ROLE_HIERARCHY[user.role] < ROLE_HIERARCHY[requiredRole]) {
      res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions', code: 'AUTH_FORBIDDEN' },
      });
      return;
    }

    next();
  };
}
