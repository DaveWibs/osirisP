import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, appendFile, chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type StorageSetupMode = 'mounted_path' | 'mount_existing_filesystem' | 'local_default';

export interface UbuntuSetupInput {
  mode: StorageSetupMode;
  dataRoot: string;
  device?: string;
  persistFstab?: boolean;
  allowNonMountRoot?: boolean;
  osirisPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  archiveContainerPath?: string;
  validateCompose?: boolean;
}

export interface BlockDevice {
  name: string;
  path: string;
  size: string;
  type: string;
  fstype: string;
  label: string;
  uuid: string;
  mountpoints: string[];
  model: string;
}

export interface MountInfo {
  target: string;
  source: string;
  fstype: string;
  options: string;
  isMountRoot: boolean;
}

export interface SetupStatus {
  enabled: boolean;
  tokenConfigured: boolean;
  unauthenticatedMutationsAllowed: boolean;
  platform: NodeJS.Platform;
  isUbuntu: boolean;
  isRoot: boolean;
  commands: Record<'lsblk' | 'findmnt' | 'docker' | 'mount' | 'sudo', boolean>;
  defaultDataRoot: string;
  envExists: boolean;
  devices: BlockDevice[];
  readiness: SetupReadinessItem[];
  warnings: string[];
}

export interface SetupReadinessItem {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SetupEnvironmentSummary {
  osirisPort: string;
  dbName: string;
  dbUser: string;
  dbPasswordSet: boolean;
  collectorSources: string;
  databaseModes: {
    earthquakes: string;
    flights: string;
    markets: string;
    news: string;
    fires: string;
    weather: string;
    spaceWeather: string;
    radar: string;
    airQuality: string;
    crypto: string;
  };
}

export interface UbuntuSetupResult {
  dataRoot: string;
  dbHostPath: string;
  archiveHostPath: string;
  archiveContainerPath: string;
  envPath: string;
  envBackupPath?: string;
  mounted?: {
    device: string;
    mountPoint: string;
    fstabUpdated: boolean;
  };
  composeValidated: boolean;
  environment: SetupEnvironmentSummary;
  nextCommands: string[];
  warnings: string[];
}

export class UbuntuSetupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'UbuntuSetupError';
  }
}

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env');
const DEFAULT_DATA_ROOT = '/srv/osiris-worldstate';
const DEFAULT_ARCHIVE_CONTAINER_PATH = '/archive';

type SetupEnvironment = Partial<Record<string, string | undefined>>;

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function runCommand(command: string, args: string[], input?: string): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new UbuntuSetupError(`${command} ${args.join(' ')} failed: ${stderr || stdout || `exit ${code}`}`));
      }
    });

    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function runPrivileged(command: string, args: string[], input?: string): Promise<CommandResult> {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return runCommand(command, args, input);
  }
  if (!(await commandExists('sudo'))) {
    throw new UbuntuSetupError(`Root or sudo is required to run ${command}. Start the setup server with suitable privileges or run the terminal wizard.`, 403);
  }
  return runCommand('sudo', ['-n', command, ...args], input);
}

export function readSetupAccess(environment: SetupEnvironment = process.env) {
  return {
    enabled: environment.OSIRIS_SETUP_ENABLED === '1',
    token: environment.OSIRIS_SETUP_TOKEN?.trim() || '',
    unauthenticatedMutationsAllowed: environment.OSIRIS_SETUP_ALLOW_UNAUTHENTICATED === '1',
  };
}

export function isSetupAuthorized(token: unknown, environment: SetupEnvironment = process.env): boolean {
  const access = readSetupAccess(environment);
  if (!access.enabled) {
    return false;
  }
  if (access.token) {
    return typeof token === 'string' && token === access.token;
  }
  return access.unauthenticatedMutationsAllowed;
}

export function generateSetupPassword(): string {
  return randomBytes(27).toString('base64');
}

