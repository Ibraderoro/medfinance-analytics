import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';
import {
  getForecast,
  getBudgetVariance,
} from '../controllers/forecasting.controller';
import {
  forecastValidator,
  budgetVarianceValidator,
} from '../validators/queryValidators';
import { notifyForecastUpdated } from '../controllers/financialsLive.controller';

export const forecastingRouter = Router();

forecastingRouter.use(authenticate);
forecastingRouter.use(attachTenantContext);
forecastingRouter.use(blockTenantOverride);

forecastingRouter.get('/forecast', forecastValidator, validateRequest(), getForecast);
forecastingRouter.get('/budget-variance', budgetVarianceValidator, validateRequest(), getBudgetVariance);

forecastingRouter.post('/live/events/forecast-updated', authorize('analyst'), notifyForecastUpdated);
