import { Request, Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';

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
      year: year ? parseInt(year as string, 10) : new Date().getFullYear(),
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
      startDate: startDate as string,
      endDate: endDate as string,
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
      startDate: startDate as string,
      endDate: endDate as string,
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
      startDate: startDate as string,
      endDate: endDate as string,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
