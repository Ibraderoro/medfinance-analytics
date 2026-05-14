#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const ROOT = path.resolve(__dirname, '..');

const coverageGates = [
  {
    label: 'Backend global',
    summaryPath: 'apps/backend/coverage/coverage-summary.json',
    key: 'total',
    thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 },
  },
  {
    label: 'Frontend global',
    summaryPath: 'apps/frontend/coverage/coverage-summary.json',
    key: 'total',
    thresholds: { statements: 90, branches: 85, functions: 88, lines: 90 },
  },
  ...[
    ['Backend auth service', 'apps/backend/src/services/auth.service.ts'],
    ['Backend billing service', 'apps/backend/src/services/billing.service.ts'],
    ['Backend tenant context', 'apps/backend/src/middleware/tenantContext.ts'],
    ['Backend compliance service', 'apps/backend/src/services/compliance.service.ts'],
    ['Backend financials service', 'apps/backend/src/services/financials.service.ts'],
    ['Backend forecasting math', 'apps/backend/src/services/forecasting/forecastingMath.ts'],
  ].map(([label, filePath]) => ({
    label,
    summaryPath: 'apps/backend/coverage/coverage-summary.json',
    filePath,
    thresholds: { statements: 85, branches: 75, functions: 90, lines: 85 },
  })),
];

function readCoverageSummary(summaryPath) {
  const absolutePath = path.join(ROOT, summaryPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Missing coverage summary: ${summaryPath}. Run npm run coverage:prod to generate coverage summaries before checking production targets.`,
    );
  }

  const coverageSummary = fs.readFileSync(absolutePath, 'utf8');
  try {
    return JSON.parse(coverageSummary);
  } catch (error) {
    throw new Error(`Malformed coverage summary JSON at ${absolutePath}: ${error.message}`);
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function findCoverageEntry(summary, gate) {
  if (gate.key) return summary[gate.key];

  const absoluteTarget = normalizePath(path.join(ROOT, gate.filePath));
  const relativeTarget = normalizePath(gate.filePath);

  return Object.entries(summary).find(([coveragePath]) => {
    const normalizedCoveragePath = normalizePath(coveragePath);
    const normalizedAbsoluteCoveragePath = normalizePath(path.resolve(ROOT, coveragePath));
    return normalizedCoveragePath === relativeTarget || normalizedAbsoluteCoveragePath === absoluteTarget;
  })?.[1];
}

const summaries = new Map();
const failures = [];

for (const gate of coverageGates) {
  if (!summaries.has(gate.summaryPath)) {
    summaries.set(gate.summaryPath, readCoverageSummary(gate.summaryPath));
  }

  const entry = findCoverageEntry(summaries.get(gate.summaryPath), gate);
  if (!entry) {
    failures.push(`${gate.label}: missing coverage entry${gate.filePath ? ` for ${gate.filePath}` : ''}`);
    continue;
  }

  for (const metric of METRICS) {
    const actual = Number(entry[metric]?.pct);
    const required = gate.thresholds[metric];
    if (!Number.isFinite(actual) || actual < required) {
      const displayActual = Number.isFinite(actual) ? actual.toFixed(2) : 'missing';
      failures.push(`${gate.label}: ${metric} ${displayActual}% < ${required}%`);
    }
  }
}

if (failures.length > 0) {
  console.error('Production coverage targets are not met:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Production coverage targets are met.');
