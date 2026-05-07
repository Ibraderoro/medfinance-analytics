import { expect, test, type Locator, type Page } from '@playwright/test';

const TEST_EMAIL = 'demo@medfinance.com';
const TEST_PASSWORD = 'demo123!';
const TEST_ORGANIZATION_ID = process.env.TEST_ORGANIZATION_ID ?? '550e8400-e29b-41d4-a716-446655440000';

type ApiResponse = { success: true; data: unknown };

const ok = (data: unknown): ApiResponse => ({ success: true, data });

const dashboardFixtures = {
  summary: { total_revenue: '1200000', total_expenses: '740000', net_income: '460000' },
  kpis: [{
    month_start: '2026-01-01',
    fiscal_year: 2026,
    fiscal_month: 1,
    total_revenue: '1200000',
    total_expenses: '740000',
    net_income: '460000',
    gross_margin: '42.5',
    operating_margin: '18.4',
    burn_rate: '61000',
    cash_reserve_amount: '980000',
    runway_months: '16',
    revenue_mom_growth: '7.2',
    revenue_yoy_growth: '14.1',
    net_income_mom_growth: '3.5',
    net_income_yoy_growth: '9.4',
  }],
  revenue: [
    { month: '2026-01-01', total: '325000' },
    { month: '2026-02-01', total: '410000' },
  ],
  forecast: {
    metric: 'revenue',
    forecastMonths: 12,
    dataPoints: [
      { month: '2026-03-01', metric: 'revenue', projected_total: '430000', actual_total: '0' },
      { month: '2026-04-01', metric: 'revenue', projected_total: '455000', actual_total: '0' },
    ],
  },
  compliance: [
    { regulation_code: 'HIPAA', status: 'compliant', last_reviewed_at: '2026-01-10', next_review_due_at: '2026-07-10', assigned_to: 'Compliance Team' },
    { regulation_code: 'SOC2', status: 'under_review', last_reviewed_at: '2026-02-01', next_review_due_at: '2026-08-01', assigned_to: 'Security Team' },
  ],
};

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (data: unknown, headers: Record<string, string> = {}) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(ok(data)),
    });

    if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
      await json({ session: 'created' }, {
        'set-cookie': [
          'csrf_token=test-csrf; Path=/; SameSite=Strict',
          'medfinance_refresh_token=test-refresh; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
          'medfinance_access_token=test-access; Path=/; HttpOnly; SameSite=Strict',
        ].join(', '),
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v1/auth/refresh') {
      await json({ session: 'refreshed' });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/financials/summary') {
      await json(dashboardFixtures.summary);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/financials/kpis') {
      await json(dashboardFixtures.kpis);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/financials/revenue') {
      await json(dashboardFixtures.revenue);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/forecasting/forecast') {
      await json(dashboardFixtures.forecast);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/compliance/status') {
      await json(dashboardFixtures.compliance);
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Unhandled test route' } }) });
  });
}

const parseNumericValue = (rawValue: string): number => {
  const normalized = rawValue.trim();

  expect(normalized).not.toMatch(/loading/i);
  expect(normalized).not.toMatch(/nan/i);

  const digitsOnly = normalized.replace(/[^0-9.-]/g, '');
  const parsed = Number(digitsOnly);

  expect(Number.isFinite(parsed)).toBeTruthy();

  return parsed;
};

const getKpiCardByName = (page: Page, cardName: RegExp): Locator =>
  page.locator('section, article, div').filter({ hasText: cardName }).first();

test('golden path login, dashboard KPIs, compliance navigation, and session persistence', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');

  await page.getByLabel('Email').fill(TEST_EMAIL);
  await page.getByLabel('Organization ID').fill(TEST_ORGANIZATION_ID);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);

  const revenueCard = getKpiCardByName(page, /revenue/i);
  const marginCard = getKpiCardByName(page, /margin/i);

  await expect(revenueCard).toBeVisible();
  await expect(marginCard).toBeVisible();

  const revenueText = await revenueCard.innerText();
  const marginText = await marginCard.innerText();

  const revenueValue = parseNumericValue(revenueText);
  const marginValue = parseNumericValue(marginText);

  expect(revenueValue).toBeGreaterThan(0);
  expect(Math.abs(marginValue)).toBeGreaterThan(0);

  await page.getByRole('link', { name: /^compliance$/i }).click();
  await expect(page).toHaveURL(/\/compliance$/);

  const sessionBeforeReload = await page.evaluate<string | null>(() => sessionStorage.getItem('auth_session_active'));
  expect(sessionBeforeReload).toBe('true');

  await page.reload();
  await expect(page).toHaveURL(/\/compliance$/);

  const sessionAfterReload = await page.evaluate<string | null>(() => sessionStorage.getItem('auth_session_active'));
  expect(sessionAfterReload).toBe('true');
  expect(sessionAfterReload).toBe(sessionBeforeReload);
});
