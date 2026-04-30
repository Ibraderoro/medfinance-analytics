import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';
import {
  getComplianceStatus,
  getAuditLog,
  getRegulatoryAlerts,
} from '../controllers/compliance.controller';
import { alertsValidator, auditLogValidator, complianceStatusValidator } from '../validators/queryValidators';

export const complianceRouter = Router();

complianceRouter.use(authenticate);
complianceRouter.use(attachTenantContext);
complianceRouter.use(blockTenantOverride);

complianceRouter.get('/status', complianceStatusValidator, validateRequest(), getComplianceStatus);
complianceRouter.get('/audit-log', auditLogValidator, validateRequest(), getAuditLog);
complianceRouter.get('/alerts', alertsValidator, validateRequest(), getRegulatoryAlerts);
