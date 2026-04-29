import { Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';
import { parseIntegerQuery, parseIsoDateQuery } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new FinancialsService();

export async function getKpis(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { year } = req.query;
    const data = await service.getKpis({
      organizationId: user.organization_id,
      year:
        parseIntegerQuery(year as string | undefined, {
          label: 'year',
          min: 2000,
          max: 2100,
        }) ?? new Date().getFullYear(),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getSummary(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { period, year } = req.query;
    const data = await service.getSummary({
      organizationId: user.organization_id,
      period: period as string,
      year:
        parseIntegerQuery(year as string | undefined, {
          label: 'year',
          min: 2000,
          max: 2100,
        }) ?? new Date().getFullYear(),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getRevenue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { startDate, endDate } = req.query;
    const data = await service.getRevenue({
      organizationId: user.organization_id,
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getExpenses(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { startDate, endDate } = req.query;
    const data = await service.getExpenses({
      organizationId: user.organization_id,
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getCashFlow(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { startDate, endDate } = req.query;
    const data = await service.getCashFlow({
      organizationId: user.organization_id,
      startDate: parseIsoDateQuery(startDate as string | undefined, 'startDate'),
      endDate: parseIsoDateQuery(endDate as string | undefined, 'endDate'),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
