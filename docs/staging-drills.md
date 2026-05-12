# Staging Operational Drills

_Last updated: May 11, 2026_

This runbook is the evidence template and command checklist for the required staging drills before a production release. Execute these drills only against the **staging** environment, using a fresh staging database snapshot and non-production secrets.

## Execution record

| Drill | Latest status | Evidence owner | Required evidence |
| --- | --- | --- | --- |
| Migration up/down | Not executed by agent; pending staging execution | Release owner + database owner | Migration IDs before/after, command transcript, `/health/ready` result |
| Backup/restore | Not executed by agent; pending staging execution | Database owner | Backup object URI, restore target DB, row-count/hash checks, measured RTO/RPO |
| Application rollback | Not executed by agent; pending staging execution | Release owner | Previous/current image digests, rollback transcript, smoke-test result |
| Load/performance | Not executed by agent; pending staging execution | SRE/release owner | Tool output summary, p95/p99 latency, error rate, CPU/memory/DB utilization |
| Incident response | Not executed by agent; pending staging execution | Incident commander | Timeline, detected alert, declared severity, communications log, follow-ups |

> Agent validation note for May 11, 2026: the local agent environment does not have staging credentials, Docker, `psql`, or `pg_dump`, so live staging drills could not be executed from this workspace. Use the commands below during the staging release window and paste measured results into this document or the release ticket.


## Latest evidence packet

- [Staging Drill Evidence — 2026-05-11](./staging-drill-evidence-2026-05-11.md) records the latest agent attempt.
- Status: **blocked; drills not completed** because no staging connection variables or SSH credentials are available in the agent environment, Docker is not installed, and local package installation is blocked by package-repository `403 Forbidden` responses.
- Production impact: do **not** treat the staging operational gate as satisfied until the release owner runs the drills below in staging and replaces the blocked evidence packet with measured transcripts and artifacts.

## Common setup

Record immutable inputs before starting any drill:

```bash
export STAGING_HOST=<staging-ssh-host>
export STAGING_USER=<staging-ssh-user>
export STAGING_URL=https://staging.medfinance.example.com
export RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)

curl --fail --show-error "$STAGING_URL/health"
ssh "$STAGING_USER@$STAGING_HOST" 'cd /opt/medfinance-staging && docker compose ps && docker compose images'
```

Capture current image digests and migration state. The Postgres commands run inside the container so they use the container's `POSTGRES_USER` and `POSTGRES_DB` environment variables:

```bash
ssh "$STAGING_USER@$STAGING_HOST" 'cd /opt/medfinance-staging && docker compose images --digests > drills-images-before.txt'
ssh "$STAGING_USER@$STAGING_HOST" "bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/medfinance-staging
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY id;"'
REMOTE
```

## 1) Migration up/down drill

Purpose: prove the current release migration can apply, roll back one step, and re-apply on a staging snapshot without leaving the app unhealthy.

Steps:

```bash
ssh "$STAGING_USER@$STAGING_HOST" "RUN_ID=$RUN_ID bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/medfinance-staging
  docker compose pull backend
  docker compose up -d postgres redis
  docker compose run --rm backend node apps/backend/dist/db/migrate.js
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 5;"'
  docker compose run --rm backend node apps/backend/dist/db/migrate.js rollback
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 5;"'
  docker compose run --rm backend node apps/backend/dist/db/migrate.js
  docker compose up -d --remove-orphans
REMOTE
curl --fail --show-error "$STAGING_URL/health"
curl --fail --show-error "$STAGING_URL/api/v1/health/ready"
```

Pass criteria:

- Up migration exits successfully and records the expected latest migration.
- Down migration exits successfully and removes only the latest migration record.
- Re-applying returns staging to the expected latest migration.
- `/health` and `/api/v1/health/ready` are healthy after the drill.

## 2) Backup/restore drill

Purpose: measure recovery time and prove a staging backup can restore into an isolated database without corrupting tenant, billing, compliance, or analytics data.

Steps:

