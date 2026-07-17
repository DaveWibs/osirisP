import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { resolveWorldStatePoolConfig, type WorldStateQueryExecutor } from './database';
import { WorldStateService } from './service';

class FakeExecutor implements WorldStateQueryExecutor {
  calls: Array<{ queryText: string; values: unknown[] }> = [];

  constructor(private readonly rows: QueryResultRow[]) {}

  async query<Row extends QueryResultRow>(queryText: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ queryText, values });
    return { rows: this.rows as Row[] };
  }
}

class SequencedExecutor implements WorldStateQueryExecutor {
  calls: Array<{ queryText: string; values: unknown[] }> = [];
  private index = 0;

  constructor(private readonly rowSets: QueryResultRow[][]) {}

  async query<Row extends QueryResultRow>(queryText: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ queryText, values });
    const rows = this.rowSets[this.index] ?? [];
    this.index += 1;
    return { rows: rows as Row[] };
  }
}

describe('WorldStateService', () => {
  it('maps source catalogue rows with latest run and totals', async () => {
    const executor = new FakeExecutor([{
      source_id: 'usgs-earthquakes',
      name: 'USGS Earthquakes',
      provider: 'USGS',
      description: 'Earthquake feed',
      access_method: 'https_geojson',
      cost_class: 'free',
      licence: 'public',
      terms_url: 'https://example.test/terms',
      documentation_url: 'https://example.test/docs',
      status: 'active',
      metadata: { endpoint: 'https://example.test/feed.geojson' },
      latest_run_id: 'run-1',
      latest_run_status: 'succeeded',
      latest_run_started_at: '2026-07-16T00:00:00Z',
      latest_run_completed_at: '2026-07-16T00:00:03Z',
      latest_run_response_received_at: '2026-07-16T00:00:02Z',
      latest_run_upstream_timestamp: '2026-07-16T00:00:01Z',
      latest_run_record_count: 42,
      latest_run_archive_path: 'archive/usgs.gz',
      latest_run_error: null,
      total_runs: 9,
      total_successes: 8,
      total_failures: 1,
      raw_observations: 42,
    }]);

    const response = await new WorldStateService(executor).listSources(new Date('2026-07-16T01:00:00Z'));

    expect(response.generatedAt).toBe('2026-07-16T01:00:00.000Z');
    expect(response.sources[0]).toMatchObject({
      sourceId: 'usgs-earthquakes',
      provider: 'USGS',
      latestRun: {
        id: 'run-1',
        status: 'succeeded',
        recordCount: 42,
        archivePath: 'archive/usgs.gz',
      },
      totals: {
        runs: 9,
        successes: 8,
        failures: 1,
        rawObservations: 42,
      },
    });
  });

  it('loads source drilldown with recent events and quotes', async () => {
    const executor = new SequencedExecutor([
      [sourceRow('usgs-earthquakes')],
      [eventRow('event-1', 'seismic', 'earthquake', '2026-07-16T03:00:00Z')],
      [],
    ]);

    const response = await new WorldStateService(executor)
      .getSourceById('usgs-earthquakes', new Date('2026-07-16T04:00:00Z'));

    expect(response.source?.sourceId).toBe('usgs-earthquakes');
    expect(response.recentEvents[0]?.id).toBe('event-1');
    expect(response.recentQuotes).toEqual([]);
    expect(executor.calls[1]?.values).toEqual([
      ['usgs-earthquakes'],
      26,
      0,
    ]);
    expect(executor.calls[2]?.values).toEqual([
      ['usgs-earthquakes'],
      26,
      0,
    ]);
  });

  it('returns null for invalid source detail identifiers without querying', async () => {
    const executor = new FakeExecutor([]);

    const response = await new WorldStateService(executor).getSourceById('../bad');

    expect(response.source).toBeNull();
    expect(response.recentEvents).toEqual([]);
    expect(executor.calls).toEqual([]);
  });

  it('maps unified event rows and applies filters with pagination', async () => {
    const rows = [
      eventRow('event-1', 'seismic', 'earthquake', '2026-07-16T03:00:00Z'),
      eventRow('event-2', 'fire', 'active_fire', '2026-07-16T02:00:00Z'),
      eventRow('event-3', 'weather', 'storm', '2026-07-16T01:00:00Z'),
    ];
    const executor = new FakeExecutor(rows);

    const response = await new WorldStateService(executor).listEvents({
      categories: ['seismic', 'fire'],
      sourceIds: ['usgs-earthquakes'],
      since: new Date('2026-07-15T00:00:00Z'),
      until: new Date('2026-07-17T00:00:00Z'),
      bbox: [-10, -20, 10, 20],
      limit: 2,
      cursor: '4',
    }, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([
      ['seismic', 'fire'],
      ['usgs-earthquakes'],
      new Date('2026-07-15T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
      -10,
      10,
      -20,
      20,
      3,
      4,
    ]);
    expect(executor.calls[0]?.queryText).toContain('category = ANY($1::text[])');
    expect(executor.calls[0]?.queryText).toContain('longitude BETWEEN $5 AND $6');
    expect(response.events).toHaveLength(2);
    expect(response.page.nextCursor).toBe('6');
    expect(response.events[0]).toMatchObject({
      id: 'event-1',
      category: 'seismic',
      sourceId: 'usgs-earthquakes',
      point: { lat: -33.86, lon: 151.2 },
      raw: {
        rawObservationId: 'raw-event-1',
        archivePath: 'archive/event-1.json.gz',
      },
    });
  });

  it('loads a single event detail by id', async () => {
    const executor = new FakeExecutor([
      eventRow('550e8400-e29b-41d4-a716-446655440000', 'weather', 'storm', '2026-07-16T01:00:00Z'),
    ]);

    const response = await new WorldStateService(executor)
      .getEventById('550e8400-e29b-41d4-a716-446655440000', new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.queryText).toContain('WHERE id = $1');
    expect(executor.calls[0]?.values).toEqual(['550e8400-e29b-41d4-a716-446655440000']);
    expect(response.event).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440000',
      category: 'weather',
      eventType: 'storm',
    });
  });

  it('returns null for invalid event detail identifiers without querying', async () => {
    const executor = new FakeExecutor([]);

    const response = await new WorldStateService(executor).getEventById('../bad');

    expect(response.event).toBeNull();
    expect(executor.calls).toEqual([]);
  });

  it('maps market quote rows and normalises symbol filters', async () => {
    const executor = new FakeExecutor([
      {
        id: 'quote-1',
        source_id: 'yahoo-finance-market-quotes',
        source_name: 'Yahoo Finance Market Quotes',
        provider: 'Yahoo Finance',
        symbol: 'RTX',
        display_name: 'RTX',
        quote_type: 'equity',
        currency: 'USD',
        price: 122.5,
        change_percent: 1.25,
        up: true,
        observed_at: '2026-07-16T00:00:00Z',
        updated_at: '2026-07-16T00:01:00Z',
        evidence_classification: 'observed',
        parser_version: 'test',
        metadata: { exchange: 'NYSE' },
        raw_observation_id: 'raw-quote-1',
        collection_run_id: 'run-quote-1',
        archive_path: 'archive/quote.json.gz',
        content_hash: 'a'.repeat(64),
      },
    ]);

    const response = await new WorldStateService(executor).listMarketQuotes({
      symbols: ['rtx'],
      quoteTypes: ['equity'],
      sourceIds: ['yahoo-finance-market-quotes'],
      since: new Date('2026-07-15T00:00:00Z'),
      limit: 50,
    });

    expect(executor.calls[0]?.values).toEqual([
      ['RTX'],
      ['equity'],
      ['yahoo-finance-market-quotes'],
      new Date('2026-07-15T00:00:00Z'),
      51,
      0,
    ]);
    expect(response.quotes[0]).toMatchObject({
      symbol: 'RTX',
      price: 122.5,
      raw: { collectionRunId: 'run-quote-1' },
    });
  });

  it('loads raw observation detail with its collection run', async () => {
    const executor = new SequencedExecutor([
      [rawObservationRow('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002')],
      [collectionRunRow('550e8400-e29b-41d4-a716-446655440002')],
    ]);

    const response = await new WorldStateService(executor)
      .getRawObservationById('550e8400-e29b-41d4-a716-446655440001', new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual(['550e8400-e29b-41d4-a716-446655440001']);
    expect(executor.calls[1]?.values).toEqual(['550e8400-e29b-41d4-a716-446655440002']);
    expect(response.rawObservation).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440001',
      collectionRunId: '550e8400-e29b-41d4-a716-446655440002',
      archivePath: 'archive/raw.json.gz',
      payload: { ok: true },
    });
    expect(response.collectionRun).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440002',
      status: 'succeeded',
    });
  });

  it('loads collection run detail with raw observation count', async () => {
    const executor = new SequencedExecutor([
      [collectionRunRow('550e8400-e29b-41d4-a716-446655440002')],
      [{ raw_observation_count: 7 }],
    ]);

    const response = await new WorldStateService(executor)
      .getCollectionRunById('550e8400-e29b-41d4-a716-446655440002');

    expect(response.collectionRun?.id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(response.rawObservationCount).toBe(7);
  });

  it('lists collection runs for a source with pagination and raw counts', async () => {
    const executor = new FakeExecutor([
      collectionRunListRow('550e8400-e29b-41d4-a716-446655440002', 4),
      collectionRunListRow('550e8400-e29b-41d4-a716-446655440003', 2),
    ]);

    const response = await new WorldStateService(executor)
      .listCollectionRunsForSource('usgs-earthquakes', { limit: 1, cursor: '3' }, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual(['usgs-earthquakes', 2, 3]);
    expect(executor.calls[0]?.queryText).toContain('WHERE run.source_id = $1');
    expect(response.runs).toHaveLength(1);
    expect(response.runs[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440002',
      rawObservationCount: 4,
    });
    expect(response.page).toEqual({ limit: 1, returned: 1, nextCursor: '4' });
  });

  it('lists global collection runs with filters, source labels and raw counts', async () => {
    const executor = new FakeExecutor([
      collectionRunSummaryRow('550e8400-e29b-41d4-a716-446655440002', 4),
      collectionRunSummaryRow('550e8400-e29b-41d4-a716-446655440003', 2),
    ]);

    const response = await new WorldStateService(executor).listCollectionRuns({
      sourceIds: ['usgs-earthquakes'],
      statuses: ['succeeded'],
      since: new Date('2026-07-15T00:00:00Z'),
      until: new Date('2026-07-17T00:00:00Z'),
      limit: 1,
      cursor: '5',
    }, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([
      ['usgs-earthquakes'],
      ['succeeded'],
      new Date('2026-07-15T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
      2,
      5,
    ]);
    expect(executor.calls[0]?.queryText).toContain('run.source_id = ANY($1::text[])');
    expect(executor.calls[0]?.queryText).toContain('run.status = ANY($2::text[])');
    expect(response.runs).toHaveLength(1);
    expect(response.runs[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440002',
      sourceName: 'USGS Earthquakes',
      provider: 'USGS',
      rawObservationCount: 4,
    });
    expect(response.page.nextCursor).toBe('6');
    expect(response.filters).toEqual({
      sourceIds: ['usgs-earthquakes'],
      statuses: ['succeeded'],
      since: '2026-07-15T00:00:00.000Z',
      until: '2026-07-17T00:00:00.000Z',
    });
  });

  it('lists raw observation summaries for a collection run without payloads', async () => {
    const executor = new FakeExecutor([
      rawObservationSummaryRow('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'),
      rawObservationSummaryRow('550e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440002'),
    ]);

    const response = await new WorldStateService(executor)
      .listRawObservationsForRun('550e8400-e29b-41d4-a716-446655440002', { limit: 1, cursor: '1' });

    expect(executor.calls[0]?.values).toEqual(['550e8400-e29b-41d4-a716-446655440002', 2, 1]);
    expect(executor.calls[0]?.queryText).toContain('WHERE raw.collection_run_id = $1');
    expect(response.rawObservations).toHaveLength(1);
    expect(response.rawObservations[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440001',
      sourceName: 'USGS Earthquakes',
      collectionRunId: '550e8400-e29b-41d4-a716-446655440002',
      archivePath: 'archive/raw.json.gz',
    });
    expect(response.rawObservations[0]).not.toHaveProperty('payload');
    expect(response.page.nextCursor).toBe('2');
  });

  it('does not query raw or run endpoints for invalid UUIDs', async () => {
    const executor = new FakeExecutor([]);
    const service = new WorldStateService(executor);

    await expect(service.getRawObservationById('not-a-uuid')).resolves.toMatchObject({ rawObservation: null });
    await expect(service.getCollectionRunById('not-a-uuid')).resolves.toMatchObject({ collectionRun: null });
    expect(executor.calls).toEqual([]);
  });

  it('does not query run raw-observation summaries for invalid UUIDs', async () => {
    const executor = new FakeExecutor([]);

    const response = await new WorldStateService(executor).listRawObservationsForRun('not-a-uuid');

    expect(response.rawObservations).toEqual([]);
    expect(executor.calls).toEqual([]);
  });

  it('does not query source run history for invalid source identifiers', async () => {
    const executor = new FakeExecutor([]);

    const response = await new WorldStateService(executor).listCollectionRunsForSource('../bad');

    expect(response.runs).toEqual([]);
    expect(executor.calls).toEqual([]);
  });

  it('uses discrete World-State database settings before DATABASE_URL', () => {
    const config = resolveWorldStatePoolConfig({
      DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/ignored',
      WORLDSTATE_PGDATABASE: 'osiris_worldstate',
      WORLDSTATE_PGHOST: 'db',
      WORLDSTATE_PGPASSWORD: 'secret',
      WORLDSTATE_PGPORT: '5432',
      WORLDSTATE_PGUSER: 'osiris',
    });

    expect(config).toMatchObject({
      database: 'osiris_worldstate',
      host: 'db',
      password: 'secret',
      port: 5432,
      user: 'osiris',
      application_name: 'osiris-worldstate-v1-api',
    });
  });
});

function eventRow(
  id: string,
  category: string,
  eventType: string,
  occurredAt: string,
): QueryResultRow {
  return {
    id,
    category,
    event_type: eventType,
    source_id: 'usgs-earthquakes',
    source_name: 'USGS Earthquakes',
    provider: 'USGS',
    source_record_id: `source-${id}`,
    title: `Title ${id}`,
    description: null,
    occurred_at: occurredAt,
    updated_at: occurredAt,
    observed_at: occurredAt,
    severity: 'medium',
    latitude: -33.86,
    longitude: 151.2,
    evidence_classification: 'reported',
    parser_version: 'test',
    facts: { magnitude: 5.5 },
    metadata: { region: 'test' },
    raw_observation_id: `raw-${id}`,
    collection_run_id: `run-${id}`,
    archive_path: `archive/${id}.json.gz`,
    content_hash: 'b'.repeat(64),
  };
}

function sourceRow(sourceId: string): QueryResultRow {
  return {
    source_id: sourceId,
    name: 'USGS Earthquakes',
    provider: 'USGS',
    description: 'Earthquake feed',
    access_method: 'https_geojson',
    cost_class: 'free',
    licence: 'public',
    terms_url: 'https://example.test/terms',
    documentation_url: 'https://example.test/docs',
    status: 'active',
    metadata: { endpoint: 'https://example.test/feed.geojson' },
    latest_run_id: 'run-1',
    latest_run_status: 'succeeded',
    latest_run_started_at: '2026-07-16T00:00:00Z',
    latest_run_completed_at: '2026-07-16T00:00:03Z',
    latest_run_response_received_at: '2026-07-16T00:00:02Z',
    latest_run_upstream_timestamp: '2026-07-16T00:00:01Z',
    latest_run_record_count: 42,
    latest_run_archive_path: 'archive/usgs.gz',
    latest_run_error: null,
    total_runs: 9,
    total_successes: 8,
    total_failures: 1,
    raw_observations: 42,
  };
}

function rawObservationRow(id: string, runId: string): QueryResultRow {
  return {
    id,
    source_id: 'usgs-earthquakes',
    collection_run_id: runId,
    source_record_id: 'source-record-1',
    observed_at: '2026-07-16T00:00:00Z',
    occurred_at: '2026-07-15T23:59:00Z',
    source_updated_at: '2026-07-16T00:00:01Z',
    first_seen_at: '2026-07-16T00:00:00Z',
    last_seen_at: '2026-07-16T00:00:00Z',
    content_hash: 'c'.repeat(64),
    archive_path: 'archive/raw.json.gz',
    payload: { ok: true },
    schema_version: 1,
    parser_version: 'test',
    evidence_classification: 'reported',
    metadata: { fixture: true },
  };
}

function collectionRunRow(id: string): QueryResultRow {
  return {
    id,
    source_id: 'usgs-earthquakes',
    started_at: '2026-07-16T00:00:00Z',
    request_started_at: '2026-07-16T00:00:00Z',
    response_received_at: '2026-07-16T00:00:01Z',
    completed_at: '2026-07-16T00:00:02Z',
    upstream_timestamp: '2026-07-16T00:00:00Z',
    retry_not_before: null,
    status: 'succeeded',
    endpoint: 'https://example.test/feed',
    http_status: 200,
    content_type: 'application/json',
    content_hash: 'd'.repeat(64),
    archive_path: 'archive/run.json.gz',
    response_headers: { etag: 'test' },
    record_count: 1,
    collector_version: 'test-collector',
    parser_version: 'test-parser',
    legacy_provenance_incomplete: false,
    error: null,
    metrics: { durationMs: 2 },
  };
}

function collectionRunListRow(id: string, rawObservationCount: number): QueryResultRow {
  return {
    ...collectionRunRow(id),
    raw_observation_count: rawObservationCount,
  };
}

function collectionRunSummaryRow(id: string, rawObservationCount: number): QueryResultRow {
  return {
    ...collectionRunListRow(id, rawObservationCount),
    source_name: 'USGS Earthquakes',
    provider: 'USGS',
  };
}

function rawObservationSummaryRow(id: string, runId: string): QueryResultRow {
  return {
    ...rawObservationRow(id, runId),
    source_name: 'USGS Earthquakes',
    provider: 'USGS',
  };
}
