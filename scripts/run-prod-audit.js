#!/usr/bin/env node
const { spawnSync } = require('child_process');

const AUDIT_TIMEOUT_MS = 5 * 60 * 1000;
const AUDIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const FAIL_SEVERITIES = ['critical', 'high'];
const ONLINE_AUDIT_ARGS = ['audit', '--omit=dev', '--json'];
const OFFLINE_AUDIT_ARGS = [...ONLINE_AUDIT_ARGS, '--offline'];

function runNpmAudit(args) {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    timeout: AUDIT_TIMEOUT_MS,
    maxBuffer: AUDIT_MAX_BUFFER_BYTES,
  });
}

function writeCommandOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function parseAuditJson(result) {
  try {
    return result.stdout ? JSON.parse(result.stdout) : null;
  } catch (error) {
    console.error(`Could not parse npm audit JSON output: ${error.message}`);
    process.exit(1);
  }
}

function auditErrorMessage(parsedAuditOutput, result) {
  return [
    parsedAuditOutput?.message,
    parsedAuditOutput?.error?.summary,
    parsedAuditOutput?.error?.detail,
    result.stderr,
  ].filter(Boolean).join('\n');
}

function auditEndpointUnavailable(parsedAuditOutput, result) {
  const message = auditErrorMessage(parsedAuditOutput, result);
  return Boolean(parsedAuditOutput?.error) || /audit endpoint returned an error/i.test(message);
}

function offlineFallbackAllowed() {
  if (process.env.AUDIT_ALLOW_OFFLINE_FALLBACK !== undefined) {
    return process.env.AUDIT_ALLOW_OFFLINE_FALLBACK === 'true';
  }

  const ci = process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
  return !ci;
}

function validateAuditResult(parsedAuditOutput, mode) {
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

  console.error(`Production dependency audit completed in ${mode} mode with no high or critical vulnerabilities.`);
}

function executeAudit(args, mode) {
  const result = runNpmAudit(args);
  writeCommandOutput(result);

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const parsed = parseAuditJson(result);
  return { parsed, result, mode };
}

let audit = executeAudit(ONLINE_AUDIT_ARGS, 'online');

if (auditEndpointUnavailable(audit.parsed, audit.result)) {
  if (!offlineFallbackAllowed()) {
    console.error(
      [
        'Production dependency audit did not complete.',
        'This is a release-blocking result because CI/release environments must use the live npm audit endpoint.',
        'Rerun in an environment that can reach the npm audit endpoint, or use the CI OSV scanner result as the signed release evidence.',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.error(
    [
      'Online npm audit endpoint was unavailable; retrying with npm audit --offline for local evidence.',
      'Offline audit fallback is disabled automatically in CI unless AUDIT_ALLOW_OFFLINE_FALLBACK=true is set explicitly.',
    ].join('\n'),
  );
  audit = executeAudit(OFFLINE_AUDIT_ARGS, 'offline fallback');

  if (auditEndpointUnavailable(audit.parsed, audit.result)) {
    console.error(
      [
        'Production dependency audit did not complete in online or offline mode.',
        'This remains release-blocking because no vulnerability metadata was available.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

validateAuditResult(audit.parsed, audit.mode);
process.exit(0);
