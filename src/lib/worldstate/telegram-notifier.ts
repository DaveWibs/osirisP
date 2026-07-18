import { createHash } from 'node:crypto';
import {
  WorldStateService,
  type WorldStateClaimNotificationDispatchResponse,
  type WorldStateClaimNotificationsQuery,
  type WorldStateNotificationDispatchItem,
  type WorldStateRecordNotificationDeliveryInput,
} from './service';
import { getWorldStateDatabase } from './database';

type Environment = Readonly<Record<string, string | undefined>>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TelegramNotifierConfig {
  enabled: boolean;
  dryRun: boolean;
  botToken: string | null;
  claimLimit: number;
  leaseSeconds: number;
  requestTimeoutMs: number;
}

export interface TelegramDeliveryService {
  claimNotificationDeliveriesForDispatch(
    query?: WorldStateClaimNotificationsQuery,
    now?: Date,
  ): Promise<WorldStateClaimNotificationDispatchResponse>;
  recordNotificationDelivery(
    input: WorldStateRecordNotificationDeliveryInput,
    now?: Date,
  ): Promise<unknown>;
}

export interface TelegramDeliverySummary {
  status: 'disabled' | 'delivered';
  notificationsClaimed: number;
  notificationsSent: number;
  notificationsFailed: number;
  dryRun: boolean;
  generatedAt: string;
}

export interface RunTelegramNotificationDeliveryOptions {
  environment?: Environment;
  service?: TelegramDeliveryService;
  fetcher?: FetchLike;
  now?: Date;
}

interface TelegramSendOutcome {
  success: boolean;
  httpStatus: number | null;
  responseHeaders: Record<string, unknown> | null;
  responseBodyHash: string | null;
  error: Record<string, unknown> | undefined;
  metadata: Record<string, unknown>;
}

export function loadTelegramNotifierConfig(environment: Environment = process.env): TelegramNotifierConfig {
  const enabled = readBoolean(environment.WORLDSTATE_TELEGRAM_NOTIFICATIONS_ENABLED, false);
  const dryRun = readBoolean(environment.WORLDSTATE_TELEGRAM_DRY_RUN, false);
  const botToken = environment.TELEGRAM_BOT_TOKEN?.trim() || null;

  if (enabled && !dryRun && botToken === null) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when Telegram notifications are enabled outside dry-run mode');
  }

  return {
    enabled,
    dryRun,
    botToken,
    claimLimit: readInteger(environment.WORLDSTATE_TELEGRAM_CLAIM_LIMIT, 10, 1, 100),
    leaseSeconds: readInteger(environment.WORLDSTATE_TELEGRAM_LEASE_SECONDS, 300, 30, 3600),
    requestTimeoutMs: readInteger(environment.WORLDSTATE_TELEGRAM_REQUEST_TIMEOUT_MS, 10_000, 500, 60_000),
  };
}

export async function runTelegramNotificationDelivery(
  options: RunTelegramNotificationDeliveryOptions = {},
): Promise<TelegramDeliverySummary> {
  const now = options.now ?? new Date();
  const config = loadTelegramNotifierConfig(options.environment);
  if (!config.enabled) {
    return emptySummary('disabled', config, now);
  }

  const service = options.service ?? buildDefaultService(options.environment);
  const fetcher = options.fetcher ?? fetch;
  const claim = await service.claimNotificationDeliveriesForDispatch({
    adapters: ['telegram'],
    limit: config.claimLimit,
    leaseSeconds: config.leaseSeconds,
  }, now);

  let notificationsSent = 0;
  let notificationsFailed = 0;
  for (const notification of claim.notifications) {
    const outcome = config.dryRun
      ? dryRunOutcome(notification)
      : await sendTelegramNotification(notification, config, fetcher);

    await service.recordNotificationDelivery({
      notificationId: notification.id,
      success: outcome.success,
      httpStatus: outcome.httpStatus ?? undefined,
      responseHeaders: outcome.responseHeaders ?? undefined,
      responseBodyHash: outcome.responseBodyHash ?? undefined,
      error: outcome.error,
      metadata: outcome.metadata,
    }, now);

    if (outcome.success) {
      notificationsSent += 1;
    } else {
      notificationsFailed += 1;
    }
  }

  return {
    status: 'delivered',
    notificationsClaimed: claim.notificationsClaimed,
    notificationsSent,
    notificationsFailed,
    dryRun: config.dryRun,
    generatedAt: now.toISOString(),
  };
}

export function formatTelegramNotification(notification: WorldStateNotificationDispatchItem): string {
  const alert = notification.alert;
  const lines = [
    `OSIRIS ${alert.severity.toUpperCase()} alert`,
    alert.title,
    alert.detail,
    `Entity: ${alert.entityType}/${alert.entityId}`,
    `Source: ${alert.sourceName} (${alert.provider})`,
    `Detected: ${alert.detectedAt}`,
    `Evidence: ${alert.evidenceClassification}; explanation ${alert.explanationStatus}`,
  ];
  return truncate(lines.join('\n'), 4000);
}

async function sendTelegramNotification(
  notification: WorldStateNotificationDispatchItem,
  config: TelegramNotifierConfig,
  fetcher: FetchLike,
): Promise<TelegramSendOutcome> {
  if (config.botToken === null) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to send Telegram notifications');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetcher(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: notification.destinationRef,
        text: formatTelegramNotification(notification),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const responseBodyHash = sha256(body);
    return {
      success: response.ok,
      httpStatus: response.status,
      responseHeaders: selectedResponseHeaders(response.headers),
      responseBodyHash,
      error: response.ok ? undefined : telegramError(response.status, body),
      metadata: { adapter: 'telegram', dryRun: false },
    };
  } catch (error) {
    return {
      success: false,
      httpStatus: null,
      responseHeaders: null,
      responseBodyHash: null,
      error: { message: error instanceof Error ? error.message : 'Telegram notification request failed' },
      metadata: { adapter: 'telegram', dryRun: false },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildDefaultService(environment: Environment | undefined): TelegramDeliveryService {
  const database = environment === undefined
    ? getWorldStateDatabase()
    : getWorldStateDatabase(environment);
  if (database === null) {
    throw new Error('World-State database is not configured');
  }
  return new WorldStateService(database);
}

function dryRunOutcome(notification: WorldStateNotificationDispatchItem): TelegramSendOutcome {
  return {
    success: true,
    httpStatus: null,
    responseHeaders: null,
    responseBodyHash: sha256(formatTelegramNotification(notification)),
    error: undefined,
    metadata: { adapter: 'telegram', dryRun: true },
  };
}

function emptySummary(
  status: TelegramDeliverySummary['status'],
  config: TelegramNotifierConfig,
  now: Date,
): TelegramDeliverySummary {
  return {
    status,
    notificationsClaimed: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    dryRun: config.dryRun,
    generatedAt: now.toISOString(),
  };
}

function selectedResponseHeaders(headers: Headers): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const name of ['content-type', 'retry-after']) {
    const value = headers.get(name);
    if (value !== null) selected[name] = value;
  }
  return selected;
}

function telegramError(httpStatus: number, body: string): Record<string, unknown> {
  const parsed = parseTelegramErrorDescription(body);
  return {
    httpStatus,
    message: parsed ?? 'Telegram Bot API returned a non-success response',
    bodyHash: sha256(body),
  };
}

function parseTelegramErrorDescription(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'description' in parsed) {
      const description = (parsed as { description?: unknown }).description;
      return typeof description === 'string' && description.trim() ? truncate(description.trim(), 500) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true';
}

function readInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Telegram notifier setting must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
