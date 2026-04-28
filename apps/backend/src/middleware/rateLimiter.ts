import { NextFunction, Request, Response } from 'express';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

type KeyExtractor = (req: Request) => string;

function keyByIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown-ip';
  }

  return ip.trim().toLowerCase();
}

function requestPrincipalKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return `token:${authHeader.slice(7, 19)}`;
  }

  return `ip:${keyByIp(req.ip)}`;
}

function createDistributedRateLimiter(config: {
  namespace: string;
  windowMs: number;
  max: number;
  message: string;
  keyExtractor?: KeyExtractor;
}) {
  const memoryStore = new Map<string, { count: number; resetAt: number }>();
  const keyExtractor = config.keyExtractor ?? requestPrincipalKey;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestKey = `${config.namespace}:${keyExtractor(req)}`;
    const now = Date.now();
    const windowSeconds = Math.ceil(config.windowMs / 1000);
    const resetAtMs = now + config.windowMs;

    try {
      const redis = getRedis();
      const current = await redis.incr(requestKey);

      if (current === 1) {
        await redis.pexpire(requestKey, config.windowMs);
      }

      const ttlMs = Math.max(await redis.pttl(requestKey), 0);
      const effectiveResetAtMs = now + ttlMs;

      res.setHeader('X-RateLimit-Limit', String(config.max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(config.max - current, 0)));
      res.setHeader('X-RateLimit-Reset', String(Math.floor(effectiveResetAtMs / 1000)));

      if (current > config.max) {
        res.setHeader('Retry-After', String(Math.max(Math.ceil(ttlMs / 1000), windowSeconds)));
        res.status(429).json({ error: config.message });
        return;
      }

      next();
      return;
    } catch (error) {
      logger.warn('Redis-backed rate limiter unavailable; falling back to memory store', {
        error: error instanceof Error ? error.message : 'unknown',
        key: config.namespace,
      });
    }

    const current = memoryStore.get(requestKey);
    if (!current || current.resetAt <= now) {
      memoryStore.set(requestKey, { count: 1, resetAt: resetAtMs });
      next();
      return;
    }

    current.count += 1;
    memoryStore.set(requestKey, current);

    if (current.count > config.max) {
      const retryAfter = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: config.message });
      return;
    }

    next();
  };
}

export const rateLimiter = createDistributedRateLimiter({
  namespace: 'ratelimit:api',
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this principal, please try again later.',
});

export const authRateLimiter = createDistributedRateLimiter({
  namespace: 'ratelimit:auth',
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts from this principal, please try again later.',
  keyExtractor: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `email:${email}` : `ip:${keyByIp(req.ip)}`;
  },
});
