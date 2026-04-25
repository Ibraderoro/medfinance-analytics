import { query } from 'express-validator';

const validTransactionMetrics = ['revenue', 'expense'] as const;
const validSeverities = ['critical', 'high', 'medium', 'low'] as const;

export const financialSummaryValidator = [
  query('period')
    .optional()
    .isIn(['monthly', 'quarterly', 'yearly'])
    .withMessage('period must be monthly, quarterly, or yearly'),
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('year must be between 2000 and 2100'),
];

export const dateRangeValidator = [
  query('startDate')
    .optional()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('startDate must be an ISO-8601 date (YYYY-MM-DD)'),
  query('endDate')
    .optional()
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('endDate must be an ISO-8601 date (YYYY-MM-DD)'),
];

export const forecastValidator = [
  query('months')
    .optional()
    .isInt({ min: 1, max: 36 })
    .withMessage('months must be an integer between 1 and 36'),
  query('metric')
    .optional()
    .isIn(validTransactionMetrics)
    .withMessage('metric must be revenue or expense'),
];

export const budgetVarianceValidator = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('year must be between 2000 and 2100'),
];

export const auditLogValidator = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 100000 })
    .withMessage('page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
];

export const regulatoryAlertValidator = [
  query('severity')
    .optional()
    .isIn(validSeverities)
    .withMessage('severity must be one of critical, high, medium, or low'),
];
