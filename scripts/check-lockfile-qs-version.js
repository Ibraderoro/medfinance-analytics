#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '..', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const allPackages = Object.entries(lock?.packages ?? {});
const vulnerable = allPackages
  .filter(([name]) => name.endsWith('/qs') || name === 'node_modules/qs')
  .map(([name, meta]) => ({ name, version: meta?.version }))
  .filter((pkg) => pkg.version === '6.14.2' || pkg.version === '6.15.1');

if (vulnerable.length > 0) {
  console.error('Lockfile contains vulnerable qs versions (GHSA-q8mj-m7cp-5q26):');
  for (const pkg of vulnerable) {
    console.error(`- ${pkg.name}@${pkg.version}`);
  }
  console.error('Refresh lockfile in CI/provisioned environment to qs@6.15.2+ and rerun scanners.');
  process.exit(1);
}

const qsPkg = lock?.packages?.['node_modules/qs'];
if (!qsPkg || typeof qsPkg.version !== 'string') {
  console.error('Lockfile does not contain node_modules/qs version metadata.');
  process.exit(1);
}

console.log(`Lockfile qs version is ${qsPkg.version}; vulnerable qs versions are not present.`);
