process.env.JWT_SECRET = process.env.JWT_SECRET ?? '12345678901234567890123456789012';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? '12345678901234567890123456789012';
process.env.AUDIT_EXPORT_SIGNING_SECRET = process.env.AUDIT_EXPORT_SIGNING_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/test';

import {
  evaluateSchemaCompatibility,
  parseMigrationVersion,
  resolveSchemaCompatibilityWindow,
} from '../db/schemaCompatibility';

describe('schema compatibility checks', () => {
  const originalMin = process.env.APP_SCHEMA_MIN_VERSION;
  const originalMax = process.env.APP_SCHEMA_MAX_VERSION;

  afterEach(() => {
    if (originalMin === undefined) {
      delete process.env.APP_SCHEMA_MIN_VERSION;
    } else {
      process.env.APP_SCHEMA_MIN_VERSION = originalMin;
    }

    if (originalMax === undefined) {
      delete process.env.APP_SCHEMA_MAX_VERSION;
    } else {
      process.env.APP_SCHEMA_MAX_VERSION = originalMax;
    }
  });

  it('accepts a database version inside the application compatibility window', () => {
    expect(evaluateSchemaCompatibility(19, 18, 20)).toEqual({
      compatible: true,
      currentVersion: 19,
      minimumVersion: 18,
      maximumVersion: 20,
    });
  });

  it('rejects a database version older than the application minimum', () => {
    expect(evaluateSchemaCompatibility(17, 18, 20)).toMatchObject({
      compatible: false,
      currentVersion: 17,
      reason: 'Database schema version 17 is older than application minimum 18',
    });
  });

  it('rejects a database version newer than the application maximum', () => {
    expect(evaluateSchemaCompatibility(21, 18, 20)).toMatchObject({
      compatible: false,
      currentVersion: 21,
      reason: 'Database schema version 21 is newer than application maximum 20',
    });
  });

  it('defaults compatibility to the latest schema version in the running build', () => {
    delete process.env.APP_SCHEMA_MIN_VERSION;
    delete process.env.APP_SCHEMA_MAX_VERSION;

    expect(resolveSchemaCompatibilityWindow(19)).toEqual({
      minimumVersion: 19,
      maximumVersion: 19,
    });
  });

  it('treats empty schema compatibility env vars as unset', () => {
    process.env.APP_SCHEMA_MIN_VERSION = '';
    process.env.APP_SCHEMA_MAX_VERSION = '';

    expect(resolveSchemaCompatibilityWindow(19)).toEqual({
      minimumVersion: 19,
      maximumVersion: 19,
    });
  });

  it('defaults each empty schema compatibility bound independently', () => {
    process.env.APP_SCHEMA_MIN_VERSION = '';
    process.env.APP_SCHEMA_MAX_VERSION = '20';
    expect(resolveSchemaCompatibilityWindow(19)).toEqual({
      minimumVersion: 19,
      maximumVersion: 20,
    });

    process.env.APP_SCHEMA_MIN_VERSION = '18';
    process.env.APP_SCHEMA_MAX_VERSION = '';
    expect(resolveSchemaCompatibilityWindow(19)).toEqual({
      minimumVersion: 18,
      maximumVersion: 19,
    });
  });

  it('supports explicit expand/contract compatibility windows', () => {
    process.env.APP_SCHEMA_MIN_VERSION = '18';
    process.env.APP_SCHEMA_MAX_VERSION = '20';

    expect(resolveSchemaCompatibilityWindow(19)).toEqual({
      minimumVersion: 18,
      maximumVersion: 20,
    });
  });

  it('fails closed when the compatibility window is invalid', () => {
    process.env.APP_SCHEMA_MIN_VERSION = '20';
    process.env.APP_SCHEMA_MAX_VERSION = '18';

    expect(() => resolveSchemaCompatibilityWindow(19)).toThrow(
      'APP_SCHEMA_MIN_VERSION must be less than or equal to APP_SCHEMA_MAX_VERSION',
    );
  });

  it('parses numeric versions from migration filenames', () => {
    expect(parseMigrationVersion('019_scalability_indexes.sql')).toBe(19);
  });
});
