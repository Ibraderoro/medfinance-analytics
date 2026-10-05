# MedFinance Analytics — Production Readiness Plan

## Overview

This plan resolves all blocking and major issues identified in the production readiness audit, bringing the codebase to 100% production-ready status. Work is grouped into seven independently-executable sub-tasks, ordered from highest to lowest severity. Each sub-task is self-contained and reviewable before the next begins.

**Scope:** Backend (Express/TypeScript), Frontend (React/Vite), Infrastructure (Docker Compose, nginx), Database (PostgreSQL migrations, query layer). No new features — only hardening and correctness fixes.

**Out of scope:** HIPAA/SOC 2 formal attestation, Kubernetes migration, Express 5 upgrade.

---

## Sub-Task 1 — Secrets & Environment Validation Hardening

**Status:** `[x] done`

### Intent
Several secrets and service URLs are `optionalEnv` but are silently required in production. A missing `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, or `STRIPE_ENTERPRISE_PRICE_ID` will cause runtime panics during user onboarding. `MFA_DELIVERY_WEBHOOK_URL` is validated at call-time in `MfaDeliveryService` (line 32–34) but not at startup — a misconfigured server can boot and serve traffic before the first login attempt surfaces the error. Grafana admin credentials default to empty strings in `docker-compose.yml`.

### Expected Outcomes
- Server refuses to start in production if any of the following are unset: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `MFA_DELIVERY_WEBHOOK_URL`.
- `docker-compose.yml` uses `:?` for `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`, causing compose to fail fast if unset.
- Root `.env.example` includes `OIDC_JWKS_URI=` alongside the other OIDC variables.
- All env changes are documented with inline comments explaining the production requirement.

### Todo List
1. In `apps/backend/src/config/env.ts`, add a new production-only validation block (alongside the existing `if (env.isProduction())` block at line 316) that throws if any of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` is empty.
2. In the same file, add a production check that throws if `MFA_DELIVERY_WEBHOOK_URL` is empty when `isProduction()` is true (mirrors the runtime check in `mfaDelivery.service.ts` but moves it to startup).
3. In `docker-compose.yml`, change `GRAFANA_ADMIN_USER: ${GRAFANA_ADMIN_USER:-}` and `GRAFANA_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-}` to use `:?` so Docker Compose fails if unset.
4. Add `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` to the root `.env.example` with placeholder values.
5. Add `OIDC_JWKS_URI=` to the root `.env.example` alongside the existing OIDC block.

### Relevant Context
- `apps/backend/src/config/env.ts` lines 246–249 (Stripe optional declarations), lines 316–336 (existing production validation block)
- `docker-compose.yml` lines 222–224 (Grafana service environment)
- Root `.env.example` lines 110–116 (OIDC block, missing OIDC_JWKS_URI)
- `apps/backend/src/services/mfaDelivery.service.ts` lines 32–34 (runtime MFA validation — keep this too as defense-in-depth)
- `apps/backend/src/services/billing.service.ts` lines 191–195 (`ensureProductionCustomerProvisioningConfigured` — only checks `STRIPE_SECRET_KEY`, not webhook secret or price IDs)

---

## Sub-Task 2 — Purge Build Artifacts from Git History

**Status:** `[x] done — artifacts already untracked; .gitignore rules confirmed correct at lines 11, 47, 82`

### Intent
`apps/backend/dist/`, `apps/backend/coverage/`, `packages/shared/dist/`, `packages/shared/coverage/`, and `apps/backend/tenant-isolation-report.json` are tracked in git despite being in `.gitignore`. Build artifacts in source control cause stale-code confusion, inflate repo size, and can expose intermediate compilation state. They must be removed from tracking and purged from history.

### Expected Outcomes
- `git ls-files dist/ coverage/ tenant-isolation-report.json` returns nothing.
- Root `.gitignore` remains correct (already has the right rules).
- A `git rm --cached` pass removes all tracked artifacts without deleting the local files.
- CI build continues to produce these artifacts from source; they are never committed.

