import { describe, expect, it } from 'vitest';
import {
  buildPostSetupCommands,
  buildSetupEnvironmentSummary,
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
    const input = {
      mode: 'mounted_path',
      dataRoot: '/mnt/osiris-worldstate',
      osirisPort: '3000',
      dbName: 'osiris_worldstate',
      dbUser: 'osiris',
      dbPassword: 'secret-password',
    } as const;
    const env = buildWizardEnv(input);

    expect(env).toContain('WORLDSTATE_DB_DATA=/mnt/osiris-worldstate/postgres');
    expect(env).toContain('RAW_ARCHIVE_HOST_PATH=/mnt/osiris-worldstate/archive');
    expect(env).toContain('EARTHQUAKE_DATA_MODE=database_with_live_fallback');
    expect(env).toContain('FLIGHTS_DATA_MODE=database_with_live_fallback');
    expect(env).toContain('MARKETS_DATA_MODE=database_with_live_fallback');
    expect(env).toContain('COLLECTOR_SOURCES=all');
    expect(env).toContain('POSTGRES_PASSWORD=secret-password');
    expect(buildSetupEnvironmentSummary(input)).toEqual({
      osirisPort: '3000',
      dbName: 'osiris_worldstate',
      dbUser: 'osiris',
      dbPasswordSet: true,
      collectorSources: 'all',
      databaseModes: {
        earthquakes: 'database_with_live_fallback',
        flights: 'database_with_live_fallback',
        markets: 'database_with_live_fallback',
      },
    });
  });

  it('builds Ubuntu-safe post-setup commands', () => {
    expect(buildPostSetupCommands('3005')).toEqual([
      'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml config --quiet',
      'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml up -d osiris collector',
      'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml ps',
      'curl --fail http://127.0.0.1:3005/api/health',
      'curl --fail http://127.0.0.1:4001/health',
      '# Browser: http://localhost:3005/worldstate',
    ]);
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
