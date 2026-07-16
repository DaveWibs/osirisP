import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService, type WorldStateEventQuery } from '@/lib/worldstate/service';
import type { WorldStateEventCategory } from '@/lib/worldstate/contract';

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

    const payload = await new WorldStateService(database).listEvents(readEventQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:events] Failed to load events:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyResponse('Failed to load World-State events'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readEventQuery(searchParams: URLSearchParams): WorldStateEventQuery {
  return {
    categories: readCsv(searchParams, 'category') as WorldStateEventCategory[],
    sourceIds: readCsv(searchParams, 'source_id'),
    since: readDate(searchParams.get('since')),
    until: readDate(searchParams.get('until')),
    bbox: readBbox(searchParams.get('bbox')),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(error: string) {
  return {
    events: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { categories: [], sourceIds: [], since: null, until: null, bbox: null },
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

function readBbox(value: string | null): [number, number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
    return undefined;
  }
  return [west, south, east, north];
}
