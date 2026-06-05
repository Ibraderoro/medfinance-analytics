#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let chromium;

try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error(
    [
      'Playwright is not installed.',
      'Run `npm ci` (or `npm install`) to install project dependencies before running E2E tests.',
      error.message,
    ].join('\n'),
  );
  process.exit(1);
}

const executablePath = chromium.executablePath();
if (!fs.existsSync(executablePath)) {
  console.warn(
    [
      'Playwright full-stack E2E tests cannot run because Chromium is not installed.',
      'Run `npm run test:e2e:install --workspace=apps/frontend` in an environment with access to the Playwright browser CDN, then rerun E2E tests.',
      `Expected executable: ${executablePath}`,
    ].join('\n'),
  );
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '../../..');
const composeFile = path.join(repoRoot, 'docker-compose.e2e.yml');
const envFile = path.join(repoRoot, '.env.e2e');
const shard = process.env.PLAYWRIGHT_SHARD;
const projectName = `medfinance-e2e-${(shard || 'local').replace('/', '-')}-${Date.now()}`;
const playwrightExtraArgs = process.argv.slice(2);
const ciArtifactsDir = path.join(repoRoot, 'apps/frontend/test-results/fullstack');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status !== 'number' || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function waitForNginx(baseUrl, timeoutMs = 180_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const probe = runCapture('node', [
      '-e',
      `fetch('${baseUrl}/health').then((r)=>{if(!r.ok) process.exit(1);}).catch(()=>process.exit(1));`,
    ]);

    if (probe.status === 0) {
      return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

function dockerComposeArgs(...extra) {
  return ['compose', '--project-name', projectName, '--env-file', envFile, '-f', composeFile, ...extra];
}

function writeDockerLogs() {
  const logsResult = runCapture('docker', dockerComposeArgs('logs', '--no-color'), { stdio: 'pipe' });
  fs.mkdirSync(ciArtifactsDir, { recursive: true });
  fs.writeFileSync(path.join(ciArtifactsDir, 'docker-compose.log'), logsResult.stdout || logsResult.stderr || '', 'utf8');
}

const runtimeEnv = {
  ...process.env,
  FULLSTACK_E2E_BASE_URL: process.env.FULLSTACK_E2E_BASE_URL || 'http://127.0.0.1:8088',
  FULLSTACK_DATABASE_URL:
    process.env.FULLSTACK_DATABASE_URL ||
    'postgresql://medfinance:medfinance@127.0.0.1:55432/medfinance_e2e',
  FULLSTACK_REDIS_HOST: process.env.FULLSTACK_REDIS_HOST || '127.0.0.1',
  FULLSTACK_REDIS_PORT: process.env.FULLSTACK_REDIS_PORT || '56379',
  PW_FULLSTACK_WORKERS: process.env.PW_FULLSTACK_WORKERS || (process.env.CI ? '2' : '2'),
};

let exitCode = 0;

try {
  run('docker', dockerComposeArgs('up', '-d', '--build', 'postgres', 'redis', 'db_prepare', 'backend', 'frontend', 'nginx'));
  waitForNginx(runtimeEnv.FULLSTACK_E2E_BASE_URL);

  const playwrightArgs = ['playwright', 'test', '--config=playwright.fullstack.config.ts'];
  if (shard) {
    playwrightArgs.push(`--shard=${shard}`);
  }
  playwrightArgs.push(...playwrightExtraArgs);

  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', playwrightArgs, {
    cwd: path.join(repoRoot, 'apps/frontend'),
    env: runtimeEnv,
  });
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
  writeDockerLogs();
} finally {
  try {
    runCapture('docker', dockerComposeArgs('down', '-v', '--remove-orphans'), { stdio: 'pipe' });
  } catch {
    // Best-effort teardown
  }
}

process.exit(exitCode);
