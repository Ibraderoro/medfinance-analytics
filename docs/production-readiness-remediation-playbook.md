# Production-Readiness Remediation Playbook

## Goal
Close the remaining gaps and create objective evidence for a defensible "production-ready" release decision.

## 1) Fix and gate test coverage gaps

### Why
Low/uneven frontend coverage means key regressions can ship undetected.

### Actions
1. Add tests for currently uncovered modules first:
   - `src/services/api.ts` (interceptors + auth redirect behavior)
   - `src/hooks/useFinancialKpis.ts`
   - `src/hooks/useLiveFinancials.ts`
   - `src/pages/{Dashboard,Financials,Forecasting}.tsx`
   - chart render sanity tests for `RevenueChart`, `ForecastChart`, and `ComplianceChart`
2. Introduce staged coverage gates in `apps/frontend/jest.config.json`:
   - Stage 1: statements 45 / lines 45 / functions 45 / branches 35
   - Stage 2: statements 60 / lines 60 / functions 60 / branches 50
   - Stage 3: statements 70 / lines 70 / functions 70 / branches 60
3. Enforce gates in CI and block merges on failure.

## 2) Eliminate known warning/deprecation signals

### Backend/Jest ts-jest deprecation warning
- Update Jest transform configuration from deprecated `globals.ts-jest` style to modern `transform` syntax.

### Frontend React Router future warnings in tests
- Wrap test routers with future flags or update tests to current v7-compatible configuration.
- If warnings are expected temporarily, explicitly silence only the known messages in test setup and track removal with a ticket.

### Vite deprecation warnings (`esbuild`/`optimizeDeps.esbuildOptions`)
- Upgrade `@vitejs/plugin-react` to a version fully aligned with the installed Vite major.
- Remove/replace deprecated plugin options and confirm clean build logs.
- Lock compatible versions in `package-lock.json` and document the matrix.

## 3) Harden runtime integration edges

### Stripe provisioning warning path
1. Ensure Stripe provisioning errors are classified and observable (error code + org id + retryability).
2. Add retry/backoff for transient failures and explicit fallback behavior in UX.
3. Add integration tests for provisioning failure modes.

### Redis analytics stream warning path
1. Validate Redis client/server support for stream operations used by analytics.
2. Add startup capability check and fail-fast (or graceful degraded mode) with explicit health signal.
3. Add integration test that exercises stream write path.

## 4) Add release-go/no-go checklist (must pass)

1. `npm run lint` clean.
2. `npm test` clean with no untriaged warnings.
3. `npm run build` clean with no deprecations.
4. DB migration up/down verified on staging snapshot.
5. Backup + restore drill completed with documented RTO/RPO.
6. Rollback drill completed (app + DB schema compatibility).
7. Synthetic health + critical user journey monitors green.
8. On-call runbook includes incident triage for auth, billing, analytics ingestion.

## 5) Suggested execution order (fastest risk reduction)
1. Warning/deprecation cleanup (toolchain + test noise).
2. Coverage expansion for hooks/services/pages.
3. Runtime edge hardening (Stripe/Redis) with tests.
4. CI gate tightening + staged threshold increases.
5. Final staged release drill and sign-off.

## Definition of Done
You can credibly state "production-ready" when:
- CI is green with enforced coverage thresholds,
- builds/tests are free from untriaged warnings/deprecations,
- operational drills (backup/restore/rollback) are completed and documented,
- high-risk integrations (Stripe/Redis) have tested fallback behavior and clear observability.
