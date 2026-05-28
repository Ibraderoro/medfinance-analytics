import fs from 'fs';
import path from 'path';
import { QueryResult, QueryResultRow } from 'pg';

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

async function getDefaultPool(): Promise<Queryable> {
  const database = await import('../config/database');
  return database.getPool();
}

export type SchemaVersionCompatibility = {
  compatible: boolean;
  currentVersion: number;
  minimumVersion: number;
  maximumVersion: number;
  reason?: string;
};

export function parseMigrationVersion(filename: string): number {
  const match = /^(\d+)_.*\.sql$/.exec(filename);
  if (!match) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }

  return Number.parseInt(match[1], 10);
}

export function resolveMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(process.cwd(), 'dist', 'db', 'migrations'),
    path.join(process.cwd(), 'src', 'db', 'migrations'),
    path.join(process.cwd(), 'apps', 'backend', 'dist', 'db', 'migrations'),
    path.join(process.cwd(), 'apps', 'backend', 'src', 'db', 'migrations'),
  ];

  const found = candidates.find((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
  if (!found) {
    throw new Error(`Unable to locate migrations directory. Checked: ${candidates.join(', ')}`);
  }

  return found;
}

export function listForwardMigrationFiles(migrationsDir = resolveMigrationsDir()): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort();
}

export function getLatestCodeSchemaVersion(migrationsDir = resolveMigrationsDir()): number {
  const migrations = listForwardMigrationFiles(migrationsDir);
  if (migrations.length === 0) {
    return 0;
  }

  return Math.max(...migrations.map(parseMigrationVersion));
}

export function resolveSchemaCompatibilityWindow(latestCodeVersion = getLatestCodeSchemaVersion()): {
  minimumVersion: number;
  maximumVersion: number;
} {
  const minRaw = process.env.APP_SCHEMA_MIN_VERSION;
  const maxRaw = process.env.APP_SCHEMA_MAX_VERSION;
  const minimumVersion = Number.parseInt(minRaw && minRaw.trim() !== '' ? minRaw : String(latestCodeVersion), 10);
  const maximumVersion = Number.parseInt(maxRaw && maxRaw.trim() !== '' ? maxRaw : String(latestCodeVersion), 10);

  if (!Number.isFinite(minimumVersion) || !Number.isFinite(maximumVersion)) {
    throw new Error('APP_SCHEMA_MIN_VERSION and APP_SCHEMA_MAX_VERSION must be valid integers when set');
  }

  if (minimumVersion > maximumVersion) {
    throw new Error('APP_SCHEMA_MIN_VERSION must be less than or equal to APP_SCHEMA_MAX_VERSION');
  }

  return { minimumVersion, maximumVersion };
}

export function evaluateSchemaCompatibility(
  currentVersion: number,
  minimumVersion: number,
  maximumVersion: number,
): SchemaVersionCompatibility {
  if (currentVersion < minimumVersion) {
    return {
      compatible: false,
      currentVersion,
      minimumVersion,
      maximumVersion,
      reason: `Database schema version ${currentVersion} is older than application minimum ${minimumVersion}`,
    };
  }

  if (currentVersion > maximumVersion) {
    return {
      compatible: false,
      currentVersion,
      minimumVersion,
      maximumVersion,
      reason: `Database schema version ${currentVersion} is newer than application maximum ${maximumVersion}`,
    };
  }

  return {
    compatible: true,
    currentVersion,
    minimumVersion,
    maximumVersion,
  };
}

export async function getCurrentDatabaseSchemaVersion(client?: Queryable): Promise<number> {
  const db = client ?? await getDefaultPool();
  const table = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'schema_migrations'
     ) AS exists`,
  );

  if (!table.rows[0]?.exists) {
    return 0;
  }

  const result = await db.query<{ version: number | string | null }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(filename FROM '^(\\d+)') AS INTEGER)), 0) AS version
     FROM schema_migrations`,
  );

  return Number(result.rows[0]?.version ?? 0);
}

export async function assertCompatibleSchemaVersion(): Promise<SchemaVersionCompatibility> {
  const currentVersion = await getCurrentDatabaseSchemaVersion();
  const { minimumVersion, maximumVersion } = resolveSchemaCompatibilityWindow();
  const compatibility = evaluateSchemaCompatibility(currentVersion, minimumVersion, maximumVersion);

  if (!compatibility.compatible) {
    throw new Error(`Database schema compatibility check failed: ${compatibility.reason}`);
  }

  return compatibility;
}
