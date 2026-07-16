import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const COINGECKO_SIMPLE_PRICE_SOURCE_ID = 'coingecko-simple-price' as const;

export type CryptoPriceSourceId = typeof COINGECKO_SIMPLE_PRICE_SOURCE_ID;

const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');

const simplePriceSchema = z
  .object({
    bitcoin: z.object({ usd: finiteNumberSchema }).passthrough().optional(),
    ethereum: z.object({ usd: finiteNumberSchema }).passthrough().optional(),
    solana: z.object({ usd: finiteNumberSchema }).passthrough().optional(),
  })
  .passthrough();

const ASSET_SYMBOLS = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
} as const;

type AssetId = keyof typeof ASSET_SYMBOLS;

export interface NormalisedCryptoPriceRecord {
  sourceId: CryptoPriceSourceId;
  sourceAssetId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  assetId: AssetId;
  symbol: (typeof ASSET_SYMBOLS)[AssetId];
  currency: 'usd';
  price: number;
  contentHash: string;
  evidenceClassification: 'observed';
  rawPayload: unknown;
  metadata: {
    provider: 'CoinGecko';
    format: 'json';
    price_content_hash: string;
    stableIdentifierSource: string;
    [key: string]: unknown;
  };
}

export interface NormalisedCryptoPriceFeed {
  sourceId: CryptoPriceSourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedCryptoPriceRecord[];
}

export class CryptoPriceNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoPriceNormalisationError';
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function normaliseCryptoPriceFeed(
  body: Buffer,
  observedAt: Date,
): NormalisedCryptoPriceFeed {
  if (!Buffer.isBuffer(body)) {
    throw new CryptoPriceNormalisationError('CoinGecko response body must be a Buffer');
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new CryptoPriceNormalisationError('observedAt must be a valid Date');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new CryptoPriceNormalisationError('Invalid CoinGecko JSON response body');
  }

  const parsed = simplePriceSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new CryptoPriceNormalisationError('Invalid CoinGecko simple price response body');
  }

  const records = (Object.keys(ASSET_SYMBOLS) as AssetId[]).flatMap((assetId) => {
    const row = parsed.data[assetId];
    if (row === undefined) return [];

    const rawPayload = { [assetId]: row };
    const contentHash = hashJson(rawPayload);

    return [{
      sourceId: COINGECKO_SIMPLE_PRICE_SOURCE_ID,
      sourceAssetId: `${assetId}:usd`,
      observedAt,
      sourceUpdatedAt: observedAt,
      assetId,
      symbol: ASSET_SYMBOLS[assetId],
      currency: 'usd',
      price: row.usd,
      contentHash,
      evidenceClassification: 'observed',
      rawPayload,
      metadata: {
        provider: 'CoinGecko',
        format: 'json',
        price_content_hash: contentHash,
        stableIdentifierSource: 'asset_id_currency',
      },
    } satisfies NormalisedCryptoPriceRecord];
  });

  return {
    sourceId: COINGECKO_SIMPLE_PRICE_SOURCE_ID,
    upstreamTimestamp: observedAt,
    records,
  };
}
