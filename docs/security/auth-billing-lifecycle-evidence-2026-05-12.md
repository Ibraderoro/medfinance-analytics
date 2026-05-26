# Auth and Billing Lifecycle Evidence — 2026-05-12

## Executive status

**Result: additional lifecycle evidence added for backend unit/integration gates.**

This evidence packet maps the requested production lifecycle areas to executable tests and release-gate expectations. It focuses on evidence that can run without live third-party credentials by using mocked delivery providers, OIDC providers, Stripe API responses, and database calls.

## Auth lifecycle coverage

| Area | Evidence added or verified | Test coverage |
| --- | --- | --- |
| MFA enrollment/challenge creation | Admin sign-in creates a time-limited MFA challenge, stores only a hashed code, and does not return the plaintext code to the client. | `AuthService.login` test: `requires MFA for admin users and stores only a hashed MFA code`. |
| MFA delivery configuration | Production admin sign-in fails closed when no MFA delivery provider is configured and removes the pending challenge so a recovery/re-enrollment attempt must start with a fresh login challenge. | `AuthService.login` test: `fails closed and removes the pending MFA challenge when production MFA delivery is not configured`. |
| MFA recovery safety | Failed MFA verification increments attempts without restoring or exposing the raw code and expires the challenge after repeated failures. This is the supported recovery posture for the current OTP challenge model: restart the verified login flow to obtain a fresh challenge rather than bypass MFA. | `AuthService.login` test: `increments MFA attempts without exposing the raw code and expires after repeated failures`. |
| Provider-specific OIDC | OIDC callbacks are exercised with Okta-style and Auth0-style issuer/token/userinfo URLs; tests verify token exchange, userinfo authorization, issuer/subject account matching, and token issuance. | `AuthService OIDC SSO` parameterized provider-specific callback test. |
| OIDC negative controls | Unverified provider email is rejected and does not clear state or issue refresh tokens. | `AuthService OIDC SSO` test: `rejects an OIDC callback when the provider email is not verified`. |

## Billing lifecycle coverage

| Area | Evidence added or verified | Test coverage |
| --- | --- | --- |
| Checkout/subscription creation | Subscription creation sends Stripe the selected price, uses `default_incomplete` payment behavior, persists the subscription snapshot, and updates tenant user billing state. | `BillingService production lifecycle evidence` test: `creates an incomplete Stripe subscription with the selected price and persists the local subscription snapshot`. |
| Checkout completion | `checkout.session.completed` records an active local subscription snapshot even before invoice price details arrive. | `BillingService production lifecycle evidence` test: `reconciles checkout completion without a price as an active free snapshot until invoice details arrive`. |
| Payment success/failure/cancel lifecycle | `invoice.paid`, `invoice.payment_failed`, and `customer.subscription.deleted` events reconcile subscription status and user plan/status fields. | `BillingService production lifecycle evidence` test: `reconciles invoice paid, payment failed, and cancellation events into subscription and user plan state`. |
| Webhook replay/idempotency | Webhook reservation, processed marking, and retryable reservation release are explicitly exercised. | `BillingService production lifecycle evidence` test: `records replay-safe webhook reservations and releases retryable failures`; route-level billing webhook tests also cover Redis and persistent duplicate handling. |
| Reconciliation semantics | Subscription upserts use `ON CONFLICT (stripe_subscription_id)` and user billing fields are updated from the canonical webhook/customer mapping. | Assertions in the billing lifecycle tests verify `ON CONFLICT` upserts and `UPDATE users` parameters for each lifecycle status. |

## Remaining production sign-off requirements

These tests provide deterministic lifecycle evidence for code behavior. Before broad production launch, the release owner should still attach environment evidence for:

1. A staging OIDC test against each configured enterprise identity provider tenant.
2. A staging Stripe webhook replay using signed events from the Stripe CLI or Stripe dashboard replay tooling.
3. A real payment-method failure/recovery test in Stripe test mode.
4. MFA delivery provider monitoring evidence, including alerting on delivery failures and operational recovery steps.

`npm run production:external-evidence:check` is expected to fail against this packet and block production deployment until replacement evidence includes `**Result: passed; external provider evidence completed.**` and rows marked passed/completed/satisfied for staging OIDC, Stripe webhook replay, Stripe payment failure/recovery, and MFA delivery monitoring.

## Verdict for May 12, 2026

The repository now has executable backend evidence for MFA challenge/recovery safety, provider-specific OIDC callback handling, and Stripe subscription lifecycle/replay/reconciliation behavior. Production sign-off still requires live staging evidence for configured external providers.
