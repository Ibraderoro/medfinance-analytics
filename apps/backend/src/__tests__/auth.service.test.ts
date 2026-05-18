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
  MFA_DELIVERY_WEBHOOK_URL: '',
  HTTP_REQUEST_TIMEOUT_MS: 30000,
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
  mockEnv.MFA_DELIVERY_WEBHOOK_URL = '';
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

  it('requires MFA for admin users and stores only a hashed MFA code', async () => {
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
    const [key, ttl, serializedPayload] = mockRedisSetex.mock.calls[0];
    expect(key).toEqual(expect.stringMatching(/^auth:mfa:pending:/));
    expect(ttl).toBe(300);
    const payload = JSON.parse(serializedPayload as string) as { code?: string; codeHash: string; attempts: number };
    expect(payload.code).toBeUndefined();
    expect(payload.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.attempts).toBe(0);
  });

  it('delivers the plaintext MFA code through the configured webhook without returning it', async () => {
    mockEnv.MFA_DELIVERY_WEBHOOK_URL = 'https://mfa-delivery.example.com/send';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const hash = await bcrypt.hash('password123', 10);
    mockQuery
      .mockResolvedValueOnce([{
        id: 'admin-uuid',
        email: 'admin@example.com',
        password_hash: hash,
        first_name: 'Ada',
        last_name: 'Admin',
        role: 'admin',
        organization_id: 'org-uuid',
        is_active: true,
      }])
      .mockResolvedValueOnce([]);
    mockRedisSetex.mockResolvedValueOnce('OK');

    const result = await service.login('admin@example.com', 'password123', 'org-uuid');

    expect(result).toEqual({ status: 'mfa_required', tempToken: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mfa-delivery.example.com/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { code: string; email: string };
    expect(body.email).toBe('admin@example.com');
    expect(body.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(result)).not.toContain(body.code);
  });

  it('increments MFA attempts without exposing the raw code and expires after repeated failures', async () => {
    const tempToken = 'temp-token-123';
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({
        userId: 'admin-uuid',
        organizationId: 'org-uuid',
        codeHash: '0'.repeat(64),
        attempts: 3,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        userId: 'admin-uuid',
        organizationId: 'org-uuid',
        codeHash: '0'.repeat(64),
        attempts: 4,
      }));
    mockRedisSetex.mockResolvedValueOnce('OK');
    mockRedisDel.mockResolvedValueOnce(1);

    await expect(service.verifyMfa(tempToken, '111111')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid MFA code',
    });
    expect(mockRedisSetex).toHaveBeenCalledWith(
      `auth:mfa:pending:${tempToken}`,
      300,
      expect.stringContaining('"attempts":4'),
    );

    await expect(service.verifyMfa(tempToken, '111111')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid or expired MFA token',
    });
    expect(mockRedisDel).toHaveBeenCalledWith(`auth:mfa:pending:${tempToken}`);
  });

  it('fails closed and removes the pending MFA challenge when production MFA delivery is not configured', async () => {
    mockEnv.isProduction = () => true;
    const hash = await bcrypt.hash('password123', 10);
    mockQuery.mockResolvedValueOnce([{
      id: 'admin-uuid',
      email: 'admin@example.com',
      password_hash: hash,
      first_name: 'Ada',
      last_name: 'Admin',
      role: 'admin',
      organization_id: 'org-uuid',
      is_active: true,
    }]);
    mockRedisSetex.mockResolvedValueOnce('OK');
    mockRedisDel.mockResolvedValueOnce(1);

    await expect(service.login('admin@example.com', 'password123', 'org-uuid')).rejects.toMatchObject({
      statusCode: 500,
      message: 'MFA delivery requires MFA_DELIVERY_WEBHOOK_URL in production',
    });

    const pendingKey = mockRedisSetex.mock.calls[0][0];
    expect(pendingKey).toEqual(expect.stringMatching(/^auth:mfa:pending:/));
    expect(mockRedisDel).toHaveBeenCalledWith(pendingKey);
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO refresh_tokens'),
      expect.any(Array),
    );
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

  it.each([
    {
      providerName: 'Okta',
      issuer: 'https://acme.okta.com/oauth2/default',
      tokenUrl: 'https://acme.okta.com/oauth2/default/v1/token',
      userinfoUrl: 'https://acme.okta.com/oauth2/default/v1/userinfo',
      subject: 'okta-user-subject',
    },
    {
      providerName: 'Auth0',
      issuer: 'https://login.acme.example.com/',
      tokenUrl: 'https://login.acme.example.com/oauth/token',
      userinfoUrl: 'https://login.acme.example.com/userinfo',
      subject: 'auth0|user-subject',
    },
  ])('completes a provider-specific OIDC callback for $providerName', async ({ issuer, tokenUrl, userinfoUrl, subject }) => {
    mockEnv.OIDC_ISSUER = issuer;
    mockEnv.OIDC_TOKEN_URL = tokenUrl;
    mockEnv.OIDC_USERINFO_URL = userinfoUrl;
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: subject, email: 'sso@example.com', email_verified: true }) } as Response);
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

    const result = await service.completeOidcLogin('550e8400-e29b-41d4-a716-446655440000', 'provider-auth-code');

    expect(fetchMock).toHaveBeenNthCalledWith(1, tokenUrl, expect.objectContaining({ method: 'POST' }));
    const tokenBody = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(tokenBody.get('grant_type')).toBe('authorization_code');
    expect(tokenBody.get('code')).toBe('provider-auth-code');
    expect(tokenBody.get('client_id')).toBe('client-id');
    expect(tokenBody.get('redirect_uri')).toBe('https://app.example.com/auth/oidc/callback');
    expect(fetchMock).toHaveBeenNthCalledWith(2, userinfoUrl, expect.objectContaining({
      headers: { Authorization: 'Bearer oidc-access-token' },
    }));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND idp_issuer = $3'),
      ['sso-user-uuid', 'org-uuid', issuer, subject],
    );
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

