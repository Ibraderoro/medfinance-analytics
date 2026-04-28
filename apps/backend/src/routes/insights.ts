import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getInsights } from '../controllers/insights.controller';
import { requireMinimumPlan } from '../middleware/planAccess';

export const insightsRouter = Router();

insightsRouter.use(authenticate);

insightsRouter.get('/', requireMinimumPlan('pro'), getInsights);
