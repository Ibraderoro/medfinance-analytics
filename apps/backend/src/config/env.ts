import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function requireMinLength(value: string, key: string, minLength: number): string {
  if (value.length < minLength) {
    throw new Error(`Environment variable ${key} must be at least ${minLength} characters long`);
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

function parseFloatEnv(key: string, defaultValue: number): number {
  const raw = optionalEnv(key, String(defaultValue));
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }

  return parsed;
}

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const jwtSecret = requireMinLength(requireEnv('JWT_SECRET'), 'JWT_SECRET', 32);
const refreshTokenSecret = requireMinLength(requireEnv('REFRESH_TOKEN_SECRET'), 'REFRESH_TOKEN_SECRET', 32);

export const env = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: parseIntEnv('PORT', 3001),

  DATABASE_URL: requireEnv('DATABASE_URL'),
  PG_SSL: optionalBooleanEnv('PG_SSL', optionalEnv('NODE_ENV', 'development') === 'production'),
  PG_SSL_REJECT_UNAUTHORIZED: optionalBooleanEnv(
    'PG_SSL_REJECT_UNAUTHORIZED',
    optionalEnv('NODE_ENV', 'development') === 'production',
  ),
  PG_POOL_MAX: parseIntEnv('PG_POOL_MAX', 30),
  PG_IDLE_TIMEOUT_MS: parseIntEnv('PG_IDLE_TIMEOUT_MS', 30_000),
  PG_CONNECTION_TIMEOUT_MS: parseIntEnv('PG_CONNECTION_TIMEOUT_MS', 5_000),
  HTTP_REQUEST_TIMEOUT_MS: parseIntEnv('HTTP_REQUEST_TIMEOUT_MS', 30_000),
  HTTP_HEADERS_TIMEOUT_MS: parseIntEnv('HTTP_HEADERS_TIMEOUT_MS', 35_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: parseIntEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000),

  REDIS_URL: optionalEnv('REDIS_URL'),
  REDIS_HOST: optionalEnv('REDIS_HOST', 'localhost'),
  REDIS_PORT: parseIntEnv('REDIS_PORT', 6379),
  REDIS_PASSWORD: optionalEnv('REDIS_PASSWORD'),
  REDIS_TLS: optionalBooleanEnv('REDIS_TLS', optionalEnv('NODE_ENV', 'development') === 'production'),
  REQUIRE_SECURE_TRANSPORT: optionalBooleanEnv(
    'REQUIRE_SECURE_TRANSPORT',
    optionalEnv('NODE_ENV', 'development') === 'production',
  ),

  JWT_SECRET: jwtSecret,
  JWT_ISSUER: optionalEnv('JWT_ISSUER', 'medfinance-api'),
  JWT_AUDIENCE: optionalEnv('JWT_AUDIENCE', 'medfinance-client'),
  JWT_EXPIRES_IN: optionalEnv('JWT_EXPIRES_IN', '1d'),
  REFRESH_TOKEN_SECRET: refreshTokenSecret,
  REFRESH_TOKEN_EXPIRES_IN: optionalEnv('REFRESH_TOKEN_EXPIRES_IN', '7d'),

  CORS_ALLOWED_ORIGINS: parseCorsOrigins(
    optionalEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'),
  ),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),
  ANALYTICS_SAMPLE_RATE: parseFloatEnv('ANALYTICS_SAMPLE_RATE', 1),
  ANALYTICS_BATCH_SIZE: parseIntEnv('ANALYTICS_BATCH_SIZE', 100),
  ANALYTICS_FLUSH_INTERVAL_MS: parseIntEnv('ANALYTICS_FLUSH_INTERVAL_MS', 1000),
  ANALYTICS_MAX_QUEUE_SIZE: parseIntEnv('ANALYTICS_MAX_QUEUE_SIZE', 10_000),
  ALLOW_SELF_SERVICE_REGISTRATION: optionalBooleanEnv(
    'ALLOW_SELF_SERVICE_REGISTRATION',
    optionalEnv('NODE_ENV', 'development') !== 'production',
  ),
  STRIPE_SECRET_KEY: optionalEnv('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: optionalEnv('STRIPE_WEBHOOK_SECRET'),
  STRIPE_PRO_PRICE_ID: optionalEnv('STRIPE_PRO_PRICE_ID'),
  STRIPE_ENTERPRISE_PRICE_ID: optionalEnv('STRIPE_ENTERPRISE_PRICE_ID'),


  isProduction: () => optionalEnv('NODE_ENV', 'development') === 'production',
  isDevelopment: () => optionalEnv('NODE_ENV', 'development') === 'development',
};

if (env.ANALYTICS_SAMPLE_RATE < 0 || env.ANALYTICS_SAMPLE_RATE > 1) {
  throw new Error('ANALYTICS_SAMPLE_RATE must be between 0 and 1');
}

if (env.REQUIRE_SECURE_TRANSPORT && env.isProduction()) {
  if (!env.PG_SSL) {
    throw new Error('PG_SSL must be enabled in production when REQUIRE_SECURE_TRANSPORT=true');
  }

  if (!env.REDIS_TLS) {
    throw new Error('REDIS_TLS must be enabled in production when REQUIRE_SECURE_TRANSPORT=true');
  }
}
