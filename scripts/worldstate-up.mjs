#!/usr/bin/env node
// One-command World-State bring-up runner (issue #34).
//
//   npm run worldstate:up
//
// Preflight-checks .env and storage, validates the combined Compose model,
// starts the osiris + collector stack, waits for service health and
// /api/v1/readiness, then prints the /worldstate URL. Secrets are never
// printed; failures name the variable or path, not its value.
//
// Exit codes: 0 success (ready or degraded), 1 preflight failure,
// 2 stack start failure, 3 readiness not reached before the timeout.

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  COMPOSE_FILES,
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

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');

const COLLECTOR_HEALTH_TIMEOUT_MS = 180_000;
const APP_HEALTH_TIMEOUT_MS = 300_000;
const DEFAULT_READINESS_TIMEOUT_SECONDS = 600;
const POLL_INTERVAL_MS = 5_000;

const USAGE = `Usage: npm run worldstate:up [-- <options>]

Options:
  --preflight-only              Run configuration/storage/Compose checks and exit.
  --readiness-timeout <seconds> How long to wait for /api/v1/readiness to reach
                                "ready" (default ${DEFAULT_READINESS_TIMEOUT_SECONDS}).
  --help                        Show this help.

Exit codes: 0 success (ready or degraded), 1 preflight failure,
2 stack start failure, 3 readiness not reached before the timeout.`;

main().catch((error) => {
  console.error(`\nworldstate:up failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  const options = readOptions();
  if (options.help) {
    console.log(USAGE);
    return;
  }

  console.log('OSIRIS World-State bring-up');
  console.log(`Repository: ${ROOT_DIR}\n`);

  const env = await preflight();
  const osirisPort = readPositiveInteger(env.OSIRIS_PORT, 3000);
  const collectorHealthPort = readPositiveInteger(env.COLLECTOR_HEALTH_PORT, 4001);
  const urls = buildServiceUrls(osirisPort, collectorHealthPort);

  if (options.preflightOnly) {
    console.log('\nPreflight passed. Re-run without --preflight-only to start the stack.');
    return;
  }

  await startStack();
  const readiness = await waitForRuntime(urls, options.readinessTimeoutMs);
  printFinalStatus(readiness, urls);

  if (readiness.outcome === 'not_ready') {
    process.exit(3);
  }
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        'preflight-only': { type: 'boolean', default: false },
        'readiness-timeout': { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${USAGE}`);
    process.exit(1);
  }
  const readinessTimeoutSeconds = readPositiveInteger(
    parsed.values['readiness-timeout'],
    DEFAULT_READINESS_TIMEOUT_SECONDS,
  );
  return {
    help: parsed.values.help,
    preflightOnly: parsed.values['preflight-only'],
    readinessTimeoutMs: readinessTimeoutSeconds * 1000,
  };
}

async function preflight() {
  console.log('[1/5] Checking .env configuration');
  let envContent;
  try {
    envContent = await readFile(ENV_FILE, 'utf8');
  } catch {
    failPreflight([
      `.env was not found at ${ENV_FILE}.`,
      'Create it with the setup wizard first:',
      '  npm run setup:wizard',
    ]);
  }
  const env = parseEnvFile(envContent);
  const missing = findMissingEnvKeys(env);
  if (missing.length > 0) {
    failPreflight([
      `.env is missing required World-State variables: ${missing.join(', ')}.`,
      'Re-run the setup wizard or add them manually (see .env.example).',
    ]);
  }
  for (const warning of collectEnvWarnings(env)) {
    console.log(`  warning: ${warning}`);
  }
  console.log('  .env present with required World-State variables.');

  console.log('[2/5] Checking storage paths');
  if (isNamedVolume(env.WORLDSTATE_DB_DATA)) {
    console.log(`  WORLDSTATE_DB_DATA uses Docker named volume "${env.WORLDSTATE_DB_DATA}".`);
  } else {
    const dbPath = resolveHostPath(env.WORLDSTATE_DB_DATA, ROOT_DIR);
    if (!(await isDirectory(dbPath))) {
      failPreflight([
        `WORLDSTATE_DB_DATA points to ${dbPath}, which does not exist.`,
        'Mount the storage disk and re-run the setup wizard, or create the directory:',
        `  sudo install -d -m 0750 ${dbPath}`,
      ]);
    }
    console.log(`  Database data directory exists: ${dbPath}`);
  }

  const archivePath = resolveHostPath(env.RAW_ARCHIVE_HOST_PATH, ROOT_DIR);
  if (!(await isDirectory(archivePath))) {
    failPreflight([
      `RAW_ARCHIVE_HOST_PATH points to ${archivePath}, which does not exist.`,
      'The Compose bind mount deliberately refuses to auto-create it. Create it first:',
      `  install -d -m 0750 ${archivePath}`,
      `  sudo chown <COLLECTOR_UID>:<COLLECTOR_GID> ${archivePath}`,
    ]);
  }
  console.log(`  Raw archive directory exists: ${archivePath}`);

  console.log('[3/5] Checking archive permissions');
  const collectorUid = readPositiveInteger(env.COLLECTOR_UID, 1000);
  const collectorGid = readPositiveInteger(env.COLLECTOR_GID, 1000);
  const archiveStats = await stat(archivePath);
  const writability = evaluateArchiveWritability(archiveStats, collectorUid, collectorGid);
  if (writability.status === 'fail') {
    failPreflight([
      `Archive directory ${archivePath} is ${writability.detail}.`,
      'Fix ownership so the collector container can write raw archives:',
      `  sudo chown ${collectorUid}:${collectorGid} ${archivePath}`,
      `  sudo chmod 0750 ${archivePath}`,
    ]);
  }
  console.log(`  Archive is writable by collector identity ${collectorUid}:${collectorGid} (${writability.detail}).`);

  console.log('[4/5] Checking Docker Compose availability');
  const dockerCheck = await runCaptured('docker', ['compose', 'version']);
  if (dockerCheck.code !== 0) {
    failPreflight([
      'Docker Compose is not available (`docker compose version` failed).',
      'Install Docker Engine with the Compose plugin before starting OSIRIS.',
    ]);
  }
  console.log(`  ${dockerCheck.stdout.trim().split('\n')[0]}`);

  console.log('[5/5] Validating combined Compose model');
  const composeCheck = await runCaptured('docker', composeArgs('config', '--quiet'));
  if (composeCheck.code !== 0) {
    failPreflight([
      `Compose validation failed for ${COMPOSE_FILES.join(' + ')}:`,
      indent(composeCheck.stderr.trim() || composeCheck.stdout.trim() || `exit ${composeCheck.code}`),
    ]);
  }
  console.log('  Combined Compose model is valid.');

  return env;
}

