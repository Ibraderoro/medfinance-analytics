# High Latency Investigation Runbook

## Purpose

Diagnose and mitigate elevated API, frontend, database, Redis, or container latency.

## Initial Triage

```bash
curl -w '\nstatus=%{http_code} total=%{time_total} connect=%{time_connect} ttfb=%{time_starttransfer}\n' \
  -o /dev/null -sS https://<prod-api-host>/api/v1/health/ready
```

Check dashboards:

- `http_request_duration_p95_ms`
- `db_query_duration_p95_ms`
- `redis_operation_duration_p95_ms`
- HTTP error rate
- Container CPU/memory
- PostgreSQL connections and locks

## API Latency

```bash
curl -fsS https://<prod-api-host>/api/v1/health/metrics | grep -E 'http_request_duration|http_error_rate'
```

Investigate:

- Recent deploys
- Slow endpoints
- Request volume spikes
- Auth/rate-limit errors
- Payload size changes

## Database Latency

```sql
SELECT pid, state, wait_event_type, wait_event, now() - query_start AS age, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY age DESC
LIMIT 20;
```

Mitigations:

- Add or verify indexes for hot query paths.
- Reduce request volume with rate limits or feature throttles.
- Temporarily disable expensive dashboards if available.
- Scale database or add read replica as a planned follow-up.

## Redis Latency

```bash
redis-cli -u <redis-url> INFO stats
redis-cli -u <redis-url> LATENCY LATEST
redis-cli -u <redis-url> SLOWLOG GET 10
```

Mitigations:

- Remove oversized keys.
- Avoid broad `SCAN`/delete during peak traffic.
- Scale Redis tier if CPU/network is saturated.
- Review cache TTL and stampede patterns.

## Frontend Latency

Check:

- Bundle size and asset cache headers.
- API waterfall in browser devtools.
- Chart rendering time and data cardinality.
- CDN or edge cache status.

## Escalation

Escalate if:

- p95 latency exceeds SLO for 15 minutes.
- DB lock contention affects writes.
- Redis latency breaks auth/rate limiting.
- Latency correlates with suspected abuse or data exfiltration.
