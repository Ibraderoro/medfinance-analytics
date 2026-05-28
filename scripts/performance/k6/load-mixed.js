import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, getUsers, loginSession, weightedPick, authHeaders, readinessLatency, recordReadiness } from './common.js';

const profile = __ENV.PERF_PROFILE || 'smoke';

const profileSettings = {
  smoke: { rate: 80, duration: '5m', preAllocatedVUs: 40, maxVUs: 120, minThroughput: 60 },
  peak: { rate: 400, duration: '15m', preAllocatedVUs: 160, maxVUs: 600, minThroughput: 300 },
};

const activeProfile = profileSettings[profile] || profileSettings.smoke;

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: 'constant-arrival-rate',
      rate: activeProfile.rate,
      timeUnit: '1s',
      duration: activeProfile.duration,
      preAllocatedVUs: activeProfile.preAllocatedVUs,
      maxVUs: activeProfile.maxVUs,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250', 'p(99)<600'],
    readiness_latency: ['p(95)<80'],
    http_reqs: [`rate>${activeProfile.minThroughput}`],
  },
};

const routes = [
  { weight: 25, method: 'GET', path: '/financials/summary?year=2026&period=monthly', auth: true, tag: 'financials_summary' },
  { weight: 10, method: 'GET', path: '/financials/kpis?year=2026&period=monthly', auth: true, tag: 'financials_kpis' },
  { weight: 7, method: 'GET', path: '/financials/revenue?startDate=2026-01-01&endDate=2026-12-31', auth: true, tag: 'financials_revenue' },
  { weight: 7, method: 'GET', path: '/financials/expenses?startDate=2026-01-01&endDate=2026-12-31', auth: true, tag: 'financials_expenses' },
  { weight: 6, method: 'GET', path: '/financials/cash-flow?startDate=2026-01-01&endDate=2026-12-31', auth: true, tag: 'financials_cash_flow' },
  { weight: 15, method: 'GET', path: '/compliance/status', auth: true, tag: 'compliance_status' },
  { weight: 10, method: 'GET', path: '/forecasting/forecast?months=12&metric=revenue', auth: true, tag: 'forecasting' },
  { weight: 10, method: 'GET', path: '/insights', auth: true, tag: 'insights' },
  { weight: 3, method: 'POST', path: '/auth/login', auth: false, tag: 'auth_login' },
  { weight: 2, method: 'POST', path: '/auth/refresh', auth: true, tag: 'auth_refresh', bodyType: 'refresh' },
  { weight: 4, method: 'GET', path: '/health/ready', auth: false, tag: 'health_ready' },
  { weight: 1, method: 'GET', path: '/admin/metrics?windowMinutes=60&activeWindowMinutes=5', auth: 'admin', tag: 'admin_metrics' },
];

function routePick() {
  return weightedPick(routes);
}

function runRoute(route, sessions, adminCookie, loginUsers) {
  if (route.path === '/health/ready') {
    const response = recordReadiness();
    check(response, { 'health ready status': (r) => r.status === 200 || r.status === 503 });
    return;
  }

  if (route.path === '/auth/login') {
    const picked = weightedPick(loginUsers);
    if (!picked) {
      recordReadiness();
      return;
    }

    const payload = JSON.stringify({ email: picked.email, password: picked.password, organizationId: picked.organizationId });
    const response = http.post(`${BASE_URL}${route.path}`, payload, {
      headers: { 'content-type': 'application/json' },
      tags: { endpoint: route.tag },
    });
    check(response, { 'login reachable': (r) => r.status >= 200 && r.status < 500 });
    return;
  }

  let headers = { accept: 'application/json' };

  if (route.auth === true) {
    const session = weightedPick(sessions);
    if (!session) {
      recordReadiness();
      return;
    }
    headers = authHeaders(session);
  } else if (route.auth === 'admin') {
    if (!adminCookie) {
      recordReadiness();
      return;
    }
    headers = { accept: 'application/json', cookie: adminCookie };
  }

  if (route.bodyType === 'refresh') {
    const refreshToken = /medfinance_refresh_token=([^;]+)/.exec(headers.cookie || '')?.[1];
    const response = http.post(`${BASE_URL}${route.path}`, JSON.stringify({ refreshToken }), {
      headers: { ...headers, 'content-type': 'application/json' },
      tags: { endpoint: route.tag },
    });
    check(response, { 'refresh reachable': (r) => r.status >= 200 && r.status < 500 });
    return;
  }

  const response = http.request(route.method, `${BASE_URL}${route.path}`, null, {
    headers,
    tags: { endpoint: route.tag },
  });

  check(response, { 'request reachable': (r) => r.status >= 200 && r.status < 500 });
}

export function setup() {
  const users = getUsers();
  const sessions = users
    .map((user) => ({ ...loginSession(user), weight: Number(user.weight) > 0 ? Number(user.weight) : 1 }))
    .filter(Boolean);

  if (sessions.length === 0 && __ENV.PERF_AUTH_COOKIE) {
    sessions.push({ cookie: __ENV.PERF_AUTH_COOKIE, csrfToken: __ENV.PERF_CSRF_TOKEN || '', weight: 1 });
  }

  return {
    users,
    sessions,
    adminCookie: __ENV.PERF_ADMIN_COOKIE || '',
  };
}

export default function (data) {
  const route = routePick();
  runRoute(route, data.sessions, data.adminCookie, data.users);
}
