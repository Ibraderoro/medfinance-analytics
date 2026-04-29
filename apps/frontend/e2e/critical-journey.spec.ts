import { expect, test, type Locator, type Page } from '@playwright/test';

const TEST_EMAIL = 'demo@medfinance.com';
const TEST_PASSWORD = 'demo123!';

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
  await page.goto('/login');

  await page.getByLabel('Email').fill(TEST_EMAIL);
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

  const tokenBeforeReload = await page.evaluate<string | null>(() => localStorage.getItem('access_token'));
  expect(tokenBeforeReload).toBeTruthy();

  await page.reload();
  await expect(page).toHaveURL(/\/compliance$/);

  const tokenAfterReload = await page.evaluate<string | null>(() => localStorage.getItem('access_token'));
  expect(tokenAfterReload).toBeTruthy();
  expect(tokenAfterReload).toBe(tokenBeforeReload);
});
