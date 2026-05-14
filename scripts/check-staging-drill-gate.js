#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const evidencePath = process.env.STAGING_DRILL_EVIDENCE || 'docs/staging-drill-evidence-2026-05-11.md';
const absoluteEvidencePath = path.resolve(ROOT, evidencePath);
const requiredDrills = [
  'Migration up/down',
  'Backup/restore',
  'Application rollback',
  'Load/performance',
  'Incident response',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(absoluteEvidencePath)) {
  fail(`Staging drill evidence file not found: ${evidencePath}`);
}

const evidence = fs.readFileSync(absoluteEvidencePath, 'utf8');
const hasPassedSummary = /\*\*Result:\s*(?:passed|complete|completed);?\s*drills completed\.?\*\*/i.test(evidence);
const failures = [];

if (!hasPassedSummary) {
  failures.push('missing required summary marker: **Result: passed; drills completed.**');
}

for (const drill of requiredDrills) {
  const escapedDrill = drill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowMatch = evidence.match(new RegExp(`\\|\\s*${escapedDrill}\\s*\\|([^|]+)\\|`, 'i'));
  if (!rowMatch) {
    failures.push(`${drill}: missing evidence ledger row`);
    continue;
  }

  const status = rowMatch[1].replace(/\*/g, '').trim().toLowerCase();
  if (/(blocked|pending|not executed|not completed|not run|incomplete)/i.test(status)) {
    failures.push(`${drill}: status is still release-blocking (${rowMatch[1].trim()})`);
    continue;
  }

  if (!/(passed|complete|completed|satisfied)/i.test(status)) {
    failures.push(`${drill}: status must explicitly be passed/completed/satisfied (${rowMatch[1].trim()})`);
  }
}

if (failures.length > 0) {
  console.error(`Staging operational drill gate is not satisfied by ${evidencePath}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Run the drills in docs/staging-drills.md and update the evidence packet before production deployment.');
  process.exit(1);
}

console.error(`Staging operational drill gate satisfied by ${evidencePath}.`);
