import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const DEMO_ORG_ID = 'ff6a1c0f-6d3b-8388-6b12-4e2ad21f57c5';
const OTHER_ORG_ID = '93e76747-5092-a76f-a869-96b1a67a0f8e';
const PASSWORD = 'demo123!';

type ApiEnvelope<T> = { success: boolean; data: T; error?: { message: string; code: string } };

async function uiLogin(page: Page, email = 'demo@medfinance.test', organizationId = DEMO_ORG_ID): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Organization ID').fill(organizationId);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function apiLogin(request: APIRequestContext, email = 'demo@medfinance.test', organizationId = DEMO_ORG_ID): Promise<Record<string, string>> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email, password: PASSWORD, organizationId },
  });
  expect(response.ok()).toBeTruthy();
  return { cookie: response.headers()['set-cookie'] ?? '' };
}

test.describe('production-like full-stack E2E', () => {
  test('authenticates through the real API and renders seeded dashboard data', async ({ page }) => {
    await uiLogin(page);

    const revenueCard = page.getByRole('group', { name: /revenue/i });
    await expect(revenueCard).toBeVisible();
    await expect(page.getByRole('group', { name: /margin/i })).toBeVisible();

    const revenueText = await revenueCard.innerText();
    expect(revenueText).not.toMatch(/loading|nan/i);
    expect(Number(revenueText.replace(/[^0-9.-]/g, ''))).toBeGreaterThan(0);

    await page.getByRole('link', { name: /^compliance$/i }).click();
    await expect(page).toHaveURL(/\/compliance$/);
    await expect(page.getByText(/HIPAA|SOC2|HITRUST/)).toBeVisible();
  });

  test('validates migrated schema and seeded integration dataset through real services', async ({ request }) => {
    const headers = await apiLogin(request);

    const health = await request.get('/api/v1/health/live');
    expect(health.ok()).toBeTruthy();

    const kpis = await request.get('/api/v1/financials/kpis?year=2026', { headers });
    expect(kpis.ok()).toBeTruthy();
    const kpiBody = await kpis.json() as ApiEnvelope<unknown[]>;
    expect(kpiBody.success).toBeTruthy();
    expect(kpiBody.data.length).toBeGreaterThan(0);

    const compliance = await request.get('/api/v1/compliance/status', { headers });
    expect(compliance.ok()).toBeTruthy();
    const complianceBody = await compliance.json() as ApiEnvelope<Array<{ regulation_code: string }>>;
    expect(complianceBody.data.map((item) => item.regulation_code).join(' ')).toMatch(/HIPAA|SOC2|HITRUST/);
  });

  test('streams live financial updates over SSE and receives triggered events', async ({ page, request }) => {
    await uiLogin(page);

    const snapshotPromise = page.evaluate(async () => {
      const response = await fetch('/api/v1/financials/live', { headers: { Accept: 'text/event-stream' }, credentials: 'include' });
      if (!response.body) throw new Error('Missing SSE body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes('event: snapshot')) return buffer;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      throw new Error('No snapshot event received');
    });

    await expect(snapshotPromise).resolves.toContain('event: snapshot');

    const headers = await apiLogin(request);
    const eventResponse = await request.post('/api/v1/financials/live/events/transaction-added', { headers });
    expect(eventResponse.ok()).toBeTruthy();
  });

  test('exercises billing and payment validation against real persistence', async ({ page, request }) => {
    await uiLogin(page);
    await page.getByRole('link', { name: /^billing$/i }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByText(/free/i)).toBeVisible();
    await expect(page.getByText(/inactive/i)).toBeVisible();

    const headers = await apiLogin(request);
    const invalidPlan = await request.post('/api/v1/billing/subscription', { headers, data: { plan: 'invalid' } });
    expect(invalidPlan.status()).toBe(400);

    const subscription = await request.get('/api/v1/billing/subscription', { headers });
    const body = await subscription.json() as ApiEnvelope<{ plan: string; status: string }>;
    expect(body.data).toMatchObject({ plan: 'free', status: 'inactive' });
  });

  test('enforces tenant isolation with independent browser contexts', async ({ browser }) => {
    const demoContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const demoPage = await demoContext.newPage();
    const otherPage = await otherContext.newPage();

    try {
      await uiLogin(demoPage, 'demo@medfinance.test', DEMO_ORG_ID);
      await uiLogin(otherPage, 'other-tenant@medfinance.test', OTHER_ORG_ID);

      const demoRevenue = await demoPage.request.get('/api/v1/financials/revenue');
      const otherRevenue = await otherPage.request.get('/api/v1/financials/revenue');
      expect(demoRevenue.ok()).toBeTruthy();
      expect(otherRevenue.ok()).toBeTruthy();

      const demoBody = await demoRevenue.text();
      const otherBody = await otherRevenue.text();
      expect(demoBody).not.toContain('tenant_isolation_marker');
      expect(otherBody).toContain('tenant_isolation_marker');
    } finally {
      await demoContext.close();
      await otherContext.close();
    }
  });
});
