import { Router, Request, Response } from 'express';
import { getPool } from '../config/database';
import { getRedis } from '../config/redis';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};

  try {
    const client = await getPool().connect();
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

  const allHealthy = Object.values(checks).every((v) => v === 'ok');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: checks,
  });
});
