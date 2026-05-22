import { getRedis } from '../config/redis';
import { logger } from './logger';

export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();

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

  async getOrLoad<T>(key: string, loader: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = (async () => {
      const loaded = await loader();
      await this.set(key, loaded, ttl);
      return loaded;
    })();

    this.inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(key);
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
      const pattern = `medfinance:${this.namespace}:*`;
      const keys: string[] = [];
      let cursor = '0';

      do {
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (batch.length > 0) {
          keys.push(...batch);
        }
      } while (cursor !== '0');

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      logger.warn('Cache flush error:', err);
    }
  }
}