export function resolveSetupPaths(dataRoot: string, archiveContainerPath = DEFAULT_ARCHIVE_CONTAINER_PATH) {
  const root = normaliseAbsolutePath(dataRoot, 'dataRoot');
  return {
    dataRoot: root,
    dbHostPath: path.join(root, 'postgres'),
    archiveHostPath: path.join(root, 'archive'),
    archiveContainerPath,
  };
}

export function buildWizardEnv(input: UbuntuSetupInput): string {
  const paths = resolveSetupPaths(input.dataRoot, input.archiveContainerPath);
  const osirisPort = readPort(input.osirisPort, 'osirisPort');
  const dbName = readIdentifier(input.dbName, 'dbName');
  const dbUser = readIdentifier(input.dbUser, 'dbUser');
  const dbPassword = readRequiredText(input.dbPassword, 'dbPassword');

  return [
    '# Generated by OSIRIS GUI setup wizard',
    `OSIRIS_PORT=${osirisPort}`,
    '',
    `POSTGRES_DB=${dbName}`,
    `POSTGRES_USER=${dbUser}`,
    `POSTGRES_PASSWORD=${dbPassword}`,
    'POSTGRES_PORT=5432',
    '',
    `WORLDSTATE_DB_DATA=${paths.dbHostPath}`,
    `RAW_ARCHIVE_HOST_PATH=${paths.archiveHostPath}`,
    `RAW_ARCHIVE_PATH=${paths.archiveContainerPath}`,
    '',
    'EARTHQUAKE_DATA_MODE=database_with_live_fallback',
    'EARTHQUAKE_DATABASE_MAX_AGE_MS=900000',
    'FLIGHTS_DATA_MODE=database_with_live_fallback',
    'FLIGHTS_DATABASE_MAX_AGE_MS=900000',
    'FLIGHTS_DATABASE_WINDOW_MS=900000',
    'MARKETS_DATA_MODE=database_with_live_fallback',
    'MARKETS_DATABASE_MAX_AGE_MS=900000',
    'MARKETS_DATABASE_WINDOW_MS=900000',
    'NEWS_DATA_MODE=database_with_live_fallback',
    'NEWS_DATABASE_WINDOW_MS=86400000',
    'FIRES_DATA_MODE=database_with_live_fallback',
    'FIRES_DATABASE_WINDOW_MS=86400000',
    'WEATHER_DATA_MODE=database_with_live_fallback',
    'WEATHER_DATABASE_WINDOW_MS=86400000',
    'SPACE_WEATHER_DATA_MODE=database_with_live_fallback',
    'SPACE_WEATHER_DATABASE_WINDOW_MS=86400000',
    'RADAR_DATA_MODE=database_with_live_fallback',
    'RADAR_DATABASE_WINDOW_MS=86400000',
    'AIR_QUALITY_DATA_MODE=database_with_live_fallback',
    'AIR_QUALITY_DATABASE_WINDOW_MS=86400000',
    'CRYPTO_DATA_MODE=database_with_live_fallback',
    '',
    'COLLECTOR_SOURCES=all',
    'COLLECTOR_SOURCE=usgs-earthquakes',
    'COLLECT_INTERVAL_MS=300000',
    'COLLECT_ON_STARTUP=1',
    'MAX_FETCH_ATTEMPTS=3',
    'MAX_RESPONSE_BYTES=26214400',
    'REQUEST_TIMEOUT_MS=10000',
    'RETRY_BASE_MS=500',
    'STALE_RUN_AFTER_MS=900000',
    '',
    `COLLECTOR_UID=${targetUid()}`,
    `COLLECTOR_GID=${targetGid()}`,
    'COLLECTOR_HEALTH_PORT=4001',
    'COLLECTOR_LOG_LEVEL=info',
    '',
  ].join('\n');
}

