import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import { toSafeError } from '../framework/errors.js';
import {
  ResponseTooLargeError,
  type BoundedHttpFetcher,
  type RawResponse,
} from '../framework/http-fetcher.js';
import {
  OPENAQ_LATEST_PM25_SOURCE_ID,
  normaliseAirQualityFeed,
  type AirQualitySourceId,
} from '../normalisers/air-quality.js';
import type {
  BeginRunInput,
  CompleteAirQualityRunInput,
  CompleteAirQualityRunResult,
  FailRunInput,
  RecordPublishedArchiveInput,
  RecordResponseMetadataInput,
} from '../storage/postgres-store.js';
import type {
  ArchiveWriteInput,
  ArchiveWriteResult,
  ArchiveWriter,
} from '../storage/archive-writer.js';
import { COLLECTOR_VERSION } from './usgs-earthquakes.js';

export const AIR_QUALITY_PARSER_VERSION = 'openaq-latest-v1';
export const AIR_QUALITY_SCHEMA_VERSION = 1;

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 60_000;

export interface AirQualityCollectionStore {
  beginRun(input: BeginRunInput): Promise<void>;
  completeAirQualityRun(input: CompleteAirQualityRunInput): Promise<CompleteAirQualityRunResult>;
  failRun(input: FailRunInput): Promise<boolean>;
  recordPublishedArchive(input: RecordPublishedArchiveInput): Promise<void>;
  recordResponseMetadata(input: RecordResponseMetadataInput): Promise<void>;
  recoverStaleRuns(sourceId: string, before: Date): Promise<number>;
}

export interface AirQualityFetcher {
  fetch(
    endpoint: string | URL,
    signal?: AbortSignal,
    requestHeaders?: Record<string, string>,
  ): ReturnType<BoundedHttpFetcher['fetch']>;
}

export interface AirQualityArchiveWriter {
  write(input: ArchiveWriteInput): ReturnType<ArchiveWriter['write']>;
}

export interface AirQualityCollectorOptions {
  archiveWriter: AirQualityArchiveWriter;
  clock?: () => Date;
  endpoint: URL;
  /** OpenAQ v3 API key; sent as X-API-Key when non-empty. */
  apiKey?: string;
  fetcher: AirQualityFetcher;
  logger: Logger;
  maxAttempts: number;
  random?: () => number;
  retryBaseMs: number;
  runIdFactory?: () => string;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  sourceId: AirQualitySourceId;
  staleRunAfterMs: number;
  store: AirQualityCollectionStore;
}

export interface AirQualityCollectionResult extends CompleteAirQualityRunResult {
  archivePath: string;
  rawHash: string;
  retryCount: number;
}

export class AirQualityHttpStatusError extends Error {
  constructor(
    readonly sourceId: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`${sourceId} returned HTTP status ${status}`);
    this.name = 'AirQualityHttpStatusError';
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Collection aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  throwIfAborted(signal);
}

function validDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Collector clock returned an invalid Date');
  }
  return new Date(value.getTime());
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof ResponseTooLargeError) return false;
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    ['AbortError', 'TimeoutError', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.name)
  );
}

function retryDelayMs(attempt: number, retryBaseMs: number, random: () => number): number {
  const exponential = retryBaseMs * 2 ** (attempt - 1);
  const jitter = Math.floor(random() * retryBaseMs);
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
}

function runMetrics(
  attempt: number,
  raw?: RawResponse,
  archive?: ArchiveWriteResult,
): Record<string, unknown> {
  return {
    attempt,
    ...(raw === undefined
      ? {}
      : {
          http_status: raw.status,
          raw_bytes: raw.body.byteLength,
          response_latency_ms:
            raw.responseReceivedAt.getTime() - raw.requestStartedAt.getTime(),
        }),
    ...(archive === undefined
      ? {}
      : {
          archive_created: archive.created,
          compressed_bytes: archive.compressedBytes,
        }),
  };
}

export class AirQualityCollector {
  readonly sourceId: AirQualitySourceId;

