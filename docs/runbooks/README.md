# Production Runbooks

This directory contains operational runbooks for MedFinance Analytics production and staging environments. These runbooks are intended for SRE, DevOps, engineering, security, and incident-response teams operating the backend API, frontend, PostgreSQL, Redis, observability stack, and CI/CD pipeline.

> **Important:** Commands use placeholders such as `<service>`, `<environment>`, `<render-service>`, `<database-url>`, and `<release-sha>`. Replace them with environment-specific values from the approved secrets manager, deployment platform, or incident channel. Do not paste secrets into tickets, chat, or shell history.

## Runbook Index

| Runbook | Purpose |
|---|---|
| [Deployment Runbook](./deployment.md) | Controlled staging and production deployment procedure. |
| [Rollback Procedures](./rollback.md) | Application, migration, frontend, and configuration rollback guidance. |
| [Database Recovery](./database-recovery.md) | PostgreSQL backup, PITR, restore, and validation workflow. |
| [Redis Recovery](./redis-recovery.md) | Redis degradation, cache rebuild, and rate-limit/session-impact handling. |
| [Incident Response](./incident-response.md) | Severity model, roles, communications, containment, and postmortems. |
| [Service Outage Troubleshooting](./service-outage-troubleshooting.md) | API/frontend outage triage and dependency checks. |
| [Health Check Debugging](./health-check-debugging.md) | `/health/live`, `/health/ready`, and metrics endpoint investigation. |
| [CI/CD Failure Troubleshooting](./cicd-failure-troubleshooting.md) | Build, test, migration, image, and deploy failure remediation. |
| [High Latency Investigation](./high-latency-investigation.md) | API, database, Redis, frontend, and container latency triage. |
| [Production Checklist](./production-checklist.md) | Pre-release and steady-state production readiness checklist. |
| [On-call Operational Guide](./on-call-guide.md) | On-call expectations, escalation, handoff, and common commands. |

## Standard Incident Channels

- **Incident command:** `#incident-<date>-<short-description>`
- **Engineering escalation:** `#eng-platform`
- **Security escalation:** `#security-incident`
- **Customer communications:** customer-success or support-owned channel
- **Change log:** deployment platform release notes and incident timeline

## Baseline Commands

```bash
# Repository checks
npm run typecheck --workspace=apps/backend
npm run test --workspace=apps/backend
npm run typecheck --workspace=apps/frontend

# Local container topology
docker compose ps
docker compose logs --tail=200 backend
docker compose logs --tail=200 postgres
docker compose logs --tail=200 redis

# Health checks
curl -fsS http://localhost:3001/api/v1/health/live
curl -fsS http://localhost:3001/api/v1/health/ready
curl -fsS http://localhost:3001/api/v1/health/metrics
```

## Operational Principles

1. **Protect customer data first.** If there is any suspected PHI or financial-data exposure, escalate to Security/Compliance immediately.
2. **Prefer reversible changes.** Avoid destructive operations unless approved by the incident commander and database owner.
3. **Use evidence-based decisions.** Capture timestamps, release SHAs, dashboards, logs, and command outputs.
4. **Communicate early.** Acknowledge pages quickly and publish status updates at severity-appropriate intervals.
5. **Document follow-ups.** Every Sev1/Sev2 incident should produce action items with owners and due dates.

- [Database migrations](database-migrations.md)
- [Production deployment](production-deployment.md)
