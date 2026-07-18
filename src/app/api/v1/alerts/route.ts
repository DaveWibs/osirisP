import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import {
  WorldStateService,
  type WorldStateAlertsQuery,
  type WorldStateRefreshAlertsQuery,
} from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyListResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database).listAlerts(readAlertsQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:alerts] Failed to load intelligence alerts:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyListResponse('Failed to load World-State intelligence alerts'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyRefreshResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database).refreshMarketAnomalyAlerts(readRefreshQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:alerts] Failed to refresh intelligence alerts:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyRefreshResponse('Failed to refresh World-State intelligence alerts'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readAlertsQuery(searchParams: URLSearchParams): WorldStateAlertsQuery {
  return {
    since: readDate(searchParams.get('since')),
    statuses: readCsv(searchParams, 'status'),
    severities: readCsv(searchParams, 'severity'),
    kinds: readCsv(searchParams, 'kind'),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function readRefreshQuery(searchParams: URLSearchParams): WorldStateRefreshAlertsQuery {
  return {
    since: readDate(searchParams.get('since')),
    minSamples: readInteger(searchParams.get('min_samples')),
    thresholdPercent: readNumber(searchParams.get('threshold_percent')),
  };
}

function emptyListResponse(error: string) {
  return {
    alerts: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { since: null, statuses: [], severities: [], kinds: [] },
    error,
  };
}

function emptyRefreshResponse(error: string) {
  return {
    alertsCreatedOrUpdated: 0,
    alertsResolved: 0,
    alerts: [],
    resolvedAlerts: [],
    generatedAt: new Date().toISOString(),
    calculationVersion: 'market-price-movement-v1',
    filters: { since: new Date().toISOString(), minSamples: 12, thresholdPercent: 5 },
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

function readNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
