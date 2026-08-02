#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const autocannon = require('autocannon');
const thresholds = require('./perf-thresholds.json');

const baseUrl = (process.env.PERF_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '');
const outputDir = path.resolve(process.cwd(), 'artifacts/performance');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseSetCookie(setCookieValues) {
  if (!setCookieValues) return '';
  const values = Array.isArray(setCookieValues) ? setCookieValues : [setCookieValues];
  return values
    .map((value) => value.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function loginAndGetCookie() {
  if (process.env.PERF_AUTH_COOKIE) return process.env.PERF_AUTH_COOKIE;

  const email = process.env.PERF_EMAIL;
  const password = process.env.PERF_PASSWORD;
  const organizationId = process.env.PERF_ORGANIZATION_ID;
  if (!email || !password || !organizationId) return '';

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, organizationId }),
  });

  if (!response.ok) {
    console.warn(`Login bootstrap failed (${response.status}); authenticated benchmarks may fail.`);
    return '';
  }

  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie');
  return parseSetCookie(cookies);
}

function benchEndpoint({ title, method, path: routePath, body, headers, connections, durationSeconds }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `${baseUrl}${routePath}`,
      method,
      headers,
      body,
      connections,
      duration: durationSeconds,
      pipelining: 1,
      timeout: 30,
    }, (err, result) => {
      if (err) reject(err);
      else resolve({ title, routePath, method, result });
    });

    autocannon.track(instance, { renderProgressBar: false, renderLatencyTable: false, renderResultsTable: false });
  });
}

function buildQuery(profile, basePath) {
  if (profile === 'warm') return basePath;
  const sep = basePath.includes('?') ? '&' : '?';
  return `${basePath}${sep}cacheBust=${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function summarize(entry) {
  const { title, routePath, method, result } = entry;
  return {
    title,
    endpoint: `${method} ${routePath}`,
    requests: result.requests.average,
    throughputBytes: result.throughput.average,
    latencyMs: {
      p50: result.latency.p50,
      p95: result.latency.p95,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    non2xx: result.non2xx,
    timeouts: result.timeouts,
    errors: result.errors,
  };
}

(async () => {
  ensureDir(outputDir);
  const authCookie = await loginAndGetCookie();

  const commonHeaders = { accept: 'application/json' };
  if (authCookie) commonHeaders.cookie = authCookie;

  const loginBody = JSON.stringify({
    email: process.env.PERF_EMAIL || 'perf-user@example.com',
    password: process.env.PERF_PASSWORD || 'password123',
    organizationId: process.env.PERF_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000000',
  });

  const endpointDefs = [
    { title: 'Health readiness', method: 'GET', path: '/health/ready', auth: false },
    { title: 'Financial summary', method: 'GET', path: '/financials/summary?year=2026&period=monthly', auth: true },
    { title: 'Financial KPIs', method: 'GET', path: '/financials/kpis?year=2026&period=monthly', auth: true },
    { title: 'Compliance status', method: 'GET', path: '/compliance/status', auth: true },
    { title: 'Forecasting', method: 'GET', path: '/forecasting/forecast?months=12&metric=revenue', auth: true },
    { title: 'Insights', method: 'GET', path: '/insights', auth: true },
    { title: 'Auth login', method: 'POST', path: '/auth/login', auth: false, body: loginBody, headers: { 'content-type': 'application/json' } },
  ];

  const profiles = [
    { name: 'warm', connections: Number(process.env.PERF_BENCH_CONNECTIONS_WARM || 20), durationSeconds: Number(process.env.PERF_BENCH_DURATION_WARM || 30) },
    { name: 'cold', connections: Number(process.env.PERF_BENCH_CONNECTIONS_COLD || 20), durationSeconds: Number(process.env.PERF_BENCH_DURATION_COLD || 30) },
  ];

  const results = [];

  for (const profile of profiles) {
    for (const endpoint of endpointDefs) {
      const headers = { ...commonHeaders, ...(endpoint.headers || {}) };
      if (endpoint.auth && !authCookie) {
        results.push({
          profile: profile.name,
          title: endpoint.title,
          endpoint: `${endpoint.method} ${endpoint.path}`,
          skipped: true,
          reason: 'No auth cookie available (set PERF_AUTH_COOKIE or PERF_EMAIL/PERF_PASSWORD/PERF_ORGANIZATION_ID).',
        });
        continue;
      }

      const entry = await benchEndpoint({
        title: `${endpoint.title} (${profile.name})`,
        method: endpoint.method,
        path: buildQuery(profile.name, endpoint.path),
        body: endpoint.body,
        headers,
        connections: profile.connections,
        durationSeconds: profile.durationSeconds,
      });

      results.push({ profile: profile.name, ...summarize(entry) });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    assumptions: {
      readApiP95Ms: thresholds.apiBench.p95Ms,
      readApiP99Ms: thresholds.apiBench.p99Ms,
      // Intentionally fixed, not sourced from perf-thresholds.json: this is
      // descriptive metadata for the warm/cold api-bench profiles, not a k6
      // profile — there's no single k6 readinessP95Ms (ci/smoke/peak/stress/soak
      // each have their own) that correctly maps to it.
      readinessP95Ms: 80,
      errorRateMax: thresholds.apiBench.non2xxRate,
    },
    results,
  };

  const jsonPath = path.join(outputDir, `api-bench-${runId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));

  const mdLines = [
    `# API Benchmark Report (${runId})`,
    '',
    `Base URL: ${baseUrl}`,
    '',
    '| Profile | Endpoint | Req/s | p50 (ms) | p95 (ms) | p99 (ms) | Non-2xx | Timeouts |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const result of results) {
    if (result.skipped) {
      mdLines.push(`| ${result.profile} | ${result.endpoint} | skipped | - | - | - | - | - |`);
      continue;
    }
    mdLines.push(`| ${result.profile} | ${result.endpoint} | ${Number(result.requests).toFixed(2)} | ${result.latencyMs.p50} | ${result.latencyMs.p95} | ${result.latencyMs.p99} | ${result.non2xx} | ${result.timeouts} |`);
  }

  const mdPath = path.join(outputDir, `api-bench-${runId}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
})();
