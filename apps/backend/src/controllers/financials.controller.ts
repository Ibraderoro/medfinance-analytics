import { Response, NextFunction } from 'express';
import { FinancialsService } from '../services/financials.service';
import { financialQuerySchemas, parseWithSchema } from '../utils/validation';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new FinancialsService();

export async function getKpis(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const query = parseWithSchema(financialQuerySchemas.summary, req.query);
    const data = await service.getKpis({ organizationId: user.organization_id, year: query.year });
    res.json(data);
  } catch (err) { next(err); }
}

export async function getSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const query = parseWithSchema(financialQuerySchemas.summary, req.query);
    const data = await service.getSummary({ organizationId: user.organization_id, period: query.period, year: query.year });
    res.json(data);
  } catch (err) { next(err); }
}

async function getDateRange(req: AuthenticatedRequest) {
  const user = requireAuthenticatedUser(req);
  const query = parseWithSchema(financialQuerySchemas.dateRange, req.query);
  return { organizationId: user.organization_id, startDate: query.startDate, endDate: query.endDate };
}

export async function getRevenue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.getRevenue(await getDateRange(req))); } catch (err) { next(err); }
}

export async function getExpenses(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.getExpenses(await getDateRange(req))); } catch (err) { next(err); }
}

export async function getCashFlow(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.getCashFlow(await getDateRange(req))); } catch (err) { next(err); }
}
