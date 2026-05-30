#!/usr/bin/env node
const { setTimeout: sleep } = require('node:timers/promises');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'medfinance-deploy-verifier/1.0' } });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: verify-deployment.js --url <health-url> [--expected-version <version>] [--timeout-ms <ms>] [--interval-ms <ms>]');
    return;
  }
  const args = parseArgs(process.argv);
  const url = args.url;
  const expectedVersion = args['expected-version'];
  const timeoutMs = Number.parseInt(args['timeout-ms'] || '120000', 10);
  const intervalMs = Number.parseInt(args['interval-ms'] || '5000', 10);
  if (!url) throw new Error('--url is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be positive');

  const deadline = Date.now() + timeoutMs;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, Math.min(intervalMs, 10000));
      const text = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      } else {
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
        const releaseVersion = payload?.release?.version;
        const status = payload?.status;
        if (expectedVersion && releaseVersion !== expectedVersion) {
          lastError = `release version mismatch: expected ${expectedVersion}, got ${releaseVersion ?? '<missing>'}`;
        } else if (status === undefined || !['ready', 'alive', 'ok'].includes(status)) {
          lastError = `unexpected or missing health status: ${status ?? '<missing>'}`;
        } else {
          console.log(`Deployment verification succeeded for ${url}`);
          return;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Deployment verification failed for ${url}: ${lastError}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
