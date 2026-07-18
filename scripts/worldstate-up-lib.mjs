// Pure helper logic for the one-command World-State bring-up runner.
// Everything in this module is side-effect free so it can be unit tested;
// process, filesystem and Docker interaction stays in worldstate-up.mjs.

export const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.worldstate.yml'];

export const REQUIRED_ENV_KEYS = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'WORLDSTATE_DB_DATA',
  'RAW_ARCHIVE_HOST_PATH',
];

const DEVELOPMENT_FALLBACK_PASSWORD = 'osiris-local-dev';

/**
 * Parse a dotenv-style file into key/value pairs. Supports comments, blank
 * lines, `export KEY=value`, and single/double-quoted values. Later keys win,
 * matching Docker Compose behaviour.
 */
export function parseEnvFile(content) {
  const env = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    env[key] = value;
  }
  return env;
}

/** Names of required keys that are absent or empty. Never returns values. */
export function findMissingEnvKeys(env, requiredKeys = REQUIRED_ENV_KEYS) {
  return requiredKeys.filter((key) => !env[key] || !String(env[key]).trim());
}

/**
 * Non-fatal configuration warnings. Only ever mentions variable names and the
 * publicly documented development fallback password, never secret values.
 */
export function collectEnvWarnings(env) {
  const warnings = [];
  if (env.POSTGRES_PASSWORD === DEVELOPMENT_FALLBACK_PASSWORD) {
    warnings.push('POSTGRES_PASSWORD is the development fallback value; set a unique password before exposing PostgreSQL beyond loopback.');
  }
  if (env.COLLECTOR_SOURCES === undefined) {
    warnings.push('COLLECTOR_SOURCES is unset; the collector container defaults to the full source set (all).');
  }
  return warnings;
}

/** WORLDSTATE_DB_DATA may be a Docker named volume or an absolute host path. */
export function isNamedVolume(value) {
  return Boolean(value) && !String(value).startsWith('/') && !String(value).startsWith('.');
}

/** Resolve a compose-style host path (absolute, or relative to the repo root). */
export function resolveHostPath(value, rootDir) {
  const text = String(value).trim();
  if (text.startsWith('/')) {
    return text;
  }
  const trimmed = text.replace(/^\.\//, '');
  return `${rootDir.replace(/\/+$/, '')}/${trimmed}`;
}

/** Read a positive-integer environment value with a default. */
export function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

/**
 * Host-side check that the archive directory is writable by the collector
 * identity. `stats` carries numeric uid/gid/mode from fs.stat. This is a
 * fast preflight; the in-container archive-check service remains the
 * authoritative gate before the collector starts.
 */
export function evaluateArchiveWritability(stats, collectorUid, collectorGid) {
  const mode = stats.mode & 0o777;
  if (stats.uid === collectorUid && (mode & 0o200) !== 0) {
    return { status: 'pass', detail: `owned by uid ${collectorUid} with owner write permission` };
  }
  if (stats.gid === collectorGid && (mode & 0o020) !== 0) {
    return { status: 'pass', detail: `group ${collectorGid} has write permission` };
  }
  if ((mode & 0o002) !== 0) {
    return { status: 'pass', detail: 'world-writable (consider tightening to owner/group access)' };
  }
  return {
    status: 'fail',
    detail: `not writable by collector identity ${collectorUid}:${collectorGid} (owner ${stats.uid}, group ${stats.gid}, mode ${mode.toString(8).padStart(3, '0')})`,
  };
}

/** Build a `docker compose` argument list against the combined stack. */
export function composeArgs(...args) {
  const flags = [];
  for (const file of COMPOSE_FILES) {
    flags.push('-f', file);
  }
  return ['compose', ...flags, ...args];
}

/**
 * Parse an /api/v1/readiness response body. Returns null when the body is not
 * a readiness payload.
 */
export function parseReadinessBody(bodyText) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.status !== 'string') {
    return null;
  }
  const checks = Array.isArray(parsed.checks)
    ? parsed.checks
        .filter((check) => check && typeof check === 'object')
        .map((check) => ({
          id: String(check.id ?? ''),
          label: String(check.label ?? check.id ?? 'check'),
          status: String(check.status ?? 'not_ready'),
          detail: String(check.detail ?? ''),
        }))
    : [];
  return { status: parsed.status, checks };
}

/** Printable one-line-per-check readiness summary. */
export function describeReadinessChecks(readiness) {
  if (!readiness || readiness.checks.length === 0) {
    return ['(no readiness checks reported)'];
  }
  const icons = { ready: 'ok', degraded: 'warn', not_ready: 'FAIL' };
  return readiness.checks.map((check) => {
    const icon = icons[check.status] ?? check.status;
    return `[${icon}] ${check.label}: ${check.detail}`;
  });
}

/** Service URLs for the final status block. */
export function buildServiceUrls(osirisPort, collectorHealthPort) {
  return {
    worldstate: `http://localhost:${osirisPort}/worldstate`,
    appHealth: `http://127.0.0.1:${osirisPort}/api/health`,
    readiness: `http://127.0.0.1:${osirisPort}/api/v1/readiness`,
    collectorHealth: `http://127.0.0.1:${collectorHealthPort}/health`,
  };
}

/** Troubleshooting commands printed on failure and in the final summary. */
export function buildTroubleshootingCommands() {
  const compose = `docker compose -f ${COMPOSE_FILES.join(' -f ')}`;
  return [
    `${compose} ps`,
    `${compose} logs db`,
    `${compose} logs migrate`,
    `${compose} logs collector`,
    `${compose} logs osiris`,
    `${compose} run --rm archive-check`,
  ];
}
