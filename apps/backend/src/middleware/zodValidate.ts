import { NextFunction, Request, Response } from 'express';
import { z, ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'request',
    message: issue.message,
    code: issue.code,
  }));
}

function validate(source: Source, schema: ZodTypeAny) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = await schema.safeParseAsync(req[source]);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation Failed',
          details: formatZodError(parsed.error),
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    (req as Request)[source] = parsed.data;
    next();
  };
}

export const validateBody = <T extends ZodTypeAny>(schema: T) => validate('body', schema);
export const validateQuery = <T extends ZodTypeAny>(schema: T) => validate('query', schema);
export const validateParams = <T extends ZodTypeAny>(schema: T) => validate('params', schema);
