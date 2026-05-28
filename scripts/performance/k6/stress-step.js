import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, readinessLatency } from './common.js';

export const options = {
  scenarios: {
    step_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 200,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1200,
      stages: [
        { target: 400, duration: '5m' },
        { target: 600, duration: '5m' },
        { target: 800, duration: '5m' },
        { target: 1000, duration: '5m' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<400', 'p(99)<1000'],
    readiness_latency: ['p(95)<120'],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health/ready`, { tags: { endpoint: 'health_ready' } });
  readinessLatency.add(response.timings.duration);
  check(response, { 'step stress health reachable': (r) => r.status === 200 || r.status === 503 });
}
