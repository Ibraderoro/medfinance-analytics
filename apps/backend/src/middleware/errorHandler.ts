import '../types/express';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
  details?: unknown;
}

export function tenantContextError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 403;
  err.isOperational = true;
  err.code = 'TENANT_CONTEXT_REQUIRED';
  return err;
}

function toErrorEnvelope(statusCode: number, message: string, code: string, details?: unknown) {
  return {
    success: false,
    error: {
      message,
      code,
      details,
    },
    data: null,
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    toErrorEnvelope(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'),
  );
}

export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void {
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
    details: err.details,
  });

  const message = statusCode >= 500 ? 'Internal server error' : err.message;
  res.status(statusCode).json(toErrorEnvelope(statusCode, message, code, err.details));
}
