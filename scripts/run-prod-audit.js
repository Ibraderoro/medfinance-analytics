#!/usr/bin/env node
const { spawnSync } = require('child_process');

const AUDIT_TIMEOUT_MS = 5 * 60 * 1000;
const AUDIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FAIL_SEVERITIES = ['critical', 'high'];

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

let parsedAuditOutput = null;
try {
  parsedAuditOutput = result.stdout ? JSON.parse(result.stdout) : null;
} catch (error) {
  console.error(`Could not parse npm audit JSON output: ${error.message}`);
  process.exit(1);
}

const errorMessage = [
  parsedAuditOutput?.message,
  parsedAuditOutput?.error?.summary,
  parsedAuditOutput?.error?.detail,
  result.stderr,
].filter(Boolean).join('\n');

if (parsedAuditOutput?.error || /audit endpoint returned an error/i.test(errorMessage)) {
  console.error(
    [
      'Production dependency audit did not complete.',
      'This is a release-blocking result because a failed/unavailable audit is not a clean vulnerability scan.',
      'Rerun in an environment that can reach the npm audit endpoint, or use the CI OSV scanner result as the signed release evidence.',
    ].join('\n'),
  );
  process.exit(1);
}

const vulnerabilities = parsedAuditOutput?.metadata?.vulnerabilities;
if (!vulnerabilities) {
  console.error('Production dependency audit did not include vulnerability metadata.');
  process.exit(1);
}

const failingCounts = FAIL_SEVERITIES
  .map((severity) => [severity, Number(vulnerabilities[severity] ?? 0)])
  .filter(([, count]) => count > 0);

if (failingCounts.length > 0) {
  console.error(
    `Production dependency audit found release-blocking vulnerabilities: ${failingCounts
      .map(([severity, count]) => `${count} ${severity}`)
      .join(', ')}.`,
  );
  process.exit(1);
}

console.error('Production dependency audit completed with no high or critical vulnerabilities.');
process.exit(0);
