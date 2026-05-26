#!/usr/bin/env node
const { checkEvidence } = require('./lib/evidence-gate');

checkEvidence({
  envVar: 'EXTERNAL_PROVIDER_EVIDENCE',
  defaultPath: 'docs/security/auth-billing-lifecycle-evidence-2026-05-21.md',
  summaryPhraseRegex: /^\*\*Result:\s*(?:passed|complete|completed);?\s*external provider evidence completed\.?\*\*$/im,
  requiredRows: [
    'Staging OIDC provider test',
    'Staging Stripe webhook replay',
    'Stripe payment failure/recovery test',
    'MFA delivery monitoring evidence',
  ],
  missingSummaryMessage: 'missing required summary marker: **Result: passed; external provider evidence completed.**',
  failureHeader: 'External provider production evidence gate is not satisfied by',
  failureHint: 'Attach live staging OIDC, Stripe, and MFA provider evidence before production deployment.',
  successMessage: (evidencePath) => `External provider production evidence gate satisfied by ${evidencePath}.`,
});
