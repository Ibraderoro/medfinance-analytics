import { Request, Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';

const service = new ForecastingService();

export async function getForecast(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { months = '12', metric = 'revenue' } = req.query;
    const data = await service.getForecast({
      months: parseInt(months as string, 10),
      metric: metric as string,
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
      year: year ? parseInt(year as string, 10) : new Date().getFullYear(),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
