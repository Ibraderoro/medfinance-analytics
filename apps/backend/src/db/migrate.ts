#!/usr/bin/env node
/**
 * Simple migration runner.
 * Runs SQL files from src/db/migrations in numeric order.
 * Tracks applied migrations in a `schema_migrations` table.
 */
import fs from 'fs';
import path from 'path';
import { getPool } from '../config/database';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id        SERIAL PRIMARY KEY,
      filename  TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const res = await getPool().query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id',
  );
  return new Set(res.rows.map((r) => r.filename));
}

async function applyMigration(filename: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename],
    );
    await client.query('COMMIT');
    console.log(`✅ Applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rollbackLatestMigration(): Promise<void> {
  await ensureMigrationsTable();

  const latest = await getPool().query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1',
  );

  if (latest.rowCount === 0) {
    console.log('Nothing to rollback — no migrations have been applied.');
    return;
  }

  const filename = latest.rows[0].filename;
  const downFilename = filename.replace(/\.sql$/, '.down.sql');
  const downPath = path.join(MIGRATIONS_DIR, downFilename);

  if (!fs.existsSync(downPath)) {
    throw new Error(
      `Rollback not available for ${filename}. Expected down migration file: ${downFilename}`,
    );
  }

  const downSql = fs.readFileSync(downPath, 'utf8');
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    await client.query(downSql);
    await client.query('DELETE FROM schema_migrations WHERE filename = $1', [
      filename,
    ]);
    await client.query('COMMIT');
    console.log(`↩️ Rolled back: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (!applied.has(file)) {
      await applyMigration(file);
      count++;
    }
  }

  if (count === 0) {
    console.log('Nothing to migrate — all migrations already applied.');
  } else {
    console.log(`\n✨ ${count} migration(s) applied.`);
  }
}

async function run(): Promise<void> {
  const command = process.argv[2];

  if (command === 'rollback') {
    await rollbackLatestMigration();
    return;
  }

  await migrate();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
