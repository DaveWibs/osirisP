import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import { CRYPTO_SOURCE_ID, buildCryptoResponse, loadCryptoDatabaseResult } from './persisted';

describe('loadCryptoDatabaseResult', () => {
  it('loads the latest persisted USD price per symbol', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:58:00Z',
        upstream_timestamp: null,
        symbol: 'ETH',
        price: 3200.5,
      },
      {
        response_received_at: '2026-07-18T11:58:00Z',
        upstream_timestamp: null,
        symbol: 'BTC',
        price: 98000.25,
      },
    ]);

    const result = await loadCryptoDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([CRYPTO_SOURCE_ID, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('crypto_price_observations');
    expect(result?.rows).toEqual([
      { symbol: 'ETH', price: 3200.5 },
      { symbol: 'BTC', price: 98000.25 },
    ]);
  });

  it('returns null when unconfigured and rejects invalid prices', async () => {
    expect(await loadCryptoDatabaseResult(900_000, null)).toBeNull();

    const executor = new FakePersistedExecutor([{
      response_received_at: '2026-07-18T11:58:00Z',
      upstream_timestamp: null,
      symbol: 'BTC',
      price: null,
    }]);
    await expect(loadCryptoDatabaseResult(900_000, executor)).rejects.toThrow('price for BTC');
  });
});

describe('buildCryptoResponse', () => {
  it('orders symbols to match the live route BTC/ETH/SOL ordering', () => {
    expect(buildCryptoResponse([
      { symbol: 'SOL', price: 150 },
      { symbol: 'BTC', price: 98000 },
      { symbol: 'ETH', price: 3200 },
    ])).toEqual([
      { symbol: 'BTC', price: 98000 },
      { symbol: 'ETH', price: 3200 },
      { symbol: 'SOL', price: 150 },
    ]);
  });
});
