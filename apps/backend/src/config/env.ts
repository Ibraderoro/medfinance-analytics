import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue;
}

function parseIntEnv(key: string, defaultValue: number): number {
  const raw = optionalEnv(key, String(defaultValue));
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer`);
  }

  return parsed;
}

function optionalBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const env = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: parseIntEnv('PORT', 3001),

  DATABASE_URL: requireEnv('DATABASE_URL'),
  PG_SSL: optionalBooleanEnv('PG_SSL', optionalEnv('NODE_ENV', 'development') === 'production'),
  PG_SSL_REJECT_UNAUTHORIZED: optionalBooleanEnv(
    'PG_SSL_REJECT_UNAUTHORIZED',
    optionalEnv('NODE_ENV', 'development') === 'production',
  ),

  REDIS_HOST: optionalEnv('REDIS_HOST', 'localhost'),
  REDIS_PORT: parseIntEnv('REDIS_PORT', 6379),
  REDIS_PASSWORD: optionalEnv('REDIS_PASSWORD'),

  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: optionalEnv('JWT_EXPIRES_IN', '1d'),
  REFRESH_TOKEN_SECRET: requireEnv('REFRESH_TOKEN_SECRET'),
  REFRESH_TOKEN_EXPIRES_IN: optionalEnv('REFRESH_TOKEN_EXPIRES_IN', '7d'),

  CORS_ALLOWED_ORIGINS: parseCorsOrigins(
    optionalEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'),
  ),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),
  STRIPE_SECRET_KEY: optionalEnv('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: optionalEnv('STRIPE_WEBHOOK_SECRET'),
  STRIPE_PRO_PRICE_ID: optionalEnv('STRIPE_PRO_PRICE_ID'),
  STRIPE_ENTERPRISE_PRICE_ID: optionalEnv('STRIPE_ENTERPRISE_PRICE_ID'),


  isProduction: () => optionalEnv('NODE_ENV', 'development') === 'production',
  isDevelopment: () => optionalEnv('NODE_ENV', 'development') === 'development',
};