async function startStack() {
  console.log('\nStarting the combined World-State stack (db, migrate, archive-check, collector, osiris)...');
  console.log(`  docker ${composeArgs('up', '-d', 'osiris', 'collector').join(' ')}`);
  const code = await runInherited('docker', composeArgs('up', '-d', 'osiris', 'collector'));
  if (code !== 0) {
    console.error('\nStack start failed. Inspect the services with:');
    for (const command of buildTroubleshootingCommands()) {
      console.error(`  ${command}`);
    }
    process.exit(2);
  }
  console.log('Stack started; migrations and the archive check completed successfully.');
}

async function waitForRuntime(urls, readinessTimeoutMs) {
  console.log('\nWaiting for collector health...');
  await waitForHttpOk(urls.collectorHealth, COLLECTOR_HEALTH_TIMEOUT_MS, 'collector /health');
  console.log(`  Collector is healthy: ${urls.collectorHealth}`);

  console.log('Waiting for application health...');
  await waitForHttpOk(urls.appHealth, APP_HEALTH_TIMEOUT_MS, 'OSIRIS /api/health');
  console.log(`  Application is healthy: ${urls.appHealth}`);

  console.log(`Waiting for World-State readiness (up to ${Math.round(readinessTimeoutMs / 1000)}s)...`);
  const deadline = Date.now() + readinessTimeoutMs;
  let lastReadiness = null;
  let lastReported = '';
  while (Date.now() < deadline) {
    const readiness = await fetchReadiness(urls.readiness);
    if (readiness) {
      lastReadiness = readiness;
      if (readiness.status !== lastReported) {
        console.log(`  Readiness is "${readiness.status}".`);
        lastReported = readiness.status;
      }
      if (readiness.status === 'ready') {
        return { outcome: 'ready', readiness };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (lastReadiness?.status === 'degraded') {
    return { outcome: 'degraded', readiness: lastReadiness };
  }
  return { outcome: 'not_ready', readiness: lastReadiness };
}

function printFinalStatus(result, urls) {
  console.log('\n────────────────────────────────────────');
  if (result.outcome === 'ready') {
    console.log('World-State is READY.');
  } else if (result.outcome === 'degraded') {
    console.log('World-State is DEGRADED but running.');
    console.log('The first collection cycle may still be filling in sources; re-check readiness in a few minutes.');
  } else {
    console.log('World-State did NOT become ready before the timeout.');
    console.log('The stack is started, but readiness checks are still failing.');
  }

  console.log('\nReadiness checks:');
  for (const line of describeReadinessChecks(result.readiness)) {
    console.log(`  ${line}`);
  }

  console.log('\nURLs:');
  console.log(`  World-State console: ${urls.worldstate}`);
  console.log(`  Runtime readiness:   ${urls.readiness}`);
  console.log(`  Application health:  ${urls.appHealth}`);
  console.log(`  Collector health:    ${urls.collectorHealth}`);

  console.log('\nTroubleshooting commands:');
  for (const command of buildTroubleshootingCommands()) {
    console.log(`  ${command}`);
  }
}

async function fetchReadiness(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
    return parseReadinessBody(await response.text());
  } catch {
    return null;
  }
}

async function waitForHttpOk(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.error(`\nTimed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label} at ${url} (${lastError}).`);
  console.error('Inspect the services with:');
  for (const command of buildTroubleshootingCommands()) {
    console.error(`  ${command}`);
  }
  process.exit(2);
}

function failPreflight(lines) {
  console.error('\nPreflight failed:');
  for (const line of lines) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function runCaptured(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error.message) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function runInherited(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
