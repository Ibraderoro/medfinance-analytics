# Redis Recovery Runbook

## Purpose

Restore Redis-dependent functionality including cache, rate limiting, auth abuse counters, refresh-token denylist, analytics streams, and health checks.

## Redis Responsibilities

Redis is used for:

- Cache entries for read-heavy financial and compliance workflows.
- Rate limiting and brute-force protection counters.
- Refresh-token revocation/denylist state.
- Analytics stream buffering and worker coordination.
- BullMQ job queue state and scheduling (Stripe webhook processing, analytics telemetry persistence, and analytics retention — see [Queue / Worker Recovery](./queue-worker-recovery.md)).
- Readiness checks.

**Important:** unlike cache data, BullMQ queue state is not merely a performance optimization — a Redis flush or data loss also destroys any in-flight or waiting jobs (queued webhook events not yet processed, pending analytics batches). This is a materially different risk profile than the rest of Redis's cache-only usage; do not treat a Redis flush as "safe, cache will just rebuild" without also checking for queue backlog first.

## Symptoms

- `/api/v1/health/ready` reports `redis: error`.
- Elevated login failures or rate limiter errors.
- Cache miss surge and PostgreSQL load increase.
- Analytics worker warnings about stream reads/writes.
- Increased API latency due to fallback paths.
- `worker` process `/ready` reporting `queueRedis: error`, or growing `queue_depth_current`/`queue_job_dead_letter_total` (see [Queue / Worker Recovery](./queue-worker-recovery.md)).

## Immediate Triage

```bash
curl -sS https://<prod-api-host>/api/v1/health/ready | jq .
redis-cli -u <redis-url> PING
redis-cli -u <redis-url> INFO server
redis-cli -u <redis-url> INFO memory
redis-cli -u <redis-url> INFO stats
```

## Recovery Procedures

### Path A: Redis Unavailable

1. Check provider status and network access.
2. Confirm credentials and TLS settings.
3. Restart Redis service only if provider/runbook permits.
4. Restart backend instances after Redis recovers if clients do not reconnect.

```bash
docker compose restart redis backend
```

### Path B: Memory Pressure

1. Inspect memory usage and key counts.

```bash
redis-cli -u <redis-url> INFO memory
redis-cli -u <redis-url> DBSIZE
```

2. Identify large namespaces.

```bash
redis-cli -u <redis-url> --scan --pattern 'medfinance:*' | head -100
```

3. Prefer namespace/tenant-specific deletion over full flush.

```bash
redis-cli -u <redis-url> --scan --pattern 'medfinance:financials:<tenant-id>:*' \
  | xargs -r redis-cli -u <redis-url> DEL
```

### Path C: Stale or Corrupt Cache

1. Confirm source-of-truth data in PostgreSQL.
2. Delete only affected cache keys.
3. Let cache-aside loaders rebuild values.
4. Monitor DB load during rebuild.

### Path D: Analytics Stream Backlog

```bash
redis-cli -u <redis-url> XLEN api_telemetry_stream
redis-cli -u <redis-url> XINFO GROUPS api_telemetry_stream
```

If backlog grows:

1. Confirm worker process is running.
2. Restart analytics worker/backend if needed.
3. Scale worker consumers if backlog persists.
4. Archive or trim stream only after data-loss approval.

## Security Considerations

- Redis may contain sensitive derived data and token denylist entries.
- Do not export raw Redis dumps into unsecured locations.
- Avoid `FLUSHALL` unless incident commander and security approve.

## Escalation

Escalate to:

- SRE lead if Redis outage exceeds 5 minutes.
- Security if refresh-token denylist integrity is compromised.
- Database owner if Redis outage causes database overload.
