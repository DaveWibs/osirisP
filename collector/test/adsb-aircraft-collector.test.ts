import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AdsbAircraftCollector,
  type AdsbAircraftArchiveWriter,
  type AdsbAircraftCollectionStore,
  type AdsbAircraftFetcher,
} from '../src/collectors/adsb-aircraft-sources.js';
import {
  ADSB_LOL_MILITARY_SOURCE_ID,
  AIRPLANES_LIVE_MILITARY_SOURCE_ID,
} from '../src/normalisers/adsb-aircraft.js';
import { createLogger } from '../src/logger.js';
import type { RawResponse } from '../src/framework/http-fetcher.js';
import type {
  BeginRunInput,
  CompleteAdsbAircraftRunInput,
  FailRunInput,
  RecordPublishedArchiveInput,
  RecordResponseMetadataInput,
} from '../src/storage/postgres-store.js';
import type { ArchiveWriteInput } from '../src/storage/archive-writer.js';

let fixtureBody: Buffer;
let adsbLolFixtureBody: Buffer;

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/airplanes-live-military.json', import.meta.url));
  adsbLolFixtureBody = await readFile(new URL('./fixtures/adsb-lol-military.json', import.meta.url));
});

function response(body: Buffer, endpoint = 'https://api.airplanes.live/v2/mil'): RawResponse {
  return {
    endpoint,
    requestStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    responseReceivedAt: new Date('2026-01-01T00:00:01.000Z'),
    status: 200,
    contentType: 'application/json',
    headers: { 'content-type': 'application/json' },
    body,
  };
}

class FakeStore implements AdsbAircraftCollectionStore {
  readonly begun: BeginRunInput[] = [];
  readonly completed: CompleteAdsbAircraftRunInput[] = [];
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

  async completeAdsbAircraftRun(input: CompleteAdsbAircraftRunInput) {
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

describe('AdsbAircraftCollector', () => {
  it('archives airplanes.live bytes before normalising aircraft positions', async () => {
    const store = new FakeStore();
    const archiveInputs: ArchiveWriteInput[] = [];
    const fetcher: AdsbAircraftFetcher = {
      fetch: vi.fn(async () => response(fixtureBody)),
    };
    const archiveWriter: AdsbAircraftArchiveWriter = {
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
    const collector = new AdsbAircraftCollector({
      archiveWriter,
      clock: () => new Date('2026-01-01T00:00:02.000Z'),
      endpoint: new URL('https://api.airplanes.live/v2/mil'),
      fetcher,
      logger: createLogger('silent'),
      maxAttempts: 1,
      retryBaseMs: 500,
      runIdFactory: () => 'a0000000-0000-4000-8000-000000000001',
      sourceId: AIRPLANES_LIVE_MILITARY_SOURCE_ID,
      staleRunAfterMs: 900_000,
      store,
    });

    const result = await collector.collect();

    expect(archiveInputs[0]?.body).toEqual(fixtureBody);
    expect(archiveInputs[0]?.extension).toBe('json');
    expect(store.completed[0]?.parsed.records).toHaveLength(2);
    expect(store.completed[0]?.parserVersion).toBe('adsb-aircraft-v1');
    expect(result).toMatchObject({ recordsSeen: 2, retryCount: 0 });
  });

  it('archives adsb.lol bytes before normalising aircraft positions', async () => {
    const store = new FakeStore();
    const archiveInputs: ArchiveWriteInput[] = [];
    const fetcher: AdsbAircraftFetcher = {
      fetch: vi.fn(async () => response(adsbLolFixtureBody, 'https://api.adsb.lol/v2/mil')),
    };
    const archiveWriter: AdsbAircraftArchiveWriter = {
      write: vi.fn(async (input: ArchiveWriteInput) => {
        archiveInputs.push(input);
        return {
          relativePath: `${input.sourceId}/fixture.json.gz`,
          absolutePath: `/archive/${input.sourceId}/fixture.json.gz`,
          contentHash: 'e'.repeat(64),
          compressedBytes: input.body.byteLength,
          created: true,
        };
      }),
    };
    const collector = new AdsbAircraftCollector({
      archiveWriter,
      clock: () => new Date('2026-01-01T00:00:02.000Z'),
      endpoint: new URL('https://api.adsb.lol/v2/mil'),
      fetcher,
      logger: createLogger('silent'),
      maxAttempts: 1,
      retryBaseMs: 500,
      runIdFactory: () => 'a0000000-0000-4000-8000-000000000002',
      sourceId: ADSB_LOL_MILITARY_SOURCE_ID,
      staleRunAfterMs: 900_000,
      store,
    });

    const result = await collector.collect();

    expect(archiveInputs[0]?.body).toEqual(adsbLolFixtureBody);
    expect(archiveInputs[0]?.extension).toBe('json');
    expect(archiveInputs[0]?.sourceId).toBe(ADSB_LOL_MILITARY_SOURCE_ID);
    expect(store.completed[0]?.parsed.sourceId).toBe(ADSB_LOL_MILITARY_SOURCE_ID);
    expect(store.completed[0]?.parsed.records).toHaveLength(2);
    expect(store.completed[0]?.parsed.records[0]?.metadata.provider).toBe('adsb.lol');
    expect(store.completed[0]?.parserVersion).toBe('adsb-aircraft-v1');
    expect(result).toMatchObject({ recordsSeen: 2, retryCount: 0 });
  });
});
