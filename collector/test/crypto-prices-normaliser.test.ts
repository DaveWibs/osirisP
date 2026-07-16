import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  COINGECKO_SIMPLE_PRICE_SOURCE_ID,
  CryptoPriceNormalisationError,
  normaliseCryptoPriceFeed,
} from '../src/normalisers/crypto-prices.js';

let fixtureBody: Buffer;
const observedAt = new Date('2026-01-01T00:00:01.000Z');

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/coingecko-simple-price.json', import.meta.url));
});

describe('normaliseCryptoPriceFeed', () => {
  it('normalises CoinGecko simple USD crypto prices', () => {
    const result = normaliseCryptoPriceFeed(fixtureBody, observedAt);

    expect(result.sourceId).toBe(COINGECKO_SIMPLE_PRICE_SOURCE_ID);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:00:01.000Z');
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      sourceAssetId: 'bitcoin:usd',
      assetId: 'bitcoin',
      symbol: 'BTC',
      currency: 'usd',
      price: 65000.12,
      evidenceClassification: 'observed',
      metadata: {
        provider: 'CoinGecko',
        format: 'json',
        stableIdentifierSource: 'asset_id_currency',
      },
    });
    expect(result.records[0]?.metadata.price_content_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects invalid CoinGecko response bodies', () => {
    expect(() => normaliseCryptoPriceFeed(Buffer.from('{'), observedAt)).toThrow(
      CryptoPriceNormalisationError,
    );
    expect(() => normaliseCryptoPriceFeed(Buffer.from('{"bitcoin":{"usd":"bad"}}'), observedAt)).toThrow(
      CryptoPriceNormalisationError,
    );
  });
});
