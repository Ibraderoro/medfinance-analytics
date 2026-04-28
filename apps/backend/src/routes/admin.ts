import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getAdminMetrics } from '../controllers/admin.controller';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.get('/metrics', getAdminMetrics);
