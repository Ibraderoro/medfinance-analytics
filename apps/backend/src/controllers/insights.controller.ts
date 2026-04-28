import { Response, NextFunction } from 'express';
import { InsightsService } from '../services/insights.service';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';

const service = new InsightsService();

export async function getInsights(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const data = await service.getInsights(user.organization_id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
