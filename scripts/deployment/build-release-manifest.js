#!/usr/bin/env node
const fs = require('node:fs');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertDigest(image, name) {
  if (!/@sha256:[a-f0-9]{64}$/i.test(image)) {
    throw new Error(`${name} must be an immutable image reference ending in @sha256:<64 hex chars>`);
  }
}

const manifest = {
  schemaVersion: 1,
  app: 'medfinance-analytics',
  environment: required('DEPLOY_ENVIRONMENT'),
  version: required('RELEASE_VERSION'),
  gitSha: required('GITHUB_SHA'),
  githubRunId: process.env.GITHUB_RUN_ID || 'local',
  createdAt: new Date().toISOString(),
  images: {
    backend: required('BACKEND_IMAGE'),
    frontend: required('FRONTEND_IMAGE'),
  },
  deployment: {
    strategy: 'blue-green',
    managedDataStores: true,
    backendPubliclyExposed: false,
  },
};

assertDigest(manifest.images.backend, 'BACKEND_IMAGE');
assertDigest(manifest.images.frontend, 'FRONTEND_IMAGE');

const output = process.env.RELEASE_MANIFEST_PATH || 'release-manifest.json';
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${output}`);
