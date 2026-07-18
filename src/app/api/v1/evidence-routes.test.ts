import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { query: vi.fn() },
  getWorldStateDatabase: vi.fn(),
  getRawObservationById: vi.fn(),
  getCollectionRunById: vi.fn(),
  listCollectionRuns: vi.fn(),
  listRawObservationsForRun: vi.fn(),
  listCollectionRunsForSource: vi.fn(),
  getOperationsSummary: vi.fn(),
  getOperationsAlerts: vi.fn(),
  getCoverage: vi.fn(),
  getReadiness: vi.fn(),
  getCollectorDiagnostics: vi.fn(),
}));

vi.mock('@/lib/worldstate/database', () => ({
  getWorldStateDatabase: mocks.getWorldStateDatabase,
}));

vi.mock('@/lib/worldstate/service', () => ({
  WorldStateService: vi.fn().mockImplementation(() => ({
    getRawObservationById: mocks.getRawObservationById,
    getCollectionRunById: mocks.getCollectionRunById,
    listCollectionRuns: mocks.listCollectionRuns,
    listRawObservationsForRun: mocks.listRawObservationsForRun,
    listCollectionRunsForSource: mocks.listCollectionRunsForSource,
    getOperationsSummary: mocks.getOperationsSummary,
    getOperationsAlerts: mocks.getOperationsAlerts,
    getCoverage: mocks.getCoverage,
    getReadiness: mocks.getReadiness,
    getCollectorDiagnostics: mocks.getCollectorDiagnostics,
  })),
}));

import { GET as getCoverage } from './coverage/route';
import { GET as getOperationsAlerts } from './operations/alerts/route';
import { GET as getCollectorDiagnostics } from './operations/diagnostics/route';
import { GET as getOperationsSummary } from './operations/summary/route';
import { GET as getReadiness } from './readiness/route';
import { GET as getRuns } from './runs/route';
import { GET as getRawObservation } from './raw/[id]/route';
import { GET as getCollectionRun } from './runs/[id]/route';
import { GET as getRunRawObservations } from './runs/[id]/raw/route';
import { GET as getSourceRuns } from './sources/[id]/runs/route';

