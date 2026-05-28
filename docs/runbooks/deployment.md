# Deployment Runbook

## Purpose

Safely deploy MedFinance Analytics frontend, backend, database migrations, and supporting infrastructure changes to staging and production while preserving rollback paths and audit evidence.

## Preconditions

- Pull request approved and merged according to branch-protection policy.
- CI checks passed for backend, frontend, migrations, security gates, and evidence gates.
- Release notes include user impact, migration impact, and rollback plan.
- Deployment window approved for production changes that include database migrations or security-sensitive behavior.
- Secrets and environment variables are already present in the deployment platform.

## Deployment Risk Classification

| Risk | Examples | Approval |
|---|---|---|
| Low | Documentation, UI copy, non-critical dashboard styling | Engineering reviewer |
| Medium | API logic, observability, cache behavior, non-destructive migrations | Tech lead + SRE |
| High | Auth, billing, tenant isolation, destructive migrations, secret rotation | Tech lead + SRE + Security/Compliance |

## Staging Deployment

1. Confirm the target commit.

```bash
git rev-parse HEAD
git status --short
```

2. Build and run local validation when applicable.

```bash
npm run typecheck --workspace=apps/backend
npm run test --workspace=apps/backend
npm run typecheck --workspace=apps/frontend
```

3. Deploy to staging using the approved deployment mechanism.

```bash
# Example: platform-specific deploy script
ENVIRONMENT=staging RELEASE_SHA=<release-sha> ./infrastructure/scripts/deploy.sh
```

4. Run database migrations in staging if the release includes migrations.

```bash
ENVIRONMENT=staging ./infrastructure/scripts/migrate.sh
```

5. Validate staging health.

```bash
curl -fsS https://<staging-api-host>/api/v1/health/live
curl -fsS https://<staging-api-host>/api/v1/health/ready
curl -fsS https://<staging-api-host>/api/v1/health/metrics | head
```

6. Run smoke tests.

```bash
npm run test:integration --workspace=apps/backend
npm run test --workspace=apps/frontend
```

7. Verify dashboards and logs.

- API p95 latency within expected staging baseline.
- Error rate below alert threshold.
- No new authentication, CSRF, database, Redis, or billing errors.
- No PHI or secrets visible in logs.

## Production Deployment

1. Announce deployment start.

```text
Deploying MedFinance Analytics <release-sha> to production.
Expected impact: <none/degraded window>.
Rollback plan: <previous-release-sha>.
```

2. Confirm production readiness gates.

- Staging validation completed.
- Migration plan reviewed.
- Rollback plan reviewed.
- On-call engineer available.
- Database owner available for high-risk migrations.

3. Deploy backend first for backward-compatible API changes.

```bash
ENVIRONMENT=production RELEASE_SHA=<release-sha> ./infrastructure/scripts/deploy.sh backend
```

4. Apply migrations only after backend compatibility is confirmed.

```bash
ENVIRONMENT=production ./infrastructure/scripts/migrate.sh
```

5. Deploy frontend after API is healthy.

```bash
ENVIRONMENT=production RELEASE_SHA=<release-sha> ./infrastructure/scripts/deploy.sh frontend
```

6. Validate production health.

```bash
curl -fsS https://<prod-api-host>/api/v1/health/live
curl -fsS https://<prod-api-host>/api/v1/health/ready
curl -fsS https://<prod-api-host>/api/v1/health/metrics | head
```

7. Monitor for at least 30 minutes after production deployment.

- HTTP 5xx rate
- API p95/p99 latency
- PostgreSQL connection usage and slow queries
- Redis latency/error rate
- Auth failures and CSRF errors
- Billing webhook errors
- Frontend error reports

## Escalation

Escalate immediately to the incident commander if:

- Readiness check fails for more than 5 minutes.
- 5xx rate exceeds SLO threshold.
- Login, billing, tenant isolation, or compliance pages are impacted.
- Migration fails or partially applies.
- Any suspected PHI or financial-data exposure occurs.
