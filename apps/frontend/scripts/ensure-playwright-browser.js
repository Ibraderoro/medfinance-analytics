#!/usr/bin/env node
const fs = require('fs');
const { chromium } = require('playwright');

const executablePath = chromium.executablePath();

if (!fs.existsSync(executablePath)) {
  console.error([
    'Playwright Chromium is not installed.',
    'Run `npm run test:e2e:install --workspace=apps/frontend` in an environment with access to the Playwright browser CDN, then rerun E2E tests.',
    `Expected executable: ${executablePath}`,
  ].join('\n'));
  process.exit(1);
}
