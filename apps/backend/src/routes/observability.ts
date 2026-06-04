import { Request, Response, Router } from 'express';
import { metricsService } from '../services/metrics.service';
import { enforceOperationalAccess } from '../middleware/operationalAccess';

export const observabilityRouter = Router();

function releaseMetadata() {
  return {
    version: process.env.RELEASE_VERSION ?? 'unknown',
    color: process.env.RELEASE_COLOR ?? 'unknown',
  };
}

observabilityRouter.get('/metrics', enforceOperationalAccess('metrics_prometheus'), (_req: Request, res: Response) => {
  res.type('text/plain').status(200).send(metricsService.toPrometheus());
});

observabilityRouter.get('/metrics/summary', enforceOperationalAccess('metrics_summary'), (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    metrics: metricsService.getSnapshot(),
  });
});

observabilityRouter.get('/status', enforceOperationalAccess('observability_status'), (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    release: releaseMetadata(),
  });
});
