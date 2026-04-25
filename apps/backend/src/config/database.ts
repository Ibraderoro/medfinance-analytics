import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.PG_SSL ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error:', err);
    });
  }
  return pool;
}

export async function connectDatabase(): Promise<void> {
  const p = getPool();
  const client: PoolClient = await p.connect();
  client.release();
  logger.info('✅ PostgreSQL connected');
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const start = Date.now();
  const res = await getPool().query<T>(text, params);
  const duration = Date.now() - start;
  logger.debug('Query executed', {
    duration,
    rows: res.rowCount,
    hasParams: Boolean(params?.length),
  });
  return res.rows;
}
