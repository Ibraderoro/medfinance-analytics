import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth';
import { AuditService } from '../services/audit.service';

const auditService = new AuditService();

export async function auditFinancialAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;

  try {
    if (user) {
      await auditService.log({
        action: 'financial_data_access',
        entityType: 'financial_endpoint',
        organizationId: user.organization_id,
        performedBy: user.id,
        requestId: req.header('X-Request-Id'),
        metadata: {
          method: req.method,
          path: req.originalUrl,
          ip: req.ip,
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Audits authorized admin endpoint access and propagates failures.
 */
export async function auditAdminAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user;

  try {
    if (user) {
      await auditService.log({
        action: 'admin_endpoint_access',
        entityType: 'admin_endpoint',
        organizationId: user.organization_id,
        performedBy: user.id,
        requestId: req.header('X-Request-Id'),
        metadata: {
          method: req.method,
          path: req.originalUrl,
          ip: req.ip,
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
