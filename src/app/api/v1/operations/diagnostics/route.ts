import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService, type WorldStateCollectorDiagnosticsQuery } from '@/lib/worldstate/service';

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

    const payload = await new WorldStateService(database).getCollectorDiagnostics(readDiagnosticsQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:operations] Failed to load collector diagnostics:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyResponse('Failed to load World-State collector diagnostics'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readDiagnosticsQuery(searchParams: URLSearchParams): WorldStateCollectorDiagnosticsQuery {
  return {
    since: readDate(searchParams.get('since')),
    limit: readLimit(searchParams.get('limit')),
  };
}

function emptyResponse(error: string) {
  return {
    failingSources: [],
    recentFailures: [],
    generatedAt: new Date().toISOString(),
    filters: { since: new Date().toISOString(), limit: 20 },
    error,
  };
}

function readDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function readLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
