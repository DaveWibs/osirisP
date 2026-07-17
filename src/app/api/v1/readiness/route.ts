import { NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService } from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database).getReadiness();
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:readiness] Failed to load readiness:', error instanceof Error ? error.message : error);
    return NextResponse.json(emptyResponse('Failed to load World-State readiness'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function emptyResponse(error: string) {
  return {
    status: 'not_ready',
    checks: [{
      id: 'database',
      label: 'Database connection',
      status: 'not_ready',
      detail: error,
    }],
    summary: {
      expectedMigrations: 21,
      migrationsApplied: 0,
      latestMigration: null,
      latestMigrationAppliedAt: null,
      sources: 0,
      activeSources: 0,
      runs: 0,
      successfulRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      rawObservations: 0,
      archivedRawObservations: 0,
      events: 0,
      latestRunId: null,
      latestRunStatus: null,
      latestRunStartedAt: null,
      latestRunCompletedAt: null,
      latestRawObservedAt: null,
    },
    generatedAt: new Date().toISOString(),
    error,
  };
}
