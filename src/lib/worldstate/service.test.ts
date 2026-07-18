import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import { resolveWorldStatePoolConfig, type WorldStateQueryExecutor } from './database';
import { WorldStateService, sanitiseCollectorEndpoint, sanitiseCollectorError } from './service';

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
  it('loads operations summary with default recent window and source health', async () => {
    const executor = new SequencedExecutor([
      [operationsTotalsRow()],
      [operationsTotalsRow({ runs: 3, successful_runs: 2, failed_runs: 1, raw_observations: 12 })],
      [
        { status: 'succeeded', count: 8 },
        { status: 'failed', count: 2 },
      ],
      [operationsSourceHealthRow()],
    ]);

    const response = await new WorldStateService(executor)
      .getOperationsSummary({}, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[1]?.values).toEqual([new Date('2026-07-15T04:00:00Z')]);
    expect(response.generatedAt).toBe('2026-07-16T04:00:00.000Z');
    expect(response.totals).toMatchObject({
      sources: 2,
      activeSources: 2,
      runs: 10,
      successfulRuns: 8,
      failedRuns: 2,
      rawObservations: 50,
    });
    expect(response.recent).toMatchObject({
      since: '2026-07-15T04:00:00.000Z',
      runs: 3,
      failedRuns: 1,
      rawObservations: 12,
    });
    expect(response.statusBreakdown).toEqual([
      { status: 'succeeded', count: 8 },
      { status: 'failed', count: 2 },
    ]);
    expect(response.sourceHealth[0]).toMatchObject({
      sourceId: 'usgs-earthquakes',
      successRate: 0.8,
      latestRunStatus: 'succeeded',
    });
  });

  it('uses a caller-supplied operations summary window', async () => {
    const since = new Date('2026-07-16T00:00:00Z');
    const executor = new SequencedExecutor([
      [operationsTotalsRow()],
      [operationsTotalsRow()],
      [],
      [],
    ]);

    const response = await new WorldStateService(executor)
      .getOperationsSummary({ since }, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[1]?.values).toEqual([since]);
    expect(response.recent.since).toBe('2026-07-16T00:00:00.000Z');
  });

  it('derives operations alerts from failed, stale and empty-output sources', async () => {
    const executor = new FakeExecutor([
      operationsAlertRow({
        source_id: 'failed-source',
        name: 'Failed Source',
        latest_run_status: 'failed',
        runs: 5,
        successful_runs: 2,
        failed_runs: 3,
        recent_runs: 1,
        recent_failed_runs: 1,
        recent_raw_observations: 0,
      }),
      operationsAlertRow({
        source_id: 'stale-source',
        name: 'Stale Source',
        latest_run_status: 'succeeded',
        recent_runs: 0,
        recent_raw_observations: 0,
      }),
      operationsAlertRow({
        source_id: 'healthy-source',
        name: 'Healthy Source',
        latest_run_status: 'succeeded',
        runs: 10,
        successful_runs: 10,
        failed_runs: 0,
        recent_runs: 2,
        recent_raw_observations: 8,
      }),
    ]);

    const response = await new WorldStateService(executor)
      .getOperationsAlerts({ since: new Date('2026-07-16T00:00:00Z') }, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([new Date('2026-07-16T00:00:00Z')]);
    expect(response.filters.since).toBe('2026-07-16T00:00:00.000Z');
    expect(response.alerts.map((alert) => `${alert.sourceId}:${alert.kind}:${alert.severity}`)).toEqual([
      'failed-source:low_success_rate:critical',
      'failed-source:source_failed:critical',
      'failed-source:no_recent_raw:warning',
      'stale-source:source_stale:warning',
    ]);
  });

  it('uses a default 24 hour operations alert window', async () => {
    const executor = new FakeExecutor([]);

    const response = await new WorldStateService(executor)
      .getOperationsAlerts({}, new Date('2026-07-16T04:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([new Date('2026-07-15T04:00:00Z')]);
    expect(response.filters.since).toBe('2026-07-15T04:00:00.000Z');
  });

  it('lists persisted intelligence alerts with filters and pagination', async () => {
    const executor = new FakeExecutor([
      intelligenceAlertRow({
        alert_key: 'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
      }),
      intelligenceAlertRow({
        id: '550e8400-e29b-41d4-a716-446655440102',
        alert_key: 'market_price_movement:yahoo-finance-market-quotes:market_symbol:CL=F',
        entity_type: 'market_symbol',
        entity_id: 'CL=F',
      }),
    ]);

    const response = await new WorldStateService(executor).listAlerts({
      since: new Date('2026-07-16T00:00:00Z'),
      statuses: ['active', 'invalid'],
      severities: ['critical'],
      kinds: ['market_price_movement'],
      limit: 1,
    }, new Date('2026-07-17T02:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([
      new Date('2026-07-16T00:00:00Z'),
      ['active'],
      ['critical'],
      ['market_price_movement'],
      2,
      0,
    ]);
    expect(response.alerts).toHaveLength(1);
    expect(response.page.nextCursor).toBe('1');
    expect(response.alerts[0]).toMatchObject({
      kind: 'market_price_movement',
      severity: 'critical',
      status: 'active',
      sourceId: 'coingecko-simple-price',
      raw: {
        rawObservationId: '550e8400-e29b-41d4-a716-446655440201',
        collectionRunId: '550e8400-e29b-41d4-a716-446655440301',
      },
    });
  });

  it('lists evidence graph edges with node, relation, source and classification filters', async () => {
    const executor = new FakeExecutor([
      evidenceEdgeRow(),
      evidenceEdgeRow({
        id: '550e8400-e29b-41d4-a716-446655440902',
        edge_key: 'edge:test:2',
      }),
    ]);

    const response = await new WorldStateService(executor).listEvidenceEdges({
      nodeKey: 'alert:gdacs:1',
      relationTypes: ['supported_by', 'invalid'],
      sourceIds: ['gdacs-disasters'],
      evidenceClassifications: ['reported', 'nonsense'],
      limit: 1,
    }, new Date('2026-07-17T03:00:00Z'));

    expect(executor.calls[0]?.queryText).toContain('FROM evidence_edges AS edge');
    expect(executor.calls[0]?.queryText).toContain('(from_node.node_key = $1 OR to_node.node_key = $1)');
    expect(executor.calls[0]?.values).toEqual([
      'alert:gdacs:1',
      ['supported_by'],
      ['gdacs-disasters'],
      ['reported'],
      2,
      0,
    ]);
    expect(response.page.nextCursor).toBe('1');
    expect(response.filters).toEqual({
      nodeKey: 'alert:gdacs:1',
      fromNodeKey: null,
      toNodeKey: null,
      relationTypes: ['supported_by'],
      sourceIds: ['gdacs-disasters'],
      evidenceClassifications: ['reported'],
    });
    expect(response.edges[0]).toMatchObject({
      edgeKey: 'edge:test:1',
      relationType: 'supported_by',
      sourceId: 'gdacs-disasters',
      confidence: 0.92,
      from: {
        nodeKey: 'alert:gdacs:1',
        nodeType: 'alert',
        evidenceClassification: 'reported',
      },
      to: {
        nodeKey: 'raw:gdacs:1',
        nodeType: 'raw_observation',
      },
      raw: {
        rawObservationId: '550e8400-e29b-41d4-a716-446655440201',
      },
    });
  });

  it('refreshes market anomaly alerts from persisted quote history', async () => {
    const rows = [
      marketAlertInputRow('2026-07-16T00:00:00Z', 100),
      marketAlertInputRow('2026-07-16T01:00:00Z', 101),
      marketAlertInputRow('2026-07-16T02:00:00Z', 99),
      marketAlertInputRow('2026-07-16T03:00:00Z', 100),
      marketAlertInputRow('2026-07-16T04:00:00Z', 130),
    ];
    const executor = new SequencedExecutor([
      rows,
      [intelligenceAlertRow({
        title: 'BTC price moved 30% above baseline',
        detail: 'BTC latest price 130 USD is 30% above the 4-sample median 100 USD.',
        input_window: { baselineSamples: 4, movementPercent: 30 },
      })],
      [],
    ]);

    const response = await new WorldStateService(executor).refreshMarketAnomalyAlerts({
      since: new Date('2026-07-16T00:00:00Z'),
      minSamples: 4,
      thresholdPercent: 5,
    }, new Date('2026-07-17T02:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([new Date('2026-07-16T00:00:00Z')]);
    expect(executor.calls[1]?.queryText).toContain('INSERT INTO intelligence_alerts');
    expect(executor.calls[1]?.values[1]).toBe('market_price_movement:coingecko-simple-price:crypto_asset:bitcoin');
    expect(executor.calls[1]?.values[3]).toBe('critical');
    expect(executor.calls[2]?.queryText).toContain("status = 'resolved'");
    expect(executor.calls[2]?.values[2]).toEqual([
      'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
    ]);
    expect(executor.calls[2]?.values[3]).toEqual([
      'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
    ]);
    expect(response.alertsCreatedOrUpdated).toBe(1);
    expect(response.alertsResolved).toBe(0);
    expect(response.calculationVersion).toBe('market-price-movement-v1');
    expect(response.filters).toEqual({
      since: '2026-07-16T00:00:00.000Z',
      minSamples: 4,
      thresholdPercent: 5,
    });
  });

  it('resolves active market anomaly alerts when re-evaluated history is no longer anomalous', async () => {
    const rows = [
      marketAlertInputRow('2026-07-16T00:00:00Z', 100),
      marketAlertInputRow('2026-07-16T01:00:00Z', 101),
      marketAlertInputRow('2026-07-16T02:00:00Z', 99),
      marketAlertInputRow('2026-07-16T03:00:00Z', 100),
      marketAlertInputRow('2026-07-16T04:00:00Z', 103),
    ];
    const executor = new SequencedExecutor([
      rows,
      [intelligenceAlertRow({
        status: 'resolved',
        metadata: {
          displayName: 'BTC',
          resolvedAt: '2026-07-17T02:00:00.000Z',
          resolutionReason: 'not_present_in_current_market_anomaly_refresh',
        },
      })],
    ]);

    const response = await new WorldStateService(executor).refreshMarketAnomalyAlerts({
      since: new Date('2026-07-16T00:00:00Z'),
      minSamples: 4,
      thresholdPercent: 5,
    }, new Date('2026-07-17T02:00:00Z'));

    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1]?.queryText).toContain("status = 'resolved'");
    expect(executor.calls[1]?.values[2]).toEqual([
      'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
    ]);
    expect(executor.calls[1]?.values[3]).toEqual([]);
    expect(response.alertsCreatedOrUpdated).toBe(0);
    expect(response.alertsResolved).toBe(1);
    expect(response.resolvedAlerts[0]).toMatchObject({
      status: 'resolved',
      alertKey: 'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
    });
  });

  it('loads coverage categories, sources and timeline with time filters', async () => {
    const executor = new SequencedExecutor([
      [coverageCategoryRow()],
      [coverageSourceRow()],
      [coverageTimelineRow()],
    ]);

    const response = await new WorldStateService(executor).getCoverage({
      since: new Date('2026-07-15T00:00:00Z'),
      until: new Date('2026-07-17T00:00:00Z'),
    }, new Date('2026-07-17T01:00:00Z'));

    expect(executor.calls[0]?.values).toEqual([
      new Date('2026-07-15T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
    ]);
    expect(executor.calls[0]?.queryText).toContain('GROUP BY category');
    expect(executor.calls[1]?.queryText).toContain('category_by_source');
    expect(executor.calls[2]?.queryText).toContain('combined AS');
    expect(response.categories[0]).toMatchObject({
      category: 'seismic',
      events: 12,
      sources: 1,
      bounds: { south: -35, west: 150, north: -30, east: 155 },
    });
    expect(response.sources[0]).toMatchObject({
      sourceId: 'usgs-earthquakes',
      events: 12,
      quotes: 0,
      rawObservations: 12,
      categories: { seismic: 12 },
    });
    expect(response.timeline[0]).toMatchObject({
      bucketStart: '2026-07-16T00:00:00.000Z',
      events: 12,
      rawObservations: 14,
      runs: 2,
    });
    expect(response.filters).toEqual({
      since: '2026-07-15T00:00:00.000Z',
      until: '2026-07-17T00:00:00.000Z',
    });
  });

  it('reports runtime readiness from migrations, sources, runs and archived raw evidence', async () => {
    const executor = new FakeExecutor([readinessRow()]);

    const response = await new WorldStateService(executor).getReadiness(new Date('2026-07-17T02:00:00Z'));

    expect(executor.calls[0]?.queryText).toContain('schema_migrations');
    expect(executor.calls[0]?.queryText).toContain('raw_observations');
    expect(response.generatedAt).toBe('2026-07-17T02:00:00.000Z');
    expect(response.status).toBe('ready');
    expect(response.summary).toMatchObject({
      expectedMigrations: 24,
      migrationsApplied: 24,
      latestMigration: '0024_evidence_chain_graph',
      sources: 24,
      activeSources: 24,
      runs: 12,
      rawObservations: 60,
      archivedRawObservations: 60,
      events: 42,
      latestRunStatus: 'succeeded',
    });
    expect(response.checks.map((check) => `${check.id}:${check.status}`)).toEqual([
      'migrations:ready',
      'sources:ready',
      'collector-runs:ready',
      'raw-archive:ready',
      'normalised-events:ready',
    ]);
    for (const check of response.checks) {
      expect(check.remediation).toEqual([]);
    }
  });

  it('reports not-ready runtime readiness before collectors produce data', async () => {
    const executor = new FakeExecutor([readinessRow({
      runs: 0,
      successful_runs: 0,
      raw_observations: 0,
      archived_raw_observations: 0,
      events: 0,
      latest_run_id: null,
      latest_run_status: null,
      latest_run_started_at: null,
      latest_run_completed_at: null,
      latest_raw_observed_at: null,
    })]);

    const response = await new WorldStateService(executor).getReadiness(new Date('2026-07-17T02:00:00Z'));

    expect(response.status).toBe('not_ready');
    expect(response.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'collector-runs', status: 'not_ready' }),
      expect.objectContaining({ id: 'raw-archive', status: 'not_ready' }),
      expect.objectContaining({ id: 'normalised-events', status: 'not_ready' }),
    ]));

    const runsCheck = response.checks.find((check) => check.id === 'collector-runs');
    expect(runsCheck?.remediation.join('\n')).toContain('ps collector');
    expect(runsCheck?.remediation.join('\n')).toContain('logs collector');
    expect(runsCheck?.remediation.join('\n')).toContain('COLLECT_ON_STARTUP=1');
    const eventsCheck = response.checks.find((check) => check.id === 'normalised-events');
    expect(eventsCheck?.remediation.join('\n')).toContain('resolve the collector-runs and raw-archive checks first');
  });

  it('returns migration remediation when the schema is not current', async () => {
    const executor = new FakeExecutor([readinessRow({
      migrations_applied: 0,
      latest_migration: null,
      latest_migration_applied_at: null,
    })]);

    const response = await new WorldStateService(executor).getReadiness(new Date('2026-07-17T02:00:00Z'));

    const migrationsCheck = response.checks.find((check) => check.id === 'migrations');
    expect(migrationsCheck?.status).toBe('not_ready');
    expect(migrationsCheck?.remediation.join('\n')).toContain('docker compose -f docker-compose.yml -f docker-compose.worldstate.yml run --rm migrate');
    expect(migrationsCheck?.remediation.join('\n')).toContain('0024_evidence_chain_graph');
  });

  it('returns archive remediation when raw observations are missing archive paths', async () => {
    const executor = new FakeExecutor([readinessRow({
      archived_raw_observations: 0,
    })]);

    const response = await new WorldStateService(executor).getReadiness(new Date('2026-07-17T02:00:00Z'));

    const archiveCheck = response.checks.find((check) => check.id === 'raw-archive');
    expect(archiveCheck?.status).toBe('not_ready');
    expect(archiveCheck?.remediation.join('\n')).toContain('run --rm archive-check');
    expect(archiveCheck?.remediation.join('\n')).toContain('RAW_ARCHIVE_HOST_PATH');
    expect(archiveCheck?.remediation.join('\n')).toContain('COLLECTOR_UID:COLLECTOR_GID');
  });

  it('loads collector diagnostics with sanitised endpoints and error payloads', async () => {
    const executor = new SequencedExecutor([
      [{
        source_id: 'openaq-latest-pm25',
        name: 'OpenAQ PM2.5',
        provider: 'OpenAQ',
        status: 'active',
        latest_failed_run_id: '550e8400-e29b-41d4-a716-446655440010',
        latest_failure_at: '2026-07-17T01:30:00Z',
        latest_http_status: 401,
        endpoint: 'https://user:hunter2@api.example.test/v2/latest?parameter=pm25&api_key=super-secret-key',
        archive_path: null,
        error: {
          name: 'HttpError',
          message: 'Request failed with status 401 for https://api.example.test/v2/latest?api_key=super-secret-key',
          apiKey: 'super-secret-key',
        },
        latest_run_status: 'failed',
        latest_run_started_at: '2026-07-17T01:30:00Z',
        recent_runs: 6,
        recent_failed_runs: 6,
      }],
      [{
        run_id: '550e8400-e29b-41d4-a716-446655440010',
        source_id: 'openaq-latest-pm25',
        source_name: 'OpenAQ PM2.5',
        provider: 'OpenAQ',
        started_at: '2026-07-17T01:30:00Z',
        completed_at: '2026-07-17T01:30:02Z',
        http_status: 401,
        endpoint: 'https://user:hunter2@api.example.test/v2/latest?parameter=pm25&api_key=super-secret-key',
        archive_path: '/archive/openaq/2026/07/17/failed.json.gz',
        record_count: null,
        error: { name: 'HttpError', message: 'Request failed with status 401', authorization: 'Bearer abc123' },
      }],
    ]);

    const response = await new WorldStateService(executor).getCollectorDiagnostics({}, new Date('2026-07-17T02:00:00Z'));

    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0]?.queryText).toContain("run.status = 'failed'");
    expect(response.filters).toEqual({ since: '2026-07-16T02:00:00.000Z', limit: 20 });

    const source = response.failingSources[0];
    expect(source).toMatchObject({
      sourceId: 'openaq-latest-pm25',
      recentRuns: 6,
      recentFailedRuns: 6,
      latestFailedRunId: '550e8400-e29b-41d4-a716-446655440010',
      latestHttpStatus: 401,
      latestFailureAt: '2026-07-17T01:30:00.000Z',
    });
    expect(source.endpoint).not.toContain('hunter2');
    expect(source.endpoint).not.toContain('super-secret-key');
    expect(source.endpoint).toContain('parameter=pm25');
    expect(source.endpoint).toContain('api_key=redacted');
    expect(source.error?.apiKey).toBe('[redacted]');
    expect(String(source.error?.message)).not.toContain('super-secret-key');

    const failure = response.recentFailures[0];
    expect(failure).toMatchObject({
      runId: '550e8400-e29b-41d4-a716-446655440010',
      sourceId: 'openaq-latest-pm25',
      httpStatus: 401,
      archivePath: '/archive/openaq/2026/07/17/failed.json.gz',
      startedAt: '2026-07-17T01:30:00.000Z',
    });
    expect(failure.endpoint).not.toContain('hunter2');
    expect(failure.error?.authorization).toBe('[redacted]');
  });

  it('clamps the collector diagnostics limit and forwards the since filter', async () => {
    const executor = new SequencedExecutor([[], []]);
    const since = new Date('2026-07-10T00:00:00Z');

    const response = await new WorldStateService(executor)
      .getCollectorDiagnostics({ since, limit: 5000 }, new Date('2026-07-17T02:00:00Z'));

    expect(response.filters).toEqual({ since: '2026-07-10T00:00:00.000Z', limit: 100 });
    expect(executor.calls[0]?.values).toEqual([since]);
    expect(executor.calls[1]?.values).toEqual([since, 100]);
    expect(response.failingSources).toEqual([]);
    expect(response.recentFailures).toEqual([]);
  });

  it('returns normaliser remediation when raw observations exist without events', async () => {
    const executor = new FakeExecutor([readinessRow({
      events: 0,
    })]);

    const response = await new WorldStateService(executor).getReadiness(new Date('2026-07-17T02:00:00Z'));

    expect(response.status).toBe('degraded');
    const eventsCheck = response.checks.find((check) => check.id === 'normalised-events');
    expect(eventsCheck?.status).toBe('degraded');
    expect(eventsCheck?.remediation.join('\n')).toContain('/api/v1/runs?status=failed');
    expect(eventsCheck?.remediation.join('\n')).toContain('logs collector');
  });

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

function operationsTotalsRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    sources: 2,
    active_sources: 2,
    runs: 10,
    successful_runs: 8,
    failed_runs: 2,
    raw_observations: 50,
    latest_run_started_at: '2026-07-16T03:00:00Z',
    latest_run_completed_at: '2026-07-16T03:00:04Z',
    ...overrides,
  };
}

function operationsSourceHealthRow(): QueryResultRow {
  return {
    source_id: 'usgs-earthquakes',
    name: 'USGS Earthquakes',
    provider: 'USGS',
    status: 'active',
    latest_run_id: '550e8400-e29b-41d4-a716-446655440002',
    latest_run_status: 'succeeded',
    latest_run_started_at: '2026-07-16T03:00:00Z',
    latest_run_completed_at: '2026-07-16T03:00:04Z',
    latest_run_error: null,
    runs: 10,
    successful_runs: 8,
    failed_runs: 2,
    raw_observations: 50,
  };
}

function operationsAlertRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    source_id: 'usgs-earthquakes',
    name: 'USGS Earthquakes',
    provider: 'USGS',
    status: 'active',
    latest_run_id: '550e8400-e29b-41d4-a716-446655440002',
    latest_run_status: 'succeeded',
    latest_run_started_at: '2026-07-16T03:00:00Z',
    latest_run_completed_at: '2026-07-16T03:00:04Z',
    latest_run_error: null,
    runs: 10,
    successful_runs: 8,
    failed_runs: 2,
    recent_runs: 1,
    recent_failed_runs: 0,
    recent_raw_observations: 5,
    ...overrides,
  };
}

function intelligenceAlertRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: '550e8400-e29b-41d4-a716-446655440101',
    alert_key: 'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
    kind: 'market_price_movement',
    severity: 'critical',
    status: 'active',
    source_id: 'coingecko-simple-price',
    source_name: 'CoinGecko Simple Price BTC ETH SOL USD',
    provider: 'CoinGecko',
    entity_type: 'crypto_asset',
    entity_id: 'bitcoin',
    title: 'BTC price moved 30% above baseline',
    detail: 'BTC latest price 130 USD is 30% above the 4-sample median 100 USD.',
    detected_at: '2026-07-16T04:00:00Z',
    window_start: '2026-07-16T00:00:00Z',
    window_end: '2026-07-16T04:00:00Z',
    evidence_classification: 'derived',
    method: 'median-baseline-percent-move-with-mad-context',
    calculation_version: 'market-price-movement-v1',
    thresholds: { minSamples: 4, thresholdPercent: 5 },
    input_window: { baselineSamples: 4, movementPercent: 30 },
    evidence: { latestRawObservationId: '550e8400-e29b-41d4-a716-446655440201' },
    explanation: 'Derived from observed price history using a median baseline.',
    explanation_status: 'unexplained',
    metadata: { displayName: 'BTC' },
    raw_observation_id: '550e8400-e29b-41d4-a716-446655440201',
    collection_run_id: '550e8400-e29b-41d4-a716-446655440301',
    archive_path: 'archive/coingecko.json.gz',
    content_hash: 'd'.repeat(64),
    ...overrides,
  };
}

function evidenceEdgeRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: '550e8400-e29b-41d4-a716-446655440901',
    edge_key: 'edge:test:1',
    relation_type: 'supported_by',
    source_id: 'gdacs-disasters',
    source_name: 'GDACS Disaster Alerts',
    provider: 'GDACS',
    effective_from: '2026-07-16T00:00:00Z',
    effective_to: null,
    confidence: 0.92,
    evidence_classification: 'reported',
    derivation_method: 'fixture_test_link',
    validation_date: '2026-07-17',
    metadata: { fixture: true },
    raw_observation_id: '550e8400-e29b-41d4-a716-446655440201',
    collection_run_id: '550e8400-e29b-41d4-a716-446655440301',
    archive_path: 'archive/gdacs.xml.gz',
    content_hash: 'e'.repeat(64),
    from_node_id: '550e8400-e29b-41d4-a716-446655440911',
    from_node_key: 'alert:gdacs:1',
    from_node_type: 'alert',
    from_source_id: 'gdacs-disasters',
    from_external_id: 'gdacs-1',
    from_label: 'GDACS alert 1',
    from_evidence_classification: 'reported',
    from_metadata: { severity: 'orange' },
    to_node_id: '550e8400-e29b-41d4-a716-446655440912',
    to_node_key: 'raw:gdacs:1',
    to_node_type: 'raw_observation',
    to_source_id: 'gdacs-disasters',
    to_external_id: 'raw-1',
    to_label: 'GDACS raw payload 1',
    to_evidence_classification: 'observed',
    to_metadata: { archivePath: 'archive/gdacs.xml.gz' },
    ...overrides,
  };
}

