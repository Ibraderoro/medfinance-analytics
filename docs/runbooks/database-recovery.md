# Database Recovery Runbook

## Purpose

Recover PostgreSQL service after corruption, accidental deletion, failed migration, provider outage, or severe performance degradation.

## Severity Triggers

- PostgreSQL unavailable or readiness reports `postgres: error`.
- Data corruption or accidental deletion suspected.
- Migration failure leaves schema in inconsistent state.
- Connection pool exhaustion causes sustained API outage.
- Recovery point objective (RPO) or recovery time objective (RTO) is at risk.

## Immediate Triage

1. Confirm API readiness.

```bash
curl -sS https://<prod-api-host>/health/ready | jq .
```

2. Check database connectivity.

```bash
psql "$DATABASE_URL" -c 'SELECT now(), current_database(), current_user;'
```

3. Check active connections and blocking queries.

```sql
SELECT pid, usename, state, wait_event_type, wait_event, now() - query_start AS age, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY age DESC
LIMIT 20;
```

4. Check database size and table pressure.

```sql
SELECT relname, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

## Recovery Paths

### Path A: Connection Exhaustion

1. Confirm pool settings and connection count.

```sql
SELECT count(*) FROM pg_stat_activity;
SHOW max_connections;
```

2. Restart only unhealthy app instances if connection leaks are suspected.
3. Temporarily reduce traffic or scale down noisy workers.
4. Escalate to database owner before terminating queries.

```sql
SELECT pg_terminate_backend(<pid>);
```

### Path B: Failed Migration

1. Stop further deploys.
2. Capture migration logs and current schema version.
3. Determine whether rollback is safe or forward-fix is required.
4. Use down migration only after approval.

```bash
DATABASE_URL=<database-url> npm run migrate:rollback --workspace=apps/backend
```

### Path C: Point-in-Time Recovery (PITR)

1. Declare incident and freeze writes if data loss/corruption is suspected.
2. Identify target restore timestamp.
3. Use provider PITR or backup script workflow.

```bash
# Example backup helper; validate provider-specific parameters first
DATABASE_URL=<database-url> ./infrastructure/scripts/postgres-pitr-backup.sh
```

4. Restore to a new database instance first.
5. Validate restored data before cutover.

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM audit_log;
SELECT COUNT(*) FROM financial_transactions;
```

6. Repoint application `DATABASE_URL` only after approval.
7. Validate health and critical user journeys.

## Post-Recovery Validation

```bash
curl -fsS https://<prod-api-host>/health/ready
npm run test:integration --workspace=apps/backend
```

Check:

- Tenant data isolation
- Auth login/refresh
- Financial summaries
- Compliance audit log
- Billing subscription state

## Escalation

Escalate to:

- **Database owner:** restore, query termination, schema rollback.
- **SRE lead:** provider incident, failover, traffic shaping.
- **Security/Compliance:** suspected data corruption, PHI exposure, or audit-log loss.
- **Customer Success:** customer-visible data loss or prolonged outage.
