import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

let pool: Pool;

function sqlInjectionError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.isOperational = true;
  return err;
}

function ensureSafeQuery(text: string, params?: unknown[]): void {
  const trimmed = text.trim();

  if (/;\s*\S+/.test(trimmed)) {
    throw sqlInjectionError('Only a single SQL statement is allowed per query call');
  }

  if (/\$\{[^}]+\}/.test(trimmed)) {
    throw sqlInjectionError('Unsafe SQL interpolation pattern detected');
  }

  if (!params || params.length === 0) {
    return;
  }

  const placeholders = Array.from(trimmed.matchAll(/\$(\d+)/g), (match) => Number.parseInt(match[1], 10));
  if (placeholders.length === 0) {
    throw sqlInjectionError('Parameterized query is required when passing SQL parameters');
  }

  const maxPlaceholder = Math.max(...placeholders);
  if (maxPlaceholder !== params.length) {
    throw sqlInjectionError('SQL placeholder count does not match provided parameter count');
  }
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.PG_SSL
        ? { rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED }
        : undefined,
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

export async function disconnectDatabase(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  ensureSafeQuery(text, params);

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
