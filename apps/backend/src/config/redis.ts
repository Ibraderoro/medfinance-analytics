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
      logger.error('Redis connection error:', err);
    });
  }
  return redisClient;
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  await client.ping();
  logger.info('✅ Redis connected');
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) {
    return;
  }

  await redisClient.quit();
}
