import { Request, Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import {
  parseEnumQuery,
  parseIntegerQuery,
} from '../utils/requestValidation';

const service = new ForecastingService();

export async function getForecast(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const months = parseIntegerQuery(req.query.months, 'months', {
      min: 1,
      max: 60,
      defaultValue: 12,
    });

    const metric = parseEnumQuery(req.query.metric, 'metric', {
      allowedValues: ['revenue', 'expense'] as const,
      defaultValue: 'revenue',
    });

    const data = await service.getForecast({ months, metric });
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
    const year = parseIntegerQuery(req.query.year, 'year', {
      min: 2000,
      max: 2100,
      defaultValue: new Date().getFullYear(),
    });

    const data = await service.getBudgetVariance({ year });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
