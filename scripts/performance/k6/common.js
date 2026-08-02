import http from 'k6/http';
import { Trend } from 'k6/metrics';

export const THRESHOLDS = JSON.parse(open('../perf-thresholds.json'));

export const readinessLatency = new Trend('readiness_latency');

export const BASE_URL = (__ENV.PERF_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '');

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getUsers() {
  if (__ENV.PERF_USERS_JSON) {
    const parsed = parseJson(__ENV.PERF_USERS_JSON, []);
    if (Array.isArray(parsed)) return parsed;
  }

  if (__ENV.PERF_EMAIL && __ENV.PERF_PASSWORD && __ENV.PERF_ORGANIZATION_ID) {
    return [{
      email: __ENV.PERF_EMAIL,
      password: __ENV.PERF_PASSWORD,
      organizationId: __ENV.PERF_ORGANIZATION_ID,
      weight: 1,
    }];
  }

  return [];
}

export function weightedPick(items) {
  if (!items || items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + (Number(item.weight) > 0 ? Number(item.weight) : 1), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Number(item.weight) > 0 ? Number(item.weight) : 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function loginSession(user) {
  const payload = JSON.stringify({
    email: user.email,
    password: user.password,
    organizationId: user.organizationId,
  });

  const loginResponse = http.post(`${BASE_URL}/auth/login`, payload, {
    headers: { 'content-type': 'application/json' },
    tags: { endpoint: 'auth_login' },
  });

  const accessToken = loginResponse.cookies?.medfinance_access_token?.[0]?.value;
  const refreshToken = loginResponse.cookies?.medfinance_refresh_token?.[0]?.value;
  const csrf = loginResponse.cookies?.csrf_token?.[0]?.value;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    cookie: `medfinance_access_token=${accessToken}; medfinance_refresh_token=${refreshToken}${csrf ? `; csrf_token=${csrf}` : ''}`,
    csrfToken: csrf || '',
    user,
  };
}

export function authHeaders(session) {
  if (!session?.cookie) return {};
  const headers = {
    cookie: session.cookie,
    accept: 'application/json',
  };
  if (session.csrfToken) headers['x-csrf-token'] = session.csrfToken;
  return headers;
}

export function recordReadiness() {
  const response = http.get(`${BASE_URL}/health/ready`, { tags: { endpoint: 'health_ready' } });
  readinessLatency.add(response.timings.duration);
  return response;
}
