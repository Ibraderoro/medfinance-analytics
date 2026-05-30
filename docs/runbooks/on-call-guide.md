# On-call Operational Guide

## Purpose

Define expectations, common commands, escalation paths, and handoff practices for MedFinance Analytics on-call engineers.

## On-call Expectations

- Acknowledge Sev1 pages within 5 minutes and Sev2 pages within 15 minutes.
- Start or join the incident channel for Sev1/Sev2 issues.
- Prioritize customer-data protection and service restoration.
- Escalate early when incident scope is unclear.
- Keep a timestamped timeline for significant events.

## Daily Checks

```bash
curl -fsS https://<prod-api-host>/api/v1/health/ready
curl -fsS https://<prod-api-host>/api/v1/internal/observability/metrics | head
```

Review:

- Overnight alerts
- Failed deployments
- Error-rate and latency dashboards
- Database backup status
- Redis memory and eviction status
- Security/auth anomaly alerts

## Common Commands

```bash
# Recent logs
<platform-cli> logs <backend-service> --since 30m

# Local compose diagnostics
docker compose ps
docker compose logs --tail=200 backend

# Dependency checks
psql "$DATABASE_URL" -c 'SELECT 1;'
redis-cli -u <redis-url> PING

# Recent commits
git log --oneline -n 10
```

## Escalation Matrix

| Situation | Escalate to |
|---|---|
| Global outage | Incident commander + SRE lead |
| Database restore or schema uncertainty | Database owner |
| Redis outage impacting auth/rate limits | SRE lead + security if denylist impacted |
| Suspected PHI/data exposure | Security lead + compliance + legal process |
| Billing/payment inconsistency | Billing owner + customer success |
| CI/CD platform outage | SRE lead |

## Handoff Template

```text
Current severity: Sev<1/2/3>
Incident channel: <link>
Customer impact: <summary>
Current hypothesis: <summary>
Actions taken: <bullets>
Current metrics: <latency/error/readiness>
Open risks: <bullets>
Next recommended action: <owner + action>
```

## After-hours Guidance

- Do not perform destructive database operations alone.
- Do not rotate production secrets without another approver unless credentials are actively compromised.
- Do not disable security controls without security approval, except for emergency containment directed by incident commander.
- Prefer rollback over risky forward fixes during active Sev1 incidents.
