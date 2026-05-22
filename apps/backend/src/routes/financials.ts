import { Router } from 'express';
import { financialSchemas } from '@medfinance/shared';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateQuery } from '../middleware/zodValidate';
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

financialsRouter.get('/kpis', authorize('viewer'), validateQuery(financialSchemas.summaryQuery), getKpis);
financialsRouter.get('/summary', authorize('viewer'), validateQuery(financialSchemas.summaryQuery), getSummary);
financialsRouter.get('/revenue', authorize('viewer'), validateQuery(financialSchemas.dateRangeQuery), enforceFreeHistoryWindow(3), getRevenue);
financialsRouter.get('/expenses', authorize('viewer'), validateQuery(financialSchemas.dateRangeQuery), enforceFreeHistoryWindow(3), getExpenses);
financialsRouter.get('/cash-flow', authorize('viewer'), validateQuery(financialSchemas.dateRangeQuery), enforceFreeHistoryWindow(3), getCashFlow);

financialsRouter.get('/live', authorize('viewer'), getLiveFinancials);

financialsRouter.post('/live/events/transaction-added', authorize('analyst'), notifyTransactionAdded);
financialsRouter.post('/live/events/forecast-changed', authorize('analyst'), notifyForecastChanged);
