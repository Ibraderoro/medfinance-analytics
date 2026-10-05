import { NextFunction, Response } from 'express';
import { AuthenticatedRequest, requireAuthenticatedUser } from './auth';

export type Permission =
  | 'financials:read'
  | 'forecasting:read'
  | 'compliance:read'
  | 'compliance:write'
  | 'billing:read'
  | 'billing:write'
  | 'admin:read';

const ROLE_PERMISSIONS: Record<string, Set<Permission>> = {
  // viewer: read-only access across all modules
  viewer: new Set(['financials:read', 'forecasting:read', 'compliance:read', 'billing:read']),
  // analyst: all viewer permissions plus the ability to write compliance records
  analyst: new Set(['financials:read', 'forecasting:read', 'compliance:read', 'compliance:write', 'billing:read']),
  // admin: full access including billing write and admin endpoints
  admin: new Set(['financials:read', 'forecasting:read', 'compliance:read', 'compliance:write', 'billing:read', 'billing:write', 'admin:read']),
};

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = requireAuthenticatedUser(req);
    const permissions = ROLE_PERMISSIONS[user.role] ?? new Set<Permission>();

    if (!permissions.has(permission)) {
      res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions', code: 'AUTH_FORBIDDEN_PERMISSION' },
        data: null,
      });
      return;
    }

    next();
  };
}
