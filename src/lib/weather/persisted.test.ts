import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  WEATHER_SOURCE_IDS,
  buildWeatherResponse,
  loadWeatherDatabaseResult,
  weatherIcon,
} from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadWeatherDatabaseResult', () => {
  it('maps persisted EONET and NWS events to the live event contract', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:50:00Z',
        upstream_timestamp: null,
        source_id: 'nasa-eonet-weather',
        source_event_id: 'EONET_1234',
        title: 'Tropical Storm Delta',
        category: 'severeStorms',
        event_type: 'Severe Storm',
        severity: 'high',
        area: null,
        expires_at: null,
        link: 'https://eonet.example.test/1234',
        occurred_at: '2026-07-18T09:00:00Z',
        lat: 21.5,
        lng: -71.2,
      },
      {
        response_received_at: '2026-07-18T11:50:00Z',
        upstream_timestamp: null,
        source_id: 'noaa-nws-alerts',
        source_event_id: 'urn:oid:2.49.0.1',
        title: 'Flash Flood Warning issued',
        category: 'weatherAlerts',
        event_type: 'Flash Flood Warning',
        severity: 'medium',
        area: 'Bexar, TX',
        expires_at: '2026-07-18T15:00:00Z',
        link: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1',
        occurred_at: '2026-07-18T11:00:00Z',
        lat: 29.4,
        lng: -98.5,
      },
    ]);

    const result = await loadWeatherDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([WEATHER_SOURCE_IDS, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('weather_events');

    expect(result?.rows[0]).toMatchObject({
      id: 'eonet-EONET_1234',
      title: 'Tropical Storm Delta',
      category: 'severeStorms',
      type: 'Severe Storm',
      icon: 'cyclone',
      severity: 'high',
      lat: 21.5,
      lng: -71.2,
      provider: 'NASA EONET',
    });
    expect(result?.rows[1]).toMatchObject({
      id: 'nws-urn:oid:2.49.0.1',
      icon: 'weather',
      severity: 'medium',
      area: 'Bexar, TX',
      expires: '2026-07-18T15:00:00.000Z',
      provider: 'NOAA/NWS',
    });
  });

  it('returns null when unconfigured', async () => {
    expect(await loadWeatherDatabaseResult(900_000, null)).toBeNull();
  });
});

describe('weatherIcon', () => {
  it('matches the live category-to-icon mapping', () => {
    expect(weatherIcon('severeStorms')).toBe('cyclone');
    expect(weatherIcon('volcanoes')).toBe('volcano');
    expect(weatherIcon('seaIce')).toBe('ice');
    expect(weatherIcon('weatherAlerts')).toBe('weather');
    expect(weatherIcon('dustHaze')).toBe('alert');
  });
});

describe('buildWeatherResponse', () => {
  it('wraps events with totals and timestamp', () => {
    const response = buildWeatherResponse([], NOW);
    expect(response).toEqual({ events: [], total: 0, timestamp: '2026-07-18T12:00:00.000Z' });
  });
});
