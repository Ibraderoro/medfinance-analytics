# Health Check Debugging Runbook

## Purpose

Debug liveness, readiness, and metrics endpoints used by load balancers, orchestrators, monitoring, and deployment gates.

## Endpoint Semantics

| Endpoint | Purpose | Expected success |
|---|---|---|
| `/api/v1/health/live` | Process liveness | Backend process can serve HTTP. |
| `/api/v1/health/ready` | Dependency readiness | Backend, PostgreSQL, Redis, and shutdown state are healthy. |
| `/api/v1/health/metrics` | Prometheus metrics | Text exposition format returned. |
| `/api/v1/health/metrics/summary` | JSON metrics snapshot | Runtime metrics returned. |

## Debug Commands

```bash
curl -v https://<prod-api-host>/api/v1/health/live
curl -v https://<prod-api-host>/api/v1/health/ready
curl -v https://<prod-api-host>/api/v1/health/metrics | head -40
```

## Readiness Failure Matrix

| Failed check | Likely cause | Next step |
|---|---|---|
| `server: draining` | App is shutting down or deployment is replacing instance | Confirm deploy status and wait for replacement. |
| `postgres: error` | DB unavailable, credentials wrong, network issue, pool exhausted | Use database recovery runbook. |
| `redis: error` | Redis unavailable, auth/TLS issue, network issue | Use Redis recovery runbook. |
| HTTP timeout | App event loop blocked, CPU saturation, ingress issue | Check logs, CPU, memory, and recent deploys. |

## Container Health Debugging

```bash
docker compose ps
docker inspect --format='{{json .State.Health}}' medfinance-analytics-backend-1 | jq .
docker compose logs --tail=200 backend
```

## Prometheus Scrape Debugging

```bash
curl -fsS http://<prometheus-host>/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health, lastError: .lastError}'
```

## Escalation

Escalate if readiness fails for more than one deployment interval or causes load balancer removal of all healthy instances.
