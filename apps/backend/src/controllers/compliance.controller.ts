import { Request, Response, NextFunction } from 'express';
import { ComplianceService } from '../services/compliance.service';

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
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
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
    const data = await service.getRegulatoryAlerts({
      severity: severity as string | undefined,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
