import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, readinessLatency } from './common.js';

const duration = __ENV.PERF_SOAK_DURATION || '2h';

export const options = {
  scenarios: {
    peak_soak: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.PERF_SOAK_RATE || 400),
      timeUnit: '1s',
      duration,
      preAllocatedVUs: Number(__ENV.PERF_SOAK_PREALLOCATED_VUS || 200),
      maxVUs: Number(__ENV.PERF_SOAK_MAX_VUS || 1000),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<300', 'p(99)<700'],
    readiness_latency: ['p(95)<100'],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health/ready`, { tags: { endpoint: 'health_ready' } });
  readinessLatency.add(response.timings.duration);
  check(response, { 'soak health reachable': (r) => r.status === 200 || r.status === 503 });
}
