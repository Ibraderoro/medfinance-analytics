import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { metricsService } from '../services/metrics.service';
import { runWithTraceContext } from '../observability/tracing';

function normalizePath(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function routeLabel(req: Request): string {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : undefined;
  const baseUrl = req.baseUrl || '';
  if (routePath) return normalizePath(`${baseUrl}${routePath}`.replace(/\/+/g, '/'));
  return normalizePath(req.path || req.originalUrl || 'unknown');
}

function statusClass(statusCode: number): string {
  return Number.isFinite(statusCode) && statusCode >= 100 ? `${Math.floor(statusCode / 100)}xx` : 'unknown';
}

function outcome(statusCode: number): string {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'client_error';
  return 'success';
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  runWithTraceContext(req, res, () => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      metricsService.recordRequest(durationMs, {
        method: req.method,
        route: routeLabel(req),
        status_code: res.statusCode,
        status_class: statusClass(res.statusCode),
        outcome: outcome(res.statusCode),
      });

      if (res.statusCode >= 500) {
        logger.warn('HTTP request completed with server error', {
          requestId: req.requestId,
          method: req.method,
          route: routeLabel(req),
          statusCode: res.statusCode,
          durationMs: Number(durationMs.toFixed(3)),
        });
      }
    });

    next();
  });
}
