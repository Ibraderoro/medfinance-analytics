import { Response, NextFunction } from 'express';
import { liveFinancialsService } from '../services/liveFinancials.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

export async function getLiveFinancials(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.flushHeaders();
    res.write('retry: 10000\n\n');

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25_000);

    await liveFinancialsService.addClient(res, user.organization_id);

    req.on('close', () => {
      clearInterval(keepAlive);
      liveFinancialsService.removeClient(res);
      res.end();
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
