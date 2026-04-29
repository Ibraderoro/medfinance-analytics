import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { authenticate } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { getAdminMetrics } from '../controllers/admin.controller';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.get('/metrics', authorize('admin'), getAdminMetrics);
adminRouter.use(attachTenantContext);
adminRouter.use(blockTenantOverride);
adminRouter.get('/metrics', getAdminMetrics);