export function buildSetupEnvironmentSummary(input: UbuntuSetupInput): SetupEnvironmentSummary {
  return {
    osirisPort: readPort(input.osirisPort, 'osirisPort'),
    dbName: readIdentifier(input.dbName, 'dbName'),
    dbUser: readIdentifier(input.dbUser, 'dbUser'),
    dbPasswordSet: Boolean(readRequiredText(input.dbPassword, 'dbPassword')),
    collectorSources: 'all',
    databaseModes: {
      earthquakes: 'database_with_live_fallback',
      flights: 'database_with_live_fallback',
      markets: 'database_with_live_fallback',
      news: 'database_with_live_fallback',
      fires: 'database_with_live_fallback',
      weather: 'database_with_live_fallback',
      spaceWeather: 'database_with_live_fallback',
      radar: 'database_with_live_fallback',
      airQuality: 'database_with_live_fallback',
      crypto: 'database_with_live_fallback',
    },
  };
}

export function buildPostSetupCommands(osirisPort: string): string[] {
  const port = readPort(osirisPort, 'osirisPort');
  return [
    'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml config --quiet',
    'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml up -d osiris collector',
    'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml ps',
    `curl --fail http://127.0.0.1:${port}/api/health`,
    'curl --fail http://127.0.0.1:4001/health',
    `# Browser: http://localhost:${port}/worldstate`,
  ];
}

export async function loadSetupStatus(environment: SetupEnvironment = process.env): Promise<SetupStatus> {
  const access = readSetupAccess(environment);
  const [lsblk, findmnt, docker, mount, sudo] = await Promise.all([
    commandExists('lsblk'),
    commandExists('findmnt'),
    commandExists('docker'),
    commandExists('mount'),
    commandExists('sudo'),
  ]);
  const warnings: string[] = [];
  const devices = lsblk ? await listBlockDevices().catch((error) => {
      warnings.push(error instanceof Error ? error.message : 'Unable to list block devices');
      return [];
    }) : [];
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const isUbuntuHost = await isUbuntu();
  const commands = { lsblk, findmnt, docker, mount, sudo };

  return {
    enabled: access.enabled,
    tokenConfigured: Boolean(access.token),
    unauthenticatedMutationsAllowed: access.unauthenticatedMutationsAllowed,
    platform: process.platform,
    isUbuntu: isUbuntuHost,
    isRoot,
    commands,
    defaultDataRoot: DEFAULT_DATA_ROOT,
    envExists: await exists(ENV_FILE),
    devices,
    readiness: buildReadiness({
      access,
      commands,
      devices,
      envExists: await exists(ENV_FILE),
      isRoot,
      isUbuntu: isUbuntuHost,
      platform: process.platform,
    }),
    warnings,
  };
}

export async function applyUbuntuSetup(input: UbuntuSetupInput): Promise<UbuntuSetupResult> {
  validateSetupInput(input);
  const warnings: string[] = [];
  const paths = resolveSetupPaths(input.dataRoot, input.archiveContainerPath);
  let mounted: UbuntuSetupResult['mounted'];

  if (input.mode === 'mount_existing_filesystem') {
    if (!input.device) {
      throw new UbuntuSetupError('device is required when mounting an existing filesystem');
    }
    mounted = await mountExistingFilesystem(input.device, paths.dataRoot, Boolean(input.persistFstab));
  }

  await ensureDataRoot(paths.dataRoot);
  const mountInfo = await getMountInfo(paths.dataRoot);
  if (input.mode !== 'local_default' && !input.allowNonMountRoot && !mountInfo?.isMountRoot) {
    throw new UbuntuSetupError(`${paths.dataRoot} is not a mount root. Enable "allow non-mounted path" only if this is intentional.`);
  }
  if (!mountInfo?.isMountRoot) {
    warnings.push(`${paths.dataRoot} is not a mounted filesystem root; PostgreSQL data may be stored on the OS disk.`);
  }

  await prepareStorageDirectories(paths.dbHostPath, paths.archiveHostPath);
  const envBackupPath = await writeEnvironmentFile(buildWizardEnv(input));
  let composeValidated = false;
  if (input.validateCompose) {
    await runCommand('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.worldstate.yml', 'config', '--quiet']);
    composeValidated = true;
  }

  return {
    ...paths,
    envPath: ENV_FILE,
    envBackupPath,
    mounted,
    composeValidated,
    environment: buildSetupEnvironmentSummary(input),
    nextCommands: buildPostSetupCommands(input.osirisPort),
    warnings,
  };
}

