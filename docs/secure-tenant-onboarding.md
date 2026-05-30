# Secure Tenant Onboarding and Invitation Flow

## 1. Threat model

### Assets
- Tenant boundary: every user must be bound only to the organization that invited them.
- Invitation secrets: invite links are bearer credentials until accepted, expired, or revoked.
- Audit trail: invite creation, failed acceptance, successful acceptance, and revocation must be retained.

### Primary threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Unauthorized tenant join by submitting another `organizationId` at registration | Public registration no longer accepts `organizationId`; account creation requires a signed invitation token whose tenant is validated server-side. |
| Role escalation during onboarding | Invite creation only permits `viewer` or `analyst`; public clients cannot choose `admin`. |
| Cross-tenant invite creation or revocation | Invite endpoints require authenticated organization admins and scope all writes by `req.user.organization_id`. |
| Token theft or replay | Tokens are signed JWTs, persisted only as HMAC hashes, expire by JWT `exp` and database `expires_at`, and become unusable after `accepted_at` or `revoked_at`. |
| User enumeration through invite verification | Invalid, expired, accepted, and revoked tokens return the same generic error. Revocation reports success even when the invite is not found in the admin tenant. |
| Domain spoofing | Optional `organization_domains` records allow tenants to enforce invites only to verified email domains. |
| Forensic gaps | Invite lifecycle events are written through the central audit service. |

## 2. Architecture design

1. An authenticated organization admin calls `POST /api/v1/auth/invitations` with an email, role, and expiration.
2. The backend uses the admin's authenticated tenant, not a request body tenant, to create a signed JWT invitation.
3. The backend stores only an HMAC of the token plus the JWT ID (`jti`) in `organization_invitations`.
4. The invited user opens `/register?invite=<token>`; the frontend verifies the token and pre-fills the invited email when valid.
5. The user submits name, password, email, and token to `/api/v1/auth/register` or `/api/v1/auth/invitations/accept`.
6. The backend verifies signature, issuer, audience, expiration, token hash, tenant, role, invite status, and exact invited email before creating the user.
7. The invitation is marked accepted and the user receives the existing auth cookie session.
8. Admins can revoke a pending invite with `DELETE /api/v1/auth/invitations/:id`.

## 3. Backend implementation

### Endpoints
- `POST /api/v1/auth/invitations` — admin-only invite creation.
- `GET /api/v1/auth/invitations/verify` with `x-invitation-token` — public token verification for onboarding UX.
- `POST /api/v1/auth/invitations/accept` — public invite acceptance and session creation.
- `POST /api/v1/auth/register` — preserved compatibility endpoint, now requiring `invitationToken` instead of `organizationId`.
- `DELETE /api/v1/auth/invitations/:id` — admin-only revocation scoped to the caller's organization.

### Data model
- `organization_invitations` stores invite status, expiry, role, recipient email, signer, and token hash.
- `organization_domains` supports optional verified domain enforcement.
- RLS policies isolate invitation and domain rows by `app.current_tenant_id`.

## 4. Frontend changes

- Registration is now invitation acceptance.
- The form accepts signed invitation tokens and no longer asks users for an organization ID.
- Invite links can pre-populate the token from `/register?invite=<token>`.
- Admin users have a Team Invitations page for creating and revoking invites.

## 5. Tests

Invite abuse coverage includes:
- Non-admin invite creation rejection.
- Admin-role invite creation rejection.
- Email mismatch on acceptance with generic failure.
- Revoked token verification with generic failure.
- Revocation scoped to the admin's organization.

## 6. Operations notes

- Default invite expiration is 72 hours; API callers can request 1–168 hours.
- Invitation tokens should be delivered out of band by an approved email provider before production launch.
- Verified domains are optional. When a tenant has verified domains, all new invites must target one of those domains.
- Treat invite links as secrets in support tooling and logs.
