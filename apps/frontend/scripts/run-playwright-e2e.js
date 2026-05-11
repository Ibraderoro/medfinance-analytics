#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const executablePath = chromium.executablePath();

if (!fs.existsSync(executablePath)) {
  console.warn(
    [
      'Skipping Playwright E2E tests: Chromium is not installed in this environment.',
      'Run `npm run test:e2e:install --workspace=apps/frontend` in an environment with access to the Playwright browser CDN, then rerun E2E tests.',
      `Expected executable: ${executablePath}`,
    ].join('\n'),
  );
  process.exit(0);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', '--config=playwright.config.ts'],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
