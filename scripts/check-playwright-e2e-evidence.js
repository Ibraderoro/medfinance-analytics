#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const evidencePath = process.env.PLAYWRIGHT_E2E_EVIDENCE || 'docs/security/playwright-e2e-evidence-2026-05-21.md';
const absoluteEvidencePath = path.resolve(ROOT, evidencePath);

const requiredRows = [
  'Chromium install step in provisioned environment',
  'Playwright critical journey suite',
  'E2E artifact retention (trace/video/report)',
  'Release commit linkage',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(absoluteEvidencePath)) {
  fail(`Playwright E2E evidence file not found: ${evidencePath}`);
}

const evidence = fs.readFileSync(absoluteEvidencePath, 'utf8');
const hasPassedSummary = /^\*\*Result:\s*(?:passed|complete|completed);?\s*provisioned playwright e2e evidence completed\.?\*\*$/im.test(evidence);
const failures = [];

if (!hasPassedSummary) {
  failures.push('missing required summary marker: **Result: passed; provisioned Playwright E2E evidence completed.**');
}

for (const item of requiredRows) {
  const escapedItem = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowMatch = evidence.match(new RegExp(`\\|\\s*${escapedItem}\\s*\\|([^|]+)\\|`, 'i'));
  if (!rowMatch) {
    failures.push(`${item}: missing evidence row`);
    continue;
  }

  const status = rowMatch[1].replace(/\*/g, '').trim().toLowerCase();
  if (/(blocked|pending|not executed|not completed|not run|incomplete|required|missing)/i.test(status)) {
    failures.push(`${item}: status is still release-blocking (${rowMatch[1].trim()})`);
    continue;
  }

  if (!/(passed|complete|completed|satisfied)/i.test(status)) {
    failures.push(`${item}: status must explicitly be passed/completed/satisfied (${rowMatch[1].trim()})`);
  }
}

if (failures.length > 0) {
  console.error(`Provisioned Playwright E2E evidence gate is not satisfied by ${evidencePath}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Run Playwright E2E in a provisioned environment (with browser install) and attach signed artifacts for release.');
  process.exit(1);
}

console.error(`Provisioned Playwright E2E evidence gate satisfied by ${evidencePath}.`);
