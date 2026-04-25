import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import {
  getSummary,
  getRevenue,
  getExpenses,
  getCashFlow,
} from '../controllers/financials.controller';

export const financialsRouter = Router();

financialsRouter.use(authenticate);

financialsRouter.get(
  '/summary',
  [
    query('period').optional().isIn(['monthly', 'quarterly', 'yearly']),
    query('year').optional().isInt({ min: 2000, max: 2100 }),
  ],
  validateRequest,
  getSummary,
);

financialsRouter.get(
  '/revenue',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validateRequest,
  getRevenue,
);

financialsRouter.get(
  '/expenses',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validateRequest,
  getExpenses,
);

financialsRouter.get(
  '/cash-flow',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validateRequest,
  getCashFlow,
);
