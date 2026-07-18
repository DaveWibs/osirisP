import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json({
        source: null,
        recentEvents: [],
        recentQuotes: [],
        generatedAt: new Date().toISOString(),
        error: 'World-State database is not configured',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    const payload = await new WorldStateService(database).getSourceById(id);
    if (payload.source === null) {
      return NextResponse.json(payload, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { id } = await context.params;
    logWorldStateError(error, {
      route: '/api/v1/sources/[id]',
      operation: 'get_source_detail',
      request,
      context: { sourceId: id },
    });
    return NextResponse.json({
      source: null,
      recentEvents: [],
      recentQuotes: [],
      generatedAt: new Date().toISOString(),
      error: 'Failed to load World-State source',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
