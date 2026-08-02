import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let queueRedisClient: Redis;

/**
 * Dedicated Redis connection for BullMQ. BullMQ requires `maxRetriesPerRequest: null`
 * for its blocking commands, which is unsafe to share with `getRedis()`'s
 * fast-fail (`maxRetriesPerRequest: 3`) cache/rate-limit usage.
 */
export function getQueueRedisConnection(): Redis {
  if (!queueRedisClient) {
    const managedRedisUrl = (env.QUEUE_REDIS_URL || env.REDIS_URL || '').trim();
    const baseOptions = {
      maxRetriesPerRequest: null as null,
      enableReadyCheck: true,
      tls: env.REDIS_TLS ? {} : undefined,
      lazyConnect: true,
    };

    queueRedisClient = managedRedisUrl
      ? new Redis(managedRedisUrl, baseOptions)
      : new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD || undefined,
          ...baseOptions,
        });

    queueRedisClient.on('error', (err) => {
      logger.error('Queue Redis connection error', { message: err.message, stack: err.stack });
    });
  }
  return queueRedisClient;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function connectQueueRedis(
  retries = 12,
  retryDelayMs = 3_000,
  attemptTimeoutMs = retryDelayMs,
): Promise<void> {
  const client = getQueueRedisConnection();
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await withTimeout(
        (async () => {
          if (!['connecting', 'connect', 'ready'].includes(client.status)) {
            await client.connect();
          }
          await client.ping();
        })(),
        attemptTimeoutMs,
        `Queue Redis connect/ping attempt timed out after ${attemptTimeoutMs}ms`,
      );
      logger.info('Queue Redis connected', { attempt });
      return;
    } catch (error) {
      lastError = error;
      logger.warn('Queue Redis connection attempt failed', { attempt, retries });
      client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

export async function disconnectQueueRedis(): Promise<void> {
  if (!queueRedisClient) return;
  await queueRedisClient.quit();
}