describe('World-State evidence API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorldStateDatabase.mockReset();
    mocks.getRawObservationById.mockReset();
    mocks.getCollectionRunById.mockReset();
    mocks.listCollectionRuns.mockReset();
    mocks.listRawObservationsForRun.mockReset();
    mocks.listCollectionRunsForSource.mockReset();
    mocks.getOperationsSummary.mockReset();
    mocks.getOperationsAlerts.mockReset();
    mocks.getCoverage.mockReset();
    mocks.getReadiness.mockReset();
    mocks.getCollectorDiagnostics.mockReset();
    mocks.getWorldStateDatabase.mockReturnValue(mocks.database);
  });

  it('returns 503 from raw detail when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getRawObservation({} as NextRequest, routeContext('raw-1'));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      rawObservation: null,
      collectionRun: null,
      error: 'World-State database is not configured',
    });
    expect(mocks.getRawObservationById).not.toHaveBeenCalled();
  });

  it('returns raw observation detail with linked collection-run evidence', async () => {
    mocks.getRawObservationById.mockResolvedValue({
      rawObservation: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        sourceId: 'usgs-earthquakes',
        collectionRunId: '550e8400-e29b-41d4-a716-446655440002',
        payload: { ok: true },
      },
      collectionRun: {
        id: '550e8400-e29b-41d4-a716-446655440002',
        status: 'succeeded',
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getRawObservation({} as NextRequest, routeContext('550e8400-e29b-41d4-a716-446655440001'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getRawObservationById).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001');
    await expect(response.json()).resolves.toMatchObject({
      rawObservation: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        payload: { ok: true },
      },
      collectionRun: { status: 'succeeded' },
    });
  });

  it('returns 404 when a raw observation is not found', async () => {
    mocks.getRawObservationById.mockResolvedValue({
      rawObservation: null,
      collectionRun: null,
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getRawObservation({} as NextRequest, routeContext('550e8400-e29b-41d4-a716-446655440099'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      rawObservation: null,
      collectionRun: null,
    });
  });

  it('returns collection-run detail and raw-observation count', async () => {
    mocks.getCollectionRunById.mockResolvedValue({
      collectionRun: {
        id: '550e8400-e29b-41d4-a716-446655440002',
        status: 'succeeded',
        endpoint: 'https://example.test/feed',
      },
      rawObservationCount: 12,
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getCollectionRun({} as NextRequest, routeContext('550e8400-e29b-41d4-a716-446655440002'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getCollectionRunById).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440002');
    await expect(response.json()).resolves.toMatchObject({
      collectionRun: {
        id: '550e8400-e29b-41d4-a716-446655440002',
        endpoint: 'https://example.test/feed',
      },
      rawObservationCount: 12,
    });
  });

  it('returns filtered global collection runs', async () => {
    mocks.listCollectionRuns.mockResolvedValue({
      runs: [{
        id: '550e8400-e29b-41d4-a716-446655440002',
        sourceId: 'usgs-earthquakes',
        sourceName: 'USGS Earthquakes',
        provider: 'USGS',
        status: 'succeeded',
        rawObservationCount: 4,
      }],
      page: { limit: 10, returned: 1, nextCursor: null },
      filters: {
        sourceIds: ['usgs-earthquakes'],
        statuses: ['succeeded'],
        since: '2026-07-15T00:00:00.000Z',
        until: null,
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getRuns(requestFor('/api/v1/runs?source_id=usgs-earthquakes&status=succeeded&since=2026-07-15T00:00:00Z&limit=10'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listCollectionRuns).toHaveBeenCalledWith({
      sourceIds: ['usgs-earthquakes'],
      statuses: ['succeeded'],
      since: new Date('2026-07-15T00:00:00Z'),
      until: undefined,
      limit: 10,
      cursor: undefined,
    });
    await expect(response.json()).resolves.toMatchObject({
      runs: [{ id: '550e8400-e29b-41d4-a716-446655440002', rawObservationCount: 4 }],
    });
  });

  it('returns operations summary with parsed since filter', async () => {
    mocks.getOperationsSummary.mockResolvedValue({
      totals: {
        sources: 2,
        activeSources: 2,
        runs: 10,
        successfulRuns: 8,
        failedRuns: 2,
        rawObservations: 50,
        latestRunStartedAt: '2026-07-16T03:00:00.000Z',
        latestRunCompletedAt: '2026-07-16T03:00:04.000Z',
      },
      recent: {
        sources: 2,
        activeSources: 2,
        runs: 3,
        successfulRuns: 2,
        failedRuns: 1,
        rawObservations: 12,
        latestRunStartedAt: '2026-07-16T03:00:00.000Z',
        latestRunCompletedAt: '2026-07-16T03:00:04.000Z',
        since: '2026-07-16T00:00:00.000Z',
      },
      statusBreakdown: [{ status: 'succeeded', count: 8 }],
      sourceHealth: [],
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getOperationsSummary(requestFor('/api/v1/operations/summary?since=2026-07-16T00:00:00Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getOperationsSummary).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
    });
    await expect(response.json()).resolves.toMatchObject({
      totals: { sources: 2, runs: 10 },
      recent: { runs: 3, failedRuns: 1 },
      statusBreakdown: [{ status: 'succeeded', count: 8 }],
    });
  });

  it('returns operations alerts with parsed since filter', async () => {
    mocks.getOperationsAlerts.mockResolvedValue({
      alerts: [{
        id: 'usgs-earthquakes:source_failed',
        severity: 'critical',
        kind: 'source_failed',
        title: 'USGS Earthquakes latest run failed',
        detail: 'Latest collector run failed.',
        sourceId: 'usgs-earthquakes',
        sourceName: 'USGS Earthquakes',
        provider: 'USGS',
      }],
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: { since: '2026-07-16T00:00:00.000Z' },
    });

    const response = await getOperationsAlerts(requestFor('/api/v1/operations/alerts?since=2026-07-16T00:00:00Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getOperationsAlerts).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
    });
    await expect(response.json()).resolves.toMatchObject({
      alerts: [{ id: 'usgs-earthquakes:source_failed', severity: 'critical' }],
      filters: { since: '2026-07-16T00:00:00.000Z' },
    });
  });

  it('returns collector diagnostics with parsed since and limit filters', async () => {
    mocks.getCollectorDiagnostics.mockResolvedValue({
      failingSources: [{
        sourceId: 'openaq-latest-pm25',
        sourceName: 'OpenAQ PM2.5',
        provider: 'OpenAQ',
        recentFailedRuns: 6,
        endpoint: 'https://api.example.test/v2/latest?parameter=pm25&api_key=redacted',
        error: { name: 'HttpError', message: 'Request failed with status 401' },
      }],
      recentFailures: [{
        runId: '550e8400-e29b-41d4-a716-446655440010',
        sourceId: 'openaq-latest-pm25',
        httpStatus: 401,
        archivePath: null,
      }],
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: { since: '2026-07-16T00:00:00.000Z', limit: 10 },
    });

    const response = await getCollectorDiagnostics(requestFor('/api/v1/operations/diagnostics?since=2026-07-16T00:00:00Z&limit=10'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getCollectorDiagnostics).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
      limit: 10,
    });
    await expect(response.json()).resolves.toMatchObject({
      failingSources: [{ sourceId: 'openaq-latest-pm25', recentFailedRuns: 6 }],
      recentFailures: [{ runId: '550e8400-e29b-41d4-a716-446655440010', httpStatus: 401 }],
      filters: { since: '2026-07-16T00:00:00.000Z', limit: 10 },
    });
  });

  it('returns 503 from collector diagnostics when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getCollectorDiagnostics(requestFor('/api/v1/operations/diagnostics'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      failingSources: [],
      recentFailures: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.getCollectorDiagnostics).not.toHaveBeenCalled();
  });

  it('returns coverage with parsed time filters', async () => {
    mocks.getCoverage.mockResolvedValue({
      categories: [{ category: 'seismic', events: 12, sources: 1 }],
      sources: [{ sourceId: 'usgs-earthquakes', events: 12, rawObservations: 12 }],
      timeline: [{ bucketStart: '2026-07-16T00:00:00.000Z', events: 12, rawObservations: 14, runs: 2 }],
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: {
        since: '2026-07-15T00:00:00.000Z',
        until: '2026-07-17T00:00:00.000Z',
      },
    });

    const response = await getCoverage(requestFor('/api/v1/coverage?since=2026-07-15T00:00:00Z&until=2026-07-17T00:00:00Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getCoverage).toHaveBeenCalledWith({
      since: new Date('2026-07-15T00:00:00Z'),
      until: new Date('2026-07-17T00:00:00Z'),
    });
    await expect(response.json()).resolves.toMatchObject({
      categories: [{ category: 'seismic', events: 12 }],
      timeline: [{ runs: 2 }],
    });
  });

  it('returns readiness summary for runtime bring-up', async () => {
    mocks.getReadiness.mockResolvedValue({
      status: 'ready',
      checks: [{ id: 'migrations', label: 'Database migrations', status: 'ready', detail: '21/21 migrations applied.' }],
      summary: {
        expectedMigrations: 21,
        migrationsApplied: 21,
        latestMigration: '0021_adsb_lol_aircraft_source',
        sources: 24,
        activeSources: 24,
        runs: 10,
        rawObservations: 50,
        events: 30,
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getReadiness();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.getReadiness).toHaveBeenCalledWith();
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      summary: {
        migrationsApplied: 21,
        latestMigration: '0021_adsb_lol_aircraft_source',
      },
    });
  });

  it('returns 503 from operations summary when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getOperationsSummary(requestFor('/api/v1/operations/summary'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      totals: { sources: 0, runs: 0 },
      sourceHealth: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.getOperationsSummary).not.toHaveBeenCalled();
  });

  it('returns 503 from operations alerts when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getOperationsAlerts(requestFor('/api/v1/operations/alerts'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      alerts: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.getOperationsAlerts).not.toHaveBeenCalled();
  });

  it('returns 503 from coverage when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getCoverage(requestFor('/api/v1/coverage'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      categories: [],
      sources: [],
      timeline: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.getCoverage).not.toHaveBeenCalled();
  });

  it('returns 503 from readiness when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getReadiness();

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'not_ready',
      checks: [{ id: 'database', status: 'not_ready' }],
      error: 'World-State database is not configured',
    });
    const remediation: string[] = payload.checks[0].remediation;
    expect(remediation.length).toBeGreaterThan(0);
    expect(remediation.join('\n')).toContain('WORLDSTATE_PGHOST');
    expect(remediation.join('\n')).toContain('docker compose -f docker-compose.yml -f docker-compose.worldstate.yml');
    expect(remediation.join('\n')).not.toContain('POSTGRES_PASSWORD=');
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it('returns raw observation summaries for a selected collection run', async () => {
    mocks.listRawObservationsForRun.mockResolvedValue({
      rawObservations: [{
        id: '550e8400-e29b-41d4-a716-446655440001',
        collectionRunId: '550e8400-e29b-41d4-a716-446655440002',
        sourceName: 'USGS Earthquakes',
        archivePath: 'archive/raw.json.gz',
      }],
      page: { limit: 5, returned: 1, nextCursor: null },
      filters: { collectionRunId: '550e8400-e29b-41d4-a716-446655440002' },
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getRunRawObservations(
      requestFor('/api/v1/runs/550e8400-e29b-41d4-a716-446655440002/raw?limit=5'),
      routeContext('550e8400-e29b-41d4-a716-446655440002'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listRawObservationsForRun).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440002', {
      limit: 5,
      cursor: undefined,
    });
    await expect(response.json()).resolves.toMatchObject({
      rawObservations: [{ id: '550e8400-e29b-41d4-a716-446655440001', archivePath: 'archive/raw.json.gz' }],
    });
  });

  it('returns 503 from global runs when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getRuns(requestFor('/api/v1/runs'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      runs: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.listCollectionRuns).not.toHaveBeenCalled();
  });

  it('returns source run history with parsed pagination controls', async () => {
    mocks.listCollectionRunsForSource.mockResolvedValue({
      runs: [{
        id: '550e8400-e29b-41d4-a716-446655440002',
        sourceId: 'usgs-earthquakes',
        status: 'succeeded',
        rawObservationCount: 4,
      }],
      page: { limit: 5, returned: 1, nextCursor: null },
      filters: { sourceId: 'usgs-earthquakes' },
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await getSourceRuns(
      requestFor('/api/v1/sources/usgs-earthquakes/runs?limit=5&cursor=10'),
      routeContext('usgs-earthquakes'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listCollectionRunsForSource).toHaveBeenCalledWith('usgs-earthquakes', {
      limit: 5,
      cursor: '10',
    });
    await expect(response.json()).resolves.toMatchObject({
      runs: [{ id: '550e8400-e29b-41d4-a716-446655440002', rawObservationCount: 4 }],
      page: { limit: 5, returned: 1, nextCursor: null },
    });
  });

  it('returns 503 from source run history when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getSourceRuns(
      requestFor('/api/v1/sources/usgs-earthquakes/runs'),
      routeContext('usgs-earthquakes'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      runs: [],
      filters: { sourceId: 'usgs-earthquakes' },
      error: 'World-State database is not configured',
    });
    expect(mocks.listCollectionRunsForSource).not.toHaveBeenCalled();
  });

  it('sanitizes thrown evidence-route errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getCollectionRunById.mockRejectedValue(new Error('postgresql://user:secret@example.invalid/database'));

    const response = await getCollectionRun({} as NextRequest, routeContext('550e8400-e29b-41d4-a716-446655440002'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      collectionRun: null,
      rawObservationCount: 0,
      error: 'Failed to load World-State collection run',
    });
    expect(console.error).toHaveBeenCalledWith(
      '[worldstate:v1:runs] Failed to load collection run:',
      'postgresql://user:secret@example.invalid/database',
    );
  });
});

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function requestFor(path: string): NextRequest {
  return { nextUrl: new URL(path, 'http://localhost:3000') } as NextRequest;
}
