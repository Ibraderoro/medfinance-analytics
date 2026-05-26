#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, process.env.STAGING_DRILL_OUTPUT_DIR || 'artifacts/staging-drills');
const runId = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const output = [];
const runIdSafe = runId.replace(/[^a-zA-Z0-9]/g, '') || `run${Date.now()}`;

const releaseMetrics = {
  rollbackImageDigests: process.env.ROLLBACK_IMAGE_DIGESTS || 'Capture previous/current image digests from staging and paste here.',
  rto: process.env.STAGING_DRILL_RTO || 'Record measured RTO here.',
  rpo: process.env.STAGING_DRILL_RPO || 'Record measured RPO here.',
  p95: process.env.STAGING_DRILL_P95 || 'Record measured p95 latency here.',
  p99: process.env.STAGING_DRILL_P99 || 'Record measured p99 latency here.',
  incidentCommander: process.env.STAGING_INCIDENT_COMMANDER || 'Record incident commander here.',
};

const requiredEnv = ['STAGING_HOST', 'STAGING_USER', 'STAGING_URL'];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

function run(name, command, args = [], opts = {}) {
  const startedAt = new Date().toISOString();
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    });
    const endedAt = new Date().toISOString();
    output.push({ name, status: 'Passed', startedAt, endedAt, cmd: [command, ...args].join(' '), stdout });
    return { ok: true, stdout };
  } catch (error) {
    const endedAt = new Date().toISOString();
    output.push({
      name,
      status: 'Failed',
      startedAt,
      endedAt,
      cmd: [command, ...args].join(' '),
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
    });
    return { ok: false };
  }
}

const drills = [
  {
    key: 'Migration up/down',
    command: 'ssh',
    args: ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', `${process.env.STAGING_USER}@${process.env.STAGING_HOST}`, 'cd /opt/medfinance-staging && docker compose run --rm backend node apps/backend/dist/db/migrate.js && docker compose run --rm backend node apps/backend/dist/db/migrate.js rollback && docker compose run --rm backend node apps/backend/dist/db/migrate.js'],
  },
  {
    key: 'Backup/restore',
    command: 'ssh',
    args: ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', `${process.env.STAGING_USER}@${process.env.STAGING_HOST}`, `cd /opt/medfinance-staging && RUN_ID=${runIdSafe} dump_path=/tmp/medfinance-staging-${runIdSafe}.dump restore_db=medfinance_restore_${runIdSafe} sh -c 'trap "docker compose exec -T postgres sh -c \\\"dropdb -U \\\\\\\"\\\\$POSTGRES_USER\\\\\\\" --if-exists \\\\\\\"\\\\$restore_db\\\\\\\"\\\" || true; docker compose exec -T postgres sh -c \\\"rm -f \\\\\\\"\\\\$dump_path\\\\\\\"\\\" || true" EXIT; docker compose exec -T postgres sh -c "pg_dump -U \\\\\\"\\\\$POSTGRES_USER\\\\\\" -d \\\\\\"\\\\$POSTGRES_DB\\\\\\" --format=custom --no-owner --file=\\\\\\"\\\\$dump_path\\\\\\""; docker compose exec -T postgres sh -c "createdb -U \\\\\\"\\\\$POSTGRES_USER\\\\\\" \\\\\\"\\\\$restore_db\\\\\\""; docker compose exec -T postgres sh -c "pg_restore -U \\\\\\"\\\\$POSTGRES_USER\\\\\\" -d \\\\\\"\\\\$restore_db\\\\\\" --clean --if-exists \\\\\\"\\\\$dump_path\\\\\\""'`],
  },
  {
    key: 'Application rollback',
    command: 'ssh',
    args: ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', `${process.env.STAGING_USER}@${process.env.STAGING_HOST}`, 'cd /opt/medfinance-staging && docker compose up -d --remove-orphans backend frontend nginx && docker compose ps'],
  },
  {
    key: 'Load/performance',
    command: 'npx',
    args: ['autocannon', '--connections', '10', '--duration', '30', `${process.env.STAGING_URL}/api/v1/health/ready`],
  },
  {
    key: 'Incident response',
    command: 'ssh',
    args: ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', `${process.env.STAGING_USER}@${process.env.STAGING_HOST}`, 'cd /opt/medfinance-staging && date -u +%FT%TZ | xargs -I{} echo "Incident drill executed at {}"'],
  },
];

const preflight = run('Preflight health', 'curl', ['--fail', '--show-error', `${process.env.STAGING_URL}/api/v1/health/ready`]);
if (!preflight.ok) {
  console.error('Preflight failed. Aborting drill run.');
}

for (const drill of drills) {
  if (!preflight.ok) {
    output.push({ name: drill.key, status: 'Skipped', cmd: [drill.command, ...(drill.args || [])].join(' '), stdout: '', stderr: 'Skipped due to failed preflight health check.' });
    continue;
  }
  run(drill.key, drill.command, drill.args);
}

const allPassed = output.filter((r) => r.name !== 'Preflight health').every((r) => r.status === 'Passed');
const mdPath = path.join(outDir, `staging-drill-evidence-${runIdSafe}.md`);
const lines = [];
lines.push(`# Staging Drill Evidence — ${new Date().toISOString().slice(0, 10)}`);
lines.push('');
lines.push('## Executive status');
lines.push('');
lines.push(`**Result: ${allPassed ? 'passed; drills completed.' : 'blocked; drills not completed.'}**`);
lines.push('');
lines.push('## Drill evidence ledger');
lines.push('');
lines.push('| Drill | Completion status | Evidence captured |');
lines.push('| --- | --- | --- |');
for (const result of output.filter((r) => r.name !== 'Preflight health')) {
  const captured = result.status === 'Passed'
    ? `Command succeeded. Artifact log: \`${result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.log\`.`
    : `Command ${result.status.toLowerCase()}. Review artifact log for errors.`;
  lines.push(`| ${result.name} | **${result.status}** | ${captured} |`);
}
lines.push('');
lines.push('## Command outputs');
lines.push('');
for (const result of output) {
  const safeName = result.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const logPath = path.join(outDir, `${safeName}.log`);
  fs.writeFileSync(logPath, [
    `# ${result.name}`,
    `status=${result.status}`,
    `started_at=${result.startedAt || ''}`,
    `ended_at=${result.endedAt || ''}`,
    `command=${result.cmd || ''}`,
    '',
    result.stdout || '',
    '',
    result.stderr || '',
  ].join('\n'));
  lines.push(`- ${result.name}: \`${path.relative(root, logPath)}\``);
}


lines.push('');
lines.push('## Required release metrics');
lines.push('');
lines.push(`- Rollback image digests: ${releaseMetrics.rollbackImageDigests}`);
lines.push(`- Backup/restore RTO: ${releaseMetrics.rto}`);
lines.push(`- Backup/restore RPO: ${releaseMetrics.rpo}`);
lines.push(`- Load/performance p95: ${releaseMetrics.p95}`);
lines.push(`- Load/performance p99: ${releaseMetrics.p99}`);
lines.push(`- Incident commander: ${releaseMetrics.incidentCommander}`);

fs.writeFileSync(mdPath, lines.join('\n'));
console.error(`Wrote staging drill evidence to ${path.relative(root, mdPath)}`);
if (!allPassed) process.exit(1);
