import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateCollectionRunQuery } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyResponse(id, 'World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database)
      .listCollectionRunsForSource(id, readCollectionRunQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { id } = await context.params;
    logWorldStateError(error, {
      route: '/api/v1/sources/[id]/runs',
      operation: 'get_source_run_history',
      request,
      context: { sourceId: id },
    });
    return NextResponse.json(emptyResponse('', 'Failed to load World-State source run history'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readCollectionRunQuery(searchParams: URLSearchParams): WorldStateCollectionRunQuery {
  return {
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(sourceId: string, error: string) {
  return {
    runs: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { sourceId },
    error,
  };
}

function readInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
