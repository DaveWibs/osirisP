import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService, type WorldStateMarketQuoteQuery } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database).listMarketQuotes(readMarketQuoteQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:markets] Failed to load market quotes:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyResponse('Failed to load World-State market quotes'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readMarketQuoteQuery(searchParams: URLSearchParams): WorldStateMarketQuoteQuery {
  return {
    symbols: readCsv(searchParams, 'symbol'),
    quoteTypes: readCsv(searchParams, 'quote_type'),
    sourceIds: readCsv(searchParams, 'source_id'),
    since: readDate(searchParams.get('since')),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(error: string) {
  return {
    quotes: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { symbols: [], quoteTypes: [], sourceIds: [], since: null },
    error,
  };
}

function readCsv(searchParams: URLSearchParams, name: string): string[] {
  return searchParams.getAll(name).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function readDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function readInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
