# Scalability Readiness Review (Incremental)

## Current Bottlenecks

1. **Mixed sync/async request paths**
   - Most domain work is inline in request lifecycle; spikes can increase API latency.
2. **Pagination inconsistency**
   - Some endpoints return unbounded arrays; this increases DB and response pressure.
3. **Cache strategy not centralized enough**
   - Caching exists but policy (TTL, key patterns, invalidation) is not uniformly defined by domain.
4. **Webhook reliability gaps**
   - Webhooks are deduped but not fully retried via durable job semantics.
5. **DB read pressure risk**
   - Dashboard-style reads can grow faster than write volume.

## Incremental Architecture Improvements

### 1) Caching strategy
- Use **cache-aside** for read-heavy, eventually consistent endpoints.
- Standardize key names: `medfinance:{domain}:{tenant}:{shape}:{paramsHash}`.
- Use TTL jitter (e.g., ±10%) to avoid synchronized cache expiry storms.
- Invalidate by tenant-scoped patterns during write events.

### 2) Redis caching abstraction
- Keep `CacheService` as the default cache adapter.
- Introduce domain wrappers per bounded context (financials, compliance, forecasting) to avoid ad hoc keys.
- Keep loader de-duplication (`getOrLoad`) to prevent stampedes.

### 3) Queue/job architecture
- Continue using Redis Streams for async telemetry as a proven pattern.
- Extend stream-worker model for:
  - webhook retries,
  - report generation,
  - non-blocking notification tasks.
- Use consumer groups with explicit ack and dead-letter stream after max retries.

### 4) Horizontal scaling readiness
- API remains stateless (JWT + Redis + Postgres) and can scale behind L7 load balancer.
- Ensure per-pod config parity and no in-memory-only critical state.
- Keep rate limit and auth abuse counters in Redis (already centralized).

### 5) API pagination standards
- Adopt standard response shape:
  - `data: []`
  - `meta: { page, limit, total, totalPages, hasNextPage, hasPreviousPage }`
- Enforce pagination defaults and max limits at validator/controller layer.

### 6) Database/index strategy
- Ensure index coverage for dominant access paths:
  - tenant + time (`organization_id`, `created_at DESC`),
  - tenant + severity/due date for alerts,
  - tenant + performed_at for audit logs.
- Prefer composite indexes that match WHERE + ORDER BY in hot queries.

### 7) Connection pooling
- Keep pool sizes env-configurable and tuned per runtime (CPU cores and DB limits).
- Add dashboard alerts for pool saturation and slow query percentiles.

### 8) Load balancing assumptions
- L7 load balancer with health checks on `/api/v1/health/ready`.
- Use least-connections or round-robin; both valid since service is stateless.
- Keep graceful shutdown so in-flight requests drain before pod termination.

### 9) Webhook retry architecture (design)
- Receiver endpoint should:
  1. verify signature,
  2. persist event id + payload hash,
  3. enqueue processing job,
  4. return quickly.
- Worker should retry with exponential backoff and idempotency keys.
- Failed jobs after max attempts go to dead-letter stream for operator replay.

## Tradeoffs

- **More caching**: lowers latency and DB load but increases invalidation complexity.
- **More async work**: improves p95 latency but adds eventual consistency windows.
- **More indexes**: faster reads but higher write overhead and storage footprint.
- **Stricter pagination**: protects system but may require client-side UX changes for large exports.

## Next suggested implementation steps
1. Extend pagination standard to financial/compliance list endpoints.
2. Add tenant+severity+due-date and tenant+performed_at composite indexes where missing.
3. Introduce `webhook_jobs` stream worker with retry/dead-letter.
4. Add pool and queue depth dashboards/alerts.
