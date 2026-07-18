import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  FIRE_DETECTION_SOURCE_IDS,
  FIRE_VOLCANO_SOURCE_ID,
  buildFiresResponse,
  loadFiresDatabaseResult,
} from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadFiresDatabaseResult', () => {
  it('maps persisted FIRMS detections and EONET volcanoes to the live marker contract', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:40:00Z',
        upstream_timestamp: null,
        kind: 'fire',
        lat: -15.78912,
        lng: 23.45678,
        brightness: 330.4,
        confidence: 'nominal',
        frp: 12.7,
        occurred_at: '2026-07-18T10:12:00Z',
        title: null,
      },
      {
        response_received_at: '2026-07-18T11:40:00Z',
        upstream_timestamp: null,
        kind: 'volcano',
        lat: 37.75,
        lng: 14.99,
        brightness: null,
        confidence: null,
        frp: null,
        occurred_at: '2026-07-17T00:00:00Z',
        title: 'Etna Volcano, Italy',
      },
    ]);

    const result = await loadFiresDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([
      [...FIRE_DETECTION_SOURCE_IDS, FIRE_VOLCANO_SOURCE_ID],
      FIRE_DETECTION_SOURCE_IDS,
      '900000 milliseconds',
      FIRE_VOLCANO_SOURCE_ID,
    ]);
    expect(executor.calls[0]?.queryText).toContain('active_fire_detections');
    expect(executor.calls[0]?.queryText).toContain('disaster_events');

    expect(result?.rows[0]).toEqual({
      lat: -15.789,
      lng: 23.457,
      brightness: 330.4,
      confidence: 'nominal',
      date: '2026-07-18',
      time: '1012',
      frp: 12.7,
      type: 'fire',
    });
    expect(result?.rows[1]).toEqual({
      lat: 37.75,
      lng: 14.99,
      brightness: 500,
      confidence: 'high',
      date: '2026-07-17',
      time: '',
      frp: 100,
      title: '[VOLCANO] Etna Volcano, Italy',
      type: 'volcano',
    });
  });

  it('returns null when unconfigured', async () => {
    expect(await loadFiresDatabaseResult(900_000, null)).toBeNull();
  });
});

describe('buildFiresResponse', () => {
  it('wraps markers with totals, source label and timestamp', () => {
    const response = buildFiresResponse([], NOW);
    expect(response).toEqual({
      fires: [],
      total: 0,
      source: 'World-State (NASA FIRMS + EONET)',
      timestamp: '2026-07-18T12:00:00.000Z',
    });
  });
});
