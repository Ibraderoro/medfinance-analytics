import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getInsights } from '../controllers/insights.controller';

export const insightsRouter = Router();

insightsRouter.use(authenticate);

insightsRouter.get('/', getInsights);