describe('AuthService additional production coverage', () => {
  const service = new AuthService();

  it('rejects unsupported registration roles before querying for duplicates', async () => {
    await expect(service.register('bad@example.com', 'password123', 'Bad', 'Role', 'org-uuid', 'owner')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid role',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('logs and continues when non-production customer provisioning fails after user creation', async () => {
    const warnSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ id: 'new-uuid', email: 'new@example.com', role: 'viewer', organization_id: 'org-uuid' }]);
    mockQuery.mockRejectedValueOnce(new Error('stripe unavailable'));
    mockQuery.mockResolvedValueOnce([]);

    await expect(service.register('new@example.com', 'password123', 'New', 'User', 'org-uuid')).resolves.toHaveProperty('accessToken');
    expect(mockQuery).toHaveBeenCalledWith('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', expect.any(Array));
    warnSpy.mockRestore();
  });

  it('verifies MFA challenges stored with legacy plaintext codes', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      userId: 'admin-uuid',
      organizationId: 'org-uuid',
      code: '123456',
      attempts: 0,
    }));
    mockRedisDel.mockResolvedValueOnce(1);
    mockQuery
      .mockResolvedValueOnce([{ id: 'admin-uuid', email: 'admin@example.com', role: 'admin', organization_id: 'org-uuid', is_active: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.verifyMfa('temp-token', '123456')).resolves.toHaveProperty('accessToken');
    expect(mockRedisDel).toHaveBeenCalledWith('auth:mfa:pending:temp-token');
  });

  it('rejects MFA verification when the resolved user is missing after a valid code', async () => {
    const crypto = await import('crypto');
    const expectedHash = crypto.createHmac('sha256', mockEnv.JWT_SECRET).update('temp-token:123456').digest('hex');
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      userId: 'missing-admin',
      organizationId: 'org-uuid',
      codeHash: expectedHash,
      attempts: 0,
    }));
    mockRedisDel.mockResolvedValueOnce(1);
    mockQuery.mockResolvedValueOnce([]);

    await expect(service.verifyMfa('temp-token', '123456')).rejects.toMatchObject({
      statusCode: 401,
      message: 'User not found or inactive',
    });
  });

  it('rejects inactive SSO users before writing state', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'sso-user', email: 'sso@example.com', role: 'viewer', organization_id: 'org-uuid', is_active: false }]);

    await expect(service.initiateSsoLogin('oidc', 'sso@example.com', 'org-uuid')).rejects.toMatchObject({
      statusCode: 401,
      message: 'SSO user not found or inactive',
    });
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  it('rejects OIDC callback when configuration or state are invalid', async () => {
    await expect(service.completeOidcLogin('state', 'code')).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('OIDC callback requires'),
    });

    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/callback';
    mockRedisGet.mockResolvedValueOnce(null);

    await expect(service.completeOidcLogin('missing', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid or expired SSO state',
    });
  });

  it('rejects OIDC callbacks for the wrong provider and missing token payloads', async () => {
    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/callback';
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'saml', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));

    await expect(service.completeOidcLogin('wrong-provider', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid SSO provider for OIDC callback',
    });

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

    await expect(service.completeOidcLogin('no-token', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC token exchange failed: missing access token',
    });
  });

  it('rejects OIDC callbacks when provider responses are malformed or account linkage fails', async () => {
    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/callback';

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'sso@example.com', email_verified: true }) } as Response);

    await expect(service.completeOidcLogin('missing-sub', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC user identity did not match pending SSO session',
    });

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'sub', email: 'other@example.com', email_verified: true }) } as Response);

    await expect(service.completeOidcLogin('email-mismatch', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC userinfo email did not match pending login',
    });

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'sub', email: 'sso@example.com', email_verified: true }) } as Response);
    mockQuery.mockResolvedValueOnce([]);

    await expect(service.completeOidcLogin('unlinked', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC user identity did not match linked account',
    });
  });

  it('rejects provider HTTP and JSON failures as operational OIDC errors', async () => {
    mockEnv.OIDC_TOKEN_URL = 'https://issuer.example.com/token';
    mockEnv.OIDC_USERINFO_URL = 'https://issuer.example.com/userinfo';
    mockEnv.OIDC_CLIENT_ID = 'client-id';
    mockEnv.OIDC_CLIENT_SECRET = 'client-secret';
    mockEnv.OIDC_REDIRECT_URI = 'https://app.example.com/callback';
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);

    await expect(service.completeOidcLogin('provider-down', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: 'OIDC token exchange failed: provider returned 503',
    });

    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ provider: 'oidc', userId: 'u1', email: 'sso@example.com', organizationId: 'org-uuid' }));
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad json'); } } as unknown as Response);

    await expect(service.completeOidcLogin('bad-json', 'code')).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('invalid JSON response'),
    });
  });

  it('handles logout without audit work when the refresh token or user is missing', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.logout('missing-refresh')).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2);

    mockQuery.mockResolvedValueOnce([{ user_id: 'user-uuid' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.logout('missing-user')).resolves.toBeUndefined();
  });

  it('writes an audit event when logout resolves a user', async () => {
    mockQuery
      .mockResolvedValueOnce([{ user_id: 'user-uuid' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'user-uuid', email: 'user@example.com', role: 'viewer', organization_id: 'org-uuid' }])
      .mockResolvedValueOnce([]);

    await service.logout('refresh-token');

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_log'), expect.arrayContaining(['logout_success']));
  });

  it('rejects refresh when the stored user is inactive or missing', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    mockQuery.mockResolvedValueOnce([{ user_id: 'user-uuid', expires_at: futureDate }]).mockResolvedValueOnce([]);

    await expect(service.refresh('valid-but-user-missing')).rejects.toMatchObject({
      statusCode: 401,
      message: 'User not found or inactive',
    });
  });
});