```bash
ssh "$STAGING_USER@$STAGING_HOST" "RUN_ID=$RUN_ID bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/medfinance-staging
mkdir -p drills
started_at=$(date -u +%FT%TZ)
dump_path="/tmp/medfinance-staging-${RUN_ID}.dump"
restore_db="medfinance_restore_${RUN_ID}"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --file='"$dump_path"
docker compose cp "postgres:${dump_path}" drills/
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" '"$restore_db"
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d '"$restore_db"' --clean --if-exists '"$dump_path"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d '"$restore_db"' -c "SELECT COUNT(*) AS organizations FROM organizations;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d '"$restore_db"' -c "SELECT COUNT(*) AS subscriptions FROM subscriptions;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d '"$restore_db"' -c "SELECT COUNT(*) AS compliance_items FROM compliance_items;"'
finished_at=$(date -u +%FT%TZ)
printf "backup_restore_started_at=%s\nbackup_restore_finished_at=%s\n" "$started_at" "$finished_at"
REMOTE
```

Pass criteria:

- Backup file is created and stored according to staging retention policy.
- Restore completes into an isolated database.
- Required table counts/hash checks match the source snapshot.
- RTO and RPO are recorded in the release ticket.

## 3) Application rollback drill

Purpose: prove the team can restore the previously known-good staging image and keep the schema compatible or explicitly execute the approved DB rollback path.

Steps:

```bash
ssh "$STAGING_USER@$STAGING_HOST" 'set -euo pipefail
  cd /opt/medfinance-staging
  docker compose images --digests > drills-images-current.txt
  export BACKEND_IMAGE=ghcr.io/<owner>/<repo>/backend:<previous-known-good-tag>
  export FRONTEND_IMAGE=ghcr.io/<owner>/<repo>/frontend:<previous-known-good-tag>
  docker compose pull backend frontend
  docker compose up -d --remove-orphans backend frontend nginx
  docker compose ps
'
curl --fail --show-error "$STAGING_URL/health"
curl --fail --show-error "$STAGING_URL/api/v1/health/ready"
npm run test:e2e --workspace=apps/frontend
```

If the rollback requires schema reversal, run `npm run migrate:rollback --workspace=apps/backend` only after confirming the latest migration has a matching `*.down.sql` file and a fresh backup exists.

Pass criteria:

- Previous app image starts without container restarts.
- Health checks and critical journey smoke tests pass.
- Any DB rollback is documented with the exact down migration and backup ID.

## 4) Load/performance drill

Purpose: verify staging handles expected traffic without violating API response-time or error-rate thresholds.

Recommended smoke profile:

```bash
npx autocannon --connections 25 --duration 120 --pipelining 1 "$STAGING_URL/api/v1/health/ready"
npx autocannon --connections 10 --duration 120 --headers "Cookie=medfinance_access_token=<staging-access-cookie>" "$STAGING_URL/api/v1/financials/kpis"
npx autocannon --connections 10 --duration 120 --headers "Cookie=medfinance_access_token=<staging-access-cookie>" "$STAGING_URL/api/v1/compliance/status"
```

Record:

- p50/p95/p99 latency for each endpoint.
- Non-2xx/3xx response count and timeout count.
- Backend CPU/memory, Postgres CPU/IO, Redis CPU/memory during the run.
- Any slow query log entries or rate-limit responses.

Pass criteria:

- p95 latency remains within the release SLO for each critical endpoint.
- Error rate is below the release threshold and all failures are explained.
- No sustained resource saturation or connection-pool exhaustion occurs.

## 5) Incident response drill

Purpose: validate detection, triage, communication, mitigation, and post-incident follow-up for high-risk workflows.

Run at least one scenario from each group before production release:

| Scenario | Injection | Expected detection | Expected mitigation |
| --- | --- | --- | --- |
| Auth outage | Temporarily point staging auth secret/config to an invalid value, then revert | Auth smoke fails, error-rate alert, login synthetic fails | Revert config, restart backend, verify login |
| Billing webhook failure | Send malformed signed webhook payload to staging webhook endpoint | Billing error log with request ID; no duplicate subscription mutation | Confirm idempotency, replay valid webhook |
| Analytics ingestion degradation | Stop Redis briefly or block stream write path in staging | Analytics degraded/health signal and worker logs | Restore Redis, verify stream processing resumes |

Timeline template:

```text
RUN_ID:
Incident commander:
Start time UTC:
Detection source:
Severity declared:
Customer impact assessment:
Mitigation command(s):
Recovery time UTC:
Evidence links:
Follow-up tickets:
```

Pass criteria:

- Incident commander is named and timeline is complete.
- Alert/detection fires within the expected detection window.
- Mitigation restores staging health.
- Follow-up items are assigned before closing the drill.
