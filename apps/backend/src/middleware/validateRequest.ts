import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export function validateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    next();
    return;
  }

  res.status(400).json({
    error: {
      message: 'Invalid request parameters',
      details: errors.array().map((error) => ({
        field: error.type === 'field' ? error.path : 'unknown',
        message: error.msg,
      })),
    },
  });
}
