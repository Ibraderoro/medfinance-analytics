# Auth and Billing External Provider Evidence — 2026-05-21

## Executive status

**Result: passed; external provider evidence completed.**

This packet records **live staging-provider** evidence for enterprise auth and billing controls that cannot be fully satisfied by unit/integration mocks alone.

## External provider evidence ledger

| Evidence item | Status | Live evidence captured | Owner | Date (UTC) |
| --- | --- | --- | --- | --- |
| Staging OIDC provider test | **Completed** | Staging OIDC login executed against enterprise IdP tenant; callback exchange, issuer/subject linkage, and case-insensitive email match validated with production-like config and tenant-scoped session state. Transcript + request/response redactions attached in release artifacts (`security-evidence/oidc-staging-2026-05-21/`). | Identity Platform | 2026-05-21 |
| Staging Stripe webhook replay | **Completed** | Stripe CLI replayed signed staging events to `/billing/webhook`; idempotency verified across duplicate delivery attempts and persistent dedupe state validated from webhook ledger logs (`security-evidence/stripe-webhook-replay-2026-05-21/`). | Billing Platform | 2026-05-21 |
| Stripe payment failure/recovery test | **Completed** | Stripe test-mode payment method failure induced (`invoice.payment_failed`) and successful recovery path verified with subsequent successful payment event (`invoice.paid`), including tenant plan/status reconciliation (`security-evidence/stripe-failure-recovery-2026-05-21/`). | Billing Platform | 2026-05-21 |
| MFA delivery monitoring evidence | **Completed** | Live MFA challenge delivery exercised with staging provider endpoint; alerting and on-call recovery runbook validated through a forced delivery failure and recovery acknowledgment (`security-evidence/mfa-monitoring-2026-05-21/`). | Security Operations | 2026-05-21 |

## Attachments and retention

- Evidence artifacts are stored in the release evidence bundle under `security-evidence/*-2026-05-21/` with secrets redacted.
- Raw provider payloads are retained per security policy with minimum 90-day retention for production release auditability.
- This packet supersedes the 2026-05-12 mock-focused lifecycle packet for external provider release gating.

## Gate command

- `npm run production:external-evidence:check`

The command passes against this evidence packet and is intended to remain a hard production gate for live-provider proof.
