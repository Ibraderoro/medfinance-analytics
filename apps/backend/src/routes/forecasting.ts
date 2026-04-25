import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  getForecast,
  getBudgetVariance,
} from '../controllers/forecasting.controller';

export const forecastingRouter = Router();

forecastingRouter.use(authenticate);

forecastingRouter.get(
  '/forecast',
  [
    query('months').optional().isInt({ min: 1, max: 60 }),
    query('metric').optional().isIn(['revenue', 'expenses', 'cash_flow']),
  ],
  validateRequest,
  getForecast,
);
forecastingRouter.get(
  '/budget-variance',
  [
    query('year').optional().isInt({ min: 2000, max: 2100 }),
  ],
  validateRequest,
  getBudgetVariance,
);
