#!/usr/bin/env node
const { spawnSync } = require('child_process');

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
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

const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
const auditEndpointForbidden =
  combinedOutput.includes('e403') ||
  combinedOutput.includes('403 forbidden') ||
  combinedOutput.includes('code e403') ||
  combinedOutput.includes('status code 403');

if (auditEndpointForbidden) {
  console.warn(
    'Skipping npm audit: audit endpoint returned 403 Forbidden in this environment.',
  );
  process.exit(0);
}

process.exit(result.status || 1);
