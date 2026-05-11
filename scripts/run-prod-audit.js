#!/usr/bin/env node
const { spawnSync } = require('child_process');

const AUDIT_TIMEOUT_MS = 5 * 60 * 1000;
const AUDIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  timeout: AUDIT_TIMEOUT_MS,
  maxBuffer: AUDIT_MAX_BUFFER_BYTES,
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status === 0) {
  process.exit(0);
}

let parsedAuditOutput = null;
try {
  parsedAuditOutput = result.stdout ? JSON.parse(result.stdout) : null;
} catch (error) {
  console.warn(`Could not parse npm audit JSON output: ${error.message}`);
  parsedAuditOutput = null;
}

const jsonErrorCode =
  parsedAuditOutput?.error?.code || parsedAuditOutput?.code;
const auditEndpointForbidden =
  String(jsonErrorCode || '').toUpperCase() === 'E403' ||
  /\bE403\b/i.test(result.stderr || '');

if (auditEndpointForbidden) {
  console.warn(
    'Skipping npm audit: audit endpoint returned 403 Forbidden in this environment.',
  );
  process.exit(0);
}

process.exit(result.status || 1);
