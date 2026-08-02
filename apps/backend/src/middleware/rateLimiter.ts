import { Request } from 'express';
import rateLimit, { MemoryStore, Store } from 'express-rate-limit';
import { getRedis } from '../config/redis';
import { env } from '../config/env';

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

function supportsRedisCommands(client: unknown): client is { call: (...args: string[]) => Promise<unknown> } {
  return Boolean(client && typeof (client as { call?: unknown }).call === 'function');
}

class RedisBackedStore implements Store {
  windowMs!: number;

  localKeys = false;

  prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  private toKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const redisKey = this.toKey(key);
    const totalHits = Number(await redisClient.call('INCR', redisKey));
    const ttlMs = Number(await redisClient.call('PTTL', redisKey));

    if (ttlMs < 0) {
      await redisClient.call('PEXPIRE', redisKey, String(this.windowMs));
    }

    const effectiveTtlMs = ttlMs > 0 ? ttlMs : this.windowMs;
    return { totalHits, resetTime: new Date(Date.now() + effectiveTtlMs) };
  }

  async decrement(key: string): Promise<void> {
    await redisClient.call('DECR', this.toKey(key));
  }

  async resetKey(key: string): Promise<void> {
    await redisClient.call('DEL', this.toKey(key));
  }
}

function createRedisStore(prefix: string): Store {
  if (!supportsRedisCommands(redisClient)) {
    return new MemoryStore();
  }
  return new RedisBackedStore(prefix);
}

export const rateLimiter = rateLimit({
  store: createRedisStore('rate-limit:general:'),
  windowMs: env.RATE_LIMIT_GENERAL_WINDOW_MS,
  max: env.RATE_LIMIT_GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage('Too many requests from this IP, please try again later.', 'RATE_LIMITED'),
});

export const authRateLimiter = rateLimit({
  // Shared Redis counters enforce global auth throttling across backend pods.
  store: createRedisStore('rate-limit:auth:'),
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage(
    'Too many authentication attempts from this IP, please try again later.',
    'AUTH_RATE_LIMITED',
  ),
});
