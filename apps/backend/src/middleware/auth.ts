import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organisationId: string;
  };
}

function isValidUserPayload(payload: string | JwtPayload): payload is JwtPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  return (
    typeof payload.id === 'string'
    && typeof payload.email === 'string'
    && typeof payload.role === 'string'
    && typeof payload.organisationId === 'string'
  );
}

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    });

    if (!isValidUserPayload(payload)) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      organisationId: payload.organisationId,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