  private readonly clock: () => Date;
  private readonly random: () => number;
  private readonly runIdFactory: () => string;
  private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: AirQualityCollectorOptions) {
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer');
    }
    if (!Number.isSafeInteger(options.retryBaseMs) || options.retryBaseMs < 1) {
      throw new Error('retryBaseMs must be a positive integer');
    }
    if (!Number.isSafeInteger(options.staleRunAfterMs) || options.staleRunAfterMs < 1) {
      throw new Error('staleRunAfterMs must be a positive integer');
    }

    this.sourceId = options.sourceId;
    this.clock = options.clock ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.runIdFactory = options.runIdFactory ?? randomUUID;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async collect(signal?: AbortSignal): Promise<AirQualityCollectionResult> {
    throwIfAborted(signal);
    const recoveryCutoff = new Date(validDate(this.clock).getTime() - this.options.staleRunAfterMs);
    await this.options.store.recoverStaleRuns(this.sourceId, recoveryCutoff);

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await this.collectAttempt(attempt, signal);
      } catch (error) {
        const failure = error instanceof AttemptError ? error.cause : error;
        const failureError =
          failure instanceof Error ? failure : new Error(`${this.sourceId} collection failed`);
        lastError = failureError;
        const retryable =
          failure instanceof AirQualityHttpStatusError
            ? failure.retryable
            : isRetryableNetworkError(failure);

        if (!retryable || attempt === this.options.maxAttempts) {
          throw failureError;
        }
        const delayMs = retryDelayMs(attempt, this.options.retryBaseMs, this.random);
        this.options.logger.warn(
          { attempt, delayMs, sourceId: this.sourceId },
          'Retrying transient air-quality collection failure',
        );
        await this.sleep(delayMs, signal);
      }
    }

    throw lastError ?? new Error(`${this.sourceId} collection exhausted without a result`);
  }

  private async collectAttempt(
    attempt: number,
    signal?: AbortSignal,
  ): Promise<AirQualityCollectionResult> {
    const runId = this.runIdFactory();
    const startedAt = validDate(this.clock);
    await this.options.store.beginRun({
      runId,
      sourceId: this.sourceId,
      startedAt,
      endpoint: this.options.endpoint.toString(),
      collectorVersion: COLLECTOR_VERSION,
    });

    let raw: RawResponse | undefined;
    let archive: ArchiveWriteResult | undefined;
    let stage = 'fetch';

    try {
      const apiKey = this.options.apiKey ?? '';
      raw = await this.options.fetcher.fetch(
        this.options.endpoint,
        signal,
        apiKey.length > 0 ? { 'x-api-key': apiKey } : undefined,
      );
      stage = 'archive';
      archive = await this.options.archiveWriter.write({
        sourceId: this.sourceId,
        timestamp: raw.responseReceivedAt,
        body: raw.body,
        extension: 'json',
      });
      stage = 'response_metadata';
      await this.options.store.recordResponseMetadata({ runId, sourceId: this.sourceId, raw });
      stage = 'archive_metadata';
      await this.options.store.recordPublishedArchive({ runId, sourceId: this.sourceId, archive });

      stage = 'http';
      if (raw.status < 200 || raw.status > 299) {
        const statusError = new AirQualityHttpStatusError(
          this.sourceId,
          raw.status,
          TRANSIENT_HTTP_STATUSES.has(raw.status),
        );
        await this.persistFailure(runId, attempt, statusError, raw, archive, 'http');
        throw new AttemptError(statusError);
      }

      stage = 'normalise_or_store';
      const parsed = normaliseAirQualityFeed(raw.body);
      const completedAt = validDate(this.clock);
      const completed = await this.options.store.completeAirQualityRun({
        runId,
        sourceId: this.sourceId,
        parsed,
        responseReceivedAt: raw.responseReceivedAt,
        completedAt,
        feedContentHash: archive.contentHash,
        archivePath: archive.relativePath,
        parserVersion: AIR_QUALITY_PARSER_VERSION,
        schemaVersion: AIR_QUALITY_SCHEMA_VERSION,
        metrics: runMetrics(attempt, raw, archive),
      });

      this.options.logger.info(
        {
          archivePath: archive.relativePath,
          recordsInserted: completed.recordsInserted,
          recordsSeen: completed.recordsSeen,
          recordsUnchanged: completed.recordsUnchanged,
          recordsUpdated: completed.recordsUpdated,
          runId,
          sourceId: this.sourceId,
        },
        'Air-quality collection completed',
      );

      return {
        ...completed,
        archivePath: archive.relativePath,
        rawHash: archive.contentHash,
        retryCount: attempt - 1,
      };
    } catch (error) {
      const failure = error instanceof AttemptError ? error.cause : error;
      await this.persistFailure(runId, attempt, failure, raw, archive, stage);
      throw error instanceof AttemptError ? error : new AttemptError(failure);
    }
  }

  private async persistFailure(
    runId: string,
    attempt: number,
    error: unknown,
    raw: RawResponse | undefined,
    archive: ArchiveWriteResult | undefined,
    stage: string,
  ): Promise<void> {
    const completedAt = validDate(this.clock);
    await this.options.store.failRun({
      runId,
      sourceId: this.sourceId,
      completedAt,
      parserVersion: AIR_QUALITY_PARSER_VERSION,
      error: toSafeError(error),
      metrics: { ...runMetrics(attempt, raw, archive), stage },
    });
  }
}

class AttemptError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Air-quality collection attempt failed');
    this.name = 'AttemptError';
  }
}

export function isAirQualitySourceId(value: string): value is AirQualitySourceId {
  return value === OPENAQ_LATEST_PM25_SOURCE_ID;
}
