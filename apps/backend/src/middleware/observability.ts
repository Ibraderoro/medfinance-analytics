import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { metricsService } from '../services/metrics.service';

type SpanLike = {
  setAttribute?: (key: string, value: string | number | boolean) => void;
  addEvent?: (name: string, attributes?: Record<string, string | number | boolean>) => void;
};

let spanApi: {
  trace: {
    getSpan: (context: unknown) => SpanLike | undefined;
    setSpan: (context: unknown, span: SpanLike) => unknown;
  };
  context: { active: () => unknown };
} | null = null;

function getOpenTelemetryApi(): typeof spanApi {
  if (spanApi !== null) {
    return spanApi;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    spanApi = require('@opentelemetry/api');
  } catch {
    spanApi = null;
  }

  return spanApi;
}

function annotateActiveSpan(span: SpanLike | undefined, req: Request, res: Response, durationMs: number): void {
  if (!span) return;

  const requestUser = (req as Request & { user?: { id?: string; organization_id?: string } }).user;
  span.setAttribute?.('http.request_id', req.requestId ?? 'missing');
  span.setAttribute?.('http.method', req.method);
  span.setAttribute?.('http.route', req.route?.path ?? req.path);
  span.setAttribute?.('http.status_code', res.statusCode);
  span.setAttribute?.('http.response_time_ms', Number(durationMs.toFixed(3)));

  if (requestUser?.organization_id) span.setAttribute?.('tenant.organization_id', requestUser.organization_id);
  if (requestUser?.id) span.setAttribute?.('enduser.id', requestUser.id);

  if (res.statusCode >= 500) {
    span.addEvent?.('http.request.failed', {
      'request.id': req.requestId ?? 'missing',
      'http.status_code': res.statusCode,
      'http.response_time_ms': Number(durationMs.toFixed(3)),
    });
  }
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const otel = getOpenTelemetryApi();
  const activeSpan = otel?.trace.getSpan(otel.context.active());

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const isError = res.statusCode >= 500;
    metricsService.recordRequest(durationMs, isError);

    annotateActiveSpan(activeSpan, req, res, durationMs);

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
