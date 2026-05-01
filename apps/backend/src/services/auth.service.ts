import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import { BillingService } from './billing.service';
import { AuditService } from './audit.service';

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
const ALLOWED_ROLES = new Set(['admin', 'analyst', 'viewer']);
const MFA_TTL_SECONDS = 5 * 60;

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

function hashRefreshToken(token: string): string {
  return crypto
    .createHmac('sha256', env.REFRESH_TOKEN_SECRET)
    .update(token)
    .digest('hex');
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

  private readonly redis = getRedis();

  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    organizationId: string,
    role = 'viewer',
  ) {
    if (!ALLOWED_ROLES.has(role)) {
      throw validationError('Invalid role');
    }

    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
      [email, organizationId],
    );
    if (existing.length > 0) {
      throw conflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await query<UserIdentity>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, organization_id`,
      [email, passwordHash, firstName, lastName, role, organizationId],
    );

    try {
      await this.billingService.ensureCustomerForOrganization(
        organizationId,
        email,
        `${firstName} ${lastName}`.trim(),
      );
    } catch (err) {
      console.warn('Stripe customer provisioning failed during signup', {
        organizationId,
        email,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    return this.generateTokenPair(user);
  }

  async initiateSsoLogin(provider: 'saml' | 'oidc', email: string) {
    const [user] = await query<UserIdentity & { is_active: boolean }>(
      'SELECT id, email, role, organization_id, is_active FROM users WHERE email = $1',
      [email],
    );

    if (!user || !user.is_active) {
      throw authError('SSO user not found or inactive');
    }

    const state = crypto.randomUUID();
    await this.redis.setex(
      `auth:sso:state:${state}`,
      MFA_TTL_SECONDS,
      JSON.stringify({ userId: user.id, provider, organizationId: user.organization_id }),
    );

    return { provider, state, status: 'sso_initiated' as const };
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
      await this.redis.setex(
        `auth:mfa:pending:${tempToken}`,
        MFA_TTL_SECONDS,
        JSON.stringify({ userId: user.id, code: mfaCode, organizationId: user.organization_id }),
      );

      await this.auditService.log({
        action: 'admin_mfa_required',
        entityType: 'user',
        entityId: user.id,
        performedBy: user.id,
        organizationId: user.organization_id,
        metadata: { email: user.email },
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

    const parsed = JSON.parse(raw) as { userId: string; code: string; organizationId: string };
    if (parsed.code !== code.trim()) {
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

    const [row] = await query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );

    if (!row || new Date(row.expires_at) < new Date()) {
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

  private generateMfaCode(): string {
    return `${Math.floor(100000 + Math.random() * 900000)}`;
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
