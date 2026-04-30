import { Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';
import { complianceQuerySchemas, parseWithSchema } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new ComplianceService();

export async function getComplianceStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const data = await service.getComplianceStatus(user.organization_id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLog(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const query = parseWithSchema(complianceQuerySchemas.auditLog, req.query);
    const data = await service.getAuditLog({
      page: query.page,
      limit: query.limit,
      organizationId: user.organization_id,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getRegulatoryAlerts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const data = await service.getRegulatoryAlerts({
      severity: severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
      organizationId: user.organization_id,
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
}
