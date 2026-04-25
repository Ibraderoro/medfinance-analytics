import { Request, Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';
import { parseDateString, parseEnumValue, parseIntegerInRange } from '../utils/validation';

const service = new FinancialsService();

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { period, year } = req.query;
    const data = await service.getSummary({
      period: parseEnumValue(period, ['monthly', 'quarterly', 'yearly'] as const, 'monthly'),
      year: parseIntegerInRange(year, new Date().getFullYear(), { min: 2000, max: 2100 }),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getRevenue(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getRevenue({
      startDate: parseDateString(startDate),
      endDate: parseDateString(endDate),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getExpenses({
      startDate: parseDateString(startDate),
      endDate: parseDateString(endDate),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getCashFlow(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { startDate, endDate } = req.query;
    const data = await service.getCashFlow({
      startDate: parseDateString(startDate),
      endDate: parseDateString(endDate),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