### Todo List
1. Verify that root `.gitignore` already covers `dist/`, `coverage/`, and `tenant-isolation-report.json` (confirmed at lines 11, 47, 82 — no changes needed).
2. Run `git rm -r --cached apps/backend/dist apps/backend/coverage packages/shared/dist packages/shared/coverage apps/backend/tenant-isolation-report.json` to untrack all artifacts.
3. Commit the removal with message: `chore: untrack committed build artifacts and coverage reports`.
4. If the project requires a clean history (compliance), run `git filter-repo` or `BFG Repo Cleaner` to purge artifact blobs from all prior commits. Otherwise a single removal commit is sufficient.

### Relevant Context
- Root `.gitignore` lines 11, 47, 82 (already correct)
- `apps/backend/dist/` — full compiled TypeScript output
- `apps/backend/coverage/` — lcov HTML reports, coverage JSON
- `apps/backend/tenant-isolation-report.json` — runtime output file, should not be versioned

---

## Sub-Task 3 — Database Layer Correctness Fixes

**Status:** `[x] done`

### Intent
Two correctness issues exist in the database query wrapper: (1) `RESET ALL` is too broad — it resets the entire session including `search_path`, `statement_timeout`, and connection pooler settings, not just the tenant ID. (2) The placeholder count check rejects valid parameterized queries that reuse a placeholder (`$1 ... $1`), which is valid PostgreSQL syntax.

### Expected Outcomes
- `RESET ALL` is replaced with a targeted reset of only `app.current_tenant_id`.
- The placeholder check allows queries where `maxPlaceholder <= params.length` (the existing check `!==` is changed to `>`).
- Existing tests continue to pass.
- No behavioral change to query results — only the session cleanup and validation logic are affected.

### Todo List
1. In `apps/backend/src/config/database.ts` line 159, replace `await client.query('RESET ALL')` with `await client.query("SELECT set_config('app.current_tenant_id', '', false)")`.
2. In the same file, line 59, change `if (maxPlaceholder !== params.length)` to `if (maxPlaceholder > params.length)` so reused placeholders are accepted.
3. Update the error message string on that same conditional to say "SQL placeholder index exceeds provided parameter count" (the old message implied an exact match requirement).
4. Run `apps/backend` unit tests to confirm `database-query-guard.test.ts` and `tenant-context.test.ts` still pass.

### Relevant Context
- `apps/backend/src/config/database.ts` line 59 (placeholder check), line 159 (`RESET ALL`)
- `apps/backend/src/__tests__/database-query-guard.test.ts` — existing tests for `ensureSafeQuery`
- `apps/backend/src/__tests__/tenant-context.test.ts` — tests for tenant context propagation

---

## Sub-Task 4 — Auth & Security Fixes

**Status:** `[x] done`

### Intent
Three independent auth/security issues: (1) Invitation JWTs are signed with `JWT_SECRET` — the same key as access tokens — meaning a compromised access secret also compromises the invitation flow. (2) The CORS callback passes `true` as its second argument even when rejecting an origin, which causes the response headers to be incorrectly populated for blocked requests. (3) `analyst` and `viewer` roles have identical permission sets in `rbac.ts`, which makes the `analyst` role meaningless.

### Expected Outcomes
- Invitation JWTs are signed with `AUDIT_EXPORT_SIGNING_SECRET` (already required to differ from `JWT_SECRET` and `REFRESH_TOKEN_SECRET`), or a new dedicated `INVITATION_SIGNING_SECRET` env var is introduced.
- The CORS `callback` correctly passes `false` as the second argument when rejecting an origin.
- `analyst` role gains at least one write permission (`compliance:write`) that `viewer` does not have, making the role hierarchy meaningful.
- Auth tests updated to reflect the new signing key for invitations.
- Existing invitation acceptance flow continues to work (token verification must use the same key as signing).

