import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redisClient: Redis;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
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
