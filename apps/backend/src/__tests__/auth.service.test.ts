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
  OIDC_ISSUER: '',
  OIDC_TOKEN_URL: '',
  OIDC_USERINFO_URL: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  OIDC_REDIRECT_URI: '',
  isDevelopment: () => false,
  isProduction: () => false,
};

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
  mockEnv.STRIPE_SECRET_KEY = '';
  mockEnv.OIDC_ISSUER = '';
  mockEnv.OIDC_TOKEN_URL = '';
  mockEnv.OIDC_USERINFO_URL = '';
  mockEnv.OIDC_CLIENT_ID = '';
  mockEnv.OIDC_CLIENT_SECRET = '';
  mockEnv.OIDC_REDIRECT_URI = '';
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
});


describe('AuthService OIDC SSO', () => {
  const service = new AuthService();

  it('stores tenant-scoped state when initiating OIDC login', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 'sso-user-uuid',
      email: 'sso@example.com',
      role: 'viewer',
      organization_id: 'org-uuid',
      is_active: true,
    }]);
    mockRedisSetex.mockResolvedValueOnce('OK');

    const result = await service.initiateSsoLogin('oidc', 'sso@example.com', 'org-uuid');

    expect(result.status).toBe('sso_initiated');
    expect(result.provider).toBe('oidc');
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:sso:state:/),
      300,
      expect.stringContaining('sso@example.com'),
    );
  });

  it('exchanges an OIDC callback code, validates userinfo, clears state, and issues tokens', async () => {
    mockEnv.OIDC_ISSUER = 'https://issuer.example.com';
    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/oauth/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/auth/oidc/callback';

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      userId: 'sso-user-uuid',
      email: 'sso@example.com',
      provider: 'oidc',
      organizationId: 'org-uuid',
    }));
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'oidc-access-token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'provider-subject', email: 'sso@example.com', email_verified: true }) } as Response);
    mockQuery
      .mockResolvedValueOnce([{
        id: 'sso-user-uuid',
        email: 'sso@example.com',
        role: 'viewer',
        organization_id: 'org-uuid',
        is_active: true,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockRedisDel.mockResolvedValueOnce(1);

    const result = await service.completeOidcLogin('550e8400-e29b-41d4-a716-446655440000', 'auth-code');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND idp_issuer = $3'),
      ['sso-user-uuid', 'org-uuid', 'https://issuer.example.com', 'provider-subject'],
    );
    expect(mockRedisDel).toHaveBeenCalledWith('auth:sso:state:550e8400-e29b-41d4-a716-446655440000');
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  it('rejects an OIDC callback when the provider email is not verified', async () => {
    mockEnv.OIDC_ISSUER = 'https://issuer.example.com';
    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/oauth/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/auth/oidc/callback';

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      userId: 'sso-user-uuid',
      email: 'sso@example.com',
      provider: 'oidc',
      organizationId: 'org-uuid',
    }));
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'oidc-access-token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'provider-subject', email: 'sso@example.com', email_verified: false }) } as Response);

    await expect(service.completeOidcLogin('550e8400-e29b-41d4-a716-446655440000', 'auth-code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC email must be verified',
    });
    expect(mockRedisDel).not.toHaveBeenCalledWith('auth:sso:state:550e8400-e29b-41d4-a716-446655440000');
    expect(mockQuery).not.toHaveBeenCalledWith('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', expect.any(Array));
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
