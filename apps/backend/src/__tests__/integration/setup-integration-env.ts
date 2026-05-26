process.env.NODE_ENV = 'test';

// Force integration-test secrets so externally supplied short env values cannot
// make env.ts fail before infrastructure-backed tests start.
process.env.JWT_SECRET = 'integration-jwt-secret-32-chars-ok';
process.env.REFRESH_TOKEN_SECRET = 'integration-refresh-secret-32-ok';
process.env.AUDIT_EXPORT_SIGNING_SECRET = 'integration-audit-secret-32-okay';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://medfinance:medfinance@127.0.0.1:5432/medfinance_test';
process.env.PG_SSL = process.env.PG_SSL ?? 'false';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
process.env.REDIS_TLS = process.env.REDIS_TLS ?? 'false';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_integration_secret';
process.env.STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? 'price_pro_test';
process.env.STRIPE_ENTERPRISE_PRICE_ID = process.env.STRIPE_ENTERPRISE_PRICE_ID ?? 'price_enterprise_test';
process.env.ANALYTICS_SAMPLE_RATE = process.env.ANALYTICS_SAMPLE_RATE ?? '1';
