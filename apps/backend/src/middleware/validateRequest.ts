import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { QuerySchema, createBadRequestError, parseWithSchema } from '../utils/validation';

export function validateRequest<T>(schema?: QuerySchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema) {
        const parsed = parseWithSchema(schema, req.query);
        req.query = parsed as Request['query'];
      } else {
        const result = validationResult(req);
        if (!result.isEmpty()) {
          throw createBadRequestError('Invalid request parameters', result.array().map((item) => ({
            field: item.type === 'field' ? item.path : 'request',
            message: item.msg,
          })));
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
