# Rollback Procedures

## Purpose

Restore service quickly and safely after a bad deployment, configuration change, migration, or frontend release.

## Rollback Decision Criteria

Rollback when any of the following occur and cannot be mitigated within the incident response window:

- Readiness probe fails after deployment.
- User-facing 5xx rate or latency exceeds SLO.
- Authentication, billing, compliance, or tenant isolation is impaired.
- Migration causes data corruption, lock contention, or query failures.
- Security control behaves incorrectly in production.

## Application Rollback

1. Identify last known-good release.

```bash
# Deployment platform or git tag should identify this
git log --oneline -n 10
```

2. Deploy previous backend artifact.

```bash
ENVIRONMENT=production RELEASE_SHA=<previous-good-sha> ./infrastructure/scripts/deploy.sh backend
```

3. Validate backend health.

```bash
curl -fsS https://<prod-api-host>/api/v1/health/ready
```

4. Deploy previous frontend artifact if user experience or API compatibility requires it.

```bash
ENVIRONMENT=production RELEASE_SHA=<previous-good-sha> ./infrastructure/scripts/deploy.sh frontend
```

## Database Migration Rollback

> **Warning:** Do not run down migrations automatically during a Sev1 without database-owner approval. Many schema changes are not safely reversible after writes occur.

1. Stop or reduce write traffic if needed.
2. Confirm migration state.

```bash
DATABASE_URL=<database-url> npm run migrate --workspace=apps/backend -- status
```

3. Review the down migration and data-loss risk.

```bash
sed -n '1,220p' apps/backend/src/db/migrations/<migration>.down.sql
```

4. If approved, run rollback.

```bash
DATABASE_URL=<database-url> npm run migrate:rollback --workspace=apps/backend
```

5. Validate application readiness and key queries.

```bash
curl -fsS https://<prod-api-host>/api/v1/health/ready
```

## Configuration Rollback

1. Identify changed environment variables.
2. Restore previous values from the secrets manager or deployment platform history.
3. Restart affected services.
4. Validate readiness and logs.

```bash
curl -fsS https://<prod-api-host>/api/v1/health/ready
```

## Cache Rollback / Redis Flush

Only flush tenant-scoped or namespace-scoped keys unless all users are impacted.

```bash
# Example: inspect matching keys first
redis-cli -u <redis-url> --scan --pattern 'medfinance:financials:<tenant-id>:*' | head

# Example: delete specific namespace after approval
redis-cli -u <redis-url> --scan --pattern 'medfinance:financials:<tenant-id>:*' \
  | xargs -r redis-cli -u <redis-url> DEL
```

## Communication

- Announce rollback start, expected impact, and owner.
- Update every 10 minutes for Sev1 or every 30 minutes for Sev2.
- Announce completion after health checks and dashboards stabilize.

## Escalation

Escalate to database owner and security lead if rollback involves:

- Schema changes
- Tenant isolation
- Auth/session behavior
- Billing records
- Suspected data exposure
