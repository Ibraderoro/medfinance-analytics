import { Request, Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { parseEnumValue, parseIntegerInRange } from '../utils/validation';

const service = new ForecastingService();

export async function getForecast(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { months, metric } = req.query;
    const data = await service.getForecast({
      months: parseIntegerInRange(months, 12, { min: 1, max: 36 }),
      metric: parseEnumValue(metric, ['revenue', 'expense'] as const, 'revenue'),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getBudgetVariance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { year } = req.query;
    const data = await service.getBudgetVariance({
      year: parseIntegerInRange(year, new Date().getFullYear(), { min: 2000, max: 2100 }),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
