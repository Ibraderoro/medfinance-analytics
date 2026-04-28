import { Router } from 'express';
import { authenticate } from '../middleware/auth';
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
financialsRouter.use(auditFinancialAccess);

financialsRouter.get('/kpis', financialsSummaryValidator, validateRequest, getKpis);
financialsRouter.get('/summary', financialsSummaryValidator, validateRequest, getSummary);
financialsRouter.get('/revenue', dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getRevenue);
financialsRouter.get('/expenses', dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getExpenses);
financialsRouter.get('/cash-flow', dateRangeValidator, validateRequest, enforceFreeHistoryWindow(3), getCashFlow);

financialsRouter.get('/live', getLiveFinancials);

financialsRouter.post('/live/events/transaction-added', notifyTransactionAdded);
financialsRouter.post('/live/events/forecast-changed', notifyForecastChanged);
