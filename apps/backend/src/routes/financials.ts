import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';
import { financialQuerySchemas } from '../utils/validation';
import { enforceFreeHistoryWindow } from '../middleware/planAccess';
import { auditFinancialAccess } from '../middleware/audit';
import {
  getKpis,
  getSummary,
  getRevenue,
  getExpenses,
  getCashFlow,
} from '../controllers/financials.controller';
import {
  getLiveFinancials,
  notifyTransactionAdded,
  notifyForecastChanged,
} from '../controllers/financialsLive.controller';

export const financialsRouter = Router();

financialsRouter.use(authenticate);
financialsRouter.use(attachTenantContext);
financialsRouter.use(blockTenantOverride);
financialsRouter.use(auditFinancialAccess);

financialsRouter.get('/kpis', authorize('viewer'), validateRequest(financialQuerySchemas.summary), getKpis);
financialsRouter.get('/summary', authorize('viewer'), validateRequest(financialQuerySchemas.summary), getSummary);
financialsRouter.get('/revenue', authorize('viewer'), validateRequest(financialQuerySchemas.dateRange), enforceFreeHistoryWindow(3), getRevenue);
financialsRouter.get('/expenses', authorize('viewer'), validateRequest(financialQuerySchemas.dateRange), enforceFreeHistoryWindow(3), getExpenses);
financialsRouter.get('/cash-flow', authorize('viewer'), validateRequest(financialQuerySchemas.dateRange), enforceFreeHistoryWindow(3), getCashFlow);

financialsRouter.get('/live', authorize('viewer'), getLiveFinancials);

financialsRouter.post('/live/events/transaction-added', authorize('analyst'), notifyTransactionAdded);
financialsRouter.post('/live/events/forecast-changed', authorize('analyst'), notifyForecastChanged);
