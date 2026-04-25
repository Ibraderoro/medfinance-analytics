import { parseIntegerQuery, parseIsoDateQuery, createBadRequestError } from '../utils/validation';

describe('createBadRequestError', () => {
  it('creates an error with statusCode 400 and isOperational true', () => {
    const err = createBadRequestError('bad input');
    expect(err.message).toBe('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.isOperational).toBe(true);
  });
});

describe('parseIntegerQuery', () => {
  it('returns undefined when value is undefined', () => {
    expect(parseIntegerQuery(undefined, { label: 'page' })).toBeUndefined();
  });

  it('parses a valid integer string', () => {
    expect(parseIntegerQuery('42', { label: 'page' })).toBe(42);
  });

  it('throws 400 for non-numeric input', () => {
    expect(() => parseIntegerQuery('abc', { label: 'page' })).toThrow('page must be a valid integer');
  });

  it('throws 400 when value is below min', () => {
    expect(() =>
      parseIntegerQuery('0', { label: 'year', min: 2000 }),
    ).toThrow('year must be at least 2000');
  });

  it('throws 400 when value exceeds max', () => {
    expect(() =>
      parseIntegerQuery('101', { label: 'limit', max: 100 }),
    ).toThrow('limit must be at most 100');
  });

  it('accepts value exactly at min boundary', () => {
    expect(parseIntegerQuery('2000', { label: 'year', min: 2000, max: 2100 })).toBe(2000);
  });

  it('accepts value exactly at max boundary', () => {
    expect(parseIntegerQuery('2100', { label: 'year', min: 2000, max: 2100 })).toBe(2100);
  });
});

describe('parseIsoDateQuery', () => {
  it('returns undefined when value is undefined', () => {
    expect(parseIsoDateQuery(undefined, 'startDate')).toBeUndefined();
  });

  it('returns the date string for a valid YYYY-MM-DD value', () => {
    expect(parseIsoDateQuery('2024-06-15', 'startDate')).toBe('2024-06-15');
  });

  it('throws 400 for invalid format', () => {
    expect(() => parseIsoDateQuery('15/06/2024', 'startDate')).toThrow(
      'startDate must use YYYY-MM-DD format',
    );
  });

  it('throws 400 for an invalid calendar date', () => {
    expect(() => parseIsoDateQuery('2024-13-01', 'startDate')).toThrow();
  });
});
