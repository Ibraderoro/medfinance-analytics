#!/usr/bin/env node
const fs = require('node:fs');

function parseArgs(argv) {
  const args = { file: 'release-manifest.json' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--file') {
      args.file = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDigest(image, name) {
  assert(typeof image === 'string', `${name} must be a string`);
  assert(/^[^:]+(?::\d+)?\/[^@]+@sha256:[a-f0-9]{64}$/i.test(image) || /^ghcr\.io\/[^@]+@sha256:[a-f0-9]{64}$/i.test(image), `${name} must be pinned to an immutable digest`);
  assert(!image.includes(':latest'), `${name} must not use the mutable latest tag`);
}

try {
  const { file } = parseArgs(process.argv);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(manifest.schemaVersion === 1, 'schemaVersion must be 1');
  assert(manifest.app === 'medfinance-analytics', 'unexpected app');
  assert(['staging', 'production'].includes(manifest.environment), 'environment must be staging or production');
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'version is required');
  assert(typeof manifest.gitSha === 'string' && /^[a-f0-9]{40}$/i.test(manifest.gitSha), 'gitSha must be a 40-character SHA');
  assertDigest(manifest.images?.backend, 'images.backend');
  assertDigest(manifest.images?.frontend, 'images.frontend');
  assert(manifest.deployment?.strategy === 'blue-green', 'deployment.strategy must be blue-green');
  assert(manifest.deployment?.managedDataStores === true, 'managedDataStores must be true');
  assert(manifest.deployment?.backendPubliclyExposed === false, 'backendPubliclyExposed must be false');
  console.log(`Release manifest validated: ${file}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
