import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  getComplianceStatus,
  getAuditLog,
  getRegulatoryAlerts,
} from '../controllers/compliance.controller';

export const complianceRouter = Router();

complianceRouter.use(authenticate);

complianceRouter.get('/status', getComplianceStatus);
complianceRouter.get(
  '/audit-log',
  [
    query('page').optional().isInt({ min: 1, max: 100000 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validateRequest,
  getAuditLog,
);
complianceRouter.get(
  '/alerts',
  [
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  ],
  validateRequest,
  getRegulatoryAlerts,
);
