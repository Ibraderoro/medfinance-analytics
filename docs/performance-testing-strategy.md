# Performance Benchmarking and Load Testing Strategy

## Scope

This strategy covers API benchmarking, mixed-load testing, stress testing, soak testing, PostgreSQL performance analysis, Redis performance checks, and consolidated latency/throughput reporting for `apps/backend`.

## Production traffic assumptions (baseline)

- Average traffic: **80–120 RPS** across API routes.
- Peak traffic: **400 RPS**.
- Burst traffic: **700 RPS** for 1–3 minutes.
- Traffic mix:
  - 55% financials (`/financials/summary`, `/financials/kpis`, `/financials/revenue`, `/financials/expenses`, `/financials/cash-flow`)
  - 15% compliance (`/compliance/status`)
  - 10% forecasting (`/forecasting/forecast`)
  - 10% insights (`/insights`)
  - 5% auth (`/auth/login`, `/auth/refresh`)
  - 5% health/admin (`/health/ready`, `/admin/metrics`)
- Tenant profile: **50–200 active tenants**, top 10 tenants generate ~60% of load.
- Read/write split: **~90/10**.

## Performance objectives

- Read API latency: **p95 < 250ms**, **p99 < 600ms**.
- Error rate: **< 1%**.
- Readiness endpoint latency: **p95 < 80ms**.
- Track throughput and resource saturation during all runs.

## Tooling

- **autocannon**: endpoint micro-benchmarks.
- **k6**: realistic mixed load, step stress, spike stress, soak.
- **PostgreSQL (`psql`)**: `pg_stat_statements`, waits, dead tuples, explain plans.
- **Redis (`redis-cli`, `redis-benchmark`)**: command latency/throughput and memory pressure.
- **Prometheus / Grafana / OTEL / cAdvisor**: correlation across app, DB, Redis, and host/container usage.

## Bottlenecks to watch first

- Redis round-trips in request rate limiting.
- Per-query transaction + tenant `set_config` overhead in DB wrapper.
- Aggregation-heavy financial and forecasting queries under large tenant datasets.
- Redis scan/delete invalidation cost for financial cache invalidation.
- Redis stream ingestion and Postgres persistence contention in analytics worker.
- In-memory request metrics are per-process; compare against shared telemetry for multi-pod runs.

## Execution cadence (implemented in CI)

- **Every PR and push to `main`** (`.github/workflows/ci.yml`, job `perf-pr-check`): `perf:api:bench` (short warm/cold durations), `PERF_PROFILE=ci perf:load:ci-smoke`, `perf:db:analyze`, `perf:report`, `perf:regression:check`. Posts a consolidated report as a PR comment; fails the job on threshold or major-regression findings. Backed by GitHub Actions `services:` (no Docker build), not the Compose stack, to keep runtime under ~15 minutes.
- **Release candidates** (`.github/workflows/cd-production.yml`, job `perf-release-candidate`, runs before `build-images`): `PERF_PROFILE=peak perf:load:peak`, full-duration `perf:api:bench`, `perf:db:analyze`, `perf:redis:check`, `perf:report`, `perf:regression:check`. Boots `docker-compose.e2e.yml`'s `backend`+`worker` (and their transitive Postgres/Redis/migration/seed dependencies). **Currently advisory** (`continue-on-error: true`) while thresholds are calibrated against real release runs — it does not yet block `build-images`/`deploy-production`.
- **Weekly** (`.github/workflows/perf-weekly.yml`, Monday 06:00 UTC + manual dispatch): `perf:stress:step`, `perf:stress:spike`, `perf:soak`, `perf:report`. Informational only — never fails the workflow.

## Threshold configuration

All latency/throughput/error-rate thresholds and k6 profile settings live in a single
file, **`scripts/performance/perf-thresholds.json`** — the source of truth for both the
Node scripts (`require()`d directly) and the k6 scripts (`open()`d at init time via
`scripts/performance/k6/common.js`'s `THRESHOLDS` export, since k6's JS runtime can't
`require()` Node modules). Env vars (`API_BENCH_P95_MS`, `API_BENCH_P99_MS`,
`API_BENCH_NON2XX_RATE`, `K6_HTTP_REQ_FAILED_RATE`) remain a per-run override layer on
top of the JSON defaults. Regression tolerances (`regression.warnTolerancePct`,
`p95TolerancePct`, `throughputTolerancePct`) live in the same file and are consumed by
`scripts/performance/check-regression.js`.

## Regression detection

`perf:regression:check` compares the current run's per-endpoint p95/p99/throughput
against a trimmed `artifacts/performance/baseline.json` snapshot. In CI, that baseline is
persisted via GitHub Actions `actions/cache` with a rolling key
(`perf-baseline-main-<run-id>`, restored via the `perf-baseline-main-` prefix) — saved
only on successful pushes to `main`, restored on PRs and release-candidate runs. Findings
under the warn tolerance pass silently; between warn and fail tolerance produce a
non-blocking `warn`; past the fail tolerance produce a build-failing `fail`. If no
baseline exists yet (first run), the check passes and seeds the next baseline.

## Required environment variables

At minimum:

- `PERF_BASE_URL` (default `http://localhost:3001/api/v1`)

Optional for authenticated scenarios:

- `PERF_AUTH_COOKIE` (cookie string to use directly)
- `PERF_USERS_JSON` (JSON array of login credentials for weighted tenant sessions)
- `PERF_EMAIL`, `PERF_PASSWORD`, `PERF_ORGANIZATION_ID` (single login fallback — CI uses
  a dedicated `perf@medfinance.test` identity seeded by `scripts/e2e/seed-e2e.sql`,
  kept separate from `demo@medfinance.test` for a cleaner audit trail)
- `PERF_ADMIN_COOKIE` (for `/admin/metrics` traffic)

For DB/Redis analysis:

- `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

Rate limiting (`apps/backend/src/middleware/rateLimiter.ts`) is env-configurable via
`RATE_LIMIT_GENERAL_MAX`, `RATE_LIMIT_GENERAL_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`,
`RATE_LIMIT_AUTH_WINDOW_MS` — defaults (200/15min, 20/15min) match prior hardcoded
production behavior exactly. **Raise these only in perf/load-test environments**: all
traffic in a load test originates from one source IP, so production-tuned limits would
otherwise 429 almost the entire run and invalidate every latency/throughput
measurement. All CI perf jobs set relaxed values for this reason.

## Implementation notes

- k6 load scripts require the `k6` CLI to be installed and available on `PATH`; npm scripts invoke it through `scripts/performance/k6-runner.js` so timestamped artifact paths work across platforms. CI installs it from the official k6 apt repository.
- Scripts write outputs to `artifacts/performance/` (gitignored — generated, not committed).
- k6 scripts enforce threshold-based pass/fail for latency, error-rate, and minimum throughput, sourced from `perf-thresholds.json`.
- Database analysis captures top statements and explain plans for key query patterns. The `pg_stat_statements`-dependent queries are skipped (not hard-failed) when that extension isn't preloaded — only the release-candidate job's Postgres (via `docker-compose.e2e.yml`'s `command: postgres -c shared_preload_libraries=pg_stat_statements ...`) gets the full analysis; the PR job's plain GitHub Actions Postgres service does not preload it.
- Redis analysis captures INFO snapshots and benchmark output for critical command patterns.
- The nginx `edge` proxy used in `docker-compose.e2e.yml` intentionally 404s `/api/v1/health/ready` and other internal/observability routes on its public listener — perf scripts must talk to `backend` directly (published to `127.0.0.1` on the host for this purpose), never through `edge`.
