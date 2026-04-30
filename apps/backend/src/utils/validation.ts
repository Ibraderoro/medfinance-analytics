import { AppError } from '../middleware/errorHandler';

export function createBadRequestError(message: string, details?: unknown): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  err.isOperational = true;
  err.details = details;
  return err;
}

type SchemaParser<T> = (input: unknown) => T;

export interface Schema<T> {
  parse: SchemaParser<T>;
}

export function parseWithSchema<T>(schema: Schema<T>, input: unknown): T {
  return schema.parse(input);
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
    parse: (input: unknown) => {
      if (!input || typeof input !== 'object') throw createBadRequestError('Invalid request parameters');
      const record = input as Record<string, unknown>;
      return {
        period: record.period === undefined ? 'monthly' : String(record.period),
        year: toInt(record.year, 'year', 2000, 2100, new Date().getFullYear()),
      };
    },
  } as Schema<{ period: string; year: number }>,
  dateRange: {
    parse: (input: unknown) => {
      if (!input || typeof input !== 'object') throw createBadRequestError('Invalid request parameters');
      const record = input as Record<string, unknown>;
      const startDate = record.startDate === undefined ? undefined : parseIsoDateQuery(String(record.startDate), 'startDate');
      const endDate = record.endDate === undefined ? undefined : parseIsoDateQuery(String(record.endDate), 'endDate');
      if (startDate && endDate && startDate > endDate) throw createBadRequestError('endDate must be greater than or equal to startDate');
      return { startDate, endDate };
    },
  } as Schema<{ startDate?: string; endDate?: string }>,
};

export const forecastingQuerySchemas = {
  forecast: {
    parse: (input: unknown) => {
      if (!input || typeof input !== 'object') throw createBadRequestError('Invalid request parameters');
      const record = input as Record<string, unknown>;
      const metric = record.metric === undefined ? 'revenue' : String(record.metric);
      if (!['revenue', 'expense', 'net_income'].includes(metric)) throw createBadRequestError('metric must be revenue, expense, or net_income');
      return { months: toInt(record.months, 'months', 1, 36, 12), metric: metric as 'revenue' | 'expense' | 'net_income' };
    },
  } as Schema<{ months: number; metric: 'revenue' | 'expense' | 'net_income' }>,
  budgetVariance: {
    parse: (input: unknown) => {
      if (!input || typeof input !== 'object') throw createBadRequestError('Invalid request parameters');
      const record = input as Record<string, unknown>;
      return { year: toInt(record.year, 'year', 2000, 2100, new Date().getFullYear()) };
    },
  } as Schema<{ year: number }>,
};

export const complianceQuerySchemas = {
  auditLog: {
    parse: (input: unknown) => {
      if (!input || typeof input !== 'object') throw createBadRequestError('Invalid request parameters');
      const record = input as Record<string, unknown>;
      return { page: toInt(record.page, 'page', 1, 1000, 1), limit: toInt(record.limit, 'limit', 1, 100, 20) };
    },
  } as Schema<{ page: number; limit: number }>,
};
