#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const evidencePath = process.env.EXTERNAL_PROVIDER_EVIDENCE || 'docs/security/auth-billing-lifecycle-evidence-2026-05-12.md';
const absoluteEvidencePath = path.resolve(ROOT, evidencePath);
const requiredEvidence = [
  'Staging OIDC provider test',
  'Staging Stripe webhook replay',
  'Stripe payment failure/recovery test',
  'MFA delivery monitoring evidence',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(absoluteEvidencePath)) {
  fail(`External provider evidence file not found: ${evidencePath}`);
}

const evidence = fs.readFileSync(absoluteEvidencePath, 'utf8');
const hasPassedSummary = /^\*\*Result:\s*(?:passed|complete|completed);?\s*external provider evidence completed\.?\*\*$/im.test(evidence);
const failures = [];

if (!hasPassedSummary) {
  failures.push('missing required summary marker: **Result: passed; external provider evidence completed.**');
}

for (const item of requiredEvidence) {
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
  console.error(`External provider production evidence gate is not satisfied by ${evidencePath}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Attach live staging OIDC, Stripe, and MFA provider evidence before production deployment.');
  process.exit(1);
}

console.error(`External provider production evidence gate satisfied by ${evidencePath}.`);
