import {
  formatCurrency,
  formatPercent,
  formatMonthYear,
  formatCompactCurrency,
} from '../utils/formatters';

describe('formatCurrency', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCurrency(1_234_567)).toBe('$1,234,567');
  });

  it('formats zero correctly', () => {
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('formatPercent', () => {
  it('formats a decimal as percentage', () => {
    expect(formatPercent(0.856)).toBe('85.6%');
  });

  it('respects decimal places', () => {
    expect(formatPercent(0.5, 0)).toBe('50%');
  });
});

describe('formatMonthYear', () => {
  it('returns abbreviated month + year', () => {
    const result = formatMonthYear('2024-03-15T00:00:00Z');
    expect(result).toMatch(/Mar(ch)? 2024/);
  });
});

describe('formatCompactCurrency', () => {
  it('formats millions', () => {
    expect(formatCompactCurrency(1_500_000)).toBe('$1.5M');
  });

  it('formats thousands', () => {
    expect(formatCompactCurrency(42_000)).toBe('$42.0K');
  });

  it('formats billions', () => {
    expect(formatCompactCurrency(3_200_000_000)).toBe('$3.2B');
  });

  it('formats small values', () => {
    expect(formatCompactCurrency(500)).toBe('$500');
  });
});
