import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { fixtureForWorker, E2E_PASSWORD } from './support/tenantFixtures';

const databaseUrl = process.env.FULLSTACK_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('FULLSTACK_DATABASE_URL is required for full-stack tests');
}

function fixtureForTest(parallelIndex: number) {
  const configuredWorkers = Number(process.env.PW_FULLSTACK_WORKERS ?? 2);
  return fixtureForWorker(parallelIndex % configuredWorkers);
}

async function login(page: import('@playwright/test').Page, email: string, organizationId: string, password = E2E_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Organization ID').fill(organizationId);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

async function getCsrfToken(page: import('@playwright/test').Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'csrf_token')?.value;
  expect(csrf).toBeTruthy();
  return csrf as string;
}

test.describe('docker-backed full-stack e2e', () => {
  test('auth flow covers successful login, logout, and MFA challenge path', async ({ page }, testInfo) => {
    const fixture = fixtureForTest(testInfo.parallelIndex);

    await login(page, fixture.viewerEmail, fixture.organizationId);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);

    await login(page, fixture.adminEmail, fixture.organizationId);
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await expect(page.getByRole('button', { name: /verify code/i })).toBeVisible();
  });

  test('migration state is applied and tenant-scoped data stays isolated per worker', async ({ page }, testInfo) => {
    const fixture = fixtureForTest(testInfo.parallelIndex);

    await login(page, fixture.viewerEmail, fixture.organizationId);
    await expect(page).toHaveURL(/\/dashboard$/);

    const pool = new Pool({ connectionString: databaseUrl, ssl: false });
    try {
      const migrationsDir = path.resolve(__dirname, '../../backend/src/db/migrations');
      const forwardMigrations = fs
        .readdirSync(migrationsDir)
        .filter((filename) => filename.endsWith('.sql') && !filename.endsWith('.down.sql'))
        .sort();

      const latestMigration = forwardMigrations[forwardMigrations.length - 1];
      const migrationRows = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
      expect(migrationRows.rows.map((row) => row.filename)).toContain(latestMigration);

      const summaryResponse = await page.request.get('/api/v1/financials/summary?year=2026');
      expect(summaryResponse.ok()).toBeTruthy();
      const summaryBody = (await summaryResponse.json()) as { data: { total_revenue?: string } };
      const revenue = Number(summaryBody.data.total_revenue ?? '0');
      expect(revenue).toBeGreaterThanOrEqual(fixture.seededRevenueAmount);

      const foreignFixtures = [fixtureForWorker(0), fixtureForWorker(1), fixtureForWorker(2), fixtureForWorker(3)]
        .filter((candidate) => candidate.organizationId !== fixture.organizationId)
        .map((candidate) => candidate.organizationId);
      const leakageRows = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM transactions
         WHERE category = 'e2e_parallel'
           AND organization_id = ANY($1::uuid[])
           AND amount::numeric = $2::numeric`,
        [foreignFixtures, fixture.seededRevenueAmount],
      );
      expect(Number(leakageRows.rows[0]?.count ?? '0')).toBe(0);
    } finally {
      await pool.end();
    }
  });

  test('billing upgrade persists through backend and SSE emits transaction update events', async ({ page }, testInfo) => {
    const fixture = fixtureForTest(testInfo.parallelIndex);

    await login(page, fixture.analystEmail, fixture.organizationId);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('link', { name: /^billing$/i }).click();
    await expect(page).toHaveURL(/\/billing$/);

    await page.getByRole('button', { name: /upgrade to pro/i }).click();
    await expect(page.getByText('Subscription updated successfully.')).toBeVisible();
    await expect(page.getByText(/^pro$/i)).toBeVisible();
    await expect(page.getByText(/^active$/i)).toBeVisible();

    const csrf = await getCsrfToken(page);
    const streamPromise = page.evaluate(async () => {
      const response = await fetch('/api/v1/financials/live', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/event-stream' },
      });
      if (!response.ok || !response.body) {
        throw new Error(`Unable to open SSE stream (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf8');
      let buffer = '';
      const deadline = Date.now() + 15_000;
      let sawSnapshot = false;

      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const event = chunk.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = chunk.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (!event || !data) continue;
          const payload = JSON.parse(data) as { organization_id?: string };
          if (event === 'snapshot') {
            sawSnapshot = true;
            continue;
          }
          if (event === 'transaction-added' && sawSnapshot) {
            return payload.organization_id;
          }
        }
      }

      throw new Error('Timed out waiting for transaction-added SSE event');
    });

    await page.request.post('/api/v1/financials/live/events/transaction-added', {
      headers: { 'x-csrf-token': csrf },
      data: {},
    });

    await expect(streamPromise).resolves.toBe(fixture.organizationId);

    const pool = new Pool({ connectionString: databaseUrl, ssl: false });
    try {
      const subscription = await pool.query<{ plan: string; status: string }>(
        'SELECT plan, status FROM subscriptions WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [fixture.organizationId],
      );
      expect(subscription.rows[0]).toMatchObject({ plan: 'pro', status: 'active' });
    } finally {
      await pool.end();
    }
  });
});
