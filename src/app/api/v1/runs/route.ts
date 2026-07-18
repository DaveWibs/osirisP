import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateCollectionRunsQuery } from '@/lib/worldstate/service';

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

    const payload = await new WorldStateService(database).listCollectionRuns(readCollectionRunsQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logWorldStateError(error, { route: '/api/v1/runs', operation: 'get_collection_runs', request });
    return NextResponse.json(emptyResponse('Failed to load World-State collection runs'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readCollectionRunsQuery(searchParams: URLSearchParams): WorldStateCollectionRunsQuery {
  return {
    sourceIds: readCsv(searchParams, 'source_id'),
    statuses: readCsv(searchParams, 'status'),
    since: readDate(searchParams.get('since')),
    until: readDate(searchParams.get('until')),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(error: string) {
  return {
    runs: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { sourceIds: [], statuses: [], since: null, until: null },
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
