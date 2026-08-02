#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outputDir = path.resolve(process.cwd(), 'artifacts/performance');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('DATABASE_URL is required for perf:db:analyze');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

function runPsql(query, description) {
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-P', 'pager=off', '-c', query], {
    encoding: 'utf8',
  });

  return {
    description,
    query,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function skippedResult(query, description, reason) {
  return {
    description,
    query,
    stdout: '',
    stderr: reason,
    status: 0,
    skipped: true,
  };
}

const availabilityCheck = {
  description: 'pg_stat_statements availability',
  query: `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';`,
};

const pgStatStatementsQueries = [
  {
    description: 'Top total execution time statements',
    query: `SELECT LEFT(query, 180) AS query, calls, ROUND(total_exec_time::numeric, 2) AS total_exec_ms, ROUND(mean_exec_time::numeric, 2) AS mean_exec_ms, rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;`,
  },
  {
    description: 'Top mean execution time statements',
    query: `SELECT LEFT(query, 180) AS query, calls, ROUND(total_exec_time::numeric, 2) AS total_exec_ms, ROUND(mean_exec_time::numeric, 2) AS mean_exec_ms, rows FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;`,
  },
];

const remainingQueries = [
  {
    description: 'Connection pool pressure and waits',
    query: `SELECT state, wait_event_type, wait_event, COUNT(*) AS count FROM pg_stat_activity GROUP BY state, wait_event_type, wait_event ORDER BY count DESC;`,
  },
  {
    description: 'Dead tuple pressure',
    query: `SELECT relname, n_live_tup, n_dead_tup, ROUND((100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0))::numeric, 2) AS dead_pct FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;`,
  },
  {
    description: 'I/O pressure (blocks)',
    query: `SELECT relname, heap_blks_read, heap_blks_hit, idx_blks_read, idx_blks_hit FROM pg_statio_user_tables ORDER BY heap_blks_read DESC LIMIT 20;`,
  },
  {
    description: 'Explain financial summary pattern',
    query: `EXPLAIN (ANALYZE, BUFFERS) SELECT COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE 0 END), 0) AS total_revenue, COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses FROM transactions WHERE organization_id = COALESCE(NULLIF('${(process.env.PERF_SAMPLE_ORG_ID || '').replace(/'/g, "''")}', ''), organization_id) AND EXTRACT(YEAR FROM occurred_on) = COALESCE(NULLIF('${(process.env.PERF_SAMPLE_YEAR || '').replace(/'/g, "''")}', '')::int, EXTRACT(YEAR FROM occurred_on));`,
  },
  {
    description: 'Explain forecasting monthly pattern',
    query: `EXPLAIN (ANALYZE, BUFFERS) SELECT DATE_TRUNC('month', occurred_on)::date AS month, SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE 0 END) AS revenue, SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) AS expense FROM transactions GROUP BY DATE_TRUNC('month', occurred_on)::date ORDER BY month DESC LIMIT 24;`,
  },
  {
    description: 'Explain admin percentile analytics',
    query: `EXPLAIN (ANALYZE, BUFFERS) SELECT endpoint, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms FROM api_request_metrics WHERE created_at >= NOW() - INTERVAL '60 minutes' GROUP BY endpoint ORDER BY p95_latency_ms DESC LIMIT 20;`,
  },
];

const availabilityResult = runPsql(availabilityCheck.query, availabilityCheck.description);
const pgStatStatementsAvailable = availabilityResult.status === 0 && /pg_stat_statements/.test(availabilityResult.stdout);

const pgStatStatementsResults = pgStatStatementsAvailable
  ? pgStatStatementsQueries.map((item) => runPsql(item.query, item.description))
  : pgStatStatementsQueries.map((item) => skippedResult(item.query, item.description, 'pg_stat_statements extension is not installed/preloaded in this environment'));

const results = [
  availabilityResult,
  ...pgStatStatementsResults,
  ...remainingQueries.map((item) => runPsql(item.query, item.description)),
];

const out = {
  generatedAt: new Date().toISOString(),
  databaseUrlRedacted: dbUrl.replace(/:[^:@/]+@/, ':***@'),
  recommendations: [
    'Investigate high total_exec_time and mean_exec_time statements first.',
    'Validate tenant/time indexes for transactions, financial_kpis, and api_request_metrics.',
    'Track dead tuple growth and autovacuum behavior during sustained load.',
    'Correlate pg_stat_activity waits with API p95/p99 spikes.',
  ],
  results,
};

const jsonPath = path.join(outputDir, `db-analysis-${runId}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

const mdLines = [
  `# Database Performance Analysis (${runId})`,
  '',
  `Output JSON: \`${path.relative(process.cwd(), jsonPath)}\``,
  '',
  '## Query results',
  '',
];

for (const result of results) {
  mdLines.push(`### ${result.description}`);
  mdLines.push('');
  mdLines.push('```text');
  mdLines.push((result.stdout || result.stderr || 'No output').trim());
  mdLines.push('```');
  mdLines.push('');
}

const mdPath = path.join(outputDir, `db-analysis-${runId}.md`);
fs.writeFileSync(mdPath, mdLines.join('\n'));

const failures = results.filter((r) => r.status !== 0);
if (failures.length > 0) {
  console.error(`Database analysis completed with ${failures.length} failed query blocks.`);
  process.exit(1);
}

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
