import { Request, Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';
import { parseEnumValue, parseIntegerInRange } from '../utils/validation';

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
    const { page, limit } = req.query;
    const data = await service.getAuditLog({
      page: parseIntegerInRange(page, 1, { min: 1, max: 10_000 }),
      limit: parseIntegerInRange(limit, 50, { min: 1, max: 500 }),
    });
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
    const parsedSeverity = parseEnumValue(
      severity,
      ['critical', 'high', 'medium', 'low'] as const,
      'low',
    );

    const data = await service.getRegulatoryAlerts({
      severity: typeof severity === 'undefined' ? undefined : parsedSeverity,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
