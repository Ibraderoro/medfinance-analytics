import { Request, Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';
import {
  parseDateQuery,
  parseEnumQuery,
  parseIntegerQuery,
} from '../utils/requestValidation';

const service = new FinancialsService();

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const period = parseEnumQuery(req.query.period, 'period', {
      allowedValues: ['monthly', 'quarterly', 'yearly'] as const,
      defaultValue: 'monthly',
    });

    const year = parseIntegerQuery(req.query.year, 'year', {
      min: 2000,
      max: 2100,
      defaultValue: new Date().getFullYear(),
    });

    const data = await service.getSummary({ period, year });
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
    const startDate = parseDateQuery(req.query.startDate, 'startDate');
    const endDate = parseDateQuery(req.query.endDate, 'endDate');

    const data = await service.getRevenue({ startDate, endDate });
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
    const startDate = parseDateQuery(req.query.startDate, 'startDate');
    const endDate = parseDateQuery(req.query.endDate, 'endDate');

    const data = await service.getExpenses({ startDate, endDate });
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
    const startDate = parseDateQuery(req.query.startDate, 'startDate');
    const endDate = parseDateQuery(req.query.endDate, 'endDate');

    const data = await service.getCashFlow({ startDate, endDate });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
