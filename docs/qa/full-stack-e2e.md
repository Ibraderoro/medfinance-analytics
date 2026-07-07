# Full-stack E2E architecture

The repository now has two Playwright lanes:

1. **Mocked UI regression** (`apps/frontend/e2e`, `playwright.mock.config.ts`) keeps fast, fully parallel browser tests that route `/api/v1/**` to fixtures.
2. **Production-like full-stack E2E** (`apps/frontend/e2e-full`, `playwright.full-stack.config.ts`) drives the built frontend through Nginx into the real backend, PostgreSQL, and Redis.

## Docker test environment

`docker-compose.e2e.yml` starts isolated services per `COMPOSE_PROJECT_NAME`:

- `postgres` and `redis` use tmpfs storage for fast startup and no cross-run state.
- `migrator` runs backend migrations before any application container can start.
- `seed` applies the production seed plus deterministic E2E identities and tenant-isolation fixtures.
- `backend` runs the production backend image against the migrated database and Redis.
- `frontend` serves the production frontend bundle.
- `edge` exposes the same Nginx API/frontend routing shape used by production on `127.0.0.1:${E2E_HTTP_PORT:-8080}`.

Run locally with:

```bash
npm run e2e:full-stack
```

Run only mocked UI regression with:

```bash
npm run test:e2e:mock --workspace=apps/frontend
```

## CI integration

The CI workflow keeps the mocked Playwright smoke test in the main validation job and adds a separate `full-stack-e2e` job. The full-stack job uses Docker layer caching, installs only the Chromium browser, starts the Docker composition with a unique project name, and uploads Playwright reports on failure.

## Test examples

The full-stack suite covers:

- Login through the real auth endpoint and dashboard rendering from seeded financial data.
- Migration/seed validation through health, KPI, and compliance API checks.
- SSE connection to `/api/v1/financials/live` plus event publishing through the real backend.
- Billing subscription reads and payment-plan validation against the real database.
- Tenant isolation by logging two browser contexts into different organizations in parallel and verifying tenant-specific rows do not leak.

## Reliability strategy

- **Parallel isolation:** CI sets a unique `COMPOSE_PROJECT_NAME`; Postgres and Redis use tmpfs so parallel jobs cannot share data.
- **Deterministic data:** `scripts/e2e/seed-e2e.sql` is idempotent and layers only E2E-specific rows on top of production-like seed data.
- **Migration gate:** the app never starts until `migrator` completes successfully.
- **Runtime optimization:** the stack uses health checks, tmpfs-backed databases, a small worker count in CI, and Docker build cache.
- **Debuggability:** Playwright traces, screenshots, videos, HTML, and JUnit reports are retained for full-stack failures.
