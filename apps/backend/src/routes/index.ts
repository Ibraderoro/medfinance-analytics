import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { financialsRouter } from './financials';
import { forecastingRouter } from './forecasting';
import { complianceRouter } from './compliance';
import { insightsRouter } from './insights';
import { billingRouter } from './billing';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/financials', financialsRouter);
router.use('/forecasting', forecastingRouter);
router.use('/compliance', complianceRouter);
router.use('/insights', insightsRouter);
router.use('/billing', billingRouter);
