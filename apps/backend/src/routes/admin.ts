import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { getAdminMetrics } from '../controllers/admin.controller';
import { auditAdminAccess } from '../middleware/audit';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(attachTenantContext);
adminRouter.use(blockTenantOverride);
adminRouter.get('/metrics', authorize('admin'), auditAdminAccess, getAdminMetrics);
