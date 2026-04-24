import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getForecast,
  getBudgetVariance,
} from '../controllers/forecasting.controller';

export const forecastingRouter = Router();

forecastingRouter.use(authenticate);

forecastingRouter.get('/forecast', getForecast);
forecastingRouter.get('/budget-variance', getBudgetVariance);
