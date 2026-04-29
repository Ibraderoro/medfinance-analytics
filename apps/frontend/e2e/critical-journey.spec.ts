import { expect, test } from '@playwright/test';

test('golden path login, dashboard KPIs, compliance navigation, and session persistence', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('demo@medfinance.com');
  await page.getByLabel('Password').fill('demo123!');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);

  const revenueCard = page.locator('div').filter({ hasText: /^Total Revenue\$/ }).first();
  const marginCard = page.locator('div').filter({ hasText: /^Operating Margin/ }).first();

  await expect(revenueCard).toBeVisible();
  await expect(marginCard).toBeVisible();

  const revenueValueText = await revenueCard.locator('span').nth(1).innerText();
  const marginValueText = await marginCard.locator('span').nth(1).innerText();

  const normalizedRevenue = Number(revenueValueText.replace(/[$,\s]/g, ''));
  const normalizedMargin = Number(marginValueText.replace(/[%\s]/g, ''));

  expect(Number.isFinite(normalizedRevenue)).toBeTruthy();
  expect(Number.isFinite(normalizedMargin)).toBeTruthy();
  expect(normalizedRevenue).toBeGreaterThan(0);
  expect(normalizedMargin).not.toBe(0);

  await page.getByRole('link', { name: 'Compliance' }).click();
  await expect(page).toHaveURL(/\/compliance$/);
  await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible();

  const tokenBeforeReload = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(tokenBeforeReload).toBeTruthy();

  await page.reload();
  await expect(page).toHaveURL(/\/compliance$/);
  await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible();

  const tokenAfterReload = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(tokenAfterReload).toBeTruthy();
  expect(tokenAfterReload).toBe(tokenBeforeReload);
});
