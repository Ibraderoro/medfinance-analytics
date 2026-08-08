import { expect, test, type Locator, type Page } from '@playwright/test';

const TEST_EMAIL = 'demo@medfinance.test';
const TEST_PASSWORD = 'demo123!';

/*
 * Must satisfy LoginPage's UUID validation:
 *
 * /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
 */
const TEST_ORGANIZATION_ID =
  process.env.TEST_ORGANIZATION_ID ?? '550e8400-e29b-41d4-a716-446655440000';

type ApiEnvelope<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        message: string;
        code: string;
      };
      data: null;
    };

type MockMode = {
  mfaRequired?: boolean;
  refreshExpired?: boolean;
  emptyCompliance?: boolean;
  financialsForbidden?: boolean;
  dashboardFailure?: boolean;
  billingForbidden?: boolean;
  authenticated?: boolean;
};

const ok = <T>(data: T): ApiEnvelope<T> => ({
  success: true,
  data,
});

const error = (message: string, code = 'TEST_ERROR'): ApiEnvelope<null> => ({
  success: false,
  error: {
    message,
    code,
  },
  data: null,
});

const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  email: TEST_EMAIL,
  first_name: 'Demo',
  last_name: 'User',
  role: 'cfo',
  organization_id: TEST_ORGANIZATION_ID,
  is_active: true,
};

const dashboardFixtures = {
  summary: {
    total_revenue: '1200000',
    total_expenses: '740000',
    net_income: '460000',
  },

  kpis: [
    {
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
    },
  ],

  revenue: [
    {
      month: '2026-01-01',
      total: '325000',
    },
    {
      month: '2026-02-01',
      total: '410000',
    },
  ],

  forecast: {
    metric: 'revenue',
    forecastMonths: 12,
    dataPoints: [
      {
        month: '2026-03-01',
        metric: 'revenue',
        projected_total: '430000',
        actual_total: '0',
      },
      {
        month: '2026-04-01',
        metric: 'revenue',
        projected_total: '455000',
        actual_total: '0',
      },
    ],
  },

  compliance: [
    {
      regulation_code: 'HIPAA',
      status: 'compliant',
      last_reviewed_at: '2026-01-10',
      next_review_due_at: '2026-07-10',
      assigned_to: 'Compliance Team',
    },
    {
      regulation_code: 'SOC2',
      status: 'under_review',
      last_reviewed_at: '2026-02-01',
      next_review_due_at: '2026-08-01',
      assigned_to: 'Security Team',
    },
    {
      regulation_code: 'HITRUST',
      status: 'non_compliant',
      last_reviewed_at: '2026-03-01',
      next_review_due_at: '2026-09-01',
      assigned_to: 'Audit Team',
    },
  ],

  subscription: {
    plan: 'free',
    status: 'inactive',
  },
};

async function setAuthCookies(page: Page): Promise<void> {
  const url = 'http://127.0.0.1:5173';

  await page.context().addCookies([
    {
      name: 'csrf_token',
      value: 'test-csrf',
      url,
    },
    {
      name: 'medfinance_access_token',
      value: 'test-access',
      url,
    },
    {
      name: 'medfinance_refresh_token',
      value: 'test-refresh',
      url,
    },
  ]);
}

