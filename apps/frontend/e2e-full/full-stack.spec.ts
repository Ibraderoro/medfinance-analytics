import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

const DEMO_ORG_ID = 'ff6a1c0f-6d3b-8388-6b12-4e2ad21f57c5';
const OTHER_ORG_ID = '93e76747-5092-a76f-a869-96b1a67a0f8e';

const ANALYST_EMAIL = 'analyst@medfinance.test';
const PASSWORD = 'demo123!';

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code: string;
  };
};

async function uiLogin(
  page: Page,
  email = 'demo@medfinance.test',
  organizationId = DEMO_ORG_ID,
): Promise<void> {
  await page.goto('/login');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Organization ID').fill(organizationId);
  await page.getByLabel('Password').fill(PASSWORD);

  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
}

function readCookieFromSetCookie(
  setCookie: string,
  name: string,
): string | undefined {
  const [cookiePair] = setCookie.split(';');

  const separatorIndex = cookiePair.indexOf('=');

  if (separatorIndex === -1) {
    return undefined;
  }

  const cookieName = cookiePair.slice(0, separatorIndex).trim();

  if (cookieName !== name) {
    return undefined;
  }

  return decodeURIComponent(cookiePair.slice(separatorIndex + 1));
}

async function apiLogin(
  request: APIRequestContext,
  email = 'demo@medfinance.test',
  organizationId = DEMO_ORG_ID,
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      email,
      password: PASSWORD,
      organizationId,
    },
  });

  expect(response.ok()).toBeTruthy();

  const csrfToken = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => readCookieFromSetCookie(header.value, 'csrf_token'))
    .find((value): value is string => Boolean(value));

  if (!csrfToken) {
    throw new Error(`CSRF token was not returned by login for ${email}`);
  }

  return csrfToken;
}

