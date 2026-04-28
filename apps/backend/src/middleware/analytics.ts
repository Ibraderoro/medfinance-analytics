import { NextFunction, Request, Response } from 'express';
import { analyticsService } from '../services/analytics.service';
import { logger } from '../utils/logger';

type RequestWithUser = Request & {
  user?: {
    id?: string;
    organization_id?: string;
  };
};

function shouldTrack(path: string): boolean {
  return path.startsWith('/api/v1');
}

export function trackApiAnalytics(req: RequestWithUser, res: Response, next: NextFunction): void {
  if (!shouldTrack(req.path)) {
    next();
    return;
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const latencyMs = Number(end - start) / 1_000_000;

    void analyticsService.recordApiRequest({
      endpoint: `${req.method} ${req.path}`,
      method: req.method,
      statusCode: res.statusCode,
      latencyMs,
      userId: req.user?.id,
      organizationId: req.user?.organization_id,
    }).catch((error: unknown) => {
      logger.warn('Failed to write API analytics event', {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  });

  next();
}