function marketAlertInputRow(observedAt: string, price: number, overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    id: `history-${observedAt}`,
    source_id: 'coingecko-simple-price',
    source_name: 'CoinGecko Simple Price BTC ETH SOL USD',
    provider: 'CoinGecko',
    entity_type: 'crypto_asset',
    entity_id: 'bitcoin',
    display_name: 'BTC',
    observed_at: observedAt,
    price,
    currency: 'usd',
    raw_observation_id: '550e8400-e29b-41d4-a716-446655440201',
    collection_run_id: '550e8400-e29b-41d4-a716-446655440301',
    archive_path: 'archive/coingecko.json.gz',
    content_hash: 'd'.repeat(64),
    ...overrides,
  };
}

function coverageCategoryRow(): QueryResultRow {
  return {
    category: 'seismic',
    events: 12,
    sources: 1,
    earliest_occurred_at: '2026-07-15T01:00:00Z',
    latest_occurred_at: '2026-07-16T01:00:00Z',
    latest_observed_at: '2026-07-16T01:01:00Z',
    south: -35,
    west: 150,
    north: -30,
    east: 155,
  };
}

function coverageSourceRow(): QueryResultRow {
  return {
    source_id: 'usgs-earthquakes',
    name: 'USGS Earthquakes',
    provider: 'USGS',
    events: 12,
    quotes: 0,
    raw_observations: 12,
    latest_event_at: '2026-07-16T01:00:00Z',
    latest_quote_at: null,
    latest_raw_observed_at: '2026-07-16T01:01:00Z',
    category_counts: { seismic: 12 },
  };
}

