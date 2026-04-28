import { Router } from 'express';
import { getInsights } from '../controllers/insights.controller';

export const insightsRouter = Router();

insightsRouter.get('/', getInsights);
