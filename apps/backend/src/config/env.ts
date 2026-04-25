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

function optionalBooleanEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const env = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: parseInt(optionalEnv('PORT', '3001'), 10),

  DATABASE_URL: requireEnv('DATABASE_URL'),
  PG_SSL: optionalBooleanEnv('PG_SSL', optionalEnv('NODE_ENV', 'development') === 'production'),

  REDIS_HOST: optionalEnv('REDIS_HOST', 'localhost'),
  REDIS_PORT: parseInt(optionalEnv('REDIS_PORT', '6379'), 10),
  REDIS_PASSWORD: optionalEnv('REDIS_PASSWORD'),

  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: optionalEnv('JWT_EXPIRES_IN', '1d'),
  REFRESH_TOKEN_SECRET: requireEnv('REFRESH_TOKEN_SECRET'),
  REFRESH_TOKEN_EXPIRES_IN: optionalEnv('REFRESH_TOKEN_EXPIRES_IN', '7d'),

  CORS_ALLOWED_ORIGINS: optionalEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  isProduction: () => process.env.NODE_ENV === 'production',
  isDevelopment: () => process.env.NODE_ENV === 'development',
};
