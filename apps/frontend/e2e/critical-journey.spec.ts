import { test, expect } from '@playwright/test';

test('Log in -> View Financials -> Export Report', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@medfinance.com');
  await page.getByLabel('Password').fill('demo123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/financials');
  await expect(page.getByText('Financials')).toBeVisible();
  await expect(page.getByText('Revenue Trend')).toBeVisible();
  // Placeholder until export button is implemented.
  await expect(page.getByText('Revenue Trend')).toBeVisible();
});
