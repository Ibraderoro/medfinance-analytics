import { Request, Response, NextFunction } from 'express';
import { analyticsService } from '../services/analytics.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';
import { metricsService } from '../services/metrics.service';

const ALLOWED_ADMIN_ROLES = new Set(['cfo', 'finance_manager']);

function parseWindow(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

export async function getAdminMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req as AuthenticatedRequest);

    if (!ALLOWED_ADMIN_ROLES.has(user.role)) {
      res.status(403).json({
        error: 'Forbidden. Admin role required.',
      });
      return;
    }

    const windowMinutes = parseWindow(req.query.windowMinutes, 60);
    const activeWindowMinutes = parseWindow(req.query.activeWindowMinutes, 5);

    const metrics = await analyticsService.getAdminMetrics(windowMinutes, activeWindowMinutes);

    res.status(200).json(metrics);
  } catch (err) {
    next(err);
  }
}

export function getAdminObservabilityMetrics(req: Request, res: Response, next: NextFunction): void {
  try {
    requireAuthenticatedUser(req as AuthenticatedRequest);

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: metricsService.getSnapshot(),
    });
  } catch (err) {
    next(err);
  }
}
