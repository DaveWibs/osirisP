import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  NewsRssCollector,
  type NewsRssArchiveWriter,
  type NewsRssCollectionStore,
  type NewsRssFetcher,
} from '../src/collectors/news-rss-sources.js';
import { BBC_WORLD_RSS_SOURCE_ID } from '../src/normalisers/news-rss.js';
import { createLogger } from '../src/logger.js';
import type { RawResponse } from '../src/framework/http-fetcher.js';
import type {
  BeginRunInput,
  CompleteNewsRssRunInput,
  FailRunInput,
  RecordPublishedArchiveInput,
  RecordResponseMetadataInput,
} from '../src/storage/postgres-store.js';
import type { ArchiveWriteInput } from '../src/storage/archive-writer.js';

let fixtureBody: Buffer;

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/bbc-world-rss.xml', import.meta.url));
});

function response(body: Buffer): RawResponse {
  return {
    endpoint: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    requestStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    responseReceivedAt: new Date('2026-01-01T00:00:01.000Z'),
    status: 200,
    contentType: 'application/rss+xml',
    headers: { 'content-type': 'application/rss+xml' },
    body,
  };
}

class FakeStore implements NewsRssCollectionStore {
  readonly begun: BeginRunInput[] = [];
  readonly completed: CompleteNewsRssRunInput[] = [];
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

  async completeNewsRssRun(input: CompleteNewsRssRunInput) {
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

describe('NewsRssCollector', () => {
  it('archives RSS bytes before normalising news articles', async () => {
    const store = new FakeStore();
    const archiveInputs: ArchiveWriteInput[] = [];
    const fetcher: NewsRssFetcher = {
      fetch: vi.fn(async () => response(fixtureBody)),
    };
    const archiveWriter: NewsRssArchiveWriter = {
      write: vi.fn(async (input: ArchiveWriteInput) => {
        archiveInputs.push(input);
        return {
          relativePath: `${input.sourceId}/fixture.xml.gz`,
          absolutePath: `/archive/${input.sourceId}/fixture.xml.gz`,
          contentHash: 'f'.repeat(64),
          compressedBytes: input.body.byteLength,
          created: true,
        };
      }),
    };
    const collector = new NewsRssCollector({
      archiveWriter,
      clock: () => new Date('2026-01-01T00:00:02.000Z'),
      endpoint: new URL('https://feeds.bbci.co.uk/news/world/rss.xml'),
      fetcher,
      logger: createLogger('silent'),
      maxAttempts: 1,
      retryBaseMs: 500,
      runIdFactory: () => '70000000-0000-4000-8000-000000000001',
      sourceId: BBC_WORLD_RSS_SOURCE_ID,
      staleRunAfterMs: 900_000,
      store,
    });

    const result = await collector.collect();

    expect(archiveInputs[0]?.body).toEqual(fixtureBody);
    expect(archiveInputs[0]?.extension).toBe('xml');
    expect(store.completed[0]?.parsed.records).toHaveLength(2);
    expect(store.completed[0]?.parserVersion).toBe('news-rss-v1');
    expect(result).toMatchObject({ recordsSeen: 2, retryCount: 0 });
  });
});
