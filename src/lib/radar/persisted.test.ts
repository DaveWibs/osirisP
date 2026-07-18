import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import { RADAR_SOURCE_ID, buildRadarResponse, loadRadarDatabaseResult } from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadRadarDatabaseResult', () => {
  it('maps persisted outages with country geometry and epoch timestamps', async () => {
    const executor = new FakePersistedExecutor([{
      response_received_at: '2026-07-18T11:55:00Z',
      upstream_timestamp: null,
      country_code: 'SD',
      score: 412.5,
      severity: 'critical',
      datasource: 'bgp_routing',
      started_at: '2026-07-18T10:00:00Z',
      ended_at: '2026-07-18T11:00:00Z',
      lat: 15,
      lng: 30,
    }]);

    const result = await loadRadarDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([RADAR_SOURCE_ID, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('internet_outage_observations');
    expect(result?.rows[0]).toMatchObject({
      countryCode: 'SD',
      score: 412.5,
      severity: 'critical',
      datasource: 'bgp_routing',
      lat: 15,
      lng: 30,
    });
  });

  it('returns null when unconfigured', async () => {
    expect(await loadRadarDatabaseResult(900_000, null)).toBeNull();
  });
});

describe('buildRadarResponse', () => {
  it('produces the live outage contract with jitter, epoch seconds and readable datasource', () => {
    const response = buildRadarResponse([{
      countryCode: 'SD',
      score: 412.5,
      severity: 'critical',
      datasource: 'bgp_routing',
      startedAt: new Date('2026-07-18T10:00:00Z'),
      endedAt: new Date('2026-07-18T11:00:00Z'),
      lat: 15,
      lng: 30,
    }], NOW);

    expect(response.total).toBe(1);
    expect(response.source).toContain('IODA');
    const outage = response.outages[0];
    expect(outage.id).toBe('ioda-SD-0');
    expect(outage.code).toBe('SD');
    expect(outage.level).toBe('critical');
    expect(outage.datasource).toBe('bgp routing');
    expect(outage.from).toBe(Math.floor(new Date('2026-07-18T10:00:00Z').getTime() / 1000));
    expect(outage.until).toBe(Math.floor(new Date('2026-07-18T11:00:00Z').getTime() / 1000));
    // Index-0 jitter matches the live formula: lat -2, lng -2.
    expect(outage.lat).toBeCloseTo(13);
    expect(outage.lng).toBeCloseTo(28);
  });
});
