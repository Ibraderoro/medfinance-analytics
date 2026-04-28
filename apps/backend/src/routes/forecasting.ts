import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  getForecast,
  getBudgetVariance,
} from '../controllers/forecasting.controller';
import {
  forecastValidator,
  budgetVarianceValidator,
} from '../validators/queryValidators';

export const forecastingRouter = Router();

forecastingRouter.use(authenticate);

forecastingRouter.get('/forecast', forecastValidator, validateRequest, getForecast);
forecastingRouter.get('/budget-variance', budgetVarianceValidator, validateRequest, getBudgetVariance);
