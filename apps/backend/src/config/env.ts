import 'dotenv/config';
import { logger } from '../utils/logger';

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

type OidcConfig = {
  OIDC_ISSUER: string;
  OIDC_TOKEN_URL: string;
  OIDC_USERINFO_URL: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  OIDC_REDIRECT_URI: string;
};

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
}

function validateMfaWebhookUrl(value = optionalEnv('MFA_DELIVERY_WEBHOOK_URL')): string {
  if (!value) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    logger.error('Invalid MFA delivery webhook URL', { key: 'MFA_DELIVERY_WEBHOOK_URL', reason: 'invalid_url' });
    throw new Error('MFA_DELIVERY_WEBHOOK_URL must be a valid URL');
  }

  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalhost(parsed.hostname))) {
    return value;
  }

  logger.error('Invalid MFA delivery webhook URL', {
    key: 'MFA_DELIVERY_WEBHOOK_URL',
    reason: 'insecure_protocol',
    protocol: parsed.protocol,
    hostname: parsed.hostname,
  });
  throw new Error('MFA_DELIVERY_WEBHOOK_URL must use HTTPS unless it targets localhost');
}

function requireSecureUrl(key: keyof OidcConfig, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable ${key} must be a valid URL`);
  }

  if (parsed.protocol === 'https:') {
    return;
  }

  if (parsed.protocol === 'http:' && isLocalhost(parsed.hostname)) {
    return;
  }

  throw new Error(`Environment variable ${key} must use HTTPS unless it targets localhost`);
}

function validateOidcConfig(config: OidcConfig): OidcConfig {
  const entries = Object.entries(config) as Array<[keyof OidcConfig, string]>;
  const present = entries.filter(([, value]) => value.length > 0);

  if (present.length === 0) {
    return config;
  }

  const missing = entries
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Incomplete OIDC configuration; missing ${missing.join(', ')}`);
  }

  for (const key of ['OIDC_ISSUER', 'OIDC_TOKEN_URL', 'OIDC_USERINFO_URL', 'OIDC_REDIRECT_URI'] as const) {
    requireSecureUrl(key, config[key]);
  }

  return config;
}

const jwtSecret = requireMinLength(requireEnv('JWT_SECRET'), 'JWT_SECRET', 32);
const refreshTokenSecret = requireMinLength(requireEnv('REFRESH_TOKEN_SECRET'), 'REFRESH_TOKEN_SECRET', 32);
const mfaDeliveryWebhookUrl = validateMfaWebhookUrl(optionalEnv('MFA_DELIVERY_WEBHOOK_URL'));
const oidcConfig = validateOidcConfig({
  OIDC_ISSUER: optionalEnv('OIDC_ISSUER'),
  OIDC_TOKEN_URL: optionalEnv('OIDC_TOKEN_URL'),
  OIDC_USERINFO_URL: optionalEnv('OIDC_USERINFO_URL'),
  OIDC_CLIENT_ID: optionalEnv('OIDC_CLIENT_ID'),
  OIDC_CLIENT_SECRET: optionalEnv('OIDC_CLIENT_SECRET'),
  OIDC_REDIRECT_URI: optionalEnv('OIDC_REDIRECT_URI'),
});

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
  AUDIT_EXPORT_SIGNING_SECRET: requireMinLength(requireEnv('AUDIT_EXPORT_SIGNING_SECRET'), 'AUDIT_EXPORT_SIGNING_SECRET', 32),

  CORS_ALLOWED_ORIGINS: parseCorsOrigins(
    optionalEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'),
  ),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),
  ERROR_RATE_ALERT_THRESHOLD: parseFloatEnv('ERROR_RATE_ALERT_THRESHOLD', 0.05),
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
  MFA_DELIVERY_WEBHOOK_URL: mfaDeliveryWebhookUrl,
  ...oidcConfig,


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

if (env.ERROR_RATE_ALERT_THRESHOLD < 0 || env.ERROR_RATE_ALERT_THRESHOLD > 1) {
  throw new Error('ERROR_RATE_ALERT_THRESHOLD must be between 0 and 1');
}

if (env.AUDIT_EXPORT_SIGNING_SECRET === refreshTokenSecret) {
  throw new Error('AUDIT_EXPORT_SIGNING_SECRET must be different from REFRESH_TOKEN_SECRET');
}


if (env.isProduction()) {
  if (env.JWT_SECRET === env.REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_SECRET must be different from REFRESH_TOKEN_SECRET in production');
  }
  const badOrigins = env.CORS_ALLOWED_ORIGINS.filter((origin) => {
    try {
      return new URL(origin).protocol !== 'https:';
    } catch {
      return true;
    }
  });
  if (badOrigins.length > 0) {
    throw new Error(`CORS_ALLOWED_ORIGINS must be valid HTTPS origins in production. Invalid origins: ${badOrigins.join(', ')}`);
  }

  const weakSecretMarkers = ['changeme', 'default', 'example', 'secret'];
  const hasWeakSecret = weakSecretMarkers.some((m) => env.JWT_SECRET.toLowerCase().includes(m) || env.REFRESH_TOKEN_SECRET.toLowerCase().includes(m));
  if (hasWeakSecret) {
    throw new Error('JWT_SECRET/REFRESH_TOKEN_SECRET appear weak or default-like; rotate secrets before production startup');
  }
}
