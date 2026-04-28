import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }

  interface Response {
    success: <T>(data: T, statusCode?: number) => void;
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = req.header('x-request-id');
  const requestId = incomingRequestId && incomingRequestId.trim().length > 0
    ? incomingRequestId.trim()
    : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.success = <T>(data: T, statusCode = 200): void => {
    res.status(statusCode).json({ success: true, data });
  };

  next();
}
