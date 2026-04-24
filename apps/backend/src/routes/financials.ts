import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getSummary,
  getRevenue,
  getExpenses,
  getCashFlow,
} from '../controllers/financials.controller';

export const financialsRouter = Router();

financialsRouter.use(authenticate);

financialsRouter.get('/summary', getSummary);
financialsRouter.get('/revenue', getRevenue);
financialsRouter.get('/expenses', getExpenses);
financialsRouter.get('/cash-flow', getCashFlow);
