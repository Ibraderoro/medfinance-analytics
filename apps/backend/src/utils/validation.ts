export function parseIntegerInRange(
  value: unknown,
  fallback: number,
  options: { min: number; max: number },
): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, options.min), options.max);
}

export function parseDateString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : value;
}

export function parseEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== 'string') {
    return fallback;
  }

  return allowed.includes(value as T) ? (value as T) : fallback;
}
