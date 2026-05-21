#!/usr/bin/env node
const { checkEvidence } = require('./lib/evidence-gate');

checkEvidence({
  envVar: 'PLAYWRIGHT_E2E_EVIDENCE',
  defaultPath: 'docs/security/playwright-e2e-evidence-2026-05-21.md',
  summaryPhraseRegex: /^\*\*Result:\s*(?:passed|complete|completed);?\s*provisioned playwright e2e evidence completed\.?\*\*$/im,
  requiredRows: [
    'Chromium install step in provisioned environment',
    'Playwright critical journey suite',
    'E2E artifact retention (trace/video/report)',
    'Release commit linkage',
  ],
  missingSummaryMessage: 'missing required summary marker: **Result: passed; provisioned Playwright E2E evidence completed.**',
  failureHeader: 'Provisioned Playwright E2E evidence gate is not satisfied by',
  failureHint: 'Run Playwright E2E in a provisioned environment (with browser install) and attach signed artifacts for release.',
  successMessage: (evidencePath) => `Provisioned Playwright E2E evidence gate satisfied by ${evidencePath}.`,
});
