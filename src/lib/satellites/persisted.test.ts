import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  SATELLITE_SOURCE_IDS,
  buildSatelliteResponse,
  classifySatellite,
  loadSatelliteDatabaseResult,
  satelliteCategory,
} from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');
const ISS_LINE_1 = '1 25544U 98067A   26199.50000000  .00015505  00000-0  27885-3 0  9997';
const ISS_LINE_2 = '2 25544  51.6402 189.7042 0004381 334.8091 106.8778 15.50091157455243';

describe('loadSatelliteDatabaseResult', () => {
  it('loads persisted TLE rows from the latest source snapshots', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:58:00Z',
        upstream_timestamp: '2026-07-18T11:55:00Z',
        name: 'ISS (ZARYA)',
        line1: ISS_LINE_1,
        line2: ISS_LINE_2,
        norad_id: 25544,
      },
    ]);

    const result = await loadSatelliteDatabaseResult(86_400_000, executor);

    expect(executor.calls[0]?.values).toEqual([SATELLITE_SOURCE_IDS, '86400000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('satellite_tle_observations');
    expect(executor.calls[0]?.queryText).toContain('normalised_at');
    expect(result?.rows).toEqual([
      { name: 'ISS (ZARYA)', line1: ISS_LINE_1, line2: ISS_LINE_2, noradId: 25544 },
    ]);
    expect(result?.responseReceivedAt?.toISOString()).toBe('2026-07-18T11:58:00.000Z');
    expect(result?.upstreamTimestamp?.toISOString()).toBe('2026-07-18T11:55:00.000Z');
  });

  it('returns null when unconfigured', async () => {
    expect(await loadSatelliteDatabaseResult(86_400_000, null)).toBeNull();
  });
});

describe('buildSatelliteResponse', () => {
  it('propagates fresh persisted TLEs into the live satellite response contract', () => {
    const response = buildSatelliteResponse([
      { name: 'ISS (ZARYA)', line1: ISS_LINE_1, line2: ISS_LINE_2, noradId: 25544 },
    ], NOW);

    expect(response.total).toBe(1);
    expect(response.raw_count).toBe(1);
    expect(response.category_counts.science).toBe(1);
    expect(response.satellites[0]).toMatchObject({
      name: 'ISS (ZARYA)',
      mission: 'Space Station',
      category: 'science',
      noradId: '25544',
    });
    expect(response.satellites[0]?.lat).toEqual(expect.any(Number));
    expect(response.source).toContain('worldstate-database');
  });

  it('keeps mission and category mapping aligned with the live route', () => {
    expect(classifySatellite('STARLINK-123').mission).toBe('Commercial Comms');
    expect(satelliteCategory('STARLINK-123', 'Commercial Comms')).toBe('comms');
    expect(satelliteCategory('COSMOS 1408 DEB', 'Russian Military')).toBe('other');
  });
});
