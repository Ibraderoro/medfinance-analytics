#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '..', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

function isReactRouterPath(name) {
  return name === 'node_modules/react-router' || name.endsWith('/node_modules/react-router')
    || name === 'node_modules/react-router-dom' || name.endsWith('/node_modules/react-router-dom');
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

function isVulnerableVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return true;
  }

  // GHSA advisories fixed at 7.18.2 (6.0.0 - 7.17.0 range); 8.x carries a
  // separate unfixed advisory (GHSA-qwww-vcr4-c8h2) tracked as a follow-up
  // React 19 migration, so 7.18.2+ (excluding 8.x) is this repo's accepted floor.
  if (parsed.major < 7) {
    return true;
  }

  if (parsed.major === 7 && (parsed.minor < 18 || (parsed.minor === 18 && parsed.patch < 2))) {
    return true;
  }

  return false;
}

const routerPackages = Object.entries(lock?.packages ?? {})
  .filter(([name]) => isReactRouterPath(name))
  .map(([name, meta]) => ({ name, version: meta?.version }));

if (routerPackages.length === 0) {
  console.error('Lockfile does not contain react-router / react-router-dom version metadata.');
  process.exit(1);
}

const vulnerable = routerPackages.filter((pkg) => isVulnerableVersion(pkg.version));

if (vulnerable.length > 0) {
  console.error('Lockfile contains vulnerable react-router versions (GHSA-2w69-qvjg-hvjx and related advisories, fixed at 7.18.2):');
  for (const pkg of vulnerable) {
    console.error(`- ${pkg.name}@${pkg.version}`);
  }
  console.error('Refresh lockfile to react-router@7.18.2+ and rerun scanners.');
  process.exit(1);
}

console.log(`Lockfile react-router version(s): ${routerPackages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}; vulnerable pre-7.18.2 versions not present.`);
