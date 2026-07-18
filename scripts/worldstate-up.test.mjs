import { describe, expect, it } from 'vitest';
import {
  buildServiceUrls,
  buildTroubleshootingCommands,
  collectEnvWarnings,
  composeArgs,
  describeReadinessChecks,
  evaluateArchiveWritability,
  findMissingEnvKeys,
  isNamedVolume,
  parseEnvFile,
  parseReadinessBody,
  readPositiveInteger,
  resolveHostPath,
} from './worldstate-up-lib.mjs';

describe('parseEnvFile', () => {
  it('parses simple assignments, comments and blank lines', () => {
    const env = parseEnvFile([
      '# comment',
      '',
      'POSTGRES_DB=osiris_worldstate',
      'export OSIRIS_PORT=3000',
      'RAW_ARCHIVE_HOST_PATH=./archive',
    ].join('\n'));
    expect(env).toEqual({
      POSTGRES_DB: 'osiris_worldstate',
      OSIRIS_PORT: '3000',
      RAW_ARCHIVE_HOST_PATH: './archive',
    });
  });

  it('preserves quoted values containing $ and #', () => {
    const env = parseEnvFile([
      "POSTGRES_PASSWORD='p$ss#word'",
      'LABEL="quoted # value"',
    ].join('\n'));
    expect(env.POSTGRES_PASSWORD).toBe('p$ss#word');
    expect(env.LABEL).toBe('quoted # value');
  });

  it('strips trailing inline comments from unquoted values', () => {
    const env = parseEnvFile('COLLECTOR_SOURCES=all # every supported source');
    expect(env.COLLECTOR_SOURCES).toBe('all');
  });

  it('lets later assignments win and ignores malformed lines', () => {
    const env = parseEnvFile([
      'OSIRIS_PORT=3000',
      'OSIRIS_PORT=3100',
      'not a valid line',
      '=nokey',
    ].join('\n'));
    expect(env).toEqual({ OSIRIS_PORT: '3100' });
  });

  it('handles CRLF line endings', () => {
    const env = parseEnvFile('POSTGRES_USER=osiris\r\nPOSTGRES_DB=osiris_worldstate\r\n');
    expect(env.POSTGRES_USER).toBe('osiris');
    expect(env.POSTGRES_DB).toBe('osiris_worldstate');
  });
});

describe('findMissingEnvKeys', () => {
  const complete = {
    POSTGRES_DB: 'osiris_worldstate',
    POSTGRES_USER: 'osiris',
    POSTGRES_PASSWORD: 'x',
    WORLDSTATE_DB_DATA: '/mnt/osiris-worldstate/postgres',
    RAW_ARCHIVE_HOST_PATH: '/mnt/osiris-worldstate/archive',
  };

  it('returns an empty list when every required key is present', () => {
    expect(findMissingEnvKeys(complete)).toEqual([]);
  });

  it('reports absent and empty keys by name only', () => {
    const env = { ...complete, POSTGRES_PASSWORD: '   ' };
    delete env.RAW_ARCHIVE_HOST_PATH;
    expect(findMissingEnvKeys(env)).toEqual(['POSTGRES_PASSWORD', 'RAW_ARCHIVE_HOST_PATH']);
  });
});

