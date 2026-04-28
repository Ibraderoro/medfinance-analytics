import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redisClient: Redis;

export function getRedis(): Redis {
  if (!redisClient) {
    const managedRedisUrl = env.REDIS_URL.trim();
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

export async function connectRedis(retries = 12, retryDelayMs = 3_000): Promise<void> {
  const client = getRedis();
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (client.status === 'wait') {
        await client.connect();
      }
      await client.ping();
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
  if (!redisClient) {
    return;
  }

  await redisClient.quit();
}
