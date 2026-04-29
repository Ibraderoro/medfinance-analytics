import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../config/redis';

function keyByIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown-ip';
  }

  return ip.trim().toLowerCase();
}

function createRateLimitMessage(message: string, code: string) {
  return {
    success: false,
    error: {
      message,
      code,
    },
  };
}

const redisClient = getRedis();

function createRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    // Redis-backed throttling prevents per-pod counter drift and ensures global consistency.
    prefix,
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)),
  });
}

export const rateLimiter = rateLimit({
  store: createRedisStore('rate-limit:general:'),
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage('Too many requests from this IP, please try again later.', 'RATE_LIMITED'),
});

export const authRateLimiter = rateLimit({
  // Security-critical: auth limiter must be shared across all pods to stop distributed brute force attempts.
  store: createRedisStore('rate-limit:auth:'),
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage(
    'Too many authentication attempts from this IP, please try again later.',
    'AUTH_RATE_LIMITED',
  ),
});
