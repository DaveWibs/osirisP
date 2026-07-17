import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json({
        event: null,
        generatedAt: new Date().toISOString(),
        error: 'World-State database is not configured',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    const payload = await new WorldStateService(database).getEventById(id);
    if (payload.event === null) {
      return NextResponse.json(payload, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:events] Failed to load event detail:', error instanceof Error ? error.message : error);
    return NextResponse.json({
      event: null,
      generatedAt: new Date().toISOString(),
      error: 'Failed to load World-State event',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