function buildReadiness({
  access,
  commands,
  devices,
  envExists,
  isRoot,
  isUbuntu,
  platform,
}: {
  access: ReturnType<typeof readSetupAccess>;
  commands: SetupStatus['commands'];
  devices: BlockDevice[];
  envExists: boolean;
  isRoot: boolean;
  isUbuntu: boolean;
  platform: NodeJS.Platform;
}): SetupReadinessItem[] {
  const canElevate = isRoot || commands.sudo;
  const formattedDevices = devices.filter((device) => device.fstype);
  return [
    {
      id: 'setup-lock',
      label: 'Setup lock',
      status: access.enabled && (Boolean(access.token) || access.unauthenticatedMutationsAllowed) ? 'pass' : 'fail',
      detail: access.enabled
        ? 'Mutating setup route is enabled for this process.'
        : 'Set OSIRIS_SETUP_ENABLED=1 before applying changes from the browser wizard.',
    },
    {
      id: 'host-os',
      label: 'Ubuntu host',
      status: isUbuntu ? 'pass' : 'warn',
      detail: isUbuntu ? 'Ubuntu-compatible host detected.' : `Current platform is ${platform}; Ubuntu Server is the supported install target.`,
    },
    {
      id: 'docker',
      label: 'Docker Compose',
      status: commands.docker ? 'pass' : 'fail',
      detail: commands.docker ? 'Docker CLI is available for Compose validation and startup.' : 'Install Docker before starting OSIRIS services.',
    },
    {
      id: 'storage-tools',
      label: 'Storage tooling',
      status: commands.lsblk && commands.findmnt && commands.mount ? 'pass' : 'fail',
      detail: commands.lsblk && commands.findmnt && commands.mount
        ? 'lsblk, findmnt and mount are available for disk discovery.'
        : 'Install util-linux tools so the wizard can inspect and mount storage.',
    },
    {
      id: 'privilege',
      label: 'Mount privilege',
      status: canElevate ? 'pass' : 'warn',
      detail: canElevate
        ? 'The setup process can run privileged mount/directory operations.'
        : 'Mounting from the browser requires root or passwordless sudo; otherwise mount the disk before using the wizard.',
    },
    {
      id: 'formatted-devices',
      label: 'Formatted devices',
      status: formattedDevices.length > 0 ? 'pass' : 'warn',
      detail: formattedDevices.length > 0
        ? `${formattedDevices.length} formatted block device${formattedDevices.length === 1 ? '' : 's'} detected.`
        : 'No formatted block devices were detected; use an already mounted path or local default storage.',
    },
    {
      id: 'env-file',
      label: '.env handling',
      status: 'pass',
      detail: envExists ? 'Existing .env will be backed up before replacement.' : 'No .env exists yet; the wizard will create one.',
    },
  ];
}

export async function listBlockDevices(): Promise<BlockDevice[]> {
  const { stdout } = await runCommand('lsblk', [
    '-J',
    '-o',
    'NAME,PATH,SIZE,TYPE,FSTYPE,LABEL,UUID,MOUNTPOINTS,MODEL',
  ]);
  const parsed = JSON.parse(stdout) as { blockdevices?: RawBlockDevice[] };
  return flattenBlockDevices(parsed.blockdevices ?? []).filter((device) => (
    device.type === 'part' || device.type === 'disk'
  ));
}

