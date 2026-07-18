import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  SPACE_WEATHER_SOURCE_IDS,
  buildSpaceWeatherResponse,
  loadSpaceWeatherDatabaseResult,
  stormLevel,
} from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadSpaceWeatherDatabaseResult', () => {
  it('loads Kp, alert and flare observations across the three SWPC sources', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:55:00Z',
        upstream_timestamp: '2026-07-18T11:54:00Z',
        event_kind: 'planetary_k_index',
        numeric_value: 6.33,
        classification: 'G2',
        message: null,
        observed_at: '2026-07-18T11:53:00Z',
        source_observation_id: 'kp-2026-07-18T11:53:00.000Z',
      },
      {
        response_received_at: '2026-07-18T11:55:00Z',
        upstream_timestamp: '2026-07-18T11:54:00Z',
        event_kind: 'alert',
        numeric_value: null,
        classification: 'K07A',
        message: 'ALERT: Geomagnetic K-index of 7 expected',
        observed_at: '2026-07-18T11:00:00Z',
        source_observation_id: 'alert-K07A-2026-07-18T11:00:00.000Z',
      },
      {
        response_received_at: '2026-07-18T11:55:00Z',
        upstream_timestamp: '2026-07-18T11:54:00Z',
        event_kind: 'xray_flare',
        numeric_value: null,
        classification: 'M5.2',
        message: null,
        observed_at: '2026-07-18T10:30:00Z',
        source_observation_id: 'xray-2026-07-18T10:30:00.000Z-M5.2',
      },
    ]);

    const result = await loadSpaceWeatherDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([SPACE_WEATHER_SOURCE_IDS, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('space_weather_observations');
    expect(result?.rows).toHaveLength(3);
  });

  it('returns null when unconfigured', async () => {
    expect(await loadSpaceWeatherDatabaseResult(900_000, null)).toBeNull();
  });
});

describe('stormLevel', () => {
  it('matches the live route thresholds', () => {
    expect(stormLevel(1)).toEqual({ level: 'Quiet', color: '#00E676' });
    expect(stormLevel(3.4)).toEqual({ level: 'Unsettled', color: '#D4AF37' });
    expect(stormLevel(5.2)).toEqual({ level: 'Moderate (G2)', color: '#FFD700' });
    expect(stormLevel(8.5)).toEqual({ level: 'Extreme (G5)', color: '#FF1744' });
  });
});

describe('buildSpaceWeatherResponse', () => {
  it('produces the live response contract from persisted observations', () => {
    const response = buildSpaceWeatherResponse([
      {
        eventKind: 'planetary_k_index',
        numericValue: 6.33,
        classification: 'G2',
        message: null,
        observedAt: new Date('2026-07-18T11:53:00Z'),
        sourceObservationId: 'kp-1',
      },
      {
        eventKind: 'alert',
        numericValue: null,
        classification: 'K07A',
        message: 'ALERT: Geomagnetic K-index of 7 expected. '.repeat(10),
        observedAt: new Date('2026-07-18T11:00:00Z'),
        sourceObservationId: 'alert-1',
      },
      {
        eventKind: 'xray_flare',
        numericValue: null,
        classification: 'M5.2',
        message: null,
        observedAt: new Date('2026-07-18T10:30:00Z'),
        sourceObservationId: 'flare-1',
      },
    ], NOW);

    expect(response.kp_index).toBe(6.33);
    expect(response.storm_level).toBe('Strong (G3)');
    expect(response.kp_timestamp).toBe('2026-07-18T11:53:00.000Z');
    expect(response.alerts).toHaveLength(1);
    expect(response.alerts[0].id).toBe('K07A');
    expect(response.alerts[0].message.length).toBeLessThanOrEqual(200);
    expect(response.solar_flares).toEqual([{
      class: 'M5.2',
      begin: null,
      peak: '2026-07-18T10:30:00.000Z',
      end: null,
    }]);
    expect(response.timestamp).toBe('2026-07-18T12:00:00.000Z');
  });

  it('reports quiet defaults when no Kp observation exists', () => {
    const response = buildSpaceWeatherResponse([], NOW);
    expect(response).toMatchObject({
      kp_index: 0,
      storm_level: 'Quiet',
      kp_timestamp: '',
      alerts: [],
      solar_flares: [],
    });
  });
});
