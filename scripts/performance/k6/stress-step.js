import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, THRESHOLDS, readinessLatency } from './common.js';

const t = THRESHOLDS.k6.stressStep;

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
    http_req_failed: [`rate<${t.httpReqFailedRate}`],
    http_req_duration: [`p(95)<${t.p95Ms}`, `p(99)<${t.p99Ms}`],
    readiness_latency: [`p(95)<${t.readinessP95Ms}`],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health/ready`, { tags: { endpoint: 'health_ready' } });
  readinessLatency.add(response.timings.duration);
  check(response, { 'step stress health reachable': (r) => r.status === 200 || r.status === 503 });
}
