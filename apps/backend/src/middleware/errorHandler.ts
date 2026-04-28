import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;
  const statusCode = err.statusCode ?? ((err.message.includes('CORS blocked') || err.message.includes('Origin not allowed by CORS')) ? 403 : 500);
  const isOperational = err.isOperational ?? false;

  if (!isOperational) {
    logger.error('Unhandled error:', {
      message: err.message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    error: {
      message: statusCode >= 500 ? 'Internal server error' : err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}
