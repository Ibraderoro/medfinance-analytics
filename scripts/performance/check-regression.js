#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const thresholds = require('./perf-thresholds.json');

const outputDir = path.resolve(process.cwd(), 'artifacts/performance');
const baselinePath = path.join(outputDir, 'baseline.json');
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
    console.warn(`Unable to read JSON artifact ${filePath}: ${error.message}`);
    return null;
  }
}

function buildSnapshot() {
  const snapshot = { generatedAt: new Date().toISOString(), apiBench: {}, k6: {} };

  const apiBench = readJson(latestFile('api-bench-'));
  for (const row of apiBench?.results || []) {
    if (row.skipped) continue;
    const key = `${row.profile}:${row.endpoint}`;
    snapshot.apiBench[key] = {
      p95: row.latencyMs?.p95,
      p99: row.latencyMs?.p99,
      throughput: Number(row.requests) || 0,
    };
  }

  const k6Scenarios = {
    ci: latestFile('k6-load-ci-'),
    smoke: latestFile('k6-load-smoke-'),
    peak: latestFile('k6-load-peak-'),
  };

  for (const [name, filePath] of Object.entries(k6Scenarios)) {
    const result = readJson(filePath);
    if (!result?.metrics) continue;
    const durationValues = result.metrics.http_req_duration?.values || {};
    const reqsValues = result.metrics.http_reqs?.values || {};
    snapshot.k6[name] = {
      p95: durationValues['p(95)'],
      p99: durationValues['p(99)'],
      throughput: reqsValues.rate,
    };
  }

  return snapshot;
}

function deltaPct(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function evaluateLatencyMetric(scope, key, metricName, current, baseline) {
  const delta = deltaPct(current, baseline);
  if (delta === null) return null;
  const { warnTolerancePct, p95TolerancePct } = thresholds.regression;
  if (delta > p95TolerancePct) {
    return { level: 'fail', message: `${scope} ${key} ${metricName} regressed ${delta.toFixed(1)}% vs baseline (${baseline.toFixed(1)}ms -> ${current.toFixed(1)}ms, tolerance ${p95TolerancePct}%)` };
  }
  if (delta > warnTolerancePct) {
    return { level: 'warn', message: `${scope} ${key} ${metricName} drifted ${delta.toFixed(1)}% vs baseline (${baseline.toFixed(1)}ms -> ${current.toFixed(1)}ms, watch tolerance ${warnTolerancePct}%)` };
  }
  return null;
}

function evaluateThroughputMetric(scope, key, current, baseline) {
  const delta = deltaPct(current, baseline);
  if (delta === null) return null;
  const { warnTolerancePct, throughputTolerancePct } = thresholds.regression;
  const drop = -delta;
  if (drop > throughputTolerancePct) {
    return { level: 'fail', message: `${scope} ${key} throughput dropped ${drop.toFixed(1)}% vs baseline (${baseline.toFixed(1)} -> ${current.toFixed(1)} req/s, tolerance ${throughputTolerancePct}%)` };
  }
  if (drop > warnTolerancePct) {
    return { level: 'warn', message: `${scope} ${key} throughput dropped ${drop.toFixed(1)}% vs baseline (${baseline.toFixed(1)} -> ${current.toFixed(1)} req/s, watch tolerance ${warnTolerancePct}%)` };
  }
  return null;
}

function checkRequiredMetrics(scope, key, currentMetrics, findings) {
  for (const metricName of ['p95', 'p99', 'throughput']) {
    if (!Number.isFinite(currentMetrics[metricName])) {
      findings.push({ level: 'fail', message: `${scope} ${key} is missing a valid current ${metricName} value` });
    }
  }
}

function checkMissingFromCurrent(scope, baselineKeys, currentKeys, findings) {
  for (const key of baselineKeys) {
    if (!currentKeys.has(key)) {
      findings.push({ level: 'fail', message: `${scope} ${key} is present in baseline but missing from the current run` });
    }
  }
}

function compare(current, baseline) {
  const findings = [];

  for (const [key, currentMetrics] of Object.entries(current.apiBench)) {
    checkRequiredMetrics('api-bench', key, currentMetrics, findings);
    const baselineMetrics = baseline.apiBench?.[key];
    if (!baselineMetrics) continue;
    for (const metricName of ['p95', 'p99']) {
      const finding = evaluateLatencyMetric('api-bench', key, metricName, currentMetrics[metricName], baselineMetrics[metricName]);
      if (finding) findings.push(finding);
    }
    const throughputFinding = evaluateThroughputMetric('api-bench', key, currentMetrics.throughput, baselineMetrics.throughput);
    if (throughputFinding) findings.push(throughputFinding);
  }
  checkMissingFromCurrent('api-bench', Object.keys(baseline.apiBench || {}), new Set(Object.keys(current.apiBench)), findings);

  for (const [scenario, currentMetrics] of Object.entries(current.k6)) {
    checkRequiredMetrics('k6', scenario, currentMetrics, findings);
    const baselineMetrics = baseline.k6?.[scenario];
    if (!baselineMetrics) continue;
    for (const metricName of ['p95', 'p99']) {
      const finding = evaluateLatencyMetric('k6', scenario, metricName, currentMetrics[metricName], baselineMetrics[metricName]);
      if (finding) findings.push(finding);
    }
    const throughputFinding = evaluateThroughputMetric('k6', scenario, currentMetrics.throughput, baselineMetrics.throughput);
    if (throughputFinding) findings.push(throughputFinding);
  }
  checkMissingFromCurrent('k6', Object.keys(baseline.k6 || {}), new Set(Object.keys(current.k6)), findings);

  return findings;
}

fs.mkdirSync(outputDir, { recursive: true });

const current = buildSnapshot();
const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : null;

let findings = [];
if (!baseline) {
  console.log('No baseline.json found — skipping regression comparison for this run (baseline will be established once one is persisted).');
} else {
  findings = compare(current, baseline);
}

const report = {
  generatedAt: new Date().toISOString(),
  hasBaseline: Boolean(baseline),
  tolerances: thresholds.regression,
  findings,
  outcome: findings.some((item) => item.level === 'fail') ? 'failed' : 'passed',
};

const jsonPath = path.join(outputDir, `regression-${runId}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const mdLines = [
  `# Performance Regression Report (${runId})`,
  '',
  `Outcome: **${report.outcome.toUpperCase()}**`,
  '',
  baseline ? '## Findings' : '## Findings',
  '',
];

if (!baseline) {
  mdLines.push('- No baseline available yet; this run will seed the next baseline.');
} else if (findings.length === 0) {
  mdLines.push('- No regressions detected vs baseline.');
} else {
  for (const finding of findings) {
    mdLines.push(`- [${finding.level.toUpperCase()}] ${finding.message}`);
  }
}

const mdPath = path.join(outputDir, `regression-${runId}.md`);
fs.writeFileSync(mdPath, mdLines.join('\n'));

// Always write the current run's trimmed snapshot; the CI workflow decides whether to
// persist it as the new baseline (only on successful main-branch runs).
fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2));

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Updated ${baselinePath}`);

if (report.outcome === 'failed') {
  process.exit(1);
}