describe('collectEnvWarnings', () => {
  it('warns about the development fallback password without printing custom values', () => {
    const warnings = collectEnvWarnings({ POSTGRES_PASSWORD: 'osiris-local-dev', COLLECTOR_SOURCES: 'all' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('development fallback');
  });

  it('never includes a custom password value in warnings', () => {
    const warnings = collectEnvWarnings({ POSTGRES_PASSWORD: 'super-secret-value', COLLECTOR_SOURCES: 'all' });
    expect(JSON.stringify(warnings)).not.toContain('super-secret-value');
  });

  it('notes when COLLECTOR_SOURCES is unset', () => {
    const warnings = collectEnvWarnings({ POSTGRES_PASSWORD: 'x' });
    expect(warnings.some((warning) => warning.includes('COLLECTOR_SOURCES'))).toBe(true);
  });
});

describe('isNamedVolume', () => {
  it('treats non-path values as Docker named volumes', () => {
    expect(isNamedVolume('worldstate-db-data')).toBe(true);
  });

  it('treats absolute and relative paths as host paths', () => {
    expect(isNamedVolume('/mnt/osiris-worldstate/postgres')).toBe(false);
    expect(isNamedVolume('./postgres')).toBe(false);
  });

  it('rejects empty values', () => {
    expect(isNamedVolume('')).toBe(false);
    expect(isNamedVolume(undefined)).toBe(false);
  });
});

describe('resolveHostPath', () => {
  it('keeps absolute paths unchanged', () => {
    expect(resolveHostPath('/mnt/osiris-worldstate/archive', '/repo')).toBe('/mnt/osiris-worldstate/archive');
  });

  it('resolves ./ and bare relative paths against the repository root', () => {
    expect(resolveHostPath('./archive', '/repo')).toBe('/repo/archive');
    expect(resolveHostPath('archive', '/repo')).toBe('/repo/archive');
  });
});

describe('readPositiveInteger', () => {
  it('accepts positive integers and rejects everything else', () => {
    expect(readPositiveInteger('3000', 1)).toBe(3000);
    expect(readPositiveInteger('0', 7)).toBe(7);
    expect(readPositiveInteger('-5', 7)).toBe(7);
    expect(readPositiveInteger('abc', 7)).toBe(7);
    expect(readPositiveInteger(undefined, 7)).toBe(7);
  });
});

describe('evaluateArchiveWritability', () => {
  it('passes for an owner-writable directory owned by the collector uid', () => {
    const result = evaluateArchiveWritability({ uid: 1000, gid: 1000, mode: 0o40750 }, 1000, 1000);
    expect(result.status).toBe('pass');
  });

  it('passes for a group-writable directory matching the collector gid', () => {
    const result = evaluateArchiveWritability({ uid: 0, gid: 1000, mode: 0o40770 }, 1000, 1000);
    expect(result.status).toBe('pass');
  });

  it('fails for a root-owned directory without collector access', () => {
    const result = evaluateArchiveWritability({ uid: 0, gid: 0, mode: 0o40750 }, 1000, 1000);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('1000:1000');
  });

  it('fails when the collector owns the directory but has no write bit', () => {
    const result = evaluateArchiveWritability({ uid: 1000, gid: 1000, mode: 0o40550 }, 1000, 1000);
    expect(result.status).toBe('fail');
  });
});

describe('composeArgs', () => {
  it('always addresses the combined Compose model', () => {
    expect(composeArgs('config', '--quiet')).toEqual([
      'compose',
      '-f', 'docker-compose.yml',
      '-f', 'docker-compose.worldstate.yml',
      'config', '--quiet',
    ]);
  });
});

describe('parseReadinessBody', () => {
  it('parses a readiness payload with checks', () => {
    const readiness = parseReadinessBody(JSON.stringify({
      status: 'degraded',
      checks: [
        { id: 'migrations', label: 'Database migrations', status: 'ready', detail: '23/23 migrations applied.' },
        { id: 'normalised-events', label: 'Normalised events', status: 'degraded', detail: 'No normalised event rows.' },
      ],
    }));
    expect(readiness?.status).toBe('degraded');
    expect(readiness?.checks).toHaveLength(2);
    expect(readiness?.checks[1].status).toBe('degraded');
  });

  it('returns null for non-JSON and non-readiness bodies', () => {
    expect(parseReadinessBody('<html>gateway error</html>')).toBeNull();
    expect(parseReadinessBody(JSON.stringify({ ok: true }))).toBeNull();
    expect(parseReadinessBody(JSON.stringify(null))).toBeNull();
  });

  it('tolerates missing check fields', () => {
    const readiness = parseReadinessBody(JSON.stringify({ status: 'not_ready', checks: [{ id: 'database' }] }));
    expect(readiness?.checks[0]).toEqual({
      id: 'database',
      label: 'database',
      status: 'not_ready',
      detail: '',
    });
  });
});

describe('describeReadinessChecks', () => {
  it('renders one line per check with a status tag', () => {
    const lines = describeReadinessChecks({
      status: 'degraded',
      checks: [
        { id: 'migrations', label: 'Database migrations', status: 'ready', detail: '23/23 applied.' },
        { id: 'collector-runs', label: 'Collector runs', status: 'not_ready', detail: 'No collector runs yet.' },
      ],
    });
    expect(lines).toEqual([
      '[ok] Database migrations: 23/23 applied.',
      '[FAIL] Collector runs: No collector runs yet.',
    ]);
  });

  it('handles a missing readiness payload', () => {
    expect(describeReadinessChecks(null)).toEqual(['(no readiness checks reported)']);
  });
});

describe('buildServiceUrls', () => {
  it('builds the console, readiness, health and collector URLs from ports', () => {
    expect(buildServiceUrls(3100, 4101)).toEqual({
      worldstate: 'http://localhost:3100/worldstate',
      appHealth: 'http://127.0.0.1:3100/api/health',
      readiness: 'http://127.0.0.1:3100/api/v1/readiness',
      collectorHealth: 'http://127.0.0.1:4101/health',
    });
  });
});

describe('buildTroubleshootingCommands', () => {
  it('addresses the combined Compose project in every command', () => {
    const commands = buildTroubleshootingCommands();
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toContain('docker compose -f docker-compose.yml -f docker-compose.worldstate.yml');
    }
  });
});
