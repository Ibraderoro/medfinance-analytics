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

function parseIntegerEnv(key: string, defaultValue: string): number {
  const rawValue = optionalEnv(key, defaultValue);
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer`);
  }
  return parsed;
}

function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const env = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: parseIntegerEnv('PORT', '3001'),

  DATABASE_URL: requireEnv('DATABASE_URL'),

  REDIS_HOST: optionalEnv('REDIS_HOST', 'localhost'),
  REDIS_PORT: parseIntegerEnv('REDIS_PORT', '6379'),
  REDIS_PASSWORD: optionalEnv('REDIS_PASSWORD'),

  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: optionalEnv('JWT_EXPIRES_IN', '1d'),
  REFRESH_TOKEN_SECRET: requireEnv('REFRESH_TOKEN_SECRET'),
  REFRESH_TOKEN_EXPIRES_IN: optionalEnv('REFRESH_TOKEN_EXPIRES_IN', '7d'),

  CORS_ALLOWED_ORIGINS: parseAllowedOrigins(optionalEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  isProduction: () => process.env.NODE_ENV === 'production',
  isDevelopment: () => process.env.NODE_ENV === 'development',
};
