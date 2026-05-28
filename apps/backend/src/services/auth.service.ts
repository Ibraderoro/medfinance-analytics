import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { BillingService } from './billing.service';
import { AuditService } from './audit.service';
import { logger } from '../utils/logger';
import { MfaDeliveryService } from './mfaDelivery.service';
import { runWithTenantContext } from '../middleware/tenantContext';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: string;
  is_active: boolean;
}

type UserIdentity = Pick<UserRow, 'id' | 'email' | 'role' | 'organization_id'>;

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  invited_by: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

interface InvitationTokenPayload extends jwt.JwtPayload {
  typ: 'organization_invite';
  jti: string;
  org: string;
  email: string;
  role: string;
}

const ALLOWED_ROLES = new Set(['admin', 'analyst', 'viewer']);
const MFA_TTL_SECONDS = 5 * 60;
const MFA_MAX_ATTEMPTS = 5;
const OIDC_REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_REVOKED_PREFIX = 'auth:refresh:revoked:';
const INVITATION_TOKEN_TTL_HOURS = 72;
const GENERIC_INVITE_ERROR = 'Invalid or expired invitation';

function authError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 401;
  err.isOperational = true;
  return err;
}

function conflictError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 409;
  err.isOperational = true;
  return err;
}

function validationError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.isOperational = true;
  return err;
}

function configurationError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 500;
  err.isOperational = true;
  return err;
}

function appendErrorMessage(message: string, err: unknown): string {
  return err instanceof Error && err.message ? `${message}: ${err.message}` : message;
}

async function fetchOidcJson<T>(url: string, init: RequestInit, failureMessage: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OIDC_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw authError(`${failureMessage}: provider returned ${response.status}`);
    }

    try {
      return await response.json() as T;
    } catch (err) {
      throw authError(appendErrorMessage(`${failureMessage}: invalid JSON response`, err));
    }
  } catch (err) {
    if ((err as AppError).isOperational) {
      throw err;
    }
    throw authError(appendErrorMessage(failureMessage, err));
  } finally {
    clearTimeout(timeout);
  }
}

function resolveOidcIssuer(): string {
  if (env.OIDC_ISSUER) {
    return env.OIDC_ISSUER;
  }

  try {
    return new URL(env.OIDC_TOKEN_URL).origin;
  } catch {
    throw configurationError('OIDC callback requires a valid OIDC issuer or token URL');
  }
}

function hmacToken(token: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(token)
    .digest('hex');
}

function hashRefreshToken(token: string): string {
  return hmacToken(token, env.REFRESH_TOKEN_SECRET);
}

function hashInvitationToken(token: string): string {
  return hmacToken(token, env.JWT_SECRET);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

function inviteError(): AppError {
  const err = new Error(GENERIC_INVITE_ERROR) as AppError;
  err.statusCode = 401;
  err.isOperational = true;
  return err;
}

function hashMfaCode(tempToken: string, code: string): string {
  return hmacToken(`${tempToken}:${code.trim()}`, env.JWT_SECRET);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function refreshExpiryToDays(expiresIn: string): number {
  const match = expiresIn.trim().match(/^(\d+)([smhd]?)$/i);
  if (!match) return 7;

  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] || 'd').toLowerCase();

  if (unit === 'd') return amount;
  if (unit === 'h') return Math.ceil(amount / 24);
  if (unit === 'm') return Math.ceil(amount / (60 * 24));
  if (unit === 's') return Math.ceil(amount / (60 * 60 * 24));

  return 7;
}

export class AuthService {
  private readonly billingService = new BillingService();

  private readonly auditService = new AuditService();

  private readonly mfaDeliveryService = new MfaDeliveryService();

