import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export function validateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }

  res.status(400).json({
    success: false,
    error: {
      message: 'Invalid request parameters',
      code: 'VALIDATION_ERROR',
    },
    data: {
      details: result.array().map((item) => ({
        field: item.type === 'field' ? item.path : 'request',
        message: item.msg,
      })),
    },
  });
}
