import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  MarketQuoteNormalisationError,
  YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID,
  normaliseMarketQuoteFeed,
} from '../src/normalisers/market-quotes.js';

let fixtureBody: Buffer;
const observedAt = new Date('2026-01-01T00:00:01.000Z');

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/yahoo-market-quotes.json', import.meta.url));
});

describe('normaliseMarketQuoteFeed', () => {
  it('normalises Yahoo Finance quote snapshots', () => {
    const result = normaliseMarketQuoteFeed(fixtureBody, observedAt);

    expect(result.sourceId).toBe(YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      sourceQuoteId: 'RTX',
      symbol: 'RTX',
      displayName: 'RTX Corporation',
      quoteType: 'EQUITY',
      currency: 'USD',
      price: 158.42,
      changePercent: 1.23,
      up: true,
      evidenceClassification: 'observed',
      metadata: {
        provider: 'Yahoo Finance',
        format: 'json',
        stableIdentifierSource: 'symbol',
      },
    });
    expect(result.records[0]?.metadata.quote_content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.records[1]).toMatchObject({ symbol: 'CL=F', up: false });
  });

  it('rejects invalid Yahoo Finance response bodies', () => {
    expect(() => normaliseMarketQuoteFeed(Buffer.from('{'), observedAt)).toThrow(
      MarketQuoteNormalisationError,
    );
    expect(() =>
      normaliseMarketQuoteFeed(Buffer.from('{"quoteResponse":{"result":[{"symbol":""}]}}'), observedAt),
    ).toThrow(MarketQuoteNormalisationError);
  });
});
