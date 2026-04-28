import { Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { ForecastMetric } from '../services/forecasting/forecastingMath';
import { parseIntegerQuery } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new ForecastingService();

export async function getForecast(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { months, metric } = req.query;
    const data = await service.getForecast({
      organizationId: user.organization_id,
      months:
        parseIntegerQuery(months as string | undefined, {
          label: 'months',
          min: 1,
          max: 36,
        }) ?? 12,
      metric: ((metric as string | undefined) ?? 'revenue') as ForecastMetric,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getBudgetVariance(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { year } = req.query;
    const data = await service.getBudgetVariance({
      organizationId: user.organization_id,
      year:
        parseIntegerQuery(year as string | undefined, {
          label: 'year',
          min: 2000,
          max: 2100,
        }) ?? new Date().getFullYear(),
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
