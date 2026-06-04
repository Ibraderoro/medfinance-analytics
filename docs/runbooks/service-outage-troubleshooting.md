# Service Outage Troubleshooting Runbook

## Purpose

Diagnose and restore production service outages affecting frontend, backend API, PostgreSQL, Redis, or ingress/load balancing.

## Triage Flow

```text
User impact reported
  -> Check frontend availability
  -> Check API live/ready
  -> Check recent deploys/config changes
  -> Check PostgreSQL and Redis
  -> Check logs/metrics/traces
  -> Mitigate: rollback, restart, scale, failover, disable feature
```

## Step 1: Confirm Scope

```bash
curl -I https://<prod-frontend-host>/
curl -sS https://<prod-api-host>/api/v1/health/live | jq .
curl -sS https://<prod-api-host>/api/v1/health/ready | jq .
```

Questions:

- Is the outage global or tenant-specific?
- Is frontend reachable but API failing?
- Are only authenticated endpoints failing?
- Did a deploy or config change occur recently?

## Step 2: Inspect Backend Logs

```bash
# Docker/local example
docker compose logs --tail=300 backend

# Platform example
<platform-cli> logs <backend-service> --since 30m
```

Look for:

- Database connection failures
- Redis connection failures
- JWT/CSRF spikes
- 5xx stack traces
- Migration errors
- Memory or timeout errors

## Step 3: Check Dependencies

```bash
psql "$DATABASE_URL" -c 'SELECT 1;'
redis-cli -u <redis-url> PING
```

## Step 4: Check Resource Saturation

```bash
docker stats --no-stream
curl -fsS http://<prometheus-host>/api/v1/query?query=histogram_quantile(0.95,sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le))
```

## Common Mitigations

| Symptom | Mitigation |
|---|---|
| New release caused outage | Roll back backend/frontend. |
| DB unavailable | Escalate to DB recovery runbook. |
| Redis unavailable | Escalate to Redis recovery runbook. |
| CPU/memory saturated | Scale service, restart leaking instances, or reduce traffic. |
| Auth-only outage | Check JWT secrets, cookie settings, CSRF changes, Redis denylist. |
| Billing webhook failure | Verify Stripe signatures, queue/dedup keys, and recent billing deploys. |

## Escalation

- Sev1 if global outage or login unavailable.
- Security if auth, tenant isolation, or data exposure is suspected.
- Database owner if DB integrity or migration state is uncertain.
