#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '..', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const wsPkg = lock?.packages?.['node_modules/ws'];
if (!wsPkg || typeof wsPkg.version !== 'string') {
  console.error('Lockfile does not contain node_modules/ws version metadata.');
  process.exit(1);
}

if (wsPkg.version === '8.20.0') {
  console.error('Lockfile still pins vulnerable ws@8.20.0 (GHSA-58qx-3vcg-4xpx). Refresh lockfile in CI/provisioned environment to 8.20.1+.');
  process.exit(1);
}

console.log(`Lockfile ws version is ${wsPkg.version}; vulnerable ws@8.20.0 not present.`);
