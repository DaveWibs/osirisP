import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  InternetOutageCollector,
  iodaOutageEndpoint,
  type InternetOutageArchiveWriter,
  type InternetOutageCollectionStore,
  type InternetOutageFetcher,
} from '../src/collectors/internet-outage-sources.js';
import { GATECH_IODA_OUTAGES_SOURCE_ID } from '../src/normalisers/internet-outages.js';
import { createLogger } from '../src/logger.js';
import type { RawResponse } from '../src/framework/http-fetcher.js';
import type {
  BeginRunInput,
  CompleteInternetOutageRunInput,
  FailRunInput,
  RecordPublishedArchiveInput,
  RecordResponseMetadataInput,
} from '../src/storage/postgres-store.js';
import type { ArchiveWriteInput } from '../src/storage/archive-writer.js';

let fixtureBody: Buffer;

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/gatech-ioda-outages.json', import.meta.url));
});

function response(body: Buffer): RawResponse {
  return {
    endpoint: 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&limit=200&from=1767139200&until=1767225600',
    requestStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    responseReceivedAt: new Date('2026-01-01T00:00:01.000Z'),
    status: 200,
    contentType: 'application/json',
    headers: { 'content-type': 'application/json' },
    body,
  };
}

class FakeStore implements InternetOutageCollectionStore {
  readonly begun: BeginRunInput[] = [];
  readonly completed: CompleteInternetOutageRunInput[] = [];
  readonly failed: FailRunInput[] = [];
  readonly published: RecordPublishedArchiveInput[] = [];
  readonly responses: RecordResponseMetadataInput[] = [];

  async recoverStaleRuns(): Promise<number> {
    return 0;
  }

  async beginRun(input: BeginRunInput): Promise<void> {
    this.begun.push(input);
  }

  async recordResponseMetadata(input: RecordResponseMetadataInput): Promise<void> {
    this.responses.push(input);
  }

  async recordPublishedArchive(input: RecordPublishedArchiveInput): Promise<void> {
    this.published.push(input);
  }

  async completeInternetOutageRun(input: CompleteInternetOutageRunInput) {
    this.completed.push(input);
    return {
      runId: input.runId,
      sourceId: input.sourceId,
      recordsSeen: input.parsed.records.length,
      recordsInserted: input.parsed.records.length,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    };
  }

  async failRun(input: FailRunInput): Promise<boolean> {
    this.failed.push(input);
    return true;
  }
}

describe('InternetOutageCollector', () => {
  it('adds the rolling 24-hour IODA query window to the configured endpoint', () => {
    const endpoint = iodaOutageEndpoint(
      new URL('https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&limit=200'),
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(endpoint.searchParams.get('from')).toBe('1767139200');
    expect(endpoint.searchParams.get('until')).toBe('1767225600');
    expect(endpoint.searchParams.get('entityType')).toBe('country');
    expect(endpoint.searchParams.get('limit')).toBe('200');
  });

  it('archives IODA bytes before normalising outage events', async () => {
    const store = new FakeStore();
    const archiveInputs: ArchiveWriteInput[] = [];
    const requestedEndpoints: string[] = [];
    const fetcher: InternetOutageFetcher = {
      fetch: vi.fn(async (endpoint: string | URL) => {
        requestedEndpoints.push(endpoint.toString());
        return response(fixtureBody);
      }),
    };
    const archiveWriter: InternetOutageArchiveWriter = {
      write: vi.fn(async (input: ArchiveWriteInput) => {
        archiveInputs.push(input);
        return {
          relativePath: `${input.sourceId}/fixture.json.gz`,
          absolutePath: `/archive/${input.sourceId}/fixture.json.gz`,
          contentHash: 'f'.repeat(64),
          compressedBytes: input.body.byteLength,
          created: true,
        };
      }),
    };
    const collector = new InternetOutageCollector({
      archiveWriter,
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
      endpoint: new URL('https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&limit=200'),
      fetcher,
      logger: createLogger('silent'),
      maxAttempts: 1,
      retryBaseMs: 500,
      runIdFactory: () => '80000000-0000-4000-8000-000000000001',
      sourceId: GATECH_IODA_OUTAGES_SOURCE_ID,
      staleRunAfterMs: 900_000,
      store,
    });

    const result = await collector.collect();

    expect(requestedEndpoints[0]).toContain('from=1767139200');
    expect(archiveInputs[0]?.body).toEqual(fixtureBody);
    expect(archiveInputs[0]?.extension).toBe('json');
    expect(store.completed[0]?.parsed.records).toHaveLength(2);
    expect(store.completed[0]?.parserVersion).toBe('ioda-outages-v1');
    expect(result).toMatchObject({ recordsSeen: 2, retryCount: 0 });
  });
});
