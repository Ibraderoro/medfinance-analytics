import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, THRESHOLDS, readinessLatency } from './common.js';

const t = THRESHOLDS.k6.stressSpike;

export const options = {
  scenarios: {
    spike_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 120,
      timeUnit: '1s',
      preAllocatedVUs: 120,
      maxVUs: 1200,
      stages: [
        { target: 120, duration: '2m' },
        { target: 700, duration: '30s' },
        { target: 900, duration: '90s' },
        { target: 120, duration: '3m' },
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
  check(response, { 'spike health reachable': (r) => r.status === 200 || r.status === 503 });
}