export async function getMountInfo(targetPath: string): Promise<MountInfo | null> {
  const absolutePath = normaliseAbsolutePath(targetPath, 'targetPath');
  if (!(await commandExists('findmnt'))) {
    return null;
  }
  try {
    const { stdout } = await runCommand('findmnt', ['-T', absolutePath, '-J']);
    const parsed = JSON.parse(stdout) as {
      filesystems?: Array<{
        target?: string;
        source?: string;
        fstype?: string;
        options?: string;
      }>;
    };
    const filesystem = parsed.filesystems?.[0];
    if (!filesystem?.target) {
      return null;
    }
    return {
      target: filesystem.target,
      source: filesystem.source ?? '',
      fstype: filesystem.fstype ?? '',
      options: filesystem.options ?? '',
      isMountRoot: path.resolve(filesystem.target) === absolutePath,
    };
  } catch {
    return null;
  }
}

interface RawBlockDevice {
  name?: string;
  path?: string;
  size?: string;
  type?: string;
  fstype?: string | null;
  label?: string | null;
  uuid?: string | null;
  mountpoints?: Array<string | null> | string | null;
  model?: string | null;
  children?: RawBlockDevice[];
}

function flattenBlockDevices(devices: RawBlockDevice[]): BlockDevice[] {
  return devices.flatMap((device) => {
    const current: BlockDevice = {
      name: device.name ?? '',
      path: device.path ?? (device.name ? `/dev/${device.name}` : ''),
      size: device.size ?? '',
      type: device.type ?? '',
      fstype: device.fstype ?? '',
      label: device.label ?? '',
      uuid: device.uuid ?? '',
      mountpoints: normaliseMountpoints(device.mountpoints),
      model: device.model ?? '',
    };
    return [current, ...flattenBlockDevices(device.children ?? [])];
  });
}

function normaliseMountpoints(value: RawBlockDevice['mountpoints']): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => Boolean(entry));
  }
  return value ? [value] : [];
}

async function mountExistingFilesystem(devicePath: string, mountPoint: string, persistFstab: boolean) {
  const device = normaliseDevicePath(devicePath);
  const devices = await listBlockDevices();
  const selected = devices.find((candidate) => candidate.path === device);
  if (!selected) {
    throw new UbuntuSetupError(`Device was not found by lsblk: ${device}`);
  }
  if (!selected.fstype) {
    throw new UbuntuSetupError(`${device} has no detected filesystem. Format or partition it outside OSIRIS first.`);
  }

  await ensureDataRoot(mountPoint);
  const before = await getMountInfo(mountPoint);
  if (!before?.isMountRoot) {
    const source = selected.uuid ? `UUID=${selected.uuid}` : device;
    await runPrivileged('mount', [source, mountPoint]);
  }

  const after = await getMountInfo(mountPoint);
  if (!after?.isMountRoot) {
    throw new UbuntuSetupError(`Mount command completed, but ${mountPoint} is not a mount root.`);
  }

  let fstabUpdated = false;
  if (persistFstab) {
    if (!selected.uuid) {
      throw new UbuntuSetupError(`${device} has no UUID, so the GUI wizard will not create a persistent /etc/fstab entry.`);
    }
    const line = `UUID=${selected.uuid} ${mountPoint.replaceAll(' ', '\\040')} ${selected.fstype} defaults,nofail 0 2\n`;
    fstabUpdated = await appendFstabLineIfMissing(selected.uuid, line);
  }

  return {
    device,
    mountPoint,
    fstabUpdated,
  };
}

async function appendFstabLineIfMissing(uuid: string, line: string): Promise<boolean> {
  try {
    const { stdout } = await runCommand('grep', ['-q', `UUID=${uuid}`, '/etc/fstab']).then(
      () => ({ stdout: 'exists', stderr: '' }),
      () => ({ stdout: '', stderr: '' }),
    );
    if (stdout === 'exists') {
      return false;
    }
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      await appendFile('/etc/fstab', line);
    } else {
      await runPrivileged('tee', ['-a', '/etc/fstab'], line);
    }
    return true;
  } catch (error) {
    if (error instanceof UbuntuSetupError) {
      throw error;
    }
    throw new UbuntuSetupError(`Unable to update /etc/fstab: ${String(error)}`);
  }
}

