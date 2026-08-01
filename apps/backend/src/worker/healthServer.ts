import express, { Express } from 'express';
import { Server } from 'http';
import { getPool } from '../config/database';
import { getRedis, timedRedis } from '../config/redis';
import { getQueueRedisConnection } from '../config/queueRedis';
import { getLastPollAt } from '../queue/metricsPoller';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * The worker process has no other HTTP surface — this small Express app
 * (mirroring the shape of `routes/health.ts`) exists solely so Docker/Render
 * can probe liveness/readiness on a dedicated port (`WORKER_HEALTH_PORT`).
 */
export function createWorkerHealthApp(isShuttingDown: () => boolean): Express {
  const app = express();

  app.get('/live', (_req, res) => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  app.get('/ready', async (_req, res) => {
    const checks: Record<string, string> = {};

    let client;
    try {
      client = await getPool().connect();
      await client.query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
    } finally {
      client?.release();
    }

    try {
      await timedRedis('worker_health:ping', () => getRedis().ping());
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    try {
      await getQueueRedisConnection().ping();
      checks.queueRedis = 'ok';
    } catch {
      checks.queueRedis = 'error';
    }

    const lastPollAt = getLastPollAt();
    const pollerFresh = lastPollAt !== null && Date.now() - lastPollAt <= env.WORKER_READY_STALE_THRESHOLD_MS;
    checks.metricsPoller = pollerFresh ? 'ok' : 'stale';
    checks.server = isShuttingDown() ? 'draining' : 'ok';

    const allHealthy = !isShuttingDown() && Object.values(checks).every((value) => value === 'ok');
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      services: checks,
    });
  });

  return app;
}

export function startWorkerHealthServer(isShuttingDown: () => boolean): Server {
  const app = createWorkerHealthApp(isShuttingDown);
  const server = app.listen(env.WORKER_HEALTH_PORT, () => {
    logger.info('Worker health server started', { port: env.WORKER_HEALTH_PORT });
  });
  return server;
}
