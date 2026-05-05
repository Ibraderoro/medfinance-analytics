import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';
import { AppError, tenantContextError } from '../middleware/errorHandler';
import { getCurrentTenantContext } from '../middleware/tenantContext';

let pool: Pool;

const TENANT_ENFORCED_TABLES = ['transactions', 'forecasts', 'compliance_items'];

function requiresTenantContext(queryText: string): boolean {
  const lower = queryText.toLowerCase();
  return TENANT_ENFORCED_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(lower));
}


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

/**
 * Executes a parameterized SQL query and returns the resulting rows.
 *
 * If the current tenant context contains an `organizationId`, the function runs the query inside a transaction and sets the session configuration `app.current_tenant_id` to that organization id for the duration of the transaction. The function validates the SQL and parameter usage before executing and ensures the client is always released back to the pool.
 *
 * @param text - The SQL statement to execute. Must be a single statement and use positional placeholders (`$1`, `$2`, ...) when parameters are provided.
 * @param params - Optional array of parameter values matching the positional placeholders in `text`.
 * @returns The array of result rows returned by the executed query.
 */
export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  /**
   * Executes a sanitized SQL query and applies tenant session context when available.
   */
  ensureSafeQuery(text, params);

  const start = Date.now();
  const tenant = getCurrentTenantContext();
  if (!tenant?.organizationId && requiresTenantContext(text)) {
    throw tenantContextError('Tenant context is required for tenant-scoped tables');
  }
  const client = await getPool().connect();
  let res;
  try {
    if (tenant?.organizationId) {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant.organizationId]);
      res = await client.query<T>(text, params);
      await client.query('COMMIT');
    } else {
      res = await client.query<T>(text, params);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const duration = Date.now() - start;
  logger.debug('Query executed', {
    duration,
    rows: res.rowCount,
    hasParams: Boolean(params?.length),
  });
  return res.rows;
}
