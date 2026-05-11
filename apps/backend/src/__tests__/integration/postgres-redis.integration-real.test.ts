import crypto from 'node:crypto';
import http from 'node:http';
import { Pool } from 'pg';
import { app } from '../../app';
import { getPool, disconnectDatabase } from '../../config/database';
import { getRedis, disconnectRedis } from '../../config/redis';
import { migrate } from '../../db/migrate';
import { analyticsService } from '../../services/analytics.service';
import { env } from '../../config/env';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

function request(options: { method?: string; path: string; body?: Buffer | string; headers?: Record<string, string> }): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers,
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        });
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (options.body) req.write(options.body);
      req.end();
    });
  });
}

function stripeSignature(payload: Buffer, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload.toString('utf8')}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function ensureSeedData(): Promise<void> {
  const pool = getPool();
  await pool.query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"");
  await pool.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, 'Integration Org A'), ($2, 'Integration Org B')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO departments (id, department_code, name, cost_center, organization_id)
     VALUES
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INT-A', 'Integration A', 'INT-A', $1),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'INT-B', 'Integration B', 'INT-B', $2)
     ON CONFLICT (department_code) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO transactions (department_id, transaction_type, category, amount, occurred_on, organization_id)
     VALUES
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'revenue', 'integration', 100, '2026-01-01', $1),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'revenue', 'integration', 200, '2026-01-01', $2)`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, organization_id)
     VALUES
       ($1, 'integration-a@example.com', 'hash', 'Integration', 'A', 'viewer', $2),
       ($3, 'integration-b@example.com', 'hash', 'Integration', 'B', 'viewer', $4)
     ON CONFLICT (email) DO NOTHING`,
    [USER_A, ORG_A, USER_B, ORG_B],
  );
  await pool.query(
    `INSERT INTO customers (organization_id, stripe_customer_id, email)
     VALUES ($1, 'cus_integration_a', 'integration-a@example.com')
     ON CONFLICT (organization_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
    [ORG_A],
  );
}

async function createRlsPool(): Promise<Pool> {
  const admin = getPool();
  await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medfinance_rls_integration') THEN CREATE ROLE medfinance_rls_integration LOGIN PASSWORD 'medfinance_rls_integration'; END IF; END $$;");
  await admin.query('GRANT USAGE ON SCHEMA public TO medfinance_rls_integration');
  await admin.query('GRANT SELECT ON transactions TO medfinance_rls_integration');
  const url = new URL(env.DATABASE_URL);
  url.username = 'medfinance_rls_integration';
  url.password = 'medfinance_rls_integration';
  return new Pool({ connectionString: url.toString(), ssl: env.PG_SSL ? { rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED } : undefined });
}

describe('real Postgres + Redis integration gates', () => {
  beforeAll(async () => {
    await migrate();
    await ensureSeedData();
    await getRedis().flushdb();
  }, 60_000);

  afterAll(async () => {
    await analyticsService.stopWorker();
    await disconnectRedis();
    await disconnectDatabase();
  });

  it('runs migrations and records the latest schema migration', async () => {
    const rows = await getPool().query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(rows.rows.map((row) => row.filename)).toEqual(expect.arrayContaining([
      '001_financial_core_schema.sql',
      '013_tenant_rls_unification.sql',
      '015_stripe_webhook_idempotency.sql',
    ]));
  });

  it('enforces Postgres RLS tenant boundaries for tenant-scoped tables', async () => {
    const rlsPool = await createRlsPool();
    try {
      const client = await rlsPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [ORG_A]);
        const orgARows = await client.query<{ organization_id: string; amount: string }>(
          "SELECT organization_id::text, amount::text FROM transactions WHERE category = 'integration' ORDER BY amount",
        );
        await client.query('COMMIT');

        expect(orgARows.rows).toHaveLength(1);
        expect(orgARows.rows[0].organization_id).toBe(ORG_A);
        expect(orgARows.rows[0].amount).toBe('100.00');
      } finally {
        client.release();
      }
    } finally {
      await rlsPool.end();
    }
  });

  it('uses Redis-backed rate limiting across requests', async () => {
    const redis = getRedis();
    const keys = await redis.keys('rate-limit:general:*');
    if (keys.length > 0) await redis.del(...keys);

    let limited = false;
    for (let i = 0; i < 205; i += 1) {
      const response = await request({ path: '/api/v1/health/live' });
      if (response.status === 429) {
        limited = true;
        break;
      }
      expect(response.status).toBe(200);
    }

    expect(limited).toBe(true);

    const resetKeys = await redis.keys('rate-limit:general:*');
    if (resetKeys.length > 0) await redis.del(...resetKeys);
  }, 30_000);

  it('writes analytics telemetry to Redis streams and persists worker batches to Postgres', async () => {
    const redis = getRedis();
    await redis.del('api_telemetry_stream');
    await getPool().query("DELETE FROM api_request_metrics WHERE endpoint = '/integration/analytics'");

    await analyticsService.enqueueApiTelemetry({
      endpoint: '/integration/analytics',
      method: 'GET',
      statusCode: 202,
      latencyMs: 12.4,
      userId: USER_A,
      organizationId: ORG_A,
      capturedAt: new Date().toISOString(),
    });

    expect(await redis.xlen('api_telemetry_stream')).toBeGreaterThan(0);

    await analyticsService.startWorker();
    const deadline = Date.now() + 10_000;
    let persisted = 0;
    while (Date.now() < deadline) {
      const rows = await getPool().query<{ count: string }>("SELECT COUNT(*) AS count FROM api_request_metrics WHERE endpoint = '/integration/analytics'");
      persisted = Number(rows.rows[0].count);
      if (persisted > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await analyticsService.stopWorker();

    expect(persisted).toBeGreaterThan(0);
  }, 20_000);

  it('deduplicates Stripe webhooks with Redis and persistent Postgres idempotency state', async () => {
    const rateLimitKeys = await getRedis().keys('rate-limit:general:*');
    if (rateLimitKeys.length > 0) await getRedis().del(...rateLimitKeys);

    const eventId = `evt_integration_${Date.now()}`;
    const payload = Buffer.from(JSON.stringify({
      id: eventId,
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_integration_a',
          subscription: 'sub_integration_a',
          lines: { data: [{ price: { id: env.STRIPE_PRO_PRICE_ID || 'price_pro_test' }, period: { start: 1767225600, end: 1769904000 } }] },
        },
      },
    }));
    const headers = {
      'content-type': 'application/json',
      'content-length': String(payload.length),
      'stripe-signature': stripeSignature(payload, env.STRIPE_WEBHOOK_SECRET),
    };

    const first = await request({ method: 'POST', path: '/api/v1/billing/webhook', body: payload, headers });
    const second = await request({ method: 'POST', path: '/api/v1/billing/webhook', body: payload, headers });

    expect(first.status).toBe(200);
    expect(JSON.parse(first.body).data).toEqual({ received: true });
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body).data).toEqual({ received: true, duplicate: true });

    const eventRows = await getPool().query<{ status: string }>('SELECT status FROM stripe_webhook_events WHERE id = $1', [eventId]);
    expect(eventRows.rows[0].status).toBe('processed');

    const subscriptionRows = await getPool().query<{ status: string; plan: string }>(
      "SELECT status, plan FROM subscriptions WHERE stripe_subscription_id = 'sub_integration_a'",
    );
    expect(subscriptionRows.rows[0]).toMatchObject({ status: 'active', plan: 'pro' });
  });
});
