#!/usr/bin/env node
/**
 * Dedicated migration runner.
 *
 * Application startup must never call this module to mutate the database.
 * Run it from CI/CD or an operations job before rolling application instances.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import {
  getCurrentDatabaseSchemaVersion,
  listForwardMigrationFiles,
  parseMigrationVersion,
  resolveMigrationsDir,
} from './schemaCompatibility';

const MIGRATIONS_DIR = resolveMigrationsDir();
const MIGRATION_LOCK_KEY = 42424220240501;
const DEFAULT_MIGRATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 1000;

let migrationPool: Pool | undefined;

function optionalBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

function parseIntEnv(key: string, defaultValue: number): number {
  const raw = process.env[key] ?? String(defaultValue);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a valid integer`);
  }
  return parsed;
}

function getPool(): Pool {
  if (!migrationPool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for migration commands');
    }

    const pgSsl = optionalBooleanEnv('PG_SSL', process.env.NODE_ENV === 'production');
    migrationPool = new Pool({
      connectionString: databaseUrl,
      ssl: pgSsl
        ? { rejectUnauthorized: optionalBooleanEnv('PG_SSL_REJECT_UNAUTHORIZED', process.env.NODE_ENV === 'production') }
        : undefined,
      max: parseIntEnv('PG_POOL_MAX', 5),
      idleTimeoutMillis: parseIntEnv('PG_IDLE_TIMEOUT_MS', 30_000),
      connectionTimeoutMillis: parseIntEnv('PG_CONNECTION_TIMEOUT_MS', 5_000),
    });
  }
  return migrationPool;
}

async function disconnectMigrationDatabase(): Promise<void> {
  if (!migrationPool) {
    return;
  }
  await migrationPool.end();
  migrationPool = undefined;
}

type AppliedMigration = {
  filename: string;
  checksum?: string | null;
};

type MigrationOptions = {
  timeoutMs: number;
  lockTimeoutMs: number;
};

function readOptionsFromEnv(): MigrationOptions {
  return {
    timeoutMs: Number.parseInt(process.env.MIGRATION_TIMEOUT_MS ?? String(DEFAULT_MIGRATION_TIMEOUT_MS), 10),
    lockTimeoutMs: Number.parseInt(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? String(DEFAULT_LOCK_TIMEOUT_MS), 10),
  };
}

function assertValidTimeouts(options: MigrationOptions): void {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('MIGRATION_TIMEOUT_MS must be a positive integer');
  }

  if (!Number.isFinite(options.lockTimeoutMs) || options.lockTimeoutMs <= 0) {
    throw new Error('MIGRATION_LOCK_TIMEOUT_MS must be a positive integer');
  }
}

function checksumSql(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function migrationPath(filename: string): string {
  return path.join(MIGRATIONS_DIR, filename);
}

async function ensureMigrationsTable(client: PoolClient = getPool() as unknown as PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id        SERIAL PRIMARY KEY,
      filename  TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
}

async function getAppliedMigrations(client: PoolClient = getPool() as unknown as PoolClient): Promise<AppliedMigration[]> {
  const res = await client.query<AppliedMigration>(
    'SELECT filename, checksum FROM schema_migrations ORDER BY id',
  );
  return res.rows;
}

async function acquireMigrationLock(client: PoolClient, lockTimeoutMs: number): Promise<void> {
  const deadline = Date.now() + lockTimeoutMs;

  while (Date.now() < deadline) {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK_KEY]);
    if (result.rows[0]?.locked) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out after ${lockTimeoutMs}ms waiting for migration advisory lock`);
}

async function releaseMigrationLock(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Migration job exceeded timeout of ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function withMigrationLock<T>(options: MigrationOptions, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  assertValidTimeouts(options);
  const client = await getPool().connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['statement_timeout', String(options.timeoutMs)]);
    await client.query('SELECT set_config($1, $2, false)', ['lock_timeout', String(options.lockTimeoutMs)]);
    await acquireMigrationLock(client, options.lockTimeoutMs);
    return await withTimeout(callback(client), options.timeoutMs);
  } finally {
    await releaseMigrationLock(client).catch(() => undefined);
    await client.query('RESET ALL').catch(() => undefined);
    client.release();
  }
}

export async function validateMigrationPlan(client?: PoolClient): Promise<void> {
  const migrationFiles = listForwardMigrationFiles(MIGRATIONS_DIR);
  const versions = migrationFiles.map(parseMigrationVersion);
  const duplicateVersions = versions.filter((version, index) => versions.indexOf(version) !== index);

  if (duplicateVersions.length > 0) {
    throw new Error(`Duplicate migration version(s): ${Array.from(new Set(duplicateVersions)).join(', ')}`);
  }

  for (const file of migrationFiles) {
    const downFile = file.replace(/\.sql$/, '.down.sql');
    if (!fs.existsSync(migrationPath(downFile))) {
      throw new Error(`Rollback file is required for migration ${file}. Missing ${downFile}`);
    }
  }

  if (!client) {
    return;
  }

  await ensureMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  const knownFiles = new Set(migrationFiles);
  const unknownApplied = applied.filter((migration) => !knownFiles.has(migration.filename));
  if (unknownApplied.length > 0) {
    throw new Error(`Database contains migration(s) not present in this build: ${unknownApplied.map((m) => m.filename).join(', ')}`);
  }

  const fileChecksums = new Map(
    migrationFiles.map((file) => [file, checksumSql(fs.readFileSync(migrationPath(file), 'utf8'))]),
  );
  const mismatched = applied.filter(
    (migration) => migration.checksum && fileChecksums.get(migration.filename) !== migration.checksum,
  );
  if (mismatched.length > 0) {
    throw new Error(`Applied migration checksum mismatch: ${mismatched.map((m) => m.filename).join(', ')}`);
  }
}

async function applyMigration(client: PoolClient, filename: string): Promise<void> {
  const sql = fs.readFileSync(migrationPath(filename), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksumSql(sql)],
    );
    await client.query('COMMIT');
    console.log(`✅ Applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function rollbackOneMigration(client: PoolClient): Promise<boolean> {
  await ensureMigrationsTable(client);

  const latest = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1',
  );

  if (latest.rowCount === 0) {
    console.log('Nothing to rollback — no migrations have been applied.');
    return false;
  }

  const filename = latest.rows[0].filename;
  const downFilename = filename.replace(/\.sql$/, '.down.sql');
  const downPath = migrationPath(downFilename);

  if (!fs.existsSync(downPath)) {
    throw new Error(`Rollback not available for ${filename}. Expected down migration file: ${downFilename}`);
  }

  const downSql = fs.readFileSync(downPath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(downSql);
    await client.query('DELETE FROM schema_migrations WHERE filename = $1', [filename]);
    await client.query('COMMIT');
    console.log(`↩️ Rolled back: ${filename}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function rollbackLatestMigration(steps = 1, options = readOptionsFromEnv()): Promise<void> {
  await withMigrationLock(options, async (client) => {
    await validateMigrationPlan(client);
    for (let i = 0; i < steps; i += 1) {
      const rolledBack = await rollbackOneMigration(client);
      if (!rolledBack) {
        break;
      }
    }
  });
}

export async function migrate(options = readOptionsFromEnv()): Promise<void> {
  await withMigrationLock(options, async (client) => {
    await validateMigrationPlan(client);
    const applied = new Set((await getAppliedMigrations(client)).map((migration) => migration.filename));
    const files = listForwardMigrationFiles(MIGRATIONS_DIR);

    let count = 0;
    for (const file of files) {
      if (!applied.has(file)) {
        await applyMigration(client, file);
        count += 1;
      }
    }

    if (count === 0) {
      console.log('Nothing to migrate — all migrations already applied.');
    } else {
      console.log(`\n✨ ${count} migration(s) applied.`);
    }
  });
}

export async function preflight(options = readOptionsFromEnv()): Promise<void> {
  await withMigrationLock(options, async (client) => {
    await validateMigrationPlan(client);
    console.log('Migration preflight passed.');
  });
}

export async function status(): Promise<void> {
  const currentVersion = await getCurrentDatabaseSchemaVersion(getPool());
  const codeVersion = Math.max(0, ...listForwardMigrationFiles(MIGRATIONS_DIR).map(parseMigrationVersion));
  console.log(`Database schema version: ${currentVersion}`);
  console.log(`Code schema version: ${codeVersion}`);
}

async function run(): Promise<void> {
  const command = process.argv[2];

  if (command === 'rollback') {
    const steps = Number.parseInt(process.argv[3] ?? '1', 10);
    if (!Number.isFinite(steps) || steps <= 0) {
      throw new Error('Rollback steps must be a positive integer');
    }
    await rollbackLatestMigration(steps);
    return;
  }

  if (command === 'preflight') {
    await preflight();
    return;
  }

  if (command === 'status') {
    await status();
    return;
  }

  await migrate();
}

if (require.main === module) {
  run()
    .then(async () => {
      await disconnectMigrationDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await disconnectMigrationDatabase().catch(() => undefined);
      process.exit(1);
    });
}
