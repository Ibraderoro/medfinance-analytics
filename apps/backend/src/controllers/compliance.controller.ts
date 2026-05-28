import { Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';
import { complianceQuerySchemas, parseWithSchema } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';
import { buildPageMeta, normalizePagination } from '../utils/pagination';

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
    res.json({
      data: data.items,
      meta: buildPageMeta(data.page, data.limit, data.total),
    });
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
    const { page, limit } = normalizePagination({
      page: typeof req.query.page === 'string' ? Number(req.query.page) : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    }, { page: 1, limit: 50, maxLimit: 100 });

    const data = await service.getRegulatoryAlerts({
      severity: severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
      organizationId: user.organization_id,
      page,
      limit,
    });

    res.json({
      data: data.items,
      meta: buildPageMeta(data.page, data.limit, data.total),
    });
  } catch (err) {
    next(err);
  }
}
