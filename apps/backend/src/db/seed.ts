#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { getPool } from '../config/database';

const SEED_SQL_PATH = path.resolve(__dirname, '../../../../infrastructure/postgres/seed.sql');

async function runSeed(): Promise<void> {
  if (!fs.existsSync(SEED_SQL_PATH)) {
    throw new Error(`Seed file not found at: ${SEED_SQL_PATH}`);
  }

  const sql = fs.readFileSync(SEED_SQL_PATH, 'utf8');

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Seed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
