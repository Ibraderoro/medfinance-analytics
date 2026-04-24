import { Router } from 'express';
import { healthRouter } from './health';
import { financialsRouter } from './financials';
import { forecastingRouter } from './forecasting';
import { complianceRouter } from './compliance';

export const router = Router();

router.use('/health', healthRouter);
router.use('/financials', financialsRouter);
router.use('/forecasting', forecastingRouter);
router.use('/compliance', complianceRouter);
