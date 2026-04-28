import { Request, Response, NextFunction } from 'express';
import { liveFinancialsService } from '../services/liveFinancials.service';

export async function getLiveFinancials(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.flushHeaders();
    res.write('retry: 10000\n\n');

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25_000);

    await liveFinancialsService.addClient(res);

    req.on('close', () => {
      clearInterval(keepAlive);
      liveFinancialsService.removeClient(res);
      res.end();
    });
  } catch (error) {
    next(error);
  }
}
