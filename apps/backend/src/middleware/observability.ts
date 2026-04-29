import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { metricsService } from '../services/metrics.service';

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const isError = res.statusCode >= 500;
    metricsService.recordRequest(durationMs, isError);

    const snapshot = metricsService.getSnapshot();
    if (snapshot.errorRate > env.ERROR_RATE_ALERT_THRESHOLD && snapshot.requestCount >= 20) {
      logger.warn('Error rate exceeded threshold', {
        requestId: req.requestId,
        threshold: env.ERROR_RATE_ALERT_THRESHOLD,
        errorRate: snapshot.errorRate,
        requestCount: snapshot.requestCount,
      });
    }
  });

  next();
}
