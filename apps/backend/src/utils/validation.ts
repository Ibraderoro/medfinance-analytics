import { AppError } from '../middleware/errorHandler';

export function createBadRequestError(message: string): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = 400;
  error.isOperational = true;
  return error;
}

interface ParseIntegerOptions {
  min?: number;
  max?: number;
  label: string;
}

export function parseIntegerQuery(
  value: string | undefined,
  options: ParseIntegerOptions,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw createBadRequestError(`${options.label} must be a valid integer`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw createBadRequestError(`${options.label} must be at least ${options.min}`);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw createBadRequestError(`${options.label} must be at most ${options.max}`);
  }

  return parsed;
}

export function parseIsoDateQuery(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createBadRequestError(`${label} must use YYYY-MM-DD format`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createBadRequestError(`${label} must be a valid date`);
  }

  return value;
}
