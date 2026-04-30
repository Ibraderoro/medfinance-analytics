import { Response, NextFunction } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { forecastingQuerySchemas, parseWithSchema } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new ForecastingService();

export async function getForecast(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const query = parseWithSchema(forecastingQuerySchemas.forecast, req.query);
    const data = await service.getForecast({
      organizationId: user.organization_id,
      months: query.months,
      metric: query.metric,
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
    const query = parseWithSchema(forecastingQuerySchemas.budgetVariance, req.query);
    const data = await service.getBudgetVariance({
      organizationId: user.organization_id,
      year: query.year,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
