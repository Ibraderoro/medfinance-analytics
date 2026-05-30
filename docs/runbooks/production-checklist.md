# Production Checklist

## Pre-Deployment Checklist

- [ ] Release SHA and changelog reviewed.
- [ ] CI passed for backend, frontend, tests, lint/typecheck, and migration checks.
- [ ] Database migrations reviewed for locks, reversibility, and runtime impact.
- [ ] Rollback procedure identified and tested where practical.
- [ ] Secrets/config changes reviewed and staged.
- [ ] Observability dashboards and alerts available.
- [ ] On-call engineer and escalation contacts confirmed.
- [ ] Customer-impacting changes communicated if required.

## Security Checklist

- [ ] Production uses HTTPS-only origins.
- [ ] JWT and refresh-token secrets are unique and stored in a secrets manager.
- [ ] Database and Redis use encrypted connections where supported.
- [ ] Admin and production access require MFA.
- [ ] Audit logging is enabled and reviewable.
- [ ] No PHI/secrets are emitted in logs, traces, metrics, or screenshots.

## Reliability Checklist

- [ ] `/api/v1/health/live` passes.
- [ ] `/api/v1/health/ready` passes.
- [ ] PostgreSQL backup schedule confirmed.
- [ ] Restore drill evidence is current.
- [ ] Redis memory, eviction, and persistence posture reviewed.
- [ ] API p95/p99 latency within baseline.
- [ ] Error-rate alerts configured.

## Data Checklist

- [ ] Migration completed successfully.
- [ ] Tenant isolation checks current.
- [ ] Audit log writes verified.
- [ ] Billing webhook idempotency verified if billing changed.
- [ ] Data retention policy reviewed for new data classes.

## Post-Deployment Checklist

```bash
curl -fsS https://<prod-api-host>/api/v1/health/live
curl -fsS https://<prod-api-host>/api/v1/health/ready
curl -fsS https://<prod-api-host>/api/v1/health/metrics | head
```

- [ ] Smoke test login.
- [ ] Smoke test dashboard.
- [ ] Smoke test financial summary.
- [ ] Smoke test compliance status.
- [ ] Monitor logs for 30 minutes.
- [ ] Announce deployment completion.
