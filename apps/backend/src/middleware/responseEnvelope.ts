import { NextFunction, Request, Response } from 'express';

interface JsonPayload {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

function shouldWrap(payload: unknown): payload is JsonPayload {
  return payload !== null && typeof payload === 'object';
}

export function responseEnvelope(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((payload: unknown) => {
    if (!shouldWrap(payload)) {
      return originalJson({ success: true, data: payload });
    }

    if (typeof payload.success === 'boolean') {
      return originalJson(payload);
    }

    if (payload.error) {
      return originalJson({ success: false, error: payload.error, data: payload.data });
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return originalJson({ success: true, data: payload.data });
    }

    return originalJson({ success: true, data: payload });
  }) as Response['json'];

  next();
}