### Todo List
1. **Decision: use `AUDIT_EXPORT_SIGNING_SECRET`** — already required, validated to differ from `JWT_SECRET` and `REFRESH_TOKEN_SECRET` at startup, no new env var needed.
2. In `apps/backend/src/services/auth.service.ts` line 317, change the second argument of `jwt.sign()` for invitation tokens from `env.JWT_SECRET` to `env.AUDIT_EXPORT_SIGNING_SECRET`.
3. In `apps/backend/src/services/auth.service.ts` (the `resolveInvitation` private method ~line 961), update `jwt.verify()` for invitation tokens to use `env.AUDIT_EXPORT_SIGNING_SECRET`.
4. In `apps/backend/src/app.ts` line 44, change the `callback` second argument from `true` to `false` on the rejection branch: `callback(new Error('Origin not allowed by CORS'), false)`.
5. In `apps/backend/src/middleware/rbac.ts` line 15, add `compliance:write` (and optionally `forecasting:write`) to the `analyst` permission set.
6. Update `apps/backend/src/__tests__/auth.service.test.ts` and `apps/backend/src/__tests__/security.middleware.test.ts` for the invitation signing key change.

### Relevant Context
- `apps/backend/src/services/auth.service.ts` line 314–325 (invitation `jwt.sign`), ~line 961 (`resolveInvitation` using `jwt.verify`)
- `apps/backend/src/app.ts` line 44 (CORS callback)
- `apps/backend/src/middleware/rbac.ts` lines 13–17 (role permission map)
- `apps/backend/src/config/env.ts` line 199 (`AUDIT_EXPORT_SIGNING_SECRET`)
- `apps/backend/src/__tests__/auth.service.test.ts`, `security.middleware.test.ts`

---

## Sub-Task 5 — Middleware Correctness Fixes

**Status:** `[x] done`

### Intent
Two middleware issues: (1) `sanitizeInput` deletes `<` and `>` characters from all string inputs, causing silent data loss for legitimate financial content (e.g. "revenue > expenses"). React's rendering already prevents XSS so this deletion provides no security value. (2) `errorHandler` logs `err.stack` unconditionally — in production, stack traces sent to a SIEM or shared log aggregator may expose internal paths and library versions.

### Expected Outcomes
- `sanitizeInput` no longer deletes `<` and `>` characters. Null bytes and leading/trailing whitespace trimming are preserved. The `$` and `.` key filters are preserved (NoSQL injection protection).
- `errorHandler` only includes `stack` in the log payload when `NODE_ENV !== 'production'`.
- `apps/backend/src/__tests__/security.middleware.test.ts` updated to reflect removed character deletion.
- No change to any route, controller, or service behavior.

### Todo List
1. In `apps/backend/src/middleware/sanitizeInput.ts` line 11, remove `.replace(/[<>]/g, '')`. Keep the null-byte removal and `.trim()`.
2. In `apps/backend/src/middleware/errorHandler.ts` line 50, wrap the `stack` field in a conditional: `...(process.env.NODE_ENV !== 'production' && { stack: err.stack })`.
3. Update `apps/backend/src/__tests__/security.middleware.test.ts` — any assertions that `<` or `>` are stripped must be removed or inverted.

### Relevant Context
- `apps/backend/src/middleware/sanitizeInput.ts` line 11
- `apps/backend/src/middleware/errorHandler.ts` line 50
- `apps/backend/src/__tests__/security.middleware.test.ts`

---

## Sub-Task 6 — Graceful Shutdown & Resilience

**Status:** `[x] done`

### Intent
The graceful shutdown sequence in `apps/backend/src/index.ts` calls `server.close()` and waits indefinitely for existing connections to drain. A keep-alive client connection will block process exit indefinitely, causing the container orchestrator (Docker, Kubernetes) to forcibly kill the process after its own timeout (typically 30 s), aborting in-flight requests. A hard-exit fallback timer must be added.

