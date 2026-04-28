import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

let pool: Pool;

function sqlInjectionError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.isOperational = true;
  err.code = 'INVALID_SQL_QUERY';
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
      max: env.PG_POOL_MAX,
      idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
    });

    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error', { message: err.message, stack: err.stack });
    });
  }
  return pool;
}

export async function connectDatabase(retries = 12, retryDelayMs = 5_000): Promise<void> {
  const p = getPool();
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const client: PoolClient = await p.connect();
      client.release();
      logger.info('PostgreSQL connected', { attempt });
      return;
    } catch (error) {
      lastError = error;
      logger.warn('PostgreSQL connection attempt failed', { attempt, retries });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
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