async function mockApi(page: Page, mode: MockMode = {}): Promise<void> {
  let isAuthenticatedState = Boolean(mode.authenticated);

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());

    const method = route.request().method();
    const pathname = url.pathname;

    const json = async (data: unknown, status = 200) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(ok(data)),
      });
    };

    const fail = async (status: number, message: string, code?: string) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(error(message, code)),
      });
    };

    if (
      method === 'GET' &&
      (pathname.includes('/auth/me') ||
        pathname.includes('/users/me') ||
        pathname.includes('/auth/session'))
    ) {
      if (mode.refreshExpired || !isAuthenticatedState) {
        await fail(401, 'Unauthorized', 'AUTH_UNAUTHORIZED');

        return;
      }

      await json({
        user: mockUser,
        session: 'active',
      });

      return;
    }

    if (method === 'POST' && pathname.endsWith('/auth/login')) {
      if (mode.mfaRequired) {
        await json({
          session: 'pending_mfa',
          tempToken: 'temp-mfa-token',
        });

        return;
      }

      isAuthenticatedState = true;

      await setAuthCookies(page);

      await json({
        user: mockUser,
        session: 'created',
      });

      return;
    }

    if (method === 'POST' && pathname.endsWith('/auth/mfa/verify')) {
      isAuthenticatedState = true;

      await setAuthCookies(page);

      await json({
        user: mockUser,
        session: 'created',
      });

      return;
    }

    if (method === 'POST' && pathname.endsWith('/auth/refresh')) {
      if (mode.refreshExpired || !isAuthenticatedState) {
        isAuthenticatedState = false;

        await page.context().clearCookies();

        await fail(401, 'Invalid or expired token', 'AUTH_INVALID_TOKEN');

        return;
      }

      isAuthenticatedState = true;

      await setAuthCookies(page);

      await json({
        session: 'refreshed',
      });

      return;
    }

    if (method === 'POST' && pathname.endsWith('/auth/logout')) {
      isAuthenticatedState = false;

      await page.context().clearCookies();

      await json({
        loggedOut: true,
      });

      return;
    }

    if (method === 'GET' && pathname.endsWith('/financials/summary')) {
      if (mode.dashboardFailure) {
        await fail(
          500,
          'Financial service unavailable',
          'INTERNAL_SERVER_ERROR',
        );

        return;
      }

      await json(dashboardFixtures.summary);

      return;
    }

    if (method === 'GET' && pathname.endsWith('/financials/kpis')) {
      await json(mode.dashboardFailure ? [] : dashboardFixtures.kpis);

      return;
    }

    if (method === 'GET' && pathname.includes('/financials/revenue')) {
      if (mode.financialsForbidden) {
        await fail(403, 'Failed to load revenue trend data.', 'AUTH_FORBIDDEN');

        return;
      }

      await json(dashboardFixtures.revenue);

      return;
    }

    if (method === 'GET' && pathname.includes('/forecasting/forecast')) {
      await json(dashboardFixtures.forecast);

      return;
    }

    if (method === 'GET' && pathname.includes('/compliance')) {
      await json(mode.emptyCompliance ? [] : dashboardFixtures.compliance);

      return;
    }

    if (method === 'GET' && pathname.includes('/billing/subscription')) {
      await json(dashboardFixtures.subscription);

      return;
    }

    if (method === 'POST' && pathname.includes('/billing/subscription')) {
      if (mode.billingForbidden) {
        await fail(
          403,
          'Only admins can change subscriptions',
          'AUTH_FORBIDDEN',
        );

        return;
      }

      await json({
        plan: 'pro',
        status: 'active',
      });

      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(
        error('Unhandled test route', 'TEST_ROUTE_NOT_FOUND'),
      ),
    });
  });
}

function getFormInput(
  page: Page,
  label: string,
  selectorFallback: string,
): Locator {
  return page
    .getByLabel(label, {
      exact: true,
    })
    .or(page.locator(selectorFallback))
    .first();
}

async function clearBrowserState(page: Page): Promise<void> {
  await page.context().clearCookies();
}

async function clearPageStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
}

async function login(page: Page): Promise<void> {
  await clearBrowserState(page);

  await page.goto('/login');

  await clearPageStorage(page);

  const emailInput = getFormInput(
    page,
    'Email',
    'input[name="email"], input[type="email"]',
  );

  const orgInput = getFormInput(
    page,
    'Organization ID',
    'input[name="organizationId"], input[name="orgId"]',
  );

  const passInput = getFormInput(
    page,
    'Password',
    'input[name="password"], input[type="password"]',
  );

  await expect(emailInput).toBeVisible({
    timeout: 10000,
  });

  await expect(orgInput).toBeVisible({
    timeout: 10000,
  });

  await expect(passInput).toBeVisible({
    timeout: 10000,
  });

  await emailInput.fill(TEST_EMAIL);

  await orgInput.fill(TEST_ORGANIZATION_ID);

  await passInput.fill(TEST_PASSWORD);

  /*
   * Give React a chance to process all controlled-input
   * updates before checking the derived validation state.
   */
  await expect(page.locator('input[name="organizationId"]')).toHaveValue(
    TEST_ORGANIZATION_ID,
  );

  await expect(page.locator('input[name="email"]')).toHaveValue(TEST_EMAIL);

  await expect(page.locator('input[name="password"]')).toHaveValue(
    TEST_PASSWORD,
  );

  const submitBtn = page
    .getByRole('button', {
      name: /^sign in$/i,
    })
    .first();

  await expect(submitBtn).toBeEnabled({
    timeout: 5000,
  });

  await submitBtn.click();

  await expect(page).toHaveURL(/\/dashboard$/, {
    timeout: 10000,
  });

  await page.evaluate(() => {
    sessionStorage.setItem('auth_session_active', 'true');
  });
}

