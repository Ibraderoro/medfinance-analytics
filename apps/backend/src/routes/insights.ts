import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { getInsights } from '../controllers/insights.controller';
import { requireMinimumPlan } from '../middleware/planAccess';

export const insightsRouter = Router();

insightsRouter.use(authenticate);
insightsRouter.use(attachTenantContext);
insightsRouter.use(blockTenantOverride);

insightsRouter.get('/', requireMinimumPlan('pro'), getInsights);
