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

const additionalEvidenceChecks = [
  { label: 'backup RTO evidence', pattern: /\bRTO\b/i },
  { label: 'backup RPO evidence', pattern: /\bRPO\b/i },
  { label: 'performance p95 evidence', pattern: /\bp95\b/i },
  { label: 'performance p99 evidence', pattern: /\bp99\b/i },
  { label: 'incident commander evidence', pattern: /incident commander/i },
  { label: 'rollback image digest evidence', pattern: /image digests?/i },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(absoluteEvidencePath)) {
  fail(`Staging drill evidence file not found: ${evidencePath}`);
}

const evidence = fs.readFileSync(absoluteEvidencePath, 'utf8');
const hasPassedSummary = /^\*\*Result:\s*(?:passed|complete|completed);?\s*drills completed\.?\*\*$/im.test(evidence);
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
  if (/(blocked|pending|not executed|not completed|not run|incomplete|skipped|failed)/i.test(status)) {
    failures.push(`${drill}: status is still release-blocking (${rowMatch[1].trim()})`);
    continue;
  }

  if (!/(passed|complete|completed|satisfied)/i.test(status)) {
    failures.push(`${drill}: status must explicitly be passed/completed/satisfied (${rowMatch[1].trim()})`);
  }
}

for (const check of additionalEvidenceChecks) {
  if (!check.pattern.test(evidence)) {
    failures.push(`missing ${check.label}`);
  }
}

if (failures.length > 0) {
  console.error(`Staging operational drill gate is not satisfied by ${evidencePath}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Run the drills in docs/staging-drills.md and update the evidence packet before production deployment.');
  process.exit(1);
}

console.error(`Staging operational drill gate satisfied by ${evidencePath}.`);
