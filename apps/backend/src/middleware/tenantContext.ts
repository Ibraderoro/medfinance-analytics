import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: {
      userId: string;
      organizationId: string;
    };
  }
}

const TENANT_ORG_FIELDS = ['organization_id', 'organizationId', 'organization_id', 'organisationId'];

export function attachTenantContext(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const organizationId = req.user?.organization_id;
  const userId = req.user?.id;
  if (!organizationId || !userId) {
    res.status(403).json({
      success: false,
      error: { message: 'organization_id is required for tenant-scoped access', code: 'TENANT_REQUIRED' },
    });
    return;
  }

  req.tenant = {
    userId,
    organizationId,
  };

  next();
}

export function blockTenantOverride(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.organization_id) {
    res.status(403).json({
      success: false,
      error: { message: 'organization_id is required for tenant-scoped access', code: 'TENANT_REQUIRED' },
    });
    return;
  }

  if (req.body && typeof req.body === 'object') {
    for (const field of TENANT_ORG_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body as object, field)) {
        delete (req.body as Record<string, unknown>)[field];
      }
    }
  }

  next();
}
