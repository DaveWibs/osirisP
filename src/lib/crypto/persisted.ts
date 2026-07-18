import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const CRYPTO_SOURCE_ID = 'coingecko-simple-price';

export interface CryptoPrice {
  symbol: string;
  price: number;
}

export type CryptoResponse = CryptoPrice[];

const SYMBOL_ORDER = ['BTC', 'ETH', 'SOL'];

const DATABASE_QUERY = `
WITH latest_success AS (
  SELECT
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = $1
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY response_received_at DESC, id DESC
  LIMIT 1
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  price.symbol,
  price.price
FROM latest_success
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (symbol) symbol, price
  FROM crypto_price_observations
  WHERE source_id = $1
    AND currency = 'usd'
    AND observed_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY symbol, observed_at DESC
) AS price ON TRUE`;

interface CryptoRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  symbol: string | null;
  price: number | null;
}

export function buildCryptoResponse(prices: CryptoPrice[]): CryptoResponse {
  return [...prices].sort((a, b) => {
    const aIndex = SYMBOL_ORDER.indexOf(a.symbol);
    const bIndex = SYMBOL_ORDER.indexOf(b.symbol);
    return (aIndex === -1 ? SYMBOL_ORDER.length : aIndex) - (bIndex === -1 ? SYMBOL_ORDER.length : bIndex);
  });
}

export async function loadCryptoDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('crypto', 'osiris-crypto-api'),
): Promise<PersistedDatabaseResult<CryptoPrice[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<CryptoRow>(DATABASE_QUERY, [
    CRYPTO_SOURCE_ID,
    `${windowMs} milliseconds`,
  ]);
  return {
    rows: result.rows.flatMap((row) => (
      row.symbol === null
        ? []
        : [{ symbol: row.symbol, price: requirePersistedNumber(row.price, `price for ${row.symbol}`) }]
    )),
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}
