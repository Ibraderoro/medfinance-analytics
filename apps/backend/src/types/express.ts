import type {} from 'express-serve-static-core';

export {};

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    traceId?: string;
    spanId?: string;
    traceSampled?: boolean;
    tenant?: {
      userId: string;
      organizationId: string;
    };
  }

  interface Response {
    success: <T>(data: T, statusCode?: number) => void;
  }
}
