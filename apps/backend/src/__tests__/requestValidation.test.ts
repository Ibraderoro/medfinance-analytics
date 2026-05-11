import { parseIntegerQuery, parseEnumQuery, parseDateQuery } from '../utils/requestValidation';

describe('requestValidation.parseIntegerQuery', () => {
  it('returns default value when query value is missing', () => {
    expect(parseIntegerQuery(undefined, 'page', { defaultValue: 1 })).toBe(1);
    expect(parseIntegerQuery('', 'page', { defaultValue: 2 })).toBe(2);
  });

  it('returns 0 when value is missing and no default is provided', () => {
    expect(parseIntegerQuery(null, 'page', {})).toBe(0);
  });

  it('parses valid integer values', () => {
    expect(parseIntegerQuery('42', 'limit', { min: 1, max: 100 })).toBe(42);
  });

  it('throws an operational 400 error for non-integer input', () => {
    try {
      parseIntegerQuery('1.5', 'limit', { min: 1, max: 100 });
      throw new Error('Expected parseIntegerQuery to throw');
    } catch (error) {
      const err = error as Error & { statusCode?: number; isOperational?: boolean };
      expect(err.message).toBe('limit must be an integer');
      expect(err.statusCode).toBe(400);
      expect(err.isOperational).toBe(true);
    }
  });

  it('throws when value is below min', () => {
    expect(() => parseIntegerQuery('0', 'page', { min: 1 })).toThrow('page must be at least 1');
  });

  it('throws when value is above max', () => {
    expect(() => parseIntegerQuery('101', 'limit', { max: 100 })).toThrow('limit must be at most 100');
  });
});

describe('requestValidation.parseEnumQuery', () => {
  it('returns default for missing values', () => {
    expect(parseEnumQuery(undefined, 'metric', {
      allowedValues: ['revenue', 'expenses'] as const,
      defaultValue: 'revenue',
    })).toBe('revenue');
  });

  it('returns provided value when allowed', () => {
    expect(parseEnumQuery('expenses', 'metric', {
      allowedValues: ['revenue', 'expenses'] as const,
      defaultValue: 'revenue',
    })).toBe('expenses');
  });

  it('throws when value is not in allowed set', () => {
    expect(() => parseEnumQuery('margin', 'metric', {
      allowedValues: ['revenue', 'expenses'] as const,
      defaultValue: 'revenue',
    })).toThrow('metric must be one of: revenue, expenses');
  });
});

describe('requestValidation.parseDateQuery', () => {
  it('returns undefined for missing values', () => {
    expect(parseDateQuery(undefined, 'startDate')).toBeUndefined();
    expect(parseDateQuery('', 'startDate')).toBeUndefined();
  });

  it('returns original value for valid dates', () => {
    expect(parseDateQuery('2026-01-15', 'startDate')).toBe('2026-01-15');
  });

  it('throws for invalid dates', () => {
    expect(() => parseDateQuery('not-a-date', 'startDate')).toThrow('startDate must be a valid date');
  });
});