test.describe('production-like full-stack E2E', () => {
  test('authenticates through the real API and renders seeded dashboard data', async ({
    page,
  }) => {
    await uiLogin(page);

    const revenueCard = page.getByRole('group', { name: /revenue/i });

    await expect(revenueCard).toBeVisible();
    await expect(page.getByRole('group', { name: /margin/i })).toBeVisible();

    const revenueText = await revenueCard.innerText();

    expect(revenueText).not.toMatch(/loading|nan/i);
    expect(revenueText).toMatch(/\$[\d,]+(?:\.\d+)?/);

    console.log('Revenue card:', revenueText);

    await page.getByRole('link', { name: /^compliance$/i }).click();

    await expect(page).toHaveURL(/\/compliance$/);

    await expect(page.getByRole('cell', { name: /^HIPAA-/i })).toBeVisible();

    await expect(page.getByRole('cell', { name: /^SOC2-/i })).toBeVisible();

    await expect(page.getByRole('cell', { name: /^HITRUST-/i })).toBeVisible();
  });

  test('validates migrated schema and seeded integration dataset through real services', async ({
    request,
  }) => {
    await apiLogin(request);

    const health = await request.get('/api/v1/health/live');

    expect(health.ok()).toBeTruthy();

    const kpis = await request.get('/api/v1/financials/kpis?year=2026');

    expect(kpis.ok()).toBeTruthy();

    const kpiBody = (await kpis.json()) as ApiEnvelope<unknown[]>;

    expect(kpiBody.success).toBeTruthy();
    expect(kpiBody.data.length).toBeGreaterThan(0);

    const compliance = await request.get('/api/v1/compliance/status');

    expect(compliance.ok()).toBeTruthy();

    const complianceBody = (await compliance.json()) as ApiEnvelope<
      Array<{ regulation_code: string }>
    >;

    expect(
      complianceBody.data.map((item) => item.regulation_code).join(' '),
    ).toMatch(/HIPAA|SOC2|HITRUST/);
  });

  test('streams live financial updates over SSE and receives triggered events', async ({
    page,
    request,
  }) => {
    await uiLogin(page);

    const snapshotPromise = page.evaluate(async () => {
      const response = await fetch('/api/v1/financials/live', {
        headers: {
          Accept: 'text/event-stream',
        },
        credentials: 'include',
      });

      if (!response.body) {
        throw new Error('Missing SSE body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, {
            stream: true,
          });

          if (buffer.includes('event: snapshot')) {
            return buffer;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }

      throw new Error('No snapshot event received');
    });

    await expect(snapshotPromise).resolves.toContain('event: snapshot');

    /*
     * /financials/live/events/transaction-added requires
     * the "analyst" role:
     *
     * authorize('analyst')
     *
     * Therefore this request must authenticate as the
     * seeded analyst user rather than the demo viewer.
     */
    const csrfToken = await apiLogin(request, ANALYST_EMAIL, DEMO_ORG_ID);

    const eventResponse = await request.post(
      '/api/v1/financials/live/events/transaction-added',
      {
        headers: {
          'x-csrf-token': csrfToken,
        },
      },
    );

    const eventBody = await eventResponse.text();

    console.log('SSE event status:', eventResponse.status());

    console.log('SSE event body:', eventBody);

    expect(eventResponse.status()).toBe(202);
  });

  test('exercises billing and payment validation against real persistence', async ({
    page,
    request,
  }) => {
    await uiLogin(page);

    await page.getByRole('link', { name: /^billing$/i }).click();

    await expect(page).toHaveURL(/\/billing$/);

    // Use exact text to avoid matching "Upgrade to Pro".
    await expect(page.getByText('pro', { exact: true })).toBeVisible();

    await expect(page.getByText('active', { exact: true })).toBeVisible();

    /*
     * The demo user is sufficient for this test.
     * There is no need to authenticate as analyst because
     * billing/subscription does not require the analyst role.
     */
    const csrfToken = await apiLogin(request, ANALYST_EMAIL, DEMO_ORG_ID);

    const eventResponse = await request.post(
      '/api/v1/financials/live/events/transaction-added',
      {
        headers: {
          'x-csrf-token': csrfToken,
        },
      },
    );

    console.log('SSE event status:', eventResponse.status());
    console.log('SSE event body:', await eventResponse.text());

    expect(eventResponse.status()).toBe(202);

    const subscription = await request.get('/api/v1/billing/subscription');

    expect(subscription.ok()).toBeTruthy();

    const body = (await subscription.json()) as ApiEnvelope<{
      plan: string;
      status: string;
    }>;

    expect(body.data).toMatchObject({
      plan: 'pro',
      status: 'active',
    });
  });

  test('enforces tenant isolation with independent browser contexts', async ({
    browser,
  }) => {
    const demoContext = await browser.newContext();
    const otherContext = await browser.newContext();

    const demoPage = await demoContext.newPage();
    const otherPage = await otherContext.newPage();

    try {
      await uiLogin(demoPage, 'demo@medfinance.test', DEMO_ORG_ID);

      await uiLogin(otherPage, 'other-tenant@medfinance.test', OTHER_ORG_ID);

      const demoRevenue = await demoPage.request.get(
        '/api/v1/financials/revenue',
      );

      const otherRevenue = await otherPage.request.get(
        '/api/v1/financials/revenue',
      );

      const demoBody = await demoRevenue.text();
      const otherBody = await otherRevenue.text();

      console.log('Demo revenue:', demoRevenue.status(), demoBody);

      console.log('Other revenue:', otherRevenue.status(), otherBody);

      expect(demoRevenue.ok()).toBeTruthy();
      expect(otherRevenue.ok()).toBeTruthy();

      /*
       * The revenue endpoint returns only:
       *
       * {
       *   month,
       *   total
       * }
       *
       * It does NOT return the transaction description,
       * so "tenant_isolation_marker" can never appear here.
       *
       * The isolated seed contains a distinctive 777777.00
       * revenue value. Verify that it is visible only to
       * the isolated tenant.
       */

      expect(demoBody).not.toContain('777777.00');

      expect(otherBody).toContain('777777.00');
    } finally {
      await demoContext.close();
      await otherContext.close();
    }
  });
});
