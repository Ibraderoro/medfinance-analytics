# Coverage Gates

The production coverage gate is now enforced by the default Jest workspace thresholds and by the explicit release command:

```bash
npm run coverage:prod
```

The gate focuses default unit/integration coverage on deterministic application runtime modules and the highest-risk healthcare-finance domains. Infrastructure bootstrapping and deployment-adapter files (`src/index.ts`, database migration/seed scripts, environment/database/Redis connection adapters, tracing bootstrap, controller glue, and live SSE transport glue) remain covered by build, route-level integration, staging-drill, and end-to-end release gates rather than line-coverage thresholds.

## Enforced production target

| Workspace / module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Backend global covered runtime modules | 70 | 60 | 70 | 70 |
| Frontend global covered runtime modules | 90 | 85 | 88 | 90 |
| Backend `auth.service.ts` | 85 | 75 | 90 | 85 |
| Backend `billing.service.ts` | 85 | 75 | 90 | 85 |
| Backend `tenantContext.ts` | 85 | 75 | 90 | 85 |
| Backend `compliance.service.ts` | 85 | 75 | 90 | 85 |
| Backend `financials.service.ts` | 85 | 75 | 90 | 85 |
| Backend `forecastingMath.ts` | 85 | 75 | 90 | 85 |

## Required complementary gates

Coverage is necessary but not sufficient for production approval. Broad healthcare-finance production sign-off still requires:

1. Live staging migration up/down, backup/restore, rollback, performance, and incident-response drill evidence.
2. Real Postgres/Redis integration evidence for tenant isolation and RLS behavior.
3. Provider-specific OIDC, Stripe replay/reconciliation, payment failure/recovery, and MFA delivery evidence.
4. A clean dependency vulnerability scan or formally approved exceptions.
5. Playwright critical-journey smoke tests in a provisioned browser environment.


## Unified production evidence gate

Run the complementary production gates together with:

```bash
npm run production:gates:check
```

This command enforces coverage, backend integration evidence, external-provider evidence, vulnerability evidence, provisioned E2E evidence, and staging-drill evidence in one release-blocking pass.

After any staging evidence refresh, re-run this command and re-run the external/provider, security, and E2E evidence checks so all release packets remain aligned to the same candidate SHA/date window.
