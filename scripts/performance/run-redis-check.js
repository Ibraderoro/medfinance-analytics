#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outputDir = path.resolve(process.cwd(), 'artifacts/performance');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const host = process.env.REDIS_HOST || '127.0.0.1';
const port = process.env.REDIS_PORT || '6379';
const password = process.env.REDIS_PASSWORD || '';

fs.mkdirSync(outputDir, { recursive: true });

function redisArgs(extra = []) {
  const args = ['-h', host, '-p', String(port)];
  if (password) args.push('-a', password);
  return args.concat(extra);
}

function sanitizeRedisArgs(args) {
  const sanitized = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      sanitized.push('<REDACTED>');
      redactNext = false;
      continue;
    }

    if (arg === '-a' || arg === '--password') {
      sanitized.push(arg);
      redactNext = true;
      continue;
    }

    if (arg.startsWith('-a=')) {
      sanitized.push('-a=<REDACTED>');
      continue;
    }

    if (arg.startsWith('--password=')) {
      sanitized.push('--password=<REDACTED>');
      continue;
    }

    sanitized.push(arg);
  }

  return sanitized;
}

function run(command, args, description) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const sanitizedArgs = sanitizeRedisArgs(args);
  return {
    description,
    command: [command, ...sanitizedArgs].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

const checks = [
  run('redis-cli', redisArgs(['PING']), 'Connectivity check'),
  run('redis-cli', redisArgs(['INFO', 'stats']), 'Redis INFO stats'),
  run('redis-cli', redisArgs(['INFO', 'memory']), 'Redis INFO memory'),
  run('redis-cli', redisArgs(['INFO', 'commandstats']), 'Redis INFO commandstats'),
  run('redis-cli', redisArgs(['INFO', 'clients']), 'Redis INFO clients'),
  run('redis-benchmark', redisArgs(['-t', 'get,set,incr', '-n', process.env.PERF_REDIS_BENCH_REQUESTS || '10000', '-q']), 'redis-benchmark get/set/incr'),
  run('redis-benchmark', redisArgs(['-t', 'ping', '-n', process.env.PERF_REDIS_BENCH_REQUESTS || '10000', '-P', '16', '-q']), 'redis-benchmark pipelined ping'),
];

const summary = {
  generatedAt: new Date().toISOString(),
  endpoint: `${host}:${port}`,
  recommendations: [
    'Check INCR/PTTL/PEXPIRE commandstats during peak for rate limiter overhead.',
    'Watch evicted_keys, rejected_connections, blocked_clients, and allocator fragmentation ratio.',
    'Correlate redis_exporter metrics with app-side redis_operation_duration_p95_ms.',
    'Validate cache invalidation scan/delete behavior under high key cardinality.',
  ],
  checks,
};

const jsonPath = path.join(outputDir, `redis-check-${runId}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

const md = [
  `# Redis Performance Check (${runId})`,
  '',
  `Target: ${host}:${port}`,
  '',
  '## Command output',
  '',
];

for (const check of checks) {
  md.push(`### ${check.description}`);
  md.push('');
  md.push('```text');
  md.push((check.stdout || check.stderr || 'No output').trim());
  md.push('```');
  md.push('');
}

const mdPath = path.join(outputDir, `redis-check-${runId}.md`);
fs.writeFileSync(mdPath, md.join('\n'));

const failed = checks.filter((check) => check.status !== 0);
if (failed.length) {
  console.error(`Redis checks completed with ${failed.length} failed commands.`);
  process.exit(1);
}

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
