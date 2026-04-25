import { AppError } from '../middleware/errorHandler';

interface IntegerOptions {
  min?: number;
  max?: number;
  defaultValue?: number;
}

interface EnumOptions<T extends string> {
  allowedValues: readonly T[];
  defaultValue: T;
}

export function parseIntegerQuery(
  value: unknown,
  field: string,
  opts: IntegerOptions,
): number {
  if (value === undefined || value === null || value === '') {
    return opts.defaultValue ?? 0;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw badRequest(`${field} must be an integer`);
  }

  if (opts.min !== undefined && parsed < opts.min) {
    throw badRequest(`${field} must be at least ${opts.min}`);
  }

  if (opts.max !== undefined && parsed > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max}`);
  }

  return parsed;
}

export function parseEnumQuery<T extends string>(
  value: unknown,
  field: string,
  opts: EnumOptions<T>,
): T {
  if (value === undefined || value === null || value === '') {
    return opts.defaultValue;
  }

  const normalized = String(value) as T;

  if (!opts.allowedValues.includes(normalized)) {
    throw badRequest(
      `${field} must be one of: ${opts.allowedValues.join(', ')}`,
    );
  }

  return normalized;
}

export function parseDateQuery(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = String(value);
  const asDate = new Date(parsed);

  if (Number.isNaN(asDate.getTime())) {
    throw badRequest(`${field} must be a valid date`);
  }

  return parsed;
}

function badRequest(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.isOperational = true;
  return err;
}
