import { Request, Response, NextFunction } from 'express';
import { InsightsService } from '../services/insights.service';

const service = new InsightsService();

export async function getInsights(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await service.getInsights();
    res.json(data);
  } catch (err) {
    next(err);
  }
}
