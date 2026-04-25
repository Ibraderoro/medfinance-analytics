import { Request, Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';
import {
  parseEnumQuery,
  parseIntegerQuery,
} from '../utils/requestValidation';

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
    const page = parseIntegerQuery(req.query.page, 'page', {
      min: 1,
      max: 10_000,
      defaultValue: 1,
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
    const severity = parseEnumQuery(req.query.severity, 'severity', {
      allowedValues: ['critical', 'high', 'medium', 'low'] as const,
      defaultValue: 'low',
    });

    const data = await service.getRegulatoryAlerts({
      severity: req.query.severity ? severity : undefined,
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
}
