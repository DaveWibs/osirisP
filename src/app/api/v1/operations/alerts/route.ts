import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService, type WorldStateOperationsAlertsQuery } from '@/lib/worldstate/service';

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

    const payload = await new WorldStateService(database).getOperationsAlerts(readAlertsQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:operations] Failed to load operations alerts:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyResponse('Failed to load World-State operations alerts'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readAlertsQuery(searchParams: URLSearchParams): WorldStateOperationsAlertsQuery {
  return {
    since: readDate(searchParams.get('since')),
  };
}

function emptyResponse(error: string) {
  return {
    alerts: [],
    generatedAt: new Date().toISOString(),
    filters: { since: new Date().toISOString() },
    error,
  };
}

function readDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
