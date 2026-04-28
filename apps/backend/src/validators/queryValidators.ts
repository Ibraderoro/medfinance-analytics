import { query } from 'express-validator';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const financialsSummaryValidator = [
  query('period')
    .optional()
    .isIn(['monthly'])
    .withMessage('period must be "monthly"'),
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('year must be an integer between 2000 and 2100'),
];

export const dateRangeValidator = [
  query('startDate')
    .optional()
    .matches(dateRegex)
    .withMessage('startDate must be in YYYY-MM-DD format'),
  query('endDate')
    .optional()
    .matches(dateRegex)
    .withMessage('endDate must be in YYYY-MM-DD format'),
  query('endDate').custom((endDate, { req }) => {
    const { startDate } = req.query as { startDate?: string };
    if (!startDate || !endDate) {
      return true;
    }

    if (new Date(startDate) > new Date(endDate)) {
      throw new Error('endDate must be greater than or equal to startDate');
    }

    return true;
  }),
];

export const forecastValidator = [
  query('months')
    .optional()
    .isInt({ min: 1, max: 36 })
    .withMessage('months must be an integer between 1 and 36'),
  query('metric')
    .optional()
    .isIn(['revenue', 'expense', 'net_income'])
    .withMessage('metric must be one of: revenue, expense, net_income'),
];

export const budgetVarianceValidator = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('year must be an integer between 2000 and 2100'),
];

export const auditLogValidator = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('page must be an integer between 1 and 1000'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
];

export const alertsValidator = [
  query('severity')
    .optional()
    .isIn(['low', 'medium', 'high', 'critical'])
    .withMessage('severity must be one of: low, medium, high, critical'),
];

export const complianceStatusValidator = [
  query('includeResolved')
    .optional()
    .isBoolean()
    .withMessage('includeResolved must be a boolean value'),
];
