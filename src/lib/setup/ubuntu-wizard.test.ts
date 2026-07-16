import { describe, expect, it } from 'vitest';
import {
  buildWizardEnv,
  isSetupAuthorized,
  readSetupAccess,
  resolveSetupPaths,
} from './ubuntu-wizard';

describe('Ubuntu GUI setup wizard helpers', () => {
  it('builds the same storage path contract used by the world-state compose overlay', () => {
    const paths = resolveSetupPaths('/mnt/osiris-worldstate/');

    expect(paths).toEqual({
      dataRoot: '/mnt/osiris-worldstate',
      dbHostPath: '/mnt/osiris-worldstate/postgres',
      archiveHostPath: '/mnt/osiris-worldstate/archive',
      archiveContainerPath: '/archive',
    });
  });

  it('generates a complete .env payload for database-backed world-state setup', () => {
    const env = buildWizardEnv({
      mode: 'mounted_path',
      dataRoot: '/mnt/osiris-worldstate',
      osirisPort: '3000',
      dbName: 'osiris_worldstate',
      dbUser: 'osiris',
      dbPassword: 'secret-password',
    });

    expect(env).toContain('WORLDSTATE_DB_DATA=/mnt/osiris-worldstate/postgres');
    expect(env).toContain('RAW_ARCHIVE_HOST_PATH=/mnt/osiris-worldstate/archive');
    expect(env).toContain('EARTHQUAKE_DATA_MODE=database_with_live_fallback');
    expect(env).toContain('FLIGHTS_DATA_MODE=database_with_live_fallback');
    expect(env).toContain('COLLECTOR_SOURCES=all');
    expect(env).toContain('POSTGRES_PASSWORD=secret-password');
  });

  it('rejects unsafe paths and database identifiers', () => {
    expect(() => resolveSetupPaths('relative/path')).toThrow('absolute path');
    expect(() => resolveSetupPaths('/')).toThrow('cannot be /');
    expect(() => buildWizardEnv({
      mode: 'mounted_path',
      dataRoot: '/mnt/osiris-worldstate',
      osirisPort: '3000',
      dbName: 'bad-name',
      dbUser: 'osiris',
      dbPassword: 'secret',
    })).toThrow('PostgreSQL-safe identifier');
  });

  it('keeps mutating setup actions locked unless setup is explicitly enabled and authorized', () => {
    expect(readSetupAccess({}).enabled).toBe(false);
    expect(isSetupAuthorized('token', {})).toBe(false);
    expect(isSetupAuthorized('wrong', {
      OSIRIS_SETUP_ENABLED: '1',
      OSIRIS_SETUP_TOKEN: 'right',
    })).toBe(false);
    expect(isSetupAuthorized('right', {
      OSIRIS_SETUP_ENABLED: '1',
      OSIRIS_SETUP_TOKEN: 'right',
    })).toBe(true);
    expect(isSetupAuthorized(undefined, {
      OSIRIS_SETUP_ENABLED: '1',
      OSIRIS_SETUP_ALLOW_UNAUTHENTICATED: '1',
    })).toBe(true);
  });
});
