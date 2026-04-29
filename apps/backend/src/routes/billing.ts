import { Router } from 'express';
import { body } from 'express-validator';
import {
  createSubscription,
  getCurrentSubscription,
} from '../controllers/billing.controller';
import { authenticate } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';

export const billingRouter = Router();

billingRouter.use(authenticate);
billingRouter.use(attachTenantContext);
billingRouter.use(blockTenantOverride);

billingRouter.get('/subscription', getCurrentSubscription);
billingRouter.post(
  '/subscription',
  [
    body('plan')
      .isIn(['pro', 'enterprise'])
      .withMessage('plan must be one of: pro, enterprise'),
  ],
  validateRequest,
  createSubscription,
);
