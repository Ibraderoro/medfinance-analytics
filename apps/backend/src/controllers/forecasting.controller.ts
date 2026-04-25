import { Request, Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { parseIntegerQuery } from '../utils/validation';

const service = new ForecastingService();

export async function getForecast(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { months, metric } = req.query;
    const data = await service.getForecast({
      months:
        parseIntegerQuery(months as string | undefined, {
          label: 'months',
          min: 1,
          max: 36,
        }) ?? 12,
      metric: metric as string,
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
    const { year } = req.query;
    const data = await service.getBudgetVariance({
      year:
        parseIntegerQuery(year as string | undefined, {
          label: 'year',
          min: 2000,
          max: 2100,
        }) ?? new Date().getFullYear(),
    });

    const data = await service.getBudgetVariance({ year });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
