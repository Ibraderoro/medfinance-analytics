import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const requestUser = (req as Request & { user?: { id?: string; organization_id?: string } }).user;
    logger.info('HTTP request completed', {
      requestId: req.requestId,
      userId: requestUser?.id,
      orgId: requestUser?.organization_id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip,
    });
  });

  next();
}
