import bcrypt from 'bcryptjs';

const mockRedisSetex = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();

const mockEnv = {
  JWT_SECRET: 'test_jwt_secret_at_least_32_chars_long',
  JWT_EXPIRES_IN: '1d',
  REFRESH_TOKEN_SECRET: 'test_refresh_secret_at_least_32_chars_long',
  AUDIT_EXPORT_SIGNING_SECRET: 'test_audit_signing_secret_at_least_32_chars',
  REFRESH_TOKEN_EXPIRES_IN: '7d',
  JWT_ISSUER: 'medfinance-api',
  JWT_AUDIENCE: 'medfinance-client',
  LOG_LEVEL: 'error',
  STRIPE_SECRET_KEY: '',
  STRIPE_PRO_PRICE_ID: '',
  STRIPE_ENTERPRISE_PRICE_ID: '',
  isDevelopment: () => false,
  isProduction: () => false,
};

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();

// Mock the logger to capture error/warn calls without writing to stdout.
jest.mock('../utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the database module so no real PostgreSQL connection is needed.
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

// Mock Redis so MFA/SSO paths never connect to a real Redis instance.
jest.mock('../config/redis', () => ({
  getRedis: () => ({
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

// Mock env module to avoid requiring real environment variables.
jest.mock('../config/env', () => ({
  env: mockEnv,
}));

import { query } from '../config/database';
import { AuthService } from '../services/auth.service';

const mockQuery = query as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockRedisSetex.mockReset();
  mockRedisGet.mockReset();
  mockRedisDel.mockReset();
  mockLoggerError.mockReset();
  mockLoggerWarn.mockReset();
  mockEnv.STRIPE_SECRET_KEY = '';
  mockEnv.isProduction = () => false;
  jest.restoreAllMocks();
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

  it('requires MFA for admin users and stores a six-digit code', async () => {
    const hash = await bcrypt.hash('password123', 10);
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'admin-uuid',
          email: 'admin@example.com',
          password_hash: hash,
          first_name: 'Ada',
          last_name: 'Admin',
          role: 'admin',
          organization_id: 'org-uuid',
          is_active: true,
        },
      ])
      .mockResolvedValueOnce([]);
    mockRedisSetex.mockResolvedValueOnce('OK');

    const result = await service.login('admin@example.com', 'password123', 'org-uuid');

    expect(result.status).toBe('mfa_required');
    expect(typeof result.tempToken).toBe('string');
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:mfa:pending:/),
      300,
      expect.any(String),
    );
    const [, , serializedPayload] = mockRedisSetex.mock.calls[0];
    const payload = JSON.parse(serializedPayload as string) as { code: string };
    expect(payload.code).toMatch(/^\d{6}$/);
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

  it('fails closed before inserting a user when production Stripe customer provisioning is not configured', async () => {
    mockEnv.isProduction = () => true;
    mockQuery.mockResolvedValueOnce([]); // email not taken

    await expect(service.register(
      'new@example.com',
      'password123',
      'New',
      'User',
      'org-uuid',
    )).rejects.toMatchObject({
      statusCode: 500,
      message: 'Stripe customer provisioning requires STRIPE_SECRET_KEY in production',
    });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.any(Array),
    );
  });

  it('does not call Stripe when the production user insert fails', async () => {
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const fetchMock = jest.spyOn(global, 'fetch');

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

    await expect(service.register(
      'duplicate@example.com',
      'password123',
      'Dupe',
      'User',
      'org-uuid',
    )).rejects.toThrow('duplicate key value violates unique constraint');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM customers'),
      expect.any(Array),
    );
  });

  it('deletes the inserted production user and rethrows when Stripe provisioning fails', async () => {
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const stripeError = new Error('Stripe unavailable');
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(stripeError);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'prod-user-uuid',
        email: 'prod@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization
    mockQuery.mockResolvedValueOnce([]); // DELETE inserted user

    await expect(service.register(
      'prod@example.com',
      'password123',
      'Prod',
      'User',
      'org-uuid',
    )).rejects.toBe(stripeError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      'DELETE FROM users WHERE id = $1 AND organization_id = $2',
      ['prod-user-uuid', 'org-uuid'],
    );
  });

  it('provisions a production Stripe customer only after the user insert succeeds', async () => {
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cus_prod_123', email: 'prod@example.com' }),
    } as Response);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'prod-user-uuid',
        email: 'prod@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization
    mockQuery.mockResolvedValueOnce([
      {
        id: 'customer-uuid',
        organization_id: 'org-uuid',
        stripe_customer_id: 'cus_prod_123',
        email: 'prod@example.com',
      },
    ]); // INSERT customer RETURNING
    mockQuery.mockResolvedValueOnce([]); // INSERT refresh token

    const result = await service.register(
      'prod@example.com',
      'password123',
      'Prod',
      'User',
      'org-uuid',
    );

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const userInsertCall = mockQuery.mock.calls.find((call) => String(call[0]).includes('INSERT INTO users'));
    const customerLookupCall = mockQuery.mock.calls.find((call) => String(call[0]).includes('FROM customers'));
    expect(userInsertCall).toBeDefined();
    expect(customerLookupCall).toBeDefined();
    expect(mockQuery.mock.invocationCallOrder[mockQuery.mock.calls.indexOf(userInsertCall!)]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[mockQuery.mock.calls.indexOf(customerLookupCall!)],
    );
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
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization
    mockQuery.mockResolvedValueOnce([
      {
        id: 'customer-uuid',
        organization_id: 'org-uuid',
        stripe_customer_id: 'cus_local_orguuid',
        email: 'new@example.com',
      },
    ]); // INSERT local customer RETURNING
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

  it('logs an error and still rethrows the billing error when the cleanup DELETE itself fails in production', async () => {
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const stripeError = new Error('Stripe network timeout');
    const cleanupError = new Error('DB connection lost');
    jest.spyOn(global, 'fetch').mockRejectedValue(stripeError);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'cleanup-fail-uuid',
        email: 'failclean@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization (billing check)
    mockQuery.mockRejectedValueOnce(cleanupError); // DELETE inserted user fails

    await expect(service.register(
      'failclean@example.com',
      'password123',
      'Fail',
      'Clean',
      'org-uuid',
    )).rejects.toBe(stripeError);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to clean up user after production billing provisioning failure',
      expect.objectContaining({
        userId: 'cleanup-fail-uuid',
        organizationId: 'org-uuid',
        email: 'failclean@example.com',
        provisioningError: stripeError.message,
        cleanupError: cleanupError.message,
      }),
    );
  });

  it('does not delete the user when Stripe provisioning fails in non-production', async () => {
    mockEnv.isProduction = () => false;
    const stripeError = new Error('Stripe dev error');
    jest.spyOn(global, 'fetch').mockRejectedValue(stripeError);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'nonprod-user-uuid',
        email: 'nonprod@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization (billing check)
    // Stripe call fails, but we stay in non-production path
    mockQuery.mockResolvedValueOnce([]); // INSERT refresh token

    const result = await service.register(
      'nonprod@example.com',
      'password123',
      'Non',
      'Prod',
      'org-uuid',
    );

    // Registration still succeeds in non-production despite Stripe failure
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');

    // No DELETE query should have been issued
    expect(mockQuery).not.toHaveBeenCalledWith(
      'DELETE FROM users WHERE id = $1 AND organization_id = $2',
      expect.any(Array),
    );

    // A warning should have been logged instead
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Stripe customer provisioning failed during signup',
      expect.objectContaining({
        organizationId: 'org-uuid',
        email: 'nonprod@example.com',
      }),
    );
  });

  it('rethrows the original billing error even when cleanup DELETE succeeds', async () => {
    // Regression: ensure the original error identity is preserved after a successful cleanup
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const originalError = new Error('original billing error');
    jest.spyOn(global, 'fetch').mockRejectedValue(originalError);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'reg-user-uuid',
        email: 'reg@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization
    mockQuery.mockResolvedValueOnce([]); // DELETE inserted user (succeeds)

    const thrown = await service.register(
      'reg@example.com',
      'password123',
      'Reg',
      'User',
      'org-uuid',
    ).catch((e: unknown) => e);

    expect(thrown).toBe(originalError);
    // No logger.error because cleanup succeeded
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('logs provisioningError as a plain string when the billing failure is not an Error instance', async () => {
    mockEnv.isProduction = () => true;
    mockEnv.STRIPE_SECRET_KEY = 'sk_test_123';
    const nonErrorCause = 'plain string billing error';
    jest.spyOn(global, 'fetch').mockRejectedValue(nonErrorCause);

    mockQuery.mockResolvedValueOnce([]); // email not taken
    mockQuery.mockResolvedValueOnce([
      {
        id: 'str-err-uuid',
        email: 'strerr@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
      },
    ]); // INSERT user RETURNING
    mockQuery.mockResolvedValueOnce([]); // no existing customer for organization
    const deleteCleanupError = new Error('delete failed');
    mockQuery.mockRejectedValueOnce(deleteCleanupError); // DELETE fails to trigger logger path

    await expect(service.register(
      'strerr@example.com',
      'password123',
      'Str',
      'Err',
      'org-uuid',
    )).rejects.toBe(nonErrorCause);

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to clean up user after production billing provisioning failure',
      expect.objectContaining({
        provisioningError: nonErrorCause,
      }),
    );
  });
});

describe('AuthService.refresh', () => {


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
