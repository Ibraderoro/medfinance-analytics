import { defineConfig, devices } from '@playwright/test';

const workers = Number(process.env.PW_FULLSTACK_WORKERS ?? (process.env.CI ? 2 : 2));

export default defineConfig({
  testDir: './e2e-fullstack',
  timeout: 90_000,
  fullyParallel: true,
  workers,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report/fullstack', open: 'never' }], ['list']]
    : [['list'], ['html', { outputFolder: 'playwright-report/fullstack', open: 'never' }]],
  use: {
    baseURL: process.env.FULLSTACK_E2E_BASE_URL ?? 'http://127.0.0.1:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './e2e-fullstack/global-setup.ts',
  globalTeardown: './e2e-fullstack/global-teardown.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
