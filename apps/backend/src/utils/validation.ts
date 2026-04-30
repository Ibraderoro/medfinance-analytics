import { AppError } from '../middleware/errorHandler';

export function createBadRequestError(message: string, details?: unknown): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  err.isOperational = true;
  err.details = details;
  return err;
}

type Parser<T> = (input: Record<string, unknown>) => T;

export interface QuerySchema<T> {
  parse: Parser<T>;
}

export function parseWithSchema<T>(schema: QuerySchema<T>, input: unknown): T {
  if (!input || typeof input !== 'object') {
    throw createBadRequestError('Invalid request parameters');
  }
  return schema.parse(input as Record<string, unknown>);
}

function toInt(value: unknown, label: string, min?: number, max?: number, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw createBadRequestError(`${label} is required`);
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) throw createBadRequestError(`${label} must be a valid integer`);
  if (min !== undefined && parsed < min) throw createBadRequestError(`${label} must be at least ${min}`);
  if (max !== undefined && parsed > max) throw createBadRequestError(`${label} must be at most ${max}`);
  return parsed;
}

export function parseIntegerQuery(value: string | undefined, options: { label: string; min?: number; max?: number }): number | undefined {
  if (value === undefined) return undefined;
  return toInt(value, options.label, options.min, options.max);
}

export function parseIsoDateQuery(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createBadRequestError(`${label} must use YYYY-MM-DD format`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw createBadRequestError(`${label} must be a valid date`);
  return value;
}

export const financialQuerySchemas = {
  summary: {
    parse: (input: Record<string, unknown>) => ({
      period: input.period === undefined ? 'monthly' : String(input.period),
      year: toInt(input.year, 'year', 2000, 2100, new Date().getFullYear()),
    }),
  } as QuerySchema<{ period: string; year: number }>,
  dateRange: {
    parse: (input: Record<string, unknown>) => {
      const startDate = input.startDate === undefined ? undefined : parseIsoDateQuery(String(input.startDate), 'startDate');
      const endDate = input.endDate === undefined ? undefined : parseIsoDateQuery(String(input.endDate), 'endDate');
      if (startDate && endDate && startDate > endDate) {
        throw createBadRequestError('endDate must be greater than or equal to startDate');
      }
      return { startDate, endDate };
    },
  } as QuerySchema<{ startDate?: string; endDate?: string }>,
};

export const forecastingQuerySchemas = {
  forecast: {
    parse: (input: Record<string, unknown>) => ({
      months: toInt(input.months, 'months', 1, 36, 12),
      metric: input.metric === undefined ? 'revenue' : String(input.metric),
    }),
  } as QuerySchema<{ months: number; metric: 'revenue' | 'expense' | 'net_income' }>,
  budgetVariance: {
    parse: (input: Record<string, unknown>) => ({
      year: toInt(input.year, 'year', 2000, 2100, new Date().getFullYear()),
    }),
  } as QuerySchema<{ year: number }>,
};

export const complianceQuerySchemas = {
  auditLog: {
    parse: (input: Record<string, unknown>) => ({
      page: toInt(input.page, 'page', 1, 1000, 1),
      limit: toInt(input.limit, 'limit', 1, 100, 20),
    }),
  } as QuerySchema<{ page: number; limit: number }>,
};
