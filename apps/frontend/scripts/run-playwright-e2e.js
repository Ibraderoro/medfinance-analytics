#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
let chromium;

try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error(
    [
      'Playwright is not installed.',
      'Run `npm ci` (or `npm install`) to install project dependencies before running E2E tests.',
      error.message,
    ].join('\n'),
  );
  process.exit(1);
}

const executablePath = chromium.executablePath();

if (!fs.existsSync(executablePath)) {
  console.warn(
    [
      'Playwright E2E tests cannot run because Chromium is not installed.',
      'Run `npm run test:e2e:install --workspace=apps/frontend` in an environment with access to the Playwright browser CDN, then rerun E2E tests.',
      `Expected executable: ${executablePath}`,
    ].join('\n'),
  );
  process.exit(1);
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

if (typeof result.status !== 'number') {
  console.error('Playwright command did not return an exit status.');
  process.exit(1);
}

process.exit(result.status);
