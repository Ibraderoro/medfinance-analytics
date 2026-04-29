import { test, expect } from '@playwright/test';

test('Critical smoke journey keeps session across dashboard to compliance navigation', async ({ page }) => {
  // Failure Mode: Auth cookie/local-storage session can be dropped during first route transition.
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@medfinance.com');
  await page.getByLabel('Password').fill('demo123!');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/(dashboard|financials|forecasting|compliance)?$/);

  await page.goto('/dashboard');
  await expect(page.getByText('Financial Overview')).toBeVisible();

  // Failure Mode: SPA navigation to compliance may cause runtime crash when session context rehydrates.
  await page.getByRole('link', { name: /Compliance/i }).click();
  await expect(page).toHaveURL(/\/compliance$/);
  await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible();

  // Session should still be valid after cross-page navigation.
  await page.goto('/dashboard');
  await expect(page.getByText('Financial Overview')).toBeVisible();
});
