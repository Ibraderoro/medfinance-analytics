import { getRedis } from '../config/redis';
import { logger } from './logger';

export class CacheService {
  constructor(
    private readonly namespace: string,
    private readonly defaultTtl: number = 60,
  ) {}

  private key(k: string): string {
    return `medfinance:${this.namespace}:${k}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await getRedis().get(this.key(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.warn('Cache get error:', err);
      return null;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      await getRedis().setex(
        this.key(key),
        ttl ?? this.defaultTtl,
        JSON.stringify(value),
      );
    } catch (err) {
      logger.warn('Cache set error:', err);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await getRedis().del(this.key(key));
    } catch (err) {
      logger.warn('Cache del error:', err);
    }
  }

  async flush(): Promise<void> {
    try {
      const redis = getRedis();
      const stream = redis.scanStream({
        match: `medfinance:${this.namespace}:*`,
        count: 100,
      });

      for await (const keys of stream) {
        if (Array.isArray(keys) && keys.length > 0) {
          await redis.unlink(...keys);
        }
      }
    } catch (err) {
      logger.warn('Cache flush error:', err);
    }
  }
}
