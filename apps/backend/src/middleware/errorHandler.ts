import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      code: 'ROUTE_NOT_FOUND',
    },
  });
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;
  const statusCode = err.statusCode ?? ((err.message.includes('CORS blocked') || err.message.includes('Origin not allowed by CORS')) ? 403 : 500);
  const code = err.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');

  logger.error('Request failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    message: err.message,
    stack: err.stack,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message: statusCode >= 500 ? 'Internal server error' : err.message,
      code,
    },
  });
}
