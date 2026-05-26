#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '..', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

function isRuntimeQsPath(name) {
  if (!name || !name.endsWith('/qs')) {
    return false;
  }

  // Ignore type packages such as node_modules/@types/qs.
  if (name.includes('/@types/qs')) {
    return false;
  }

  return true;
}

function parseVersion(version) {
  const [major, minor, patch] = String(version || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  if ([major, minor, patch].some(Number.isNaN)) {
    return null;
  }

  return { major, minor, patch };
}

function isVulnerableRuntimeQsVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return true;
  }

  if (parsed.major !== 6) {
    // Guardrail: scanner policy for this repo requires qs 6.15.2+.
    return true;
  }

  if (parsed.minor < 15) {
    return true;
  }

  if (parsed.minor === 15 && parsed.patch < 2) {
    return true;
  }

  return false;
}

const allPackages = Object.entries(lock?.packages ?? {});
const runtimeQsPackages = allPackages
  .filter(([name]) => isRuntimeQsPath(name))
  .map(([name, meta]) => ({ name, version: meta?.version }));

const vulnerable = runtimeQsPackages.filter((pkg) => isVulnerableRuntimeQsVersion(pkg.version));

if (vulnerable.length > 0) {
  console.error('Lockfile contains vulnerable runtime qs versions (GHSA-q8mj-m7cp-5q26):');
  for (const pkg of vulnerable) {
    console.error(`- ${pkg.name}@${pkg.version}`);
  }
  console.error('Refresh lockfile to runtime qs@6.15.2+ and rerun scanners.');
  process.exit(1);
}

const rootRuntimeQs = lock?.packages?.['node_modules/qs'];
if (!rootRuntimeQs || typeof rootRuntimeQs.version !== 'string') {
  console.error('Lockfile does not contain runtime node_modules/qs version metadata.');
  process.exit(1);
}

if (isVulnerableRuntimeQsVersion(rootRuntimeQs.version)) {
  console.error(`Root runtime qs is vulnerable: ${rootRuntimeQs.version}. Require qs@6.15.2+.`);
  process.exit(1);
}

console.log(`Runtime lockfile qs version is ${rootRuntimeQs.version}; vulnerable runtime qs versions are not present.`);
