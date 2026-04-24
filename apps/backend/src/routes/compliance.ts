import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getComplianceStatus,
  getAuditLog,
  getRegulatoryAlerts,
} from '../controllers/compliance.controller';

export const complianceRouter = Router();

complianceRouter.use(authenticate);

complianceRouter.get('/status', getComplianceStatus);
complianceRouter.get('/audit-log', getAuditLog);
complianceRouter.get('/alerts', getRegulatoryAlerts);