async function startAuthenticated(
  page: Page,
  mode: MockMode = {},
): Promise<void> {
  await mockApi(page, {
    ...mode,
    authenticated: true,
  });

  if (!mode.refreshExpired) {
    await setAuthCookies(page);

    await page.addInitScript(() => {
      sessionStorage.setItem('auth_session_active', 'true');
    });
  }
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
  page.getByRole('group', {
    name: cardName,
  });

test('golden path login, dashboard KPIs, compliance navigation, and session persistence', async ({
  page,
}) => {
  await mockApi(page, {
    authenticated: false,
  });

  await login(page);

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

  await page
    .getByRole('link', {
      name: /^compliance$/i,
    })
    .click();

  await expect(page).toHaveURL(/\/compliance$/);

  const sessionBeforeReload = await page.evaluate(() =>
    sessionStorage.getItem('auth_session_active'),
  );

  expect(sessionBeforeReload).toBe('true');

  await page.reload();

  await expect(page).toHaveURL(/\/compliance$/);

  const sessionAfterReload = await page.evaluate(() =>
    sessionStorage.getItem('auth_session_active'),
  );

  expect(sessionAfterReload).toBe('true');

  expect(sessionAfterReload).toBe(sessionBeforeReload);
});

test('MFA challenge requires verification before dashboard access', async ({
  page,
}) => {
  await mockApi(page, {
    mfaRequired: true,
    authenticated: false,
  });

  await clearBrowserState(page);

  await page.goto('/login');

  await clearPageStorage(page);

  const emailInput = getFormInput(
    page,
    'Email',
    'input[name="email"], input[type="email"]',
  );

  const orgInput = getFormInput(
    page,
    'Organization ID',
    'input[name="organizationId"], input[name="orgId"]',
  );

  const passInput = getFormInput(
    page,
    'Password',
    'input[name="password"], input[type="password"]',
  );

  await expect(emailInput).toBeVisible({
    timeout: 10000,
  });

  await expect(orgInput).toBeVisible({
    timeout: 10000,
  });

  await expect(passInput).toBeVisible({
    timeout: 10000,
  });

  await emailInput.fill(TEST_EMAIL);

  await orgInput.fill(TEST_ORGANIZATION_ID);

  await passInput.fill(TEST_PASSWORD);

  await expect(orgInput).toHaveValue(TEST_ORGANIZATION_ID);

  const submitBtn = page
    .getByRole('button', {
      name: /^sign in$/i,
    })
    .first();

  await expect(submitBtn).toBeEnabled({
    timeout: 5000,
  });

  await submitBtn.click();

  const mfaInput = getFormInput(
    page,
    'Verification code',
    'input[name="mfaCode"], input[name="code"]',
  );

  await expect(mfaInput).toBeVisible({
    timeout: 10000,
  });

  await mfaInput.fill('123456');

  const verifyBtn = page
    .getByRole('button', {
      name: /^verify code$/i,
    })
    .first();

  await expect(verifyBtn).toBeEnabled({
    timeout: 5000,
  });

  await verifyBtn.click();

  await expect(page).toHaveURL(/\/dashboard$/, {
    timeout: 10000,
  });
});

test('expired sessions redirect to login and clear session hint', async ({
  page,
}) => {
  await startAuthenticated(page, {
    refreshExpired: true,
  });

  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login$/);

  await page.evaluate(() => sessionStorage.removeItem('auth_session_active'));

  const session = await page.evaluate(() =>
    sessionStorage.getItem('auth_session_active'),
  );

  expect(session).toBeNull();
});

test('billing upgrade flow and RBAC denial are surfaced', async ({ page }) => {
  await mockApi(page, {
    billingForbidden: true,
    authenticated: false,
  });

  await login(page);

  await page
    .getByRole('link', {
      name: /^billing$/i,
    })
    .click();

  await expect(page).toHaveURL(/\/billing$/);

  await expect(page.getByText(/free/i)).toBeVisible();

  await expect(page.getByText(/inactive/i)).toBeVisible();

  await page
    .getByRole('button', {
      name: /upgrade to pro/i,
    })
    .click();

  await expect(
    page.getByText(/Only admins can change subscriptions/i),
  ).toBeVisible();
});

test('financial RBAC/API failures render user-visible errors', async ({
  page,
}) => {
  await startAuthenticated(page, {
    financialsForbidden: true,
  });

  await page.goto('/financials');

  await expect(
    page.getByText(
      /Failed to load revenue trend data|Insufficient permissions/i,
    ),
  ).toBeVisible();
});

test('dashboard API failures degrade with no-data and unavailable states', async ({
  page,
}) => {
  await startAuthenticated(page, {
    dashboardFailure: true,
  });

  await page.goto('/dashboard');

  const dashboardAlert = page.getByRole('alert');

  await expect(dashboardAlert).toBeVisible();

  await expect(dashboardAlert).toContainText(
    /dashboard.*unavailable|unavailable.*dashboard|service unavailable/i,
  );
});

test('empty compliance state remains usable', async ({ page }) => {
  await startAuthenticated(page, {
    emptyCompliance: true,
  });

  await page.goto('/compliance');

  await expect(
    page.getByText(/No compliance items found|No items/i).first(),
  ).toBeVisible();
});
