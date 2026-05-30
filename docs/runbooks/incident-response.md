# Incident Response Runbook

## Purpose

Coordinate fast, safe, and auditable response to production incidents affecting availability, integrity, confidentiality, compliance, or customer trust.

## Severity Levels

| Severity | Definition | Response target | Examples |
|---|---|---|---|
| Sev1 | Critical production impact or suspected data exposure | 5 minutes | Full outage, tenant isolation failure, PHI exposure, billing corruption |
| Sev2 | Major feature degradation or elevated errors | 15 minutes | Login degraded, compliance dashboard unavailable, sustained high latency |
| Sev3 | Minor degradation with workaround | 1 business hour | Single endpoint slow, non-critical dashboard issue |
| Sev4 | Informational / follow-up | Next business day | Documentation issue, low-priority alert |

## Roles

| Role | Responsibilities |
|---|---|
| Incident Commander | Owns coordination, severity, timeline, and decisions. |
| Technical Lead | Drives diagnosis and remediation. |
| Communications Lead | Publishes internal/customer updates. |
| Scribe | Records timeline, commands, links, and decisions. |
| Security Lead | Leads suspected data exposure, auth, or abuse incidents. |

## First 10 Minutes

1. Acknowledge page and create incident channel.
2. Assign incident commander and scribe.
3. State impact hypothesis and severity.
4. Capture current release SHA and dashboards.
5. Check health endpoints.

```bash
curl -sS https://<prod-api-host>/api/v1/health/live | jq .
curl -sS https://<prod-api-host>/api/v1/health/ready | jq .
```

6. Check recent deploys.

```bash
git log --oneline -n 5
```

## Containment

- Roll back recent deployment if symptoms correlate strongly with release.
- Disable affected feature flag if available.
- Scale API or workers if resource saturation is confirmed.
- Block abusive traffic at WAF/load balancer if attack is suspected.
- Freeze writes if data integrity is at risk.

## Communication Cadence

| Severity | Internal updates | Customer/status updates |
|---|---|---|
| Sev1 | Every 10 minutes | Every 15-30 minutes or per policy |
| Sev2 | Every 30 minutes | As customer impact warrants |
| Sev3 | At material changes | Usually not required |

## Security / Compliance Escalation

Escalate immediately if:

- PHI, financial records, credentials, tokens, or audit logs may be exposed.
- Tenant isolation may have failed.
- Unauthorized access is suspected.
- Audit logs are missing, altered, or inaccessible.

## Resolution Criteria

- Health checks pass.
- Error rate and latency return to baseline.
- Critical workflows validated.
- No active data-integrity or security concern remains.
- Incident commander announces resolution.

## Post-Incident Review

Within 3 business days for Sev1/Sev2:

- Timeline
- Customer impact
- Root cause
- Detection gaps
- What went well / poorly
- Corrective actions with owners and due dates
- Evidence links: dashboards, logs, release SHAs, commands
