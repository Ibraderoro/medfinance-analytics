import { NextFunction, Request, Response } from 'express';
import { getRedis, timedRedis } from '../config/redis';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_IDENTITY = 8;

function safeTimedRedis<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  if (typeof timedRedis === 'function') {
    return timedRedis(operation, fn);
  }
  return Promise.resolve(fn());
}

function identityKey(req: Request): string {
  const ip = (req.ip || 'unknown').trim().toLowerCase();
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown-email';
  const organizationId = typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim().toLowerCase() : 'unknown-org';
  return `bf:auth:${ip}:${email}:${organizationId}`;
}

export async function bruteForceProtection(req: Request, res: Response, next: NextFunction): Promise<void> {
  const redis = getRedis();
  const key = identityKey(req);

  const attempts = Number(await safeTimedRedis('bruteforce:incr', () => redis.incr(key)));
  if (attempts === 1) {
    await safeTimedRedis('bruteforce:expire', () => redis.expire(key, WINDOW_SECONDS));
  }

  if (attempts > MAX_ATTEMPTS_PER_IDENTITY) {
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many authentication attempts for this identity. Try again later.',
        code: 'AUTH_BRUTE_FORCE_BLOCKED',
      },
      data: null,
    });
    return;
  }

  next();
}
