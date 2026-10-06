import { Response, NextFunction } from 'express';
import { liveFinancialsService } from '../services/liveFinancials.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

type FlushableResponse = Response & { flush?: () => void };

export async function getLiveFinancials(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const sseResponse = res as FlushableResponse;

    sseResponse.setHeader('Content-Type', 'text/event-stream');
    sseResponse.setHeader('Cache-Control', 'no-cache, no-transform');
    sseResponse.setHeader('Connection', 'keep-alive');
    sseResponse.setHeader('X-Accel-Buffering', 'no');

    sseResponse.flushHeaders();
    sseResponse.write('retry: 10000\n\n');
    sseResponse.flush?.();

    const keepAlive = setInterval(() => {
      sseResponse.write(': keep-alive\n\n');
      sseResponse.flush?.();
    }, 25_000);

    await liveFinancialsService.addClient(sseResponse, user.organization_id);

    req.on('close', () => {
      clearInterval(keepAlive);
      liveFinancialsService.removeClient(sseResponse);
      sseResponse.end();
    });
  } catch (error) {
    next(error);
  }
}

export async function notifyTransactionAdded(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    await liveFinancialsService.publishTransactionAdded(user.organization_id);
    res.status(202).json({ ok: true, event: 'transaction-added' });
  } catch (error) {
    next(error);
  }
}

export async function notifyForecastChanged(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    await liveFinancialsService.publishForecastChanged(user.organization_id);
    res.status(202).json({ ok: true, event: 'forecast-changed' });
  } catch (error) {
    next(error);
  }
}

export async function notifyKpiUpdated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const fiscalYear: number = Number(req.body?.fiscalYear) || new Date().getFullYear();
    await liveFinancialsService.publishKpiUpdated(user.organization_id, fiscalYear);
    res.status(202).json({ ok: true, event: 'kpi-updated' });
  } catch (error) {
    next(error);
  }
}

export async function notifyComplianceUpdated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    await liveFinancialsService.publishComplianceUpdated(user.organization_id);
    res.status(202).json({ ok: true, event: 'compliance-updated' });
  } catch (error) {
    next(error);
  }
}

export async function notifyForecastUpdated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const metric: string = String(req.body?.metric ?? 'revenue');
    const months: number = Number(req.body?.months) || 6;
    await liveFinancialsService.publishForecastUpdated(user.organization_id, metric, months);
    res.status(202).json({ ok: true, event: 'forecast-updated' });
  } catch (error) {
    next(error);
  }
}
