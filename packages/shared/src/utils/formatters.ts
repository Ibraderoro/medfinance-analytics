/**
 * Format a number as a USD currency string.
 * e.g. 1234567.89 → "$1,234,567.89"
 */
export function formatCurrency(
  value: number,
  locale = 'en-US',
  currency = 'USD',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a number as a percentage string.
 * e.g. 0.856 → "85.6%"
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a date string (ISO) to a human-readable short form.
 * e.g. "2024-03-15T00:00:00Z" → "Mar 2024"
 */
export function formatMonthYear(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('default', { month: 'short', year: 'numeric' });
}

/**
 * Format large numbers with K/M/B suffix.
 * e.g. 1500000 → "$1.5M"
 */
export function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value}`;
}
