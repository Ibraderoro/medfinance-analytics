import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../config/database';
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
  mfa_required?: boolean;
}

interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
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

interface OidcState {
  userId: string;
  email: string;
  provider: string;
  organizationId: string;
  nonce: string;
  codeVerifier: string;
}

interface OidcTokenPayload extends jwt.JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
  azp?: string;
}

interface JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
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
const OIDC_JWKS_CACHE_TTL_SECONDS = 60 * 60;
const SUSPICIOUS_LOGIN_WINDOW_SECONDS = 30 * 24 * 60 * 60;
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

function hashRecoveryCode(code: string): string {
  return hmacToken(code.trim().toUpperCase(), env.JWT_SECRET);
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

function base64Url(input: Buffer): string {
  return input.toString('base64url');
}

function sha256Base64Url(value: string): string {
  return base64Url(crypto.createHash('sha256').update(value).digest());
}

function parseJwtSegment<T>(token: string, segmentIndex: number): T {
  const segment = token.split('.')[segmentIndex];
  if (!segment) throw authError('OIDC ID token is malformed');
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch (err) {
    throw authError(appendErrorMessage('OIDC ID token is malformed', err));
  }
}

function resolveJwksUri(issuer: string): string {
  const configured = (env as typeof env & { OIDC_JWKS_URI?: string }).OIDC_JWKS_URI;
  if (configured) return configured;
  return `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
}

function normalizeAuthContext(context?: AuthRequestContext): Required<AuthRequestContext> {
  return {
    ipAddress: context?.ipAddress?.slice(0, 128) ?? 'unknown',
    userAgent: context?.userAgent?.slice(0, 512) ?? 'unknown',
    deviceId: context?.deviceId?.slice(0, 128) ?? crypto.randomUUID(),
  };
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

    const fullName = `${firstName} ${lastName}`.trim();
    if (env.isProduction()) {
      this.billingService.ensureProductionCustomerProvisioningConfigured();
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.claimInvitationAndCreateUser(invite, normalizedEmail, passwordHash, firstName, lastName);

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

    await this.recordSuccessfulLogin(user);
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
    const nonce = crypto.randomUUID();
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = sha256Base64Url(codeVerifier);
    await this.redis.setex(
      `auth:sso:state:${state}`,
      MFA_TTL_SECONDS,
      JSON.stringify({ userId: user.id, email: user.email, provider, organizationId: user.organization_id, nonce, codeVerifier }),
    );

    const authorizationUrl = env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_REDIRECT_URI
      ? `${env.OIDC_ISSUER.replace(/\/$/, '')}/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: env.OIDC_CLIENT_ID,
        redirect_uri: env.OIDC_REDIRECT_URI,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString()}`
      : undefined;

    return { provider, state, nonce, codeChallenge, codeChallengeMethod: 'S256' as const, authorizationUrl, status: 'sso_initiated' as const };
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

    const pending = JSON.parse(rawState) as Partial<OidcState>;
    const hasReplayBinding = Boolean(pending.nonce && pending.codeVerifier);
    if (hasReplayBinding) await this.redis.del(stateKey);
    if (pending.provider !== 'oidc') {
      throw authError('Invalid SSO provider for OIDC callback');
    }

    const tokenRequestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      redirect_uri: env.OIDC_REDIRECT_URI,
    });
    if (pending.codeVerifier) tokenRequestBody.set('code_verifier', pending.codeVerifier);

    const tokenPayload = await fetchOidcJson<{ access_token?: string; id_token?: string; token_type?: string }>(env.OIDC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody,
    }, 'OIDC token exchange failed');
    if (!tokenPayload.access_token) {
      throw authError('OIDC token exchange failed: missing access token');
    }

    const issuer = resolveOidcIssuer();
    const idToken = tokenPayload.id_token && pending.nonce
      ? await this.validateOidcIdToken(tokenPayload.id_token, issuer, pending.nonce)
      : null;

    const userInfo = await fetchOidcJson<{ sub?: string; email?: string; email_verified?: boolean }>(env.OIDC_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    }, 'OIDC userinfo fetch failed');
    if (!userInfo.sub || (idToken && userInfo.sub !== idToken.sub) || !userInfo.email) {
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

    if (!hasReplayBinding) await this.redis.del(stateKey);
    await this.recordSuccessfulLogin(user);
    await this.auditService.log({
      action: 'oidc_login_success',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { email: user.email },
    });

    return this.generateTokenPair(user, ['sso']);
  }

  async login(email: string, password: string, organizationId: string, context?: AuthRequestContext): Promise<{
    status: 'success' | 'mfa_required';
    accessToken?: string;
    refreshToken?: string;
    tempToken?: string;
  }> {
    const [user] = await query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.role, u.organization_id, u.is_active,
              COALESCE(p.mfa_enforced, false) AS mfa_required
       FROM users u
       LEFT JOIN organization_auth_policies p ON p.organization_id = u.organization_id
       WHERE u.email = $1 AND u.organization_id = $2`,
      [email, organizationId],
    );

    if (!user || !user.is_active) {
      throw authError('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw authError('Invalid credentials');
    }

    const suspicious = await this.detectSuspiciousLogin(user, context);
    if (user.role === 'admin' || user.mfa_required === true || suspicious) {
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
          stepUp: suspicious,
          context: normalizeAuthContext(context),
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
        action: user.role === 'admin' ? 'admin_mfa_required' : 'mfa_required',
        entityType: 'user',
        entityId: user.id,
        performedBy: user.id,
        organizationId: user.organization_id,
        metadata: { email: user.email, delivery: delivery.method, suspicious },
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

    await this.recordSuccessfulLogin(user, context);

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

  async generateRecoveryCodes(user: UserIdentity) {
    const codes = Array.from({ length: 10 }, () => `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`.toUpperCase());
    await query('DELETE FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    for (const code of codes) {
      await query(
        'INSERT INTO user_recovery_codes (user_id, organization_id, code_hash) VALUES ($1, $2, $3)',
        [user.id, user.organization_id, hashRecoveryCode(code)],
      );
    }
    await this.auditService.log({
      action: 'recovery_codes_rotated',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { count: codes.length },
    });
    return { codes };
  }

  async verifyMfa(tempToken: string, code: string) {
    const key = `auth:mfa:pending:${tempToken}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      throw authError('Invalid or expired MFA token');
    }

    const parsed = JSON.parse(raw) as { userId: string; codeHash?: string; code?: string; organizationId: string; attempts?: number; context?: AuthRequestContext };
    const expectedHash = parsed.codeHash ?? (parsed.code ? hashMfaCode(tempToken, parsed.code) : '');
    const providedHash = hashMfaCode(tempToken, code);

    if (!expectedHash || !constantTimeEqual(expectedHash, providedHash)) {
      const recovered = await this.consumeRecoveryCode(parsed.userId, code);
      if (recovered) {
        await this.redis.del(key);
        const [user] = await query<UserIdentity & { is_active: boolean }>(
          'SELECT id, email, role, organization_id, is_active FROM users WHERE id = $1',
          [parsed.userId],
        );
        if (!user || !user.is_active) throw authError('User not found or inactive');
        await this.recordSuccessfulLogin(user, parsed.context);
        await this.auditService.log({ action: 'mfa_recovery_code_used', entityType: 'user', entityId: user.id, performedBy: user.id, organizationId: user.organization_id, metadata: {} });
        return this.generateTokenPair(user, ['pwd', 'mfa']);
      }

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

    await this.recordSuccessfulLogin(user, parsed.context);

    await this.auditService.log({
      action: 'admin_mfa_verified',
      entityType: 'user',
      entityId: user.id,
      performedBy: user.id,
      organizationId: user.organization_id,
      metadata: { method: 'totp_or_otp' },
    });

    return this.generateTokenPair(user, ['pwd', 'mfa']);
  }

  async refresh(refreshToken: string, context?: AuthRequestContext) {
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

    await this.recordSuccessfulLogin(user, context);
    return this.generateTokenPair(user, ['refresh_token']);
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

  private async claimInvitationAndCreateUser(
    invite: InvitationRow,
    normalizedEmail: string,
    passwordHash: string,
    firstName: string,
    lastName: string,
  ): Promise<UserIdentity> {
    const client = await getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [invite.organization_id]);

      const claimed = await client.query<InvitationRow>(
        `UPDATE organization_invitations
         SET accepted_at = NOW()
         WHERE id = $1
           AND organization_id = $2
           AND accepted_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > NOW()
         RETURNING id, organization_id, email, role, invited_by, token_hash, expires_at, accepted_at, revoked_at`,
        [invite.id, invite.organization_id],
      );
      const claimedInvite = claimed.rows[0];
      if (!claimedInvite || claimedInvite.email !== normalizedEmail || claimedInvite.role !== invite.role) {
        throw inviteError();
      }

      const existing = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
        [normalizedEmail, invite.organization_id],
      );
      if (existing.rows.length > 0) {
        throw conflictError('Email already registered');
      }

      const created = await client.query<UserIdentity>(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, role, organization_id`,
        [normalizedEmail, passwordHash, firstName, lastName, invite.role, invite.organization_id],
      );
      const user = created.rows[0];
      if (!user) {
        throw conflictError('Unable to create invited user');
      }

      const acceptedBy = await client.query<{ id: string }>(
        `UPDATE organization_invitations
         SET accepted_by = $1
         WHERE id = $2
           AND organization_id = $3
           AND accepted_at IS NOT NULL
           AND accepted_by IS NULL
         RETURNING id`,
        [user.id, invite.id, invite.organization_id],
      );
      if (acceptedBy.rows.length === 0) {
        throw inviteError();
      }

      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') {
        throw conflictError('Email already registered');
      }
      throw err;
    } finally {
      client.release();
    }
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

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (!/^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{8}$/.test(code.trim())) return false;
    const [row] = await query<{ id: string }>(
      `UPDATE user_recovery_codes
       SET used_at = NOW()
       WHERE id = (
         SELECT id FROM user_recovery_codes
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING id`,
      [userId, hashRecoveryCode(code)],
    );
    return Boolean(row);
  }

  private async getJwks(issuer: string, kid?: string, forceRefresh = false): Promise<JsonWebKey[]> {
    const jwksUri = resolveJwksUri(issuer);
    const cacheKey = `auth:oidc:jwks:${hmacToken(jwksUri, env.JWT_SECRET)}`;
    if (!forceRefresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const keys = JSON.parse(cached) as JsonWebKey[];
        if (!kid || keys.some((key) => key.kid === kid)) return keys;
      }
    }

    const jwks = await fetchOidcJson<{ keys?: JsonWebKey[] }>(jwksUri, {}, 'OIDC JWKS fetch failed');
    const keys = (jwks.keys ?? []).filter((key) => key.kty === 'RSA' && (key.use === undefined || key.use === 'sig') && (!key.key_ops || key.key_ops.includes('verify')));
    if (keys.length === 0) throw authError('OIDC JWKS did not contain signing keys');
    await this.redis.setex(cacheKey, OIDC_JWKS_CACHE_TTL_SECONDS, JSON.stringify(keys));
    return keys;
  }

  private async validateOidcIdToken(idToken: string, issuer: string, nonce: string): Promise<OidcTokenPayload> {
    const header = parseJwtSegment<{ alg?: string; kid?: string }>(idToken, 0);
    if (header.alg !== 'RS256' || !header.kid) throw authError('OIDC ID token must be signed with an RS256 JWKS key');
    let keys = await this.getJwks(issuer, header.kid);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await this.getJwks(issuer, header.kid, true);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) throw authError('OIDC signing key was not found in JWKS');
    const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    const verified = jwt.verify(idToken, publicKey, { algorithms: ['RS256'], issuer, audience: env.OIDC_CLIENT_ID }) as OidcTokenPayload;
    if (!verified.sub || verified.nonce !== nonce) throw authError('OIDC ID token nonce validation failed');
    if (verified.azp && verified.azp !== env.OIDC_CLIENT_ID) throw authError('OIDC ID token authorized party mismatch');
    if (verified.email_verified === false) throw authError('OIDC email must be verified');
    return verified;
  }

  private async detectSuspiciousLogin(user: UserIdentity, context?: AuthRequestContext): Promise<boolean> {
    if (!context?.ipAddress) return false;
    const normalized = normalizeAuthContext(context);
    const key = `auth:login:last:${user.id}`;
    const previous = await this.redis.get(key).catch(() => null);
    await this.redis.setex(key, SUSPICIOUS_LOGIN_WINDOW_SECONDS, JSON.stringify(normalized)).catch(() => undefined);
    if (!previous) return false;
    try {
      const parsed = JSON.parse(previous) as Required<AuthRequestContext>;
      return parsed.ipAddress !== 'unknown' && normalized.ipAddress !== 'unknown' && parsed.ipAddress !== normalized.ipAddress;
    } catch {
      return false;
    }
  }

  private async recordSuccessfulLogin(user: UserIdentity, context?: AuthRequestContext): Promise<void> {
    const normalized = normalizeAuthContext(context);
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    try {
      await query(
        `INSERT INTO auth_sessions (user_id, organization_id, device_id, ip_address, user_agent, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, device_id) DO UPDATE
         SET ip_address = EXCLUDED.ip_address, user_agent = EXCLUDED.user_agent, last_seen_at = NOW(), revoked_at = NULL`,
        [user.id, user.organization_id, normalized.deviceId, normalized.ipAddress, normalized.userAgent],
      );
    } catch {}
  }

  private generateMfaCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private async generateTokenPair(user: UserIdentity, amr: string[] = ['pwd']) {
    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id,
        amr,
        auth_time: Math.floor(Date.now() / 1000),
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