async function ensureDataRoot(dataRoot: string): Promise<void> {
  const root = normaliseAbsolutePath(dataRoot, 'dataRoot');
  try {
    await mkdir(root, { recursive: true, mode: 0o750 });
    await chmod(root, 0o750).catch(() => undefined);
  } catch {
    await runPrivileged('install', ['-d', '-m', '0750', root]);
  }
}

async function prepareStorageDirectories(dbHostPath: string, archiveHostPath: string): Promise<void> {
  for (const directory of [dbHostPath, archiveHostPath]) {
    try {
      await mkdir(directory, { recursive: true, mode: 0o750 });
      await chmod(directory, 0o750).catch(() => undefined);
    } catch {
      await runPrivileged('install', ['-d', '-m', '0750', directory]);
    }
  }
}

async function writeEnvironmentFile(content: string): Promise<string | undefined> {
  let backupPath: string | undefined;
  if (await exists(ENV_FILE)) {
    backupPath = `${ENV_FILE}.backup.${timestampForFile()}`;
    await copyFile(ENV_FILE, backupPath);
  }
  await writeFile(ENV_FILE, content, { mode: 0o600 });
  return backupPath;
}

function validateSetupInput(input: UbuntuSetupInput): void {
  if (!['mounted_path', 'mount_existing_filesystem', 'local_default'].includes(input.mode)) {
    throw new UbuntuSetupError('mode must be mounted_path, mount_existing_filesystem, or local_default');
  }
  normaliseAbsolutePath(input.dataRoot, 'dataRoot');
  readPort(input.osirisPort, 'osirisPort');
  readIdentifier(input.dbName, 'dbName');
  readIdentifier(input.dbUser, 'dbUser');
  readRequiredText(input.dbPassword, 'dbPassword');
  if (input.archiveContainerPath) {
    normaliseAbsolutePath(input.archiveContainerPath, 'archiveContainerPath');
  }
  if (input.device) {
    normaliseDevicePath(input.device);
  }
}

function normaliseAbsolutePath(value: string, field: string): string {
  const trimmed = readRequiredText(value, field).replace(/\/+$/, '') || '/';
  if (!path.isAbsolute(trimmed)) {
    throw new UbuntuSetupError(`${field} must be an absolute path`);
  }
  if (trimmed === '/') {
    throw new UbuntuSetupError(`${field} cannot be /`);
  }
  return path.resolve(trimmed);
}

function normaliseDevicePath(value: string): string {
  const trimmed = readRequiredText(value, 'device');
  if (!trimmed.startsWith('/dev/')) {
    throw new UbuntuSetupError('device must be a /dev path');
  }
  if (trimmed.includes('..') || /[\s;&|`$<>]/.test(trimmed)) {
    throw new UbuntuSetupError('device contains unsafe characters');
  }
  return trimmed;
}

function readPort(value: string, field: string): string {
  const trimmed = readRequiredText(value, field);
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UbuntuSetupError(`${field} must be a TCP port between 1 and 65535`);
  }
  return String(port);
}

function readIdentifier(value: string, field: string): string {
  const trimmed = readRequiredText(value, field);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed)) {
    throw new UbuntuSetupError(`${field} must be a PostgreSQL-safe identifier`);
  }
  return trimmed;
}

function readRequiredText(value: string, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new UbuntuSetupError(`${field} is required`);
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new UbuntuSetupError(`${field} cannot contain newlines`);
  }
  return trimmed;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isUbuntu(): Promise<boolean> {
  try {
    const osRelease = await import('node:fs/promises').then((fs) => fs.readFile('/etc/os-release', 'utf8'));
    return /^ID=ubuntu$/m.test(osRelease) || /^ID_LIKE=.*ubuntu.*$/m.test(osRelease);
  } catch {
    return false;
  }
}

function targetUid(): string {
  return process.env.SUDO_UID || String(typeof process.getuid === 'function' ? process.getuid() : 1000);
}

function targetGid(): string {
  return process.env.SUDO_GID || String(typeof process.getgid === 'function' ? process.getgid() : 1000);
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}
