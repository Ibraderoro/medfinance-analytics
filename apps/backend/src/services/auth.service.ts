import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: string;
  organisation_id: string;
  is_active: boolean;
}

type UserIdentity = Pick<UserRow, 'id' | 'email' | 'role' | 'organisation_id'>;

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

export class AuthService {
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    organisationId: string,
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
      `INSERT INTO users (email, password_hash, first_name, last_name, role, organisation_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, organisation_id`,
      [email, passwordHash, firstName, lastName, role, organisationId],
    );

    return this.generateTokenPair(user);
  }

  async login(email: string, password: string) {
    const [user] = await query<UserRow>(
      `SELECT id, email, password_hash, first_name, last_name, role, organisation_id, is_active
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
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const [row] = await query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );

    if (!row || new Date(row.expires_at) < new Date()) {
      throw authError('Invalid or expired refresh token');
    }

    const [user] = await query<UserIdentity>(
      'SELECT id, email, role, organisation_id FROM users WHERE id = $1 AND is_active = true',
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
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  }

  private async generateTokenPair(user: UserIdentity) {
    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organisationId: user.organisation_id,
      },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    const plainRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plainRefreshToken).digest('hex');

    // Parse REFRESH_TOKEN_EXPIRES_IN as days (default "7d" → 7 days)
    const expiresIn = env.REFRESH_TOKEN_EXPIRES_IN;
    const days = Number.parseInt(expiresIn.replace(/\D/g, ''), 10) || 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt.toISOString()],
    );

    return { accessToken, refreshToken: plainRefreshToken };
  }
}
