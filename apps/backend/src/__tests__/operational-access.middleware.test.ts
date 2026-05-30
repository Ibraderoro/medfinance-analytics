type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function makeResponse(): MockResponse {
  const status = jest.fn();
  const json = jest.fn();
  status.mockReturnValue({ json });
  return { status, json };
}

function makeRequest(options: { ip: string; headers?: Record<string, string> }) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    ip: options.ip,
    socket: { remoteAddress: options.ip },
    method: 'GET',
    originalUrl: '/api/v1/internal/observability/metrics',
    requestId: 'req_ops_test',
    header: (name: string) => normalizedHeaders[name.toLowerCase()],
  };
}

describe('operational access middleware', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPS_ALLOWLIST_CIDRS;
    delete process.env.OPS_ENDPOINT_AUTH_ENABLED;
    delete process.env.OPS_ENDPOINT_AUTH_TOKEN;
  });

  it('allows allowlisted requests when optional auth is disabled', () => {
    process.env.OPS_ALLOWLIST_CIDRS = '127.0.0.1/32';
    process.env.OPS_ENDPOINT_AUTH_ENABLED = 'false';

    const { enforceOperationalAccess } = require('../middleware/operationalAccess');
    const middleware = enforceOperationalAccess('metrics_prometheus');
    const res = makeResponse();
    const next = jest.fn();

    middleware(makeRequest({ ip: '127.0.0.1' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('denies requests from IPs outside the operational allowlist', () => {
    process.env.OPS_ALLOWLIST_CIDRS = '127.0.0.1/32';
    process.env.OPS_ENDPOINT_AUTH_ENABLED = 'false';

    const { enforceOperationalAccess } = require('../middleware/operationalAccess');
    const middleware = enforceOperationalAccess('health_ready');
    const res = makeResponse();
    const next = jest.fn();

    middleware(makeRequest({ ip: '203.0.113.12' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('denies allowlisted requests when token auth is enabled and missing', () => {
    process.env.OPS_ALLOWLIST_CIDRS = '127.0.0.1/32';
    process.env.OPS_ENDPOINT_AUTH_ENABLED = 'true';
    process.env.OPS_ENDPOINT_AUTH_TOKEN = 'super-secret-ops-token';

    const { enforceOperationalAccess } = require('../middleware/operationalAccess');
    const middleware = enforceOperationalAccess('metrics_summary');
    const res = makeResponse();
    const next = jest.fn();

    middleware(makeRequest({ ip: '127.0.0.1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows allowlisted requests with a valid bearer token when auth is enabled', () => {
    process.env.OPS_ALLOWLIST_CIDRS = '127.0.0.1/32';
    process.env.OPS_ENDPOINT_AUTH_ENABLED = 'true';
    process.env.OPS_ENDPOINT_AUTH_TOKEN = 'super-secret-ops-token';

    const { enforceOperationalAccess } = require('../middleware/operationalAccess');
    const middleware = enforceOperationalAccess('metrics_summary');
    const res = makeResponse();
    const next = jest.fn();

    middleware(
      makeRequest({
        ip: '127.0.0.1',
        headers: { authorization: ['Bearer', 'super-secret-ops-token'].join(' ') },
      }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
