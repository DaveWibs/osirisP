import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateOperationsSummaryQuery } from '@/lib/worldstate/service';

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

    const payload = await new WorldStateService(database).getOperationsSummary(readSummaryQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logWorldStateError(error, { route: '/api/v1/operations/summary', operation: 'get_operations_summary', request });
    return NextResponse.json(emptyResponse('Failed to load World-State operations summary'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readSummaryQuery(searchParams: URLSearchParams): WorldStateOperationsSummaryQuery {
  return {
    since: readDate(searchParams.get('since')),
  };
}

function emptyResponse(error: string) {
  const generatedAt = new Date().toISOString();
  const totals = {
    sources: 0,
    activeSources: 0,
    runs: 0,
    successfulRuns: 0,
    failedRuns: 0,
    rawObservations: 0,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
  };
  return {
    totals,
    recent: { ...totals, since: generatedAt },
    statusBreakdown: [],
    sourceHealth: [],
    generatedAt,
    error,
  };
}

function readDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
