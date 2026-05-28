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

## Execution cadence

- PRs touching backend hot paths: `perf:load:smoke`.
- Release candidates: `perf:load:peak`, `perf:db:analyze`, `perf:redis:check`, `perf:report`.
- Weekly or pre-major-release: `perf:stress:step`, `perf:stress:spike`, `perf:soak`.

## Required environment variables

At minimum:

- `PERF_BASE_URL` (default `http://localhost:3001/api/v1`)

Optional for authenticated scenarios:

- `PERF_AUTH_COOKIE` (cookie string to use directly)
- `PERF_USERS_JSON` (JSON array of login credentials for weighted tenant sessions)
- `PERF_EMAIL`, `PERF_PASSWORD`, `PERF_ORGANIZATION_ID` (single login fallback)
- `PERF_ADMIN_COOKIE` (for `/admin/metrics` traffic)

For DB/Redis analysis:

- `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

## Implementation notes

- k6 load scripts require the `k6` CLI to be installed and available on `PATH`; npm scripts invoke it through `scripts/performance/k6-runner.js` so timestamped artifact paths work across platforms.
- Scripts write outputs to `artifacts/performance/`.
- k6 scripts enforce threshold-based pass/fail for latency, error-rate, and minimum throughput.
- Database analysis captures top statements and explain plans for key query patterns.
- Redis analysis captures INFO snapshots and benchmark output for critical command patterns.
