import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';
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
import {
  financialsSummaryValidator,
  dateRangeValidator,
} from '../validators/queryValidators';

export const financialsRouter = Router();

financialsRouter.use(authenticate);
financialsRouter.use(attachTenantContext);
financialsRouter.use(blockTenantOverride);
financialsRouter.use(auditFinancialAccess);

financialsRouter.get('/kpis', authorize('viewer'), financialsSummaryValidator, validateRequest, getKpis);
financialsRouter.get('/summary', authorize('viewer'), financialsSummaryValidator, validateRequest, getSummary);
financialsRouter.get('/revenue', authorize('viewer'), dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getRevenue);
financialsRouter.get('/expenses', authorize('viewer'), dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getExpenses);
financialsRouter.get('/cash-flow', authorize('viewer'), dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getCashFlow);

financialsRouter.get('/live', authorize('viewer'), getLiveFinancials);

financialsRouter.post('/live/events/transaction-added', authorize('analyst'), notifyTransactionAdded);
financialsRouter.post('/live/events/forecast-changed', authorize('analyst'), notifyForecastChanged);
