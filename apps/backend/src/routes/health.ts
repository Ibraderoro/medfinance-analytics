import { Router, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { getRedis, timedRedis } from '../config/redis';
import { metricsService } from '../services/metrics.service';

export const healthRouter = Router();

function releaseMetadata() {
  return {
    version: process.env.RELEASE_VERSION ?? 'unknown',
    color: process.env.RELEASE_COLOR ?? 'unknown',
    gitSha: process.env.GITHUB_SHA ?? process.env.RELEASE_GIT_SHA ?? 'unknown',
  };
}

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    release: releaseMetadata(),
  });
});

healthRouter.get('/ready', async (req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  const isShuttingDown = Boolean(req.app.locals.isShuttingDown);

  let client: PoolClient | undefined;
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
    await timedRedis('health:ping', () => getRedis().ping());
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  checks.server = isShuttingDown ? 'draining' : 'ok';

  const allHealthy =
    !isShuttingDown && Object.values(checks).every((v) => v === 'ok');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    services: checks,
    release: releaseMetadata(),
  });
});

healthRouter.get('/metrics', (_req: Request, res: Response) => {
  res.type('text/plain').status(200).send(metricsService.toPrometheus());
});

healthRouter.get('/metrics/summary', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    metrics: metricsService.getSnapshot(),
  });
});

healthRouter.get('/', (req: Request, res: Response) => {
  res.redirect(302, `${req.baseUrl}/ready`);
});
