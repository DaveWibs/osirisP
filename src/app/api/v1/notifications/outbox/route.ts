import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import {
  WorldStateService,
  type WorldStateEnqueueNotificationsQuery,
  type WorldStateNotificationOutboxQuery,
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

    const payload = await new WorldStateService(database)
      .listNotificationOutbox(readOutboxQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:notifications:outbox] Failed to load notification outbox:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyListResponse('Failed to load World-State notification outbox'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyEnqueueResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database)
      .enqueueAlertNotifications(readEnqueueQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:notifications:outbox] Failed to enqueue notifications:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyEnqueueResponse('Failed to enqueue World-State notifications'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readOutboxQuery(searchParams: URLSearchParams): WorldStateNotificationOutboxQuery {
  return {
    statuses: readCsv(searchParams, 'status'),
    adapters: readCsv(searchParams, 'adapter'),
    topics: readCsv(searchParams, 'topic'),
    severities: readCsv(searchParams, 'severity'),
    since: readDate(searchParams.get('since')),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function readEnqueueQuery(searchParams: URLSearchParams): WorldStateEnqueueNotificationsQuery {
  return {
    since: readDate(searchParams.get('since')),
    adapters: readCsv(searchParams, 'adapter'),
    kinds: readCsv(searchParams, 'kind'),
    severities: readCsv(searchParams, 'severity'),
  };
}

function emptyListResponse(error: string) {
  return {
    notifications: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { statuses: [], adapters: [], topics: [], severities: [], since: null },
    error,
  };
}

function emptyEnqueueResponse(error: string) {
  return {
    notificationsCreated: 0,
    notifications: [],
    generatedAt: new Date().toISOString(),
    filters: { since: null, adapters: [], kinds: [], severities: [] },
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
