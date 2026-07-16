import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MarketQuoteCollector,
  type MarketQuoteArchiveWriter,
  type MarketQuoteCollectionStore,
  type MarketQuoteFetcher,
} from '../src/collectors/market-quote-sources.js';
import { YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID } from '../src/normalisers/market-quotes.js';
import { createLogger } from '../src/logger.js';
import type { RawResponse } from '../src/framework/http-fetcher.js';
import type {
  BeginRunInput,
  CompleteMarketQuoteRunInput,
  FailRunInput,
  RecordPublishedArchiveInput,
  RecordResponseMetadataInput,
} from '../src/storage/postgres-store.js';
import type { ArchiveWriteInput } from '../src/storage/archive-writer.js';

let fixtureBody: Buffer;

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/yahoo-market-quotes.json', import.meta.url));
});

function response(body: Buffer): RawResponse {
  return {
    endpoint: 'https://query2.finance.yahoo.com/v6/finance/quote?symbols=RTX,CL%3DF',
    requestStartedAt: new Date('2026-01-01T00:00:00.000Z'),
    responseReceivedAt: new Date('2026-01-01T00:00:01.000Z'),
    status: 200,
    contentType: 'application/json',
    headers: { 'content-type': 'application/json' },
    body,
  };
}

class FakeStore implements MarketQuoteCollectionStore {
  readonly begun: BeginRunInput[] = [];
  readonly completed: CompleteMarketQuoteRunInput[] = [];
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

  async completeMarketQuoteRun(input: CompleteMarketQuoteRunInput) {
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

describe('MarketQuoteCollector', () => {
  it('archives Yahoo Finance bytes before normalising quotes', async () => {
    const store = new FakeStore();
    const archiveInputs: ArchiveWriteInput[] = [];
    const fetcher: MarketQuoteFetcher = {
      fetch: vi.fn(async () => response(fixtureBody)),
    };
    const archiveWriter: MarketQuoteArchiveWriter = {
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
    const collector = new MarketQuoteCollector({
      archiveWriter,
      clock: () => new Date('2026-01-01T00:00:02.000Z'),
      endpoint: new URL('https://query2.finance.yahoo.com/v6/finance/quote?symbols=RTX,CL%3DF'),
      fetcher,
      logger: createLogger('silent'),
      maxAttempts: 1,
      retryBaseMs: 500,
      runIdFactory: () => '90000000-0000-4000-8000-000000000001',
      sourceId: YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID,
      staleRunAfterMs: 900_000,
      store,
    });

    const result = await collector.collect();

    expect(archiveInputs[0]?.body).toEqual(fixtureBody);
    expect(archiveInputs[0]?.extension).toBe('json');
    expect(store.completed[0]?.parsed.records).toHaveLength(2);
    expect(store.completed[0]?.parserVersion).toBe('yahoo-market-quotes-v1');
    expect(result).toMatchObject({ recordsSeen: 2, retryCount: 0 });
  });
});
