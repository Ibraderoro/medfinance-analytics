import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { createBadRequestError, parseWithSchema, Schema } from '../utils/validation';

type RequestSchemas = {
  query?: Schema<unknown>;
  body?: Schema<unknown>;
  params?: Schema<unknown>;
};

export function validateRequest(schema?: Schema<unknown> | RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema) {
        if ('parse' in schema) {
          req.query = parseWithSchema(schema, req.query) as Request['query'];
        } else {
          if (schema.query) req.query = parseWithSchema(schema.query, req.query) as Request['query'];
          if (schema.body) req.body = parseWithSchema(schema.body, req.body);
          if (schema.params) req.params = parseWithSchema(schema.params, req.params) as Request['params'];
        }
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
