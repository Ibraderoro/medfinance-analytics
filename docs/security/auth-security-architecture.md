# Authentication and Enterprise SSO Security Architecture

## 1. Auth security architecture

MedFinance keeps the existing first-party JWT architecture for API authorization while strengthening the authentication ceremony around session issuance.

* **Primary session format:** API access tokens remain HMAC-signed JWTs with issuer, audience, subject, JTI, `auth_time`, and `amr` claims. Refresh tokens remain opaque random values stored server-side as HMAC hashes.
* **Organization-wide MFA:** `organization_auth_policies` stores tenant MFA and step-up policy. Password logins require an MFA challenge for admins, tenants that enforce MFA, configured step-up policies, and suspicious logins.
* **Step-up authentication:** Sensitive workflows can require a fresh MFA challenge before issuing a fully trusted session. Suspicious-login and policy-driven challenges are recorded in the MFA pending challenge payload.
* **Enterprise OIDC SSO:** SSO initiation creates tenant-scoped `state`, `nonce`, and PKCE S256 verifier/challenge values. Callback processing validates one-time state, exchanges the authorization code with `code_verifier`, validates the ID token when present, and cross-checks UserInfo `sub`, verified email, issuer, and linked local identity.
* **JWKS and key rotation:** ID-token verification fetches only signing-capable RSA JWKS keys, caches them, and refetches on key-id misses so IdP rotations are accepted without deployment.
* **Replay protection:** SSO state is one-time use, MFA challenges are short-lived and attempt-limited, refresh tokens rotate on every refresh, and revoked token hashes are cached to detect replay.
* **Device/session tracking:** `auth_sessions` records user, tenant, device ID, IP, user agent, first seen, last seen, and revocation state.
* **Suspicious login detection:** Recent login IP context is compared per user. A changed source IP triggers an MFA challenge before session issuance.
* **Backup recovery codes:** Users can generate one-time recovery codes. Only HMAC hashes are stored; successful use marks a code consumed.

## 2. Backend changes

* Added tenant policy, IdP, sessions, recovery-code, and auth event schema in migration `021_enterprise_auth_security`.
* Hardened OIDC with PKCE, nonce-aware ID-token validation, JWKS validation, key rotation refetch, and one-time state handling.
* Added MFA enforcement for non-admin users when tenant policy or suspicious-login rules require it.
* Added recovery-code generation and MFA fallback verification.
* Added session/device metadata capture and refresh-token replay revocation tracking.

## 3. Frontend changes

* Login supports enterprise SSO initiation.
* MFA entry accepts either a 6-digit code or a one-time recovery code.
* Auth API client exposes OIDC initiation/callback and recovery-code generation calls.

## 4. Database changes

* `organization_auth_policies` — organization-wide MFA and step-up policy.
* `tenant_oidc_providers` — per-tenant enterprise IdP configuration, including issuer, endpoints, JWKS URI, client ID, and secret reference.
* `auth_sessions` — device/session tracking and revocation metadata.
* `user_recovery_codes` — HMAC-hashed one-time recovery codes.
* `auth_security_events` — suspicious-login and authentication security event ledger.
* `refresh_tokens` gains optional device/IP/user-agent metadata columns for compatibility with future refresh-session analytics.

## 5. Tests

Security-focused tests cover existing auth edge cases including MFA code hashing/attempt limits, production delivery fail-closed behavior, SSO state handling, provider email verification, refresh-token rotation, invitation abuse, inactive users, malformed provider responses, and tenant-scoped account linking. New ID-token validation paths are designed to reject missing/incorrect nonce, non-RS256 algorithms, wrong audience/issuer, unknown `kid`, and invalid JWKS material.

## 6. Threat analysis

| Threat | Control |
| --- | --- |
| Authorization-code interception | PKCE S256 binds callback code exchange to the server-created verifier. |
| OIDC CSRF/session swapping | Tenant-scoped one-time `state` and ID-token `nonce` validation. |
| Forged ID tokens | RS256-only verification against issuer JWKS with issuer/audience checks. |
| IdP key rotation outage | JWKS cache refresh on unknown `kid`. |
| Refresh-token replay | Rotate refresh tokens, delete consumed token hashes, and cache revoked hashes. |
| MFA brute force | Short MFA TTL, constant-time code comparison, and max-attempt invalidation. |
| Admin-only MFA gap | Tenant-wide policy and suspicious-login triggers extend MFA beyond admins. |
| Account linking confusion | Local user must match tenant, issuer, subject, and verified email. |
| Lost MFA device | One-time recovery codes are hashed at rest and consumed atomically. |
| Session/device blind spots | `auth_sessions` captures device/IP/user-agent and last-seen metadata. |

## Operational notes

1. Store OIDC client secrets in a secrets manager; keep only `client_secret_ref` in `tenant_oidc_providers`.
2. Enable `organization_auth_policies.mfa_enforced` for healthcare-finance production tenants.
3. Alert on repeated `refresh_failed`, MFA failures, unknown JWKS `kid`, and suspicious-login events.
4. Use HTTPS redirect URIs only and register exact callback URLs with each IdP.
5. Rotate recovery codes after suspected compromise and after every break-glass use.
