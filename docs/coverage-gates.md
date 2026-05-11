# Coverage Gates

Coverage thresholds are intentionally staged so CI can ratchet toward production-grade confidence without blocking the current test suite on uncovered legacy areas.

## Stage 1 — enforced now
- Backend global coverage floor is raised above the previous baseline and excludes high-risk modules that have their own thresholds.
- Frontend global branch and line thresholds are raised to the current tested baseline.
- Shared package coverage is held above 80% globally.
- Backend high-risk modules now have file-level gates for:
  - authentication service,
  - billing service,
  - tenant context middleware,
  - financial data service,
  - forecasting math.

## Stage 2 — next ratchet target
- Raise backend and frontend global statements/lines/functions to at least 60%.
- Raise auth, billing, tenant isolation, and financial calculation modules to at least 80% statements/lines/functions where practical.
- Add missing tests before increasing gates, rather than lowering risk-specific thresholds.

## Stage 3 — production target
- Raise backend and frontend global statements/lines/functions to at least 70%.
- Keep high-risk auth, billing, tenant isolation, and financial calculation modules above the global floor, targeting 85%+ statements/lines/functions and materially higher branch coverage.
