import Redis from 'ioredis';

async function run(): Promise<void> {
  const host = process.env.FULLSTACK_REDIS_HOST ?? '127.0.0.1';
  const port = Number(process.env.FULLSTACK_REDIS_PORT ?? 56379);

  const redis = new Redis({ host, port, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch {
    // Best-effort cleanup for dedicated E2E Redis.
  } finally {
    redis.disconnect();
  }
}

export default run;
