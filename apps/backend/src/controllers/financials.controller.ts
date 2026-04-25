import { Request, Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';
import { parseIntegerQuery, parseIsoDateQuery } from '../utils/validation';

const service = new FinancialsService();

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { period = 'monthly', year } = req.query;
    const data = await service.getSummary({
      period: period as string,
      year:
        parseIntegerQuery(year as string | undefined, {
          label: 'year',
          min: 2000,
          max: 2100,
        }) ?? new Date().getFullYear(),
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
    const { startDate, endDate } = req.query;
    const data = await service.getRevenue({
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
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
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
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
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
