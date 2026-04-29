import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getAdminMetrics } from '../controllers/admin.controller';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.get('/metrics', authorize('admin'), getAdminMetrics);
