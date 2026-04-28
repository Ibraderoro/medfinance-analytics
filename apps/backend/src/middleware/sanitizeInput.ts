import { NextFunction, Request, Response } from 'express';

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\0/g, '')
      .replace(/[<>]/g, '')
      .trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitizedEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !key.includes('$') && !key.includes('.'))
    .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]);

  return Object.fromEntries(sanitizedEntries);
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  req.body = sanitizeValue(req.body) as Request['body'];
  req.query = sanitizeValue(req.query) as Request['query'];
  req.params = sanitizeValue(req.params) as Request['params'];
  next();
}