function coverageTimelineRow(): QueryResultRow {
  return {
    bucket_start: '2026-07-16T00:00:00Z',
    events: 12,
    raw_observations: 14,
    runs: 2,
  };
}

describe('collector diagnostics sanitisation', () => {
  it('redacts URL credentials and sensitive query values while keeping benign parameters', () => {
    const sanitised = sanitiseCollectorEndpoint('https://user:pass@example.test/feed?symbols=RTX,LMT&apikey=abc&access_token=def');
    expect(sanitised).not.toContain('user:pass');
    expect(sanitised).not.toContain('abc');
    expect(sanitised).not.toContain('def');
    expect(sanitised).toContain('symbols=RTX%2CLMT');
    expect(sanitised).toContain('apikey=redacted');
    expect(sanitised).toContain('access_token=redacted');
  });

  it('returns non-URL endpoint text unchanged', () => {
    expect(sanitiseCollectorEndpoint('not a url')).toBe('not a url');
  });

  it('redacts sensitive keys, sanitises embedded URLs and truncates long strings in error payloads', () => {
    const sanitised = sanitiseCollectorError({
      message: 'fetch failed for https://example.test/data?token=secret-value',
      code: 'ECONNRESET',
      requestKey: 'secret-value',
      nested: { Authorization: 'Bearer zzz', detail: 'x'.repeat(600) },
      attempts: [1, 2, 3],
    });
    expect(String(sanitised?.message)).not.toContain('secret-value');
    expect(String(sanitised?.message)).toContain('token=redacted');
    expect(sanitised?.code).toBe('ECONNRESET');
    expect(sanitised?.requestKey).toBe('[redacted]');
    const nested = sanitised?.nested as Record<string, unknown>;
    expect(nested.Authorization).toBe('[redacted]');
    expect(String(nested.detail).length).toBeLessThanOrEqual(501);
    expect(sanitised?.attempts).toEqual([1, 2, 3]);
  });

  it('returns null for non-object error payloads', () => {
    expect(sanitiseCollectorError(null)).toBeNull();
    expect(sanitiseCollectorError('boom')).toBeNull();
    expect(sanitiseCollectorError(['a'])).toBeNull();
  });
});

function readinessRow(overrides: Partial<QueryResultRow> = {}): QueryResultRow {
  return {
    migrations_applied: 24,
    latest_migration: '0024_evidence_chain_graph',
    latest_migration_applied_at: '2026-07-16T00:00:00Z',
    sources: 24,
    active_sources: 24,
    runs: 12,
    successful_runs: 11,
    failed_runs: 1,
    running_runs: 0,
    raw_observations: 60,
    archived_raw_observations: 60,
    events: 42,
    latest_run_id: '550e8400-e29b-41d4-a716-446655440002',
    latest_run_status: 'succeeded',
    latest_run_started_at: '2026-07-17T01:00:00Z',
    latest_run_completed_at: '2026-07-17T01:00:04Z',
    latest_raw_observed_at: '2026-07-17T01:00:03Z',
    ...overrides,
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