  private readonly redis = getRedis();

  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    invitationToken: string,
  ) {
    return this.acceptInvitation(invitationToken, email, password, firstName, lastName);
  }

  async createInvitation(inviter: UserIdentity, email: string, role = 'viewer', expiresInHours = INVITATION_TOKEN_TTL_HOURS) {
    if (inviter.role !== 'admin') {
      throw validationError('Only organization admins can create invitations');
    }
    if (!ALLOWED_ROLES.has(role) || role === 'admin') {
      throw validationError('Invitations can only grant analyst or viewer access');
    }

    const normalizedEmail = normalizeEmail(email);
    const boundedHours = Math.min(Math.max(Math.floor(expiresInHours || INVITATION_TOKEN_TTL_HOURS), 1), 168);
    const [organization] = await query<{ id: string; name: string }>(
      'SELECT id, name FROM organizations WHERE id = $1',
      [inviter.organization_id],
    );
    if (!organization) {
      throw validationError('Invalid organization');
    }

    const verifiedDomains = await runWithTenantContext({ organizationId: inviter.organization_id, userId: inviter.id }, () => query<{ domain: string }>(
      'SELECT domain FROM organization_domains WHERE organization_id = $1 AND verified_at IS NOT NULL',
      [inviter.organization_id],
    ));
    if (verifiedDomains.length > 0 && !verifiedDomains.some((domain) => domain.domain.toLowerCase() === emailDomain(normalizedEmail))) {
      throw validationError('Invited email domain is not verified for this organization');
    }

    const existingUser = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
      [normalizedEmail, inviter.organization_id],
    );
    if (existingUser.length > 0) {
      throw conflictError('Invitation could not be created');
    }

    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + boundedHours * 60 * 60 * 1000);
    const token = jwt.sign(
      { typ: 'organization_invite', org: inviter.organization_id, email: normalizedEmail, role },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: `${boundedHours}h`,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        subject: normalizedEmail,
        jwtid: jti,
      },
    );
    const tokenHash = hashInvitationToken(token);

    const [invite] = await runWithTenantContext({ organizationId: inviter.organization_id, userId: inviter.id }, () => query<{ id: string; expires_at: string }>(
      `INSERT INTO organization_invitations (organization_id, email, role, invited_by, token_hash, token_jti, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, expires_at`,
      [inviter.organization_id, normalizedEmail, role, inviter.id, tokenHash, jti, expiresAt.toISOString()],
    ));

    await this.auditService.log({
      action: 'invite_created',
      entityType: 'organization_invitation',
      entityId: invite.id,
      performedBy: inviter.id,
      organizationId: inviter.organization_id,
      metadata: { email: normalizedEmail, role, expiresAt: invite.expires_at },
    });

    return { id: invite.id, token, email: normalizedEmail, role, organizationId: inviter.organization_id, organizationName: organization.name, expiresAt: invite.expires_at };
  }

  async verifyInvitation(token: string) {
    const invite = await this.resolveInvitation(token);
    return {
      valid: true,
      email: invite.email,
      role: invite.role,
      organizationId: invite.organization_id,
      expiresAt: invite.expires_at,
    };
  }

  async revokeInvitation(inviter: UserIdentity, invitationId: string) {
    if (inviter.role !== 'admin') {
      throw validationError('Only organization admins can revoke invitations');
    }

    const [invite] = await runWithTenantContext({ organizationId: inviter.organization_id, userId: inviter.id }, () => query<{ id: string }>(
      `UPDATE organization_invitations
       SET revoked_at = NOW(), revoked_by = $1
       WHERE id = $2 AND organization_id = $3 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id`,
      [inviter.id, invitationId, inviter.organization_id],
    ));

    if (invite) {
      await this.auditService.log({
        action: 'invite_revoked',
        entityType: 'organization_invitation',
        entityId: invite.id,
        performedBy: inviter.id,
        organizationId: inviter.organization_id,
        metadata: {},
      });
    }

    return { revoked: true };
  }

  async acceptInvitation(token: string, email: string, password: string, firstName: string, lastName: string) {
    const invite = await this.resolveInvitation(token);
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail !== invite.email) {
      await this.auditService.log({
        action: 'invite_accept_failed',
        entityType: 'organization_invitation',
        entityId: invite.id,
        performedBy: invite.invited_by,
        organizationId: invite.organization_id,
        metadata: { reason: 'email_mismatch', attemptedEmailDomain: emailDomain(normalizedEmail) },
      });
      throw inviteError();
    }

    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
      [normalizedEmail, invite.organization_id],
    );
    if (existing.length > 0) {
      throw conflictError('Email already registered');
    }

    const fullName = `${firstName} ${lastName}`.trim();
    if (env.isProduction()) {
      this.billingService.ensureProductionCustomerProvisioningConfigured();
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await query<UserIdentity>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, organization_id`,
      [normalizedEmail, passwordHash, firstName, lastName, invite.role, invite.organization_id],
    );

    await runWithTenantContext({ organizationId: invite.organization_id, userId: user.id }, () => query(
      `UPDATE organization_invitations
       SET accepted_at = NOW(), accepted_by = $1
       WHERE id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [user.id, invite.id],
    ));

    await this.auditService.log({
      action: 'invite_accepted',
      entityType: 'organization_invitation',
      entityId: invite.id,
      performedBy: user.id,
      organizationId: invite.organization_id,
      metadata: { email: normalizedEmail, role: invite.role },
    });

    if (env.isProduction()) {
      await this.billingService.ensureCustomerForOrganization(invite.organization_id, normalizedEmail, fullName);
    } else {
      try {
        await this.billingService.ensureCustomerForOrganization(invite.organization_id, normalizedEmail, fullName);
      } catch (err) {
        logger.warn('Stripe customer provisioning failed during invite acceptance', {
          organizationId: invite.organization_id,
          email: normalizedEmail,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    return this.generateTokenPair(user);
  }

  async initiateSsoLogin(provider: 'saml' | 'oidc', email: string, organizationId: string) {
    const [user] = await query<UserIdentity & { is_active: boolean }>(
      'SELECT id, email, role, organization_id, is_active FROM users WHERE email = $1 AND organization_id = $2',
      [email, organizationId],
    );

    if (!user || !user.is_active) {
      throw authError('SSO user not found or inactive');
    }

    const state = crypto.randomUUID();
    await this.redis.setex(
      `auth:sso:state:${state}`,
      MFA_TTL_SECONDS,
      JSON.stringify({ userId: user.id, email: user.email, provider, organizationId: user.organization_id }),
    );

    return { provider, state, status: 'sso_initiated' as const };
  }

  async completeOidcLogin(state: string, code: string) {
    if (!env.OIDC_TOKEN_URL || !env.OIDC_USERINFO_URL || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET || !env.OIDC_REDIRECT_URI) {
      throw configurationError('OIDC callback requires OIDC_TOKEN_URL, OIDC_USERINFO_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI');
    }

    const stateKey = `auth:sso:state:${state}`;
    const rawState = await this.redis.get(stateKey);
    if (!rawState) {
      throw authError('Invalid or expired SSO state');
    }

    const pending = JSON.parse(rawState) as { userId: string; email: string; provider: string; organizationId: string };
    if (pending.provider !== 'oidc') {
      throw authError('Invalid SSO provider for OIDC callback');
    }

    const tokenPayload = await fetchOidcJson<{ access_token?: string }>(env.OIDC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.OIDC_CLIENT_ID,
        client_secret: env.OIDC_CLIENT_SECRET,
        redirect_uri: env.OIDC_REDIRECT_URI,
      }),
    }, 'OIDC token exchange failed');
    if (!tokenPayload.access_token) {
      throw authError('OIDC token exchange failed: missing access token');
    }

    const userInfo = await fetchOidcJson<{ sub?: string; email?: string; email_verified?: boolean }>(env.OIDC_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    }, 'OIDC userinfo fetch failed');
    if (!userInfo.sub || !userInfo.email) {
      throw authError('OIDC user identity did not match pending SSO session');
    }
    if (userInfo.email_verified !== true) {
      throw authError('OIDC email must be verified');
    }
    const pendingEmail = typeof pending.email === 'string' ? pending.email.trim().toLowerCase() : '';
    const userInfoEmail = userInfo.email.trim().toLowerCase();
    if (!pendingEmail || userInfoEmail !== pendingEmail) {
      throw authError('OIDC userinfo email did not match pending login');
    }

    const issuer = resolveOidcIssuer();
    const [user] = await query<UserIdentity & { is_active: boolean }>(
      `SELECT id, email, role, organization_id, is_active
       FROM users
       WHERE id = $1
         AND organization_id = $2
         AND idp_issuer = $3
         AND idp_subject = $4`,
      [pending.userId, pending.organizationId, issuer, userInfo.sub],
    );
    if (!user || !user.is_active) {
      throw authError('OIDC user identity did not match linked account');
    }

    await this.redis.del(stateKey);
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await this.auditService.log({
      action: 'oidc_login_success',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { email: user.email },
    });

    return this.generateTokenPair(user);
  }

  async login(email: string, password: string, organizationId: string): Promise<{
    status: 'success' | 'mfa_required';
    accessToken?: string;
    refreshToken?: string;
    tempToken?: string;
  }> {
    const [user] = await query<UserRow>(
      `SELECT id, email, password_hash, first_name, last_name, role, organization_id, is_active
       FROM users WHERE email = $1 AND organization_id = $2`,
      [email, organizationId],
    );

    if (!user || !user.is_active) {
      throw authError('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw authError('Invalid credentials');
    }

    if (user.role === 'admin') {
      const tempToken = crypto.randomUUID();
      const mfaCode = this.generateMfaCode();
      const mfaKey = `auth:mfa:pending:${tempToken}`;
      await this.redis.setex(
        mfaKey,
        MFA_TTL_SECONDS,
        JSON.stringify({
          userId: user.id,
          codeHash: hashMfaCode(tempToken, mfaCode),
          organizationId: user.organization_id,
          attempts: 0,
        }),
      );

      let delivery;
      try {
        delivery = await this.mfaDeliveryService.sendMfaCode({
          userId: user.id,
          email: user.email,
          organizationId: user.organization_id,
          code: mfaCode,
        });
      } catch (error) {
        await this.redis.del(mfaKey).catch(() => undefined);
        throw error;
      }

      await this.auditService.log({
        action: 'admin_mfa_required',
        entityType: 'user',
        entityId: user.id,
        performedBy: user.id,
        organizationId: user.organization_id,
        metadata: { email: user.email, delivery: delivery.method },
      });

      logger.info('Admin MFA challenge delivered', {
        userId: user.id,
        organizationId: user.organization_id,
        delivery: delivery.method,
      });

      return {
        status: 'mfa_required' as const,
        tempToken,
      };
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    await this.auditService.log({
      action: 'login_success',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { email: user.email },
    });

    return {
      status: 'success' as const,
      ...(await this.generateTokenPair(user)),
    };
  }

  async verifyMfa(tempToken: string, code: string) {
    const key = `auth:mfa:pending:${tempToken}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      throw authError('Invalid or expired MFA token');
    }

    const parsed = JSON.parse(raw) as { userId: string; codeHash?: string; code?: string; organizationId: string; attempts?: number };
    const expectedHash = parsed.codeHash ?? (parsed.code ? hashMfaCode(tempToken, parsed.code) : '');
    const providedHash = hashMfaCode(tempToken, code);

    if (!expectedHash || !constantTimeEqual(expectedHash, providedHash)) {
      const attempts = (parsed.attempts ?? 0) + 1;
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await this.redis.del(key);
        throw authError('Invalid or expired MFA token');
      }

      await this.redis.setex(
        key,
        MFA_TTL_SECONDS,
        JSON.stringify({ ...parsed, code: undefined, codeHash: expectedHash, attempts }),
      );
      throw authError('Invalid MFA code');
    }

    await this.redis.del(key);

    const [user] = await query<UserIdentity & { is_active: boolean }>(
      'SELECT id, email, role, organization_id, is_active FROM users WHERE id = $1',
      [parsed.userId],
    );

    if (!user || !user.is_active) {
      throw authError('User not found or inactive');
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    await this.auditService.log({
      action: 'admin_mfa_verified',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { method: 'totp_or_otp' },
    });

    return this.generateTokenPair(user);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const revoked = await this.redis.get(`${REFRESH_REVOKED_PREFIX}${tokenHash}`);
    if (revoked) {
      throw authError('Refresh token has been revoked');
    }

    const [row] = await query<{ user_id: string; expires_at: string; organization_id: string | null }>(
      `SELECT rt.user_id, rt.expires_at, u.organization_id
       FROM refresh_tokens rt
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    if (!row || new Date(row.expires_at) < new Date()) {
      if (row?.organization_id) {
        try {
          await this.auditService.log({
            action: 'refresh_failed',
            entityType: 'auth',
            organizationId: row.organization_id,
            performedBy: row.user_id,
            metadata: { reason: 'invalid_or_expired_refresh_token' },
          });
        } catch (error) {
          logger.warn('Refresh failure audit log write failed', {
            userId: row.user_id,
            organizationId: row.organization_id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      throw authError('Invalid or expired refresh token');
    }

    const [user] = await query<UserIdentity>(
      'SELECT id, email, role, organization_id FROM users WHERE id = $1 AND is_active = true',
      [row.user_id],
    );

    if (!user) {
      throw authError('User not found or inactive');
    }

    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    await this.redis.setex(`${REFRESH_REVOKED_PREFIX}${tokenHash}`, Math.max(60, refreshExpiryToDays(env.REFRESH_TOKEN_EXPIRES_IN) * 24 * 60 * 60), '1');
    await this.auditService.log({
      action: 'refresh_success',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { email: user.email },
    });

    return this.generateTokenPair(user);
  }

  async logout(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const [row] = await query<{ user_id: string }>(
      'SELECT user_id FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    await this.redis.setex(`${REFRESH_REVOKED_PREFIX}${tokenHash}`, Math.max(60, refreshExpiryToDays(env.REFRESH_TOKEN_EXPIRES_IN) * 24 * 60 * 60), '1');

    if (!row?.user_id) {
      return;
    }

    const [user] = await query<UserIdentity>(
      'SELECT id, email, role, organization_id FROM users WHERE id = $1',
      [row.user_id],
    );

    if (!user) {
      return;
    }

    await this.auditService.log({
      action: 'logout_success',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { email: user.email },
    });
  }


  private async resolveInvitation(token: string): Promise<InvitationRow> {
    let payload: InvitationTokenPayload;
    try {
      const verified = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });
      if (!verified || typeof verified !== 'object') {
        throw inviteError();
      }
      payload = verified as InvitationTokenPayload;
    } catch {
      throw inviteError();
    }

    if (payload.typ !== 'organization_invite' || !payload.jti || !payload.org || !payload.email || !ALLOWED_ROLES.has(payload.role)) {
      throw inviteError();
    }

    const tokenHash = hashInvitationToken(token);
    const [invite] = await runWithTenantContext({ organizationId: payload.org, userId: 'invite-verifier' }, () => query<InvitationRow>(
      `SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, accepted_at, revoked_at
       FROM organization_invitations
       WHERE token_hash = $1 AND token_jti = $2 AND organization_id = $3`,
      [tokenHash, payload.jti, payload.org],
    ));

    if (
      !invite
      || invite.accepted_at
      || invite.revoked_at
      || new Date(invite.expires_at) <= new Date()
      || invite.email !== normalizeEmail(payload.email)
      || invite.role !== payload.role
    ) {
      throw inviteError();
    }

    return invite;
  }

  private generateMfaCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private async generateTokenPair(user: UserIdentity) {
    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
      },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        subject: user.id,
        jwtid: crypto.randomUUID(),
      },
    );

    const plainRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = hashRefreshToken(plainRefreshToken);

    const days = refreshExpiryToDays(env.REFRESH_TOKEN_EXPIRES_IN);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt.toISOString()],
    );

    return { accessToken, refreshToken: plainRefreshToken };
  }
}
