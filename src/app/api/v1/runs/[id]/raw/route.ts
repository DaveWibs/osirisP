import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateRunRawObservationQuery } from '@/lib/worldstate/service';

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
      .listRawObservationsForRun(id, readRunRawObservationQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { id } = await context.params;
    logWorldStateError(error, {
      route: '/api/v1/runs/[id]/raw',
      operation: 'get_run_raw_observations',
      request,
      context: { collectionRunId: id },
    });
    return NextResponse.json(emptyResponse('', 'Failed to load World-State run raw observations'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readRunRawObservationQuery(searchParams: URLSearchParams): WorldStateRunRawObservationQuery {
  return {
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(collectionRunId: string, error: string) {
  return {
    rawObservations: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { collectionRunId },
    error,
  };
}

function readInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
