#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outputDir = path.resolve(process.cwd(), 'artifacts/performance');

const artifactPrefixes = {
  smoke: 'k6-load-smoke',
  peak: 'k6-load-peak',
  'stress-step': 'k6-stress-step',
  'stress-spike': 'k6-stress-spike',
  soak: 'k6-soak',
};

const [profile, scriptName, ...extraArgs] = process.argv.slice(2);

if (!profile || !scriptName) {
  console.error('Usage: node scripts/performance/k6-runner.js <profile> <script-name> [k6 args...]');
  process.exit(1);
}

const prefix = artifactPrefixes[profile] || `k6-${profile}`;
const scriptPath = path.join('scripts', 'performance', 'k6', `${scriptName}.js`);
const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace(/\d{3}Z$/, 'Z');
const summaryPath = path.join(outputDir, `${prefix}-${timestamp}.json`);

fs.mkdirSync(outputDir, { recursive: true });

const env = { ...process.env, PERF_PROFILE: process.env.PERF_PROFILE || profile };
const args = ['run', scriptPath, '--summary-export', summaryPath, ...extraArgs];
const result = spawnSync('k6', args, { encoding: 'utf8', env, stdio: 'inherit' });

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error('Unable to find k6. Install k6 and ensure it is available on PATH before running performance load scripts.');
  } else {
    console.error(`Failed to run k6: ${result.error.message}`);
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
