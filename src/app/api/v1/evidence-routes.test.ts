import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  listAlerts: vi.fn(),
  refreshMarketAnomalyAlerts: vi.fn(),
  listEvidenceEdges: vi.fn(),
  listNotificationOutbox: vi.fn(),
  enqueueAlertNotifications: vi.fn(),
  listSourceDiscoveryCandidates: vi.fn(),
  createSourceDiscoveryCandidate: vi.fn(),
  runTelegramNotificationDelivery: vi.fn(),
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
    listAlerts: mocks.listAlerts,
    refreshMarketAnomalyAlerts: mocks.refreshMarketAnomalyAlerts,
    listEvidenceEdges: mocks.listEvidenceEdges,
    listNotificationOutbox: mocks.listNotificationOutbox,
    enqueueAlertNotifications: mocks.enqueueAlertNotifications,
    listSourceDiscoveryCandidates: mocks.listSourceDiscoveryCandidates,
    createSourceDiscoveryCandidate: mocks.createSourceDiscoveryCandidate,
    getCoverage: mocks.getCoverage,
    getReadiness: mocks.getReadiness,
    getCollectorDiagnostics: mocks.getCollectorDiagnostics,
  })),
}));

vi.mock('@/lib/worldstate/telegram-notifier', () => ({
  runTelegramNotificationDelivery: mocks.runTelegramNotificationDelivery,
}));

