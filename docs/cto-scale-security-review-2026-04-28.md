# CTO Scale & Security Review (2026-04-28)

## Executive summary

This codebase can support early paid customers, but specific failure modes appear quickly as concurrency and data sensitivity rise. The most urgent issues were around **distributed throttling**, **analytics write amplification**, and **financial-data safety guardrails**.

## What would break under 1,000 users

1. **Rate limiting would be inconsistent across multiple backend instances**.
   - Process-local counters allow users to bypass limits by hitting different instances.
   - Risk: brute-force attempts and noisy-neighbor traffic can spread across pods.

2. **Per-request analytics INSERTs can become a latency multiplier**.
   - Every API response attempts a direct write to `api_request_metrics`.
   - Risk: elevated DB write pressure from operational telemetry competing with customer queries.

3. **Default HTTP socket behavior is not explicitly tuned**.
   - Missing explicit request/header/keepalive timeouts can increase exposure to slow clients.

## What would break under 10,000 users

1. **Database pool saturation risk increases significantly**.
   - Fixed pool sizing (`max=20`) becomes a bottleneck under bursty traffic and live updates.

2. **Observability path can overload primary data path**.
   - Telemetry writes at this scale can flood the primary database unless batched and bounded.

3. **Auth endpoint abuse risk rises**.
   - Auth throttling must be principal-aware and shared globally.

## What would make this unsafe for financial data

1. **Transport security could be disabled by misconfiguration in production**.
   - Financial workloads require secure transport to data stores by default.

2. **Open self-service registration in production is a governance risk**.
   - For paying B2B financial customers, onboarding usually requires controlled provisioning.

3. **Role assignment needed strict runtime validation**.
   - Role inputs must be validated before persistence.

## Upgrades implemented in this change

### 1) Distributed rate limiting with Redis + graceful fallback

- Replaced process-local `express-rate-limit` usage with Redis-backed counters (`INCR` + `PEXPIRE`).
- Added shared rate-limit keying:
  - API: source IP, with authentication state carried by HttpOnly cookies rather than client-managed header tokens
  - Auth: source IP
- Added response headers for limit visibility and fallback to in-memory counters only when Redis is unavailable.

### 2) Batched analytics ingestion to protect primary DB path

- Added in-memory queue + periodic flush loop.
- Added bounded queue with drop-on-overflow behavior and warning logs.
- Added configurable batch size, flush interval, max queue, and sampling rate.
- Added forced flush before admin metrics aggregation for fresher snapshots.

### 3) Production safety hardening for financial workloads

- Added secure-transport guardrail:
  - In production with `REQUIRE_SECURE_TRANSPORT=true`, startup fails if `PG_SSL=false` or `REDIS_TLS=false`.
- Added explicit HTTP timeout tuning:
  - request timeout
  - headers timeout
  - keep-alive timeout
- Added controlled registration toggle:
  - `ALLOW_SELF_SERVICE_REGISTRATION=false` can disable public signup in production.
- Added role allowlist validation in both request validation and auth service runtime checks.

### 4) Scalability tuning knobs

- Added env-configurable PostgreSQL pool and timeout settings:
  - pool max
  - idle timeout
  - connection timeout

## Residual risks (next phase)

1. Add Row-Level Security policies in PostgreSQL for defense-in-depth tenant isolation.
2. Move analytics queue to durable stream (Redis Stream/Kafka) for crash-safe ingestion.
3. Add background jobs for retention/partitioning of `api_request_metrics`.
4. Add SIEM-ready audit exports and immutable audit retention policies.
5. Add SSO (OIDC/SAML) and optional MFA for privileged users.
