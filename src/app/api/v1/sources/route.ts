import { NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json({
        sources: [],
        generatedAt: new Date().toISOString(),
        error: 'World-State database is not configured',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    const payload = await new WorldStateService(database).listSources();
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:sources] Failed to load sources:', error instanceof Error ? error.message : error);
    return NextResponse.json({
      sources: [],
      generatedAt: new Date().toISOString(),
      error: 'Failed to load World-State sources',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
