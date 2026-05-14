# Coverage Gates

Coverage thresholds are intentionally staged so CI can ratchet toward production-grade confidence without blocking the current test suite on uncovered legacy areas. Each stage should raise gates only after the matching tests are merged and the full workspace suite passes locally and in CI.

## Stage 1 — enforced now

The current ratchet locks in an improved May 2026 backend baseline and the current frontend baseline without overfitting to one machine-specific coverage run.

| Workspace / module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Backend global | 50 | 40 | 45 | 51 |
| Backend `auth.service.ts` | 71 | 49 | 73 | 73 |
| Backend `billing.service.ts` | 86 | 75 | 90 | 87 |
| Backend `tenantContext.ts` | 71 | 50 | 85 | 72 |
| Backend `financials.service.ts` | 45 | 22 | 25 | 48 |
| Backend `forecastingMath.ts` | 90 | 70 | 90 | 90 |
| Frontend global | 82 | 75 | 75 | 83 |
| Shared global | 80 | 90 | 90 | 80 |

Stage 1 specifically raises gates around the high-risk lifecycle areas that now have additional evidence:

- MFA challenge/recovery and provider-specific OIDC coverage in `auth.service.ts`.
- Stripe subscription lifecycle, webhook replay/idempotency, and reconciliation coverage in `billing.service.ts`.
- A frontend global ratchet that prevents broad UI coverage from regressing while future tests target currently uncovered shell modules.

## Stage 2 — next ratchet target

Target after the next coverage-focused remediation pass:

| Workspace / module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Backend global | 60 | 50 | 60 | 60 |
| Backend auth/billing/tenant modules | 80 | 65 | 85 | 80 |
| Backend financial services | 65 | 45 | 60 | 65 |
| Frontend global | 85 | 80 | 82 | 85 |
| Frontend app shell/store/API modules | 60 | 50 | 60 | 60 |

Required work before Stage 2:

1. Add tests for backend health, database/Redis configuration failure paths, analytics worker paths, forecasting service orchestration, and live financials.
2. Add tests for frontend `App.tsx`, `main.tsx`, store behavior, and remaining API service paths.
3. Keep high-risk auth, billing, tenant isolation, and financial-calculation modules above the global floor.

## Stage 3 — production target

Target for broad healthcare-finance production confidence:

| Workspace / module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Backend global | 70 | 60 | 70 | 70 |
| Frontend global | 90 | 85 | 88 | 90 |
| High-risk auth, billing, tenant, compliance, and financial modules | 85 | 75 | 90 | 85 |

Stage 3 should be paired with live staging drill evidence, real Postgres/Redis integration evidence, provider-specific SSO evidence, Stripe replay/reconciliation evidence, and a clean vulnerability scan result.

## Production coverage verification

The Stage 3 target is intentionally not wired into the default `npm test` CI gate yet because current coverage remains below that production bar. Release owners should run the explicit production check before broad healthcare-finance launch:

```bash
npm run coverage:prod
```

This command regenerates workspace coverage summaries and then fails unless the Stage 3 global and high-risk module targets above are met. A failing result is expected until the Stage 2 and Stage 3 remediation work is complete; do not treat Stage 1 CI coverage alone as broad production sign-off evidence.
