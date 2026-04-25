import { Request, Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';
import { createBadRequestError, parseIntegerQuery } from '../utils/validation';

const service = new ComplianceService();

export async function getComplianceStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getComplianceStatus();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page = '1', limit = '50' } = req.query;
    const data = await service.getAuditLog({
      page: parseIntegerQuery(page as string | undefined, {
        label: 'page',
        min: 1,
      }) ?? 1,
      limit:
        parseIntegerQuery(limit as string | undefined, {
          label: 'limit',
          min: 1,
          max: 200,
        }) ?? 50,
    });

    const limit = parseIntegerQuery(req.query.limit, 'limit', {
      min: 1,
      max: 100,
      defaultValue: 50,
    });

    const data = await service.getAuditLog({ page, limit });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getRegulatoryAlerts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { severity } = req.query;
    if (severity !== undefined && !['low', 'medium', 'high'].includes(severity as string)) {
      throw createBadRequestError('severity must be one of: low, medium, high');
    }
    const data = await service.getRegulatoryAlerts({
      severity: req.query.severity ? severity : undefined,
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
}