### Expected Outcomes
- After `server.close()` is called, a `setTimeout` fallback fires after a configurable grace period (default 25 s, below the typical orchestrator SIGKILL window of 30 s) and calls `process.exit(0)` if the server hasn't already exited cleanly.
- The grace period is configurable via a new `SHUTDOWN_GRACE_PERIOD_MS` env var with a default of 25,000.
- The worker process (`apps/backend/src/worker.ts`) receives the same treatment.
- The existing SIGTERM/SIGINT handlers are unchanged in structure.

### Todo List
1. In `apps/backend/src/config/env.ts`, add `SHUTDOWN_GRACE_PERIOD_MS: parseIntEnv('SHUTDOWN_GRACE_PERIOD_MS', 25_000)` alongside the other HTTP timeout declarations, with a validation that it is ≥ 1000.
2. In `apps/backend/src/index.ts`, inside the `shutdown` function after calling `server.close(...)`, add a `setTimeout(() => { logger.warn('Graceful shutdown timed out, forcing exit'); process.exit(0); }, env.SHUTDOWN_GRACE_PERIOD_MS).unref()`.
3. Apply the same pattern to `apps/backend/src/worker.ts` (find its equivalent shutdown block and add the same timer).
4. Add `SHUTDOWN_GRACE_PERIOD_MS=25000` to root `.env.example`.

### Relevant Context
- `apps/backend/src/index.ts` lines 49–68 (shutdown function, no existing timeout)
- `apps/backend/src/worker.ts` (worker shutdown block)
- `apps/backend/src/config/env.ts` lines 178–180 (HTTP timeout declarations, add alongside these)

---

## Sub-Task 7 — Operational & Observability Hardening

**Status:** `[x] done`

### Intent
The internal metrics/observability endpoint (`/api/v1/internal/observability/metrics`) defaults to CIDR-only access control with no bearer token authentication (`OPS_ENDPOINT_AUTH_ENABLED=false`). In cloud or Kubernetes environments where internal CIDR ranges are trusted, raw Prometheus metrics — which contain route paths, organization IDs in label values, and user-level counters — are readable by any workload in the cluster without a token. The default should be changed in production documentation and the `.env.example` should recommend enabling it.

### Expected Outcomes
- Root `.env.example` documents that `OPS_ENDPOINT_AUTH_ENABLED=true` and `OPS_ENDPOINT_AUTH_TOKEN=<strong-random>` are recommended in production, with a comment explaining why.
- The `apps/backend/.env.example` (already present) is updated to match.
- Prometheus `prometheus.yml` scrape config includes a `bearer_token` entry with a placeholder, so operators know to configure it.
- No code logic changes are required — the existing implementation is correct; only configuration defaults and documentation need updating.

### Todo List
1. In root `.env.example`, change the `OPS_ENDPOINT_AUTH_ENABLED=false` comment block to add a note: "Set to true in production and provide a strong random token".
2. In `apps/backend/.env.example`, make the same documentation update.
3. In `infrastructure/observability/prometheus/prometheus.yml`, add a commented-out `bearer_token: <your-token>` field to the `medfinance-backend` scrape job so operators know where to add it.
4. In the root `README.md` (or create a `docs/runbooks/ops-endpoint-auth.md`), add a section explaining how to enable and configure the ops auth token end-to-end (generate token, set env var, configure Prometheus bearer token).

### Relevant Context
- Root `.env.example` lines 98–103 (`OPS_ALLOWLIST_CIDRS`, `OPS_ENDPOINT_AUTH_ENABLED`, `OPS_ENDPOINT_AUTH_TOKEN`)
- `apps/backend/.env.example` (same section)
- `infrastructure/observability/prometheus/prometheus.yml` (scrape config)
- `apps/backend/src/middleware/operationalAccess.ts` (existing correct implementation — no changes needed)
