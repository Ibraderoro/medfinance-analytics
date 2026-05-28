import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';
import { metricsService } from '../services/metrics.service';

let redisClient: Redis;

export const CACHE_TTL = {
  financialDataSeconds: 300,
  latestMetricsSeconds: 120,
} as const;

export async function timedRedis<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    metricsService.recordRedisOperation(durationMs);
    logger.debug('Redis operation completed', { operation, durationMs: Number(durationMs.toFixed(3)) });
  }
}

export function getRedis(): Redis {
  if (!redisClient) {
    const managedRedisUrl = (env.REDIS_URL ?? '').trim();
    const baseOptions = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      tls: env.REDIS_TLS ? {} : undefined,
      lazyConnect: true,
    };

    redisClient = managedRedisUrl
      ? new Redis(managedRedisUrl, baseOptions)
      : new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD || undefined,
          ...baseOptions,
        });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error', { message: err.message, stack: err.stack });
    });
  }
  return redisClient;
}

export async function invalidateFinancialCache(organizationId: string): Promise<number> {
  const redis = getRedis();
  const patterns = [
    `medfinance:financials:*:${organizationId}:*`,
    `medfinance:financials:latest_metrics:${organizationId}`,
  ];
  const keys = new Set<string>();

  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [nextCursor, batch] = await timedRedis('scan', () => redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100));
      cursor = nextCursor;
      batch.forEach((key) => keys.add(key));
    } while (cursor !== '0');
  }

  if (keys.size === 0) return 0;
  return timedRedis('del:invalidateFinancialCache', () => redis.del(...Array.from(keys)));
}

export async function connectRedis(retries = 12, retryDelayMs = 3_000): Promise<void> {
  const client = getRedis();
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (client.status === 'wait') await timedRedis('connect', () => client.connect());
      await timedRedis('ping', () => client.ping());
      logger.info('Redis connected', { attempt });
      return;
    } catch (error) {
      lastError = error;
      logger.warn('Redis connection attempt failed', { attempt, retries });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  await timedRedis('quit', () => redisClient.quit());
}
