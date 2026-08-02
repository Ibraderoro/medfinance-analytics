#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const thresholds = require('./perf-thresholds.json');

const outputDir = path.resolve(process.cwd(), 'artifacts/performance');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

function latestFile(prefix) {
  const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')) : [];
  if (files.length === 0) return null;
  files.sort();
  return path.join(outputDir, files[files.length - 1]);
}

function readJson(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read JSON artifact ${filePath}: ${error.message}`);
  }
}

function numberFromEnv(name, fallback) {
  const value = Number.parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function evaluateApiBench(apiBench) {
  if (!apiBench?.results) return [];
  const p95TargetMs = numberFromEnv('API_BENCH_P95_MS', thresholds.apiBench.p95Ms);
  const p99TargetMs = numberFromEnv('API_BENCH_P99_MS', thresholds.apiBench.p99Ms);
  const non2xxRateTarget = numberFromEnv('API_BENCH_NON2XX_RATE', thresholds.apiBench.non2xxRate);
  const findings = [];
  for (const row of apiBench.results) {
    if (row.skipped) {
      findings.push({ level: 'warn', message: `Skipped benchmark: ${row.endpoint} (${row.reason})` });
      continue;
    }
    if (row.latencyMs?.p95 > p95TargetMs) findings.push({ level: 'fail', message: `${row.endpoint} p95 ${row.latencyMs.p95}ms exceeds ${p95TargetMs}ms target` });
    if (row.latencyMs?.p99 > p99TargetMs) findings.push({ level: 'fail', message: `${row.endpoint} p99 ${row.latencyMs.p99}ms exceeds ${p99TargetMs}ms target` });
    const reqs = Number(row.requests) || 0;
    const non2xxRate = reqs > 0 ? Number(row.non2xx || 0) / reqs : 0;
    if (non2xxRate > non2xxRateTarget) findings.push({ level: 'fail', message: `${row.endpoint} non-2xx rate ${(non2xxRate * 100).toFixed(2)}% exceeds ${(non2xxRateTarget * 100).toFixed(2)}% target` });
  }
  return findings;
}

function evaluateK6Results(k6Entries) {
  const findings = [];

  for (const { name, result, thresholds: scenarioThresholds } of k6Entries) {
    if (!result) continue;

    const httpReqFailedRateTarget = numberFromEnv('K6_HTTP_REQ_FAILED_RATE', scenarioThresholds.httpReqFailedRate);
    const httpReqFailedRate = Number(result.metrics?.http_req_failed?.values?.rate ?? 0);
    if (httpReqFailedRate > httpReqFailedRateTarget) {
      findings.push({
        level: 'fail',
        message: `${name} http_req_failed rate ${(httpReqFailedRate * 100).toFixed(2)}% exceeds ${(httpReqFailedRateTarget * 100).toFixed(2)}% target`,
      });
    }

    const checkFails = Number(result.metrics?.checks?.values?.fails ?? 0);
    if (checkFails > 0) {
      findings.push({ level: 'fail', message: `${name} has ${checkFails} failed k6 checks` });
    }
  }

  return findings;
}

const K6_SCENARIOS = [
  { name: 'k6 load ci', key: 'loadCi', prefix: 'k6-load-ci-', thresholds: thresholds.k6.loadMixed.thresholds.ci },
  { name: 'k6 load smoke', key: 'loadSmoke', prefix: 'k6-load-smoke-', thresholds: thresholds.k6.loadMixed.thresholds.smoke },
  { name: 'k6 load peak', key: 'loadPeak', prefix: 'k6-load-peak-', thresholds: thresholds.k6.loadMixed.thresholds.peak },
  { name: 'k6 stress step', key: 'stressStep', prefix: 'k6-stress-step-', thresholds: thresholds.k6.stressStep },
  { name: 'k6 stress spike', key: 'stressSpike', prefix: 'k6-stress-spike-', thresholds: thresholds.k6.stressSpike },
  { name: 'k6 soak', key: 'soak', prefix: 'k6-soak-', thresholds: thresholds.k6.soakPeak },
];

const apiBenchPath = latestFile('api-bench-');
const dbPath = latestFile('db-analysis-');
const redisPath = latestFile('redis-check-');

const apiBench = readJson(apiBenchPath);
const dbAnalysis = readJson(dbPath);
const redisCheck = readJson(redisPath);
const k6Entries = K6_SCENARIOS.map((scenario) => {
  const filePath = latestFile(scenario.prefix);
  return { ...scenario, path: filePath, result: readJson(filePath) };
});

const findings = [
  ...evaluateApiBench(apiBench),
  ...evaluateK6Results(k6Entries),
];

if (dbAnalysis?.results?.some((result) => result.status !== 0 && !result.skipped)) {
  findings.push({ level: 'fail', message: 'Database analysis contains failed query blocks' });
}

const skippedDbQueries = dbAnalysis?.results?.filter((result) => result.skipped) || [];
for (const skipped of skippedDbQueries) {
  findings.push({ level: 'warn', message: `Database analysis skipped: ${skipped.description} (${skipped.stderr})` });
}

if (redisCheck?.checks?.some((check) => check.status !== 0)) {
  findings.push({ level: 'fail', message: 'Redis checks contain failed command blocks' });
}

const report = {
  generatedAt: new Date().toISOString(),
  artifacts: {
    apiBench: apiBenchPath,
    dbAnalysis: dbPath,
    redisCheck: redisPath,
    k6: Object.fromEntries(k6Entries.map((entry) => [entry.key, entry.path])),
  },
  findings,
  outcome: findings.some((item) => item.level === 'fail') ? 'failed' : 'passed',
};

fs.mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, `perf-report-${runId}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const mdLines = [
  `# Consolidated Performance Report (${runId})`,
  '',
  `Outcome: **${report.outcome.toUpperCase()}**`,
  '',
  '## Artifact references',
  '',
  `- API benchmark: ${apiBenchPath || 'missing'}`,
  `- Database analysis: ${dbPath || 'missing'}`,
  `- Redis check: ${redisPath || 'missing'}`,
  ...k6Entries.map((entry) => `- ${entry.name}: ${entry.path || 'missing'}`),
  '',
  '## Findings',
  '',
];

if (findings.length === 0) {
  mdLines.push('- No threshold violations detected in available artifacts.');
} else {
  for (const finding of findings) {
    mdLines.push(`- [${finding.level.toUpperCase()}] ${finding.message}`);
  }
}

const mdPath = path.join(outputDir, `perf-report-${runId}.md`);
fs.writeFileSync(mdPath, mdLines.join('\n'));

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);

if (report.outcome === 'failed') {
  process.exit(1);
}
