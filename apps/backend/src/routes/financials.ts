import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  getKpis,
  getSummary,
  getRevenue,
  getExpenses,
  getCashFlow,
} from '../controllers/financials.controller';
import { getLiveFinancials } from '../controllers/financialsLive.controller';
import {
  financialsSummaryValidator,
  dateRangeValidator,
} from '../validators/queryValidators';

export const financialsRouter = Router();

financialsRouter.use(authenticate);

financialsRouter.get('/kpis', financialsSummaryValidator, validateRequest, getKpis);
financialsRouter.get('/summary', financialsSummaryValidator, validateRequest, getSummary);
financialsRouter.get('/revenue', dateRangeValidator, validateRequest, getRevenue);
financialsRouter.get('/expenses', dateRangeValidator, validateRequest, getExpenses);
financialsRouter.get('/cash-flow', dateRangeValidator, validateRequest, getCashFlow);

financialsRouter.get('/live', getLiveFinancials);