import { GET as getCoverage } from './coverage/route';
import { GET as getAlerts, POST as refreshAlerts } from './alerts/route';
import { GET as getEvidence } from './evidence/route';
import { GET as getNotificationOutbox, POST as enqueueNotifications } from './notifications/outbox/route';
import { POST as deliverTelegramNotifications } from './notifications/telegram/deliver/route';
import { GET as getOperationsAlerts } from './operations/alerts/route';
import { GET as getCollectorDiagnostics } from './operations/diagnostics/route';
import { GET as getOperationsSummary } from './operations/summary/route';
import { GET as getReadiness } from './readiness/route';
import { GET as getSourceDiscovery, POST as createSourceDiscoveryCandidate } from './source-discovery/route';
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
    mocks.listAlerts.mockReset();
    mocks.refreshMarketAnomalyAlerts.mockReset();
    mocks.listEvidenceEdges.mockReset();
    mocks.listNotificationOutbox.mockReset();
    mocks.enqueueAlertNotifications.mockReset();
    mocks.listSourceDiscoveryCandidates.mockReset();
    mocks.createSourceDiscoveryCandidate.mockReset();
    mocks.runTelegramNotificationDelivery.mockReset();
    mocks.getCoverage.mockReset();
    mocks.getReadiness.mockReset();
    mocks.getCollectorDiagnostics.mockReset();
    mocks.getWorldStateDatabase.mockReturnValue(mocks.database);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('returns intelligence alerts with parsed filters', async () => {
    mocks.listAlerts.mockResolvedValue({
      alerts: [{ id: '550e8400-e29b-41d4-a716-446655440101', kind: 'market_price_movement', severity: 'critical' }],
      page: { limit: 10, returned: 1, nextCursor: null },
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: {
        since: '2026-07-16T00:00:00.000Z',
        statuses: ['active'],
        severities: ['critical'],
        kinds: ['market_price_movement'],
      },
    });

    const response = await getAlerts(requestFor('/api/v1/alerts?since=2026-07-16T00:00:00Z&status=active&severity=critical&kind=market_price_movement&limit=10&cursor=20'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listAlerts).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
      statuses: ['active'],
      severities: ['critical'],
      kinds: ['market_price_movement'],
      limit: 10,
      cursor: '20',
    });
    await expect(response.json()).resolves.toMatchObject({
      alerts: [{ kind: 'market_price_movement', severity: 'critical' }],
    });
  });

  it('refreshes intelligence alerts with parsed market anomaly thresholds', async () => {
    mocks.refreshMarketAnomalyAlerts.mockResolvedValue({
      alertsCreatedOrUpdated: 1,
      alertsResolved: 0,
      alerts: [{ id: '550e8400-e29b-41d4-a716-446655440101', kind: 'market_price_movement' }],
      resolvedAlerts: [],
      generatedAt: '2026-07-17T00:00:00.000Z',
      calculationVersion: 'market-price-movement-v1',
      filters: {
        since: '2026-07-16T00:00:00.000Z',
        minSamples: 4,
        thresholdPercent: 5,
      },
    });

    const response = await refreshAlerts(requestFor('/api/v1/alerts?since=2026-07-16T00:00:00Z&min_samples=4&threshold_percent=5'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.refreshMarketAnomalyAlerts).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
      minSamples: 4,
      thresholdPercent: 5,
    });
    await expect(response.json()).resolves.toMatchObject({
      alertsCreatedOrUpdated: 1,
      alertsResolved: 0,
      calculationVersion: 'market-price-movement-v1',
    });
  });

  it('returns evidence graph edges with parsed filters', async () => {
    mocks.listEvidenceEdges.mockResolvedValue({
      edges: [{
        id: '550e8400-e29b-41d4-a716-446655440901',
        edgeKey: 'edge:test',
        relationType: 'supported_by',
        sourceId: 'gdacs-disasters',
        from: { nodeKey: 'alert:gdacs:1' },
        to: { nodeKey: 'raw:gdacs:1' },
      }],
      page: { limit: 10, returned: 1, nextCursor: null },
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: {
        nodeKey: 'alert:gdacs:1',
        fromNodeKey: null,
        toNodeKey: null,
        relationTypes: ['supported_by'],
        sourceIds: ['gdacs-disasters'],
        evidenceClassifications: ['reported'],
      },
    });

    const response = await getEvidence(requestFor('/api/v1/evidence?node_key=alert:gdacs:1&relation_type=supported_by&source_id=gdacs-disasters&classification=reported&limit=10&cursor=20'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listEvidenceEdges).toHaveBeenCalledWith({
      nodeKey: 'alert:gdacs:1',
      fromNodeKey: undefined,
      toNodeKey: undefined,
      relationTypes: ['supported_by'],
      sourceIds: ['gdacs-disasters'],
      evidenceClassifications: ['reported'],
      limit: 10,
      cursor: '20',
    });
    await expect(response.json()).resolves.toMatchObject({
      edges: [{ relationType: 'supported_by', sourceId: 'gdacs-disasters' }],
    });
  });

  it('returns notification outbox rows with parsed filters', async () => {
    mocks.listNotificationOutbox.mockResolvedValue({
      notifications: [{
        id: '550e8400-e29b-41d4-a716-446655441001',
        outboxKey: 'notification:ops:alert:1:market_price_movement',
        status: 'pending',
        adapter: 'telegram',
        topic: 'market_price_movement',
        severity: 'critical',
      }],
      page: { limit: 5, returned: 1, nextCursor: null },
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: {
        statuses: ['pending'],
        adapters: ['telegram'],
        topics: ['market_price_movement'],
        severities: ['critical'],
        since: '2026-07-16T00:00:00.000Z',
      },
    });

    const response = await getNotificationOutbox(requestFor('/api/v1/notifications/outbox?status=pending&adapter=telegram&topic=market_price_movement&severity=critical&since=2026-07-16T00:00:00Z&limit=5&cursor=10'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listNotificationOutbox).toHaveBeenCalledWith({
      statuses: ['pending'],
      adapters: ['telegram'],
      topics: ['market_price_movement'],
      severities: ['critical'],
      since: new Date('2026-07-16T00:00:00Z'),
      limit: 5,
      cursor: '10',
    });
    await expect(response.json()).resolves.toMatchObject({
      notifications: [{ status: 'pending', adapter: 'telegram' }],
    });
  });

  it('enqueues alert notifications with parsed filters', async () => {
    mocks.enqueueAlertNotifications.mockResolvedValue({
      notificationsCreated: 1,
      notifications: [{
        id: '550e8400-e29b-41d4-a716-446655441001',
        outboxKey: 'notification:ops:alert:1:market_price_movement',
        status: 'pending',
      }],
      generatedAt: '2026-07-17T00:00:00.000Z',
      filters: {
        since: '2026-07-16T00:00:00.000Z',
        adapters: ['telegram'],
        kinds: ['market_price_movement'],
        severities: ['warning'],
      },
    });

    const response = await enqueueNotifications(requestFor('/api/v1/notifications/outbox?adapter=telegram&kind=market_price_movement&severity=warning&since=2026-07-16T00:00:00Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.enqueueAlertNotifications).toHaveBeenCalledWith({
      since: new Date('2026-07-16T00:00:00Z'),
      adapters: ['telegram'],
      kinds: ['market_price_movement'],
      severities: ['warning'],
    });
    await expect(response.json()).resolves.toMatchObject({
      notificationsCreated: 1,
      notifications: [{ status: 'pending' }],
    });
  });

  it('returns source discovery candidates with parsed filters', async () => {
    mocks.listSourceDiscoveryCandidates.mockResolvedValue({
      candidates: [{
        id: '550e8400-e29b-41d4-a716-446655442001',
        candidateKey: 'source-discovery:noaa:abc123',
        title: 'NOAA Storm Events',
        provider: 'NOAA',
        endpointUrl: 'https://www.ncei.noaa.gov/stormevents/csv',
        costClass: 'free',
        status: 'candidate',
      }],
      page: { limit: 20, returned: 1, nextCursor: null },
      generatedAt: '2026-07-18T00:00:00.000Z',
      filters: {
        statuses: ['candidate'],
        providers: ['NOAA'],
        costClasses: ['free'],
      },
    });

    const response = await getSourceDiscovery(requestFor('/api/v1/source-discovery?status=candidate&provider=NOAA&cost_class=free&limit=20&cursor=40'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.listSourceDiscoveryCandidates).toHaveBeenCalledWith({
      statuses: ['candidate'],
      providers: ['NOAA'],
      costClasses: ['free'],
      limit: 20,
      cursor: '40',
    });
    await expect(response.json()).resolves.toMatchObject({
      candidates: [{ provider: 'NOAA', status: 'candidate', costClass: 'free' }],
    });
  });

  it('creates source discovery candidates when the write token is valid', async () => {
    vi.stubEnv('WORLDSTATE_SOURCE_DISCOVERY_TOKEN', 'source-secret');
    mocks.createSourceDiscoveryCandidate.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655442001',
      candidateKey: 'source-discovery:noaa:abc123',
      title: 'NOAA Storm Events',
      provider: 'NOAA',
      endpointUrl: 'https://www.ncei.noaa.gov/stormevents/csv',
      documentationUrl: 'https://www.ncei.noaa.gov/products/storm-events',
      termsUrl: null,
      licence: 'Public domain',
      costClass: 'free',
      accessMethod: 'https_csv',
      status: 'candidate',
      evidenceClassification: 'reported',
      discoveredAt: '2026-07-18T00:00:00.000Z',
      lastReviewedAt: null,
      reviewedBy: null,
      rationale: 'Official NOAA historical severe-weather event feed.',
      metadata: { domain: 'weather' },
    });

    const response = await createSourceDiscoveryCandidate(requestFor('/api/v1/source-discovery', {
      authorization: 'Bearer source-secret',
    }, {
      title: 'NOAA Storm Events',
      provider: 'NOAA',
      endpointUrl: 'https://www.ncei.noaa.gov/stormevents/csv',
      documentationUrl: 'https://www.ncei.noaa.gov/products/storm-events',
      licence: 'Public domain',
      costClass: 'free',
      accessMethod: 'https_csv',
      rationale: 'Official NOAA historical severe-weather event feed.',
      metadata: { domain: 'weather' },
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.createSourceDiscoveryCandidate).toHaveBeenCalledWith({
      title: 'NOAA Storm Events',
      provider: 'NOAA',
      endpointUrl: 'https://www.ncei.noaa.gov/stormevents/csv',
      documentationUrl: 'https://www.ncei.noaa.gov/products/storm-events',
      termsUrl: null,
      licence: 'Public domain',
      costClass: 'free',
      accessMethod: 'https_csv',
      status: undefined,
      evidenceClassification: undefined,
      rationale: 'Official NOAA historical severe-weather event feed.',
      metadata: { domain: 'weather' },
    });
    await expect(response.json()).resolves.toMatchObject({
      candidate: { provider: 'NOAA', status: 'candidate' },
    });
  });

  it('fails closed when source discovery writes are not configured', async () => {
    const response = await createSourceDiscoveryCandidate(requestFor('/api/v1/source-discovery'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'World-State source discovery writes are not configured',
    });
    expect(mocks.getWorldStateDatabase).not.toHaveBeenCalled();
    expect(mocks.createSourceDiscoveryCandidate).not.toHaveBeenCalled();
  });

  it('rejects source discovery writes with an invalid bearer token', async () => {
    vi.stubEnv('WORLDSTATE_SOURCE_DISCOVERY_TOKEN', 'source-secret');

    const response = await createSourceDiscoveryCandidate(requestFor('/api/v1/source-discovery', {
      authorization: 'Bearer wrong-secret',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' });
    expect(mocks.getWorldStateDatabase).not.toHaveBeenCalled();
    expect(mocks.createSourceDiscoveryCandidate).not.toHaveBeenCalled();
  });

  it('rejects source discovery writes with credential-bearing URLs', async () => {
    vi.stubEnv('WORLDSTATE_SOURCE_DISCOVERY_TOKEN', 'source-secret');

    const response = await createSourceDiscoveryCandidate(requestFor('/api/v1/source-discovery', {
      authorization: 'Bearer source-secret',
    }, {
      title: 'Unsafe source',
      provider: 'Example',
      endpointUrl: 'https://user:secret@example.test/feed.json',
      accessMethod: 'https_json',
      rationale: 'Should be rejected before persistence.',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'endpointUrl must not include credentials',
    });
    expect(mocks.createSourceDiscoveryCandidate).not.toHaveBeenCalled();
  });

  it('delivers Telegram notifications when the delivery trigger token is valid', async () => {
    vi.stubEnv('WORLDSTATE_TELEGRAM_DELIVERY_TOKEN', 'deliver-secret');
    mocks.runTelegramNotificationDelivery.mockResolvedValue({
      status: 'delivered',
      notificationsClaimed: 1,
      notificationsSent: 1,
      notificationsFailed: 0,
      dryRun: false,
      generatedAt: '2026-07-18T00:00:00.000Z',
    });

    const response = await deliverTelegramNotifications(requestFor('/api/v1/notifications/telegram/deliver', {
      authorization: 'Bearer deliver-secret',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.runTelegramNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      service: expect.any(Object),
      fetcher: expect.any(Function),
    }));
    await expect(response.json()).resolves.toMatchObject({
      status: 'delivered',
      notificationsSent: 1,
    });
  });

  it('fails closed when Telegram delivery trigger token is not configured', async () => {
    const response = await deliverTelegramNotifications(requestFor('/api/v1/notifications/telegram/deliver'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Telegram notification delivery is not configured',
    });
    expect(mocks.getWorldStateDatabase).not.toHaveBeenCalled();
    expect(mocks.runTelegramNotificationDelivery).not.toHaveBeenCalled();
  });

  it('rejects Telegram delivery trigger requests with an invalid bearer token', async () => {
    vi.stubEnv('WORLDSTATE_TELEGRAM_DELIVERY_TOKEN', 'deliver-secret');

    const response = await deliverTelegramNotifications(requestFor('/api/v1/notifications/telegram/deliver', {
      authorization: 'Bearer wrong-secret',
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' });
    expect(mocks.getWorldStateDatabase).not.toHaveBeenCalled();
    expect(mocks.runTelegramNotificationDelivery).not.toHaveBeenCalled();
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

  it('returns 503 from source discovery when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getSourceDiscovery(requestFor('/api/v1/source-discovery'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      candidates: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.listSourceDiscoveryCandidates).not.toHaveBeenCalled();
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
      checks: [{ id: 'migrations', label: 'Database migrations', status: 'ready', detail: '27/27 migrations applied.' }],
      summary: {
        expectedMigrations: 27,
        migrationsApplied: 27,
        latestMigration: '0027_source_discovery_candidates',
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
        migrationsApplied: 27,
        latestMigration: '0027_source_discovery_candidates',
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

  it('returns 503 from intelligence alerts when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getAlerts(requestFor('/api/v1/alerts'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      alerts: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.listAlerts).not.toHaveBeenCalled();
  });

  it('returns 503 from intelligence alert refresh when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await refreshAlerts(requestFor('/api/v1/alerts'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      alertsCreatedOrUpdated: 0,
      alertsResolved: 0,
      alerts: [],
      resolvedAlerts: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.refreshMarketAnomalyAlerts).not.toHaveBeenCalled();
  });

  it('returns 503 from evidence graph when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getEvidence(requestFor('/api/v1/evidence'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      edges: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.listEvidenceEdges).not.toHaveBeenCalled();
  });

  it('returns 503 from notification outbox when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await getNotificationOutbox(requestFor('/api/v1/notifications/outbox'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      notifications: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.listNotificationOutbox).not.toHaveBeenCalled();
  });

  it('returns 503 from notification enqueue when the World-State database is not configured', async () => {
    mocks.getWorldStateDatabase.mockReturnValue(null);

    const response = await enqueueNotifications(requestFor('/api/v1/notifications/outbox'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      notificationsCreated: 0,
      notifications: [],
      error: 'World-State database is not configured',
    });
    expect(mocks.enqueueAlertNotifications).not.toHaveBeenCalled();
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

function requestFor(path: string, headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return {
    headers: new Headers(headers),
    json: async () => body,
    nextUrl: new URL(path, 'http://localhost:3000'),
  } as NextRequest;
}
