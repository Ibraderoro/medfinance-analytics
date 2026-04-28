import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { BillingService } from './billing.service';

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
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    organizationId: string,
    role = 'viewer',
  ) {
    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email],
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

  async login(email: string, password: string) {
    const [user] = await query<UserRow>(
      `SELECT id, email, password_hash, first_name, last_name, role, organization_id, is_active
       FROM users WHERE email = $1`,
      [email],
    );

    if (!user || !user.is_active) {
      throw authError('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw authError('Invalid credentials');
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

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

    // Rotate: delete old token and issue a new pair
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);

    return this.generateTokenPair(user);
  }

  async logout(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
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
      { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
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
