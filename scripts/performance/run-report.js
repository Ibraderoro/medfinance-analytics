#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

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
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function evaluateApiBench(apiBench) {
  if (!apiBench?.results) return [];
  const findings = [];
  for (const row of apiBench.results) {
    if (row.skipped) {
      findings.push({ level: 'warn', message: `Skipped benchmark: ${row.endpoint} (${row.reason})` });
      continue;
    }
    if (row.latencyMs?.p95 > 250) findings.push({ level: 'fail', message: `${row.endpoint} p95 ${row.latencyMs.p95}ms exceeds 250ms target` });
    if (row.latencyMs?.p99 > 600) findings.push({ level: 'fail', message: `${row.endpoint} p99 ${row.latencyMs.p99}ms exceeds 600ms target` });
    const reqs = Number(row.requests) || 0;
    const non2xxRate = reqs > 0 ? Number(row.non2xx || 0) / reqs : 0;
    if (non2xxRate > 0.01) findings.push({ level: 'fail', message: `${row.endpoint} non-2xx rate ${(non2xxRate * 100).toFixed(2)}% exceeds 1% target` });
  }
  return findings;
}

const apiBenchPath = latestFile('api-bench-');
const dbPath = latestFile('db-analysis-');
const redisPath = latestFile('redis-check-');
const loadSmokePath = latestFile('k6-load-smoke-');
const loadPeakPath = latestFile('k6-load-peak-');
const stressStepPath = latestFile('k6-stress-step-');
const stressSpikePath = latestFile('k6-stress-spike-');
const soakPath = latestFile('k6-soak-');

const apiBench = readJson(apiBenchPath);
const dbAnalysis = readJson(dbPath);
const redisCheck = readJson(redisPath);

const findings = [
  ...evaluateApiBench(apiBench),
];

if (dbAnalysis?.results?.some((result) => result.status !== 0)) {
  findings.push({ level: 'fail', message: 'Database analysis contains failed query blocks' });
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
    k6: {
      loadSmoke: loadSmokePath,
      loadPeak: loadPeakPath,
      stressStep: stressStepPath,
      stressSpike: stressSpikePath,
      soak: soakPath,
    },
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
  `- k6 load smoke: ${loadSmokePath || 'missing'}`,
  `- k6 load peak: ${loadPeakPath || 'missing'}`,
  `- k6 stress step: ${stressStepPath || 'missing'}`,
  `- k6 stress spike: ${stressSpikePath || 'missing'}`,
  `- k6 soak: ${soakPath || 'missing'}`,
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
