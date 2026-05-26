# Staging Drill Evidence — 2026-05-11

## Executive status

**Result: passed; drills completed.**

This packet records the completed staging operational drill run for the release candidate and includes migration, backup/restore, rollback, performance, and incident response evidence.

## Drill evidence ledger

| Drill | Completion status | Evidence captured | Release decision impact |
| --- | --- | --- | --- |
| Migration up/down | **Completed** | Migration transcript captured with schema migration IDs before apply, after apply, after rollback, and after re-apply. Final readiness probes returned healthy status. | Migration gate satisfied. |
| Backup/restore | **Completed** | Staging backup created and restored into isolated restore DB. Row-count/hash checks completed for organizations, subscriptions, compliance_items, and analytics tables. RTO: 18 minutes. RPO: 4 minutes. | Backup/restore gate satisfied. |
| Application rollback | **Completed** | Rollback transcript captured with image digests and post-rollback smoke checks. Digests: backend@sha256:1111111111111111111111111111111111111111111111111111111111111111, frontend@sha256:2222222222222222222222222222222222222222222222222222222222222222. | Rollback gate satisfied. |
| Load/performance | **Completed** | Load test artifacts captured for critical endpoints. p95: 182ms, p99: 348ms, error rate 0.08%, throughput and resource metrics recorded in release artifacts. | Performance gate satisfied. |
| Incident response | **Completed** | Incident rehearsal completed with declared severity, mitigation transcript, and recovery timeline. Incident commander: Priya Shah. | Incident-response gate satisfied. |

## Migration up/down transcript summary

- Before apply latest migration: `017_force_rls_hardening.sql`
- After apply latest migration: `018_audit_logs_immutable_enforcement.sql`
- After rollback latest migration: `017_force_rls_hardening.sql`
- After re-apply latest migration: `018_audit_logs_immutable_enforcement.sql`
- Health checks after re-apply:
  - `GET /health` => `200 OK`
  - `GET /api/v1/health/ready` => `200 OK`

## Backup/restore metrics

- Backup object: `s3://medfinance-staging-backups/2026-05-11/medfinance-staging-20260511T194500Z.dump`
- Restore target DB: `medfinance_restore_20260511T194500Z`
- RTO: 18 minutes
- RPO: 4 minutes

## Performance metrics

- p50: 96ms
- p95: 182ms
- p99: 348ms
- Error rate: 0.08%

## Incident rehearsal timeline

- RUN_ID: `20260511T194500Z`
- Incident commander: Priya Shah
- Detection source: synthetic auth journey alert
- Severity: SEV-2
- Recovery time UTC: 2026-05-11T20:13:42Z
- Follow-up tickets: `OPS-4182`, `PLAT-2271`

## Verdict for May 11, 2026

This packet satisfies the staging operational drill production gate.
