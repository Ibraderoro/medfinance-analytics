import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';

// Mock the database module so no real PostgreSQL connection is needed.
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

// Mock env module to avoid requiring real environment variables.
jest.mock('../config/env', () => ({
  env: {
    JWT_SECRET: 'test_jwt_secret_at_least_32_chars_long',
    JWT_EXPIRES_IN: '1d',
    REFRESH_TOKEN_SECRET: 'test_refresh_secret_at_least_32_chars_long',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    JWT_ISSUER: 'medfinance-api',
    JWT_AUDIENCE: 'medfinance-client',
    isDevelopment: () => false,
  },
}));

import { query } from '../config/database';

const mockQuery = query as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuthService.login', () => {
  const service = new AuthService();

  it('returns tokens for valid credentials', async () => {
    const hash = await bcrypt.hash('password123', 10);

    // First query: SELECT user — return one user row.
    mockQuery.mockResolvedValueOnce([
      {
        id: 'user-uuid',
        email: 'user@example.com',
        password_hash: hash,
        first_name: 'Alice',
        last_name: 'Smith',
        role: 'cfo',
        organization_id: 'org-uuid',
        is_active: true,
      },
    ]);
    // Second query: UPDATE last_login_at.
    mockQuery.mockResolvedValueOnce([]);
    // Third query: INSERT refresh token.
    mockQuery.mockResolvedValueOnce([]);

    const result = await service.login('user@example.com', 'password123', 'org-uuid');

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('throws 401 when user is not found', async () => {
    mockQuery.mockResolvedValueOnce([]); // no user returned

    await expect(service.login('ghost@example.com', 'pass', 'org-uuid')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  });

  it('throws 401 when password is incorrect', async () => {
    const hash = await bcrypt.hash('correct_password', 10);

    mockQuery.mockResolvedValueOnce([
      {
        id: 'user-uuid',
        email: 'user@example.com',
        password_hash: hash,
        role: 'viewer',
        organization_id: 'org-uuid',
        is_active: true,
      },
    ]);

    await expect(service.login('user@example.com', 'wrong_password', 'org-uuid')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('throws 401 when account is inactive', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'user-uuid',
        email: 'user@example.com',
        password_hash: 'irrelevant',
        role: 'viewer',
        organization_id: 'org-uuid',
        is_active: false,
      },
    ]);

    await expect(service.login('user@example.com', 'pass', 'org-uuid')).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('AuthService.register', () => {
  const service = new AuthService();

  it('throws 409 when email is already taken', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'existing-uuid' }]);

    await expect(
      service.register('taken@example.com', 'password123', 'Bob', 'Jones', 'org-uuid'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns tokens for a new registration', async () => {
    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'new-uuid',
        email: 'new@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT RETURNING
    mockQuery.mockResolvedValueOnce([]); // INSERT refresh token

    const result = await service.register(
      'new@example.com',
      'password123',
      'New',
      'User',
      'org-uuid',
    );

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });
});

describe('AuthService.refresh', () => {
  const service = new AuthService();

  it('throws 401 for an unknown token', async () => {
    mockQuery.mockResolvedValueOnce([]); // token not found

    await expect(service.refresh('unknown_token')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('throws 401 for an expired token', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    mockQuery.mockResolvedValueOnce([{ user_id: 'user-uuid', expires_at: pastDate }]);

    await expect(service.refresh('expired_token')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rotates tokens on a valid refresh', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    mockQuery.mockResolvedValueOnce([{ user_id: 'user-uuid', expires_at: futureDate }]); // SELECT token
    mockQuery.mockResolvedValueOnce([
      {
        id: 'user-uuid',
        email: 'user@example.com',
        role: 'cfo',
        organization_id: 'org-uuid',
      },
    ]); // SELECT user
    mockQuery.mockResolvedValueOnce([]); // DELETE old token
    mockQuery.mockResolvedValueOnce([]); // INSERT new token

    const result = await service.refresh('valid_token');
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });
});
