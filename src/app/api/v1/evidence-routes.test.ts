import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { query: vi.fn() },
  getWorldStateDatabase: vi.fn(),
  getRawObservationById: vi.fn(),
  getCollectionRunById: vi.fn(),
}));

vi.mock('@/lib/worldstate/database', () => ({
  getWorldStateDatabase: mocks.getWorldStateDatabase,
}));

vi.mock('@/lib/worldstate/service', () => ({
  WorldStateService: vi.fn().mockImplementation(() => ({
    getRawObservationById: mocks.getRawObservationById,
    getCollectionRunById: mocks.getCollectionRunById,
  })),
}));

import { GET as getRawObservation } from './raw/[id]/route';
import { GET as getCollectionRun } from './runs/[id]/route';

describe('World-State evidence API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorldStateDatabase.mockReset();
    mocks.getRawObservationById.mockReset();
    mocks.getCollectionRunById.mockReset();
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
