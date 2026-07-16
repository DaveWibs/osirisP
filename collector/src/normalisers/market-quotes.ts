import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID = 'yahoo-finance-market-quotes' as const;

export type MarketQuoteSourceId = typeof YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID;

const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');

const yahooQuoteSchema = z
  .object({
    symbol: z.string().min(1),
    shortName: z.string().optional(),
    longName: z.string().optional(),
    quoteType: z.string().optional(),
    regularMarketPrice: finiteNumberSchema.optional(),
    regularMarketChangePercent: finiteNumberSchema.optional(),
    regularMarketTime: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough();

const yahooResponseSchema = z
  .object({
    quoteResponse: z.object({
      result: z.array(yahooQuoteSchema).default([]),
    }),
  })
  .passthrough();

type YahooQuote = z.infer<typeof yahooQuoteSchema>;

export interface NormalisedMarketQuoteRecord {
  sourceId: MarketQuoteSourceId;
  sourceQuoteId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  symbol: string;
  displayName: string;
  quoteType: string;
  currency: string | null;
  price: number;
  changePercent: number;
  up: boolean;
  contentHash: string;
  evidenceClassification: 'observed';
  rawPayload: unknown;
  metadata: {
    provider: 'Yahoo Finance';
    format: 'json';
    quote_content_hash: string;
    stableIdentifierSource: 'symbol';
    [key: string]: unknown;
  };
}

export interface NormalisedMarketQuoteFeed {
  sourceId: MarketQuoteSourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedMarketQuoteRecord[];
}

export class MarketQuoteNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketQuoteNormalisationError';
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function parseMarketTime(value: number | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const parsed = new Date(value * 1000);
  if (!Number.isFinite(parsed.getTime())) {
    throw new MarketQuoteNormalisationError('Yahoo quote has invalid regularMarketTime');
  }
  return parsed;
}

function normaliseQuote(quote: YahooQuote, observedAt: Date): NormalisedMarketQuoteRecord | null {
  if (quote.regularMarketPrice === undefined) return null;
  const sourceUpdatedAt = parseMarketTime(quote.regularMarketTime, observedAt);
  const changePercent = quote.regularMarketChangePercent ?? 0;
  const contentHash = hashJson(quote);

  return {
    sourceId: YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID,
    sourceQuoteId: quote.symbol,
    observedAt,
    sourceUpdatedAt,
    symbol: quote.symbol,
    displayName: quote.shortName ?? quote.longName ?? quote.symbol,
    quoteType: quote.quoteType ?? 'UNKNOWN',
    currency: quote.currency ?? null,
    price: Math.round(quote.regularMarketPrice * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    up: changePercent >= 0,
    contentHash,
    evidenceClassification: 'observed',
    rawPayload: quote,
    metadata: {
      provider: 'Yahoo Finance',
      format: 'json',
      quote_content_hash: contentHash,
      stableIdentifierSource: 'symbol',
    },
  };
}

function latestTimestamp(records: NormalisedMarketQuoteRecord[]): Date | null {
  return records.reduce<Date | null>((current, record) => {
    if (current === null || record.sourceUpdatedAt.getTime() > current.getTime()) {
      return record.sourceUpdatedAt;
    }
    return current;
  }, null);
}

export function normaliseMarketQuoteFeed(body: Buffer, observedAt: Date): NormalisedMarketQuoteFeed {
  if (!Buffer.isBuffer(body)) {
    throw new MarketQuoteNormalisationError('Yahoo Finance response body must be a Buffer');
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new MarketQuoteNormalisationError('observedAt must be a valid Date');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new MarketQuoteNormalisationError('Invalid Yahoo Finance JSON response body');
  }

  const parsed = yahooResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new MarketQuoteNormalisationError('Invalid Yahoo Finance quote response body');
  }

  const records = parsed.data.quoteResponse.result.flatMap((quote) => {
    const record = normaliseQuote(quote, observedAt);
    return record === null ? [] : [record];
  });

  return {
    sourceId: YAHOO_FINANCE_MARKET_QUOTES_SOURCE_ID,
    upstreamTimestamp: latestTimestamp(records),
    records,
  };
}
