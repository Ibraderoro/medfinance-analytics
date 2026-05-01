import { Router, Request, Response } from 'express';
import { getPool } from '../config/database';
import { getRedis } from '../config/redis';
import { metricsService } from '../services/metrics.service';

export const healthRouter = Router();

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/ready', async (req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  const isShuttingDown = Boolean(req.app.locals.isShuttingDown);

  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
  }

  try {
    await getRedis().ping();
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
