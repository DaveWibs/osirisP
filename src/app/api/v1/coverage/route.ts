import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateCoverageQuery } from '@/lib/worldstate/service';

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

    const payload = await new WorldStateService(database).getCoverage(readCoverageQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logWorldStateError(error, { route: '/api/v1/coverage', operation: 'get_coverage', request });
    return NextResponse.json(emptyResponse('Failed to load World-State coverage'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readCoverageQuery(searchParams: URLSearchParams): WorldStateCoverageQuery {
  return {
    since: readDate(searchParams.get('since')),
    until: readDate(searchParams.get('until')),
  };
}

function emptyResponse(error: string) {
  return {
    categories: [],
    sources: [],
    timeline: [],
    generatedAt: new Date().toISOString(),
    filters: { since: null, until: null },
    error,
  };
}

function readDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
