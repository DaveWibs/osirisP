import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  AIR_QUALITY_SOURCE_ID,
  buildAirQualityResponse,
  loadAirQualityDatabaseResult,
  pm25Color,
} from './persisted';

describe('loadAirQualityDatabaseResult', () => {
  it('maps persisted PM2.5 stations to the live station contract', async () => {
    const executor = new FakePersistedExecutor([{
      response_received_at: '2026-07-18T11:50:00Z',
      upstream_timestamp: '2026-07-18T11:45:00Z',
      location_name: 'Lahore US Consulate',
      city: 'Lahore',
      country_code: 'PK',
      measurement_value: 168.2,
      unit: 'µg/m³',
      level: 'Hazardous',
      observed_at: '2026-07-18T11:30:00Z',
      lat: 31.56,
      lng: 74.34,
    }]);

    const result = await loadAirQualityDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([AIR_QUALITY_SOURCE_ID, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('air_quality_observations');
    expect(result?.rows[0]).toEqual({
      id: 'aq-Lahore US Consulate',
      name: 'Lahore US Consulate',
      city: 'Lahore',
      country: 'PK',
      lat: 31.56,
      lng: 74.34,
      pm25: 168.2,
      unit: 'µg/m³',
      level: 'Hazardous',
      color: '#8B0000',
      lastUpdated: '2026-07-18T11:30:00.000Z',
    });
  });

  it('returns null when unconfigured', async () => {
    expect(await loadAirQualityDatabaseResult(900_000, null)).toBeNull();
  });
});

describe('pm25Color', () => {
  it('matches the live WHO/EPA thresholds', () => {
    expect(pm25Color(10)).toBe('#00E676');
    expect(pm25Color(40)).toBe('#FFD700');
    expect(pm25Color(60)).toBe('#FF9500');
    expect(pm25Color(120)).toBe('#FF1744');
    expect(pm25Color(200)).toBe('#8B0000');
  });
});

describe('buildAirQualityResponse', () => {
  it('wraps stations with totals and timestamp', () => {
    const response = buildAirQualityResponse([], new Date('2026-07-18T12:00:00Z'));
    expect(response).toEqual({ stations: [], total: 0, timestamp: '2026-07-18T12:00:00.000Z' });
  });
});
