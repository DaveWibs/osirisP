'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const WorldStateMap = dynamic(() => import('@/components/WorldStateMap'), { ssr: false });

type EventCategory = 'seismic' | 'disaster' | 'fire' | 'weather' | 'air_quality' | 'internet_outage' | 'aviation';
type RunStatusFilter = 'all' | 'succeeded' | 'failed';

interface SourceSummary {
  sourceId: string;
  name: string;
  provider: string;
  description?: string | null;
  accessMethod?: string;
  costClass?: string;
  licence?: string | null;
  termsUrl?: string | null;
  documentationUrl?: string | null;
  status: string;
  latestRun: {
    id?: string | null;
    status: string | null;
    startedAt?: string | null;
    completedAt: string | null;
    responseReceivedAt?: string | null;
    upstreamTimestamp?: string | null;
    recordCount: number | null;
    archivePath: string | null;
    error?: Record<string, unknown> | null;
  };
  totals: {
    runs: number;
    successes: number;
    failures: number;
    rawObservations: number;
  };
}

interface WorldEvent {
  id: string;
  category: EventCategory;
  eventType: string;
  sourceId: string;
  sourceName: string;
  provider: string;
  title: string;
  description: string | null;
  occurredAt: string;
  observedAt: string | null;
  severity: string | null;
  point: { lat: number; lon: number };
  evidenceClassification: string;
  facts: Record<string, unknown>;
  raw: {
    rawObservationId: string;
    collectionRunId: string | null;
    archivePath: string | null;
    contentHash: string | null;
  };
}

interface RawObservation {
  id: string;
  sourceId: string;
  collectionRunId: string;
  sourceRecordId: string | null;
  observedAt: string;
  occurredAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
  archivePath: string;
  payload: unknown;
  schemaVersion: number;
  parserVersion: string;
  evidenceClassification: string;
  metadata: Record<string, unknown>;
}

interface CollectionRun {
  id: string;
  sourceId: string;
  startedAt: string;
  requestStartedAt: string | null;
  responseReceivedAt: string | null;
  completedAt: string | null;
  upstreamTimestamp: string | null;
  retryNotBefore: string | null;
  status: string;
  endpoint: string;
  httpStatus: number | null;
  contentType: string | null;
  contentHash: string | null;
  archivePath: string | null;
  responseHeaders: Record<string, unknown>;
  recordCount: number | null;
  collectorVersion: string;
  parserVersion: string | null;
  legacyProvenanceIncomplete: boolean;
  error: Record<string, unknown> | null;
  metrics: Record<string, unknown>;
}

interface RawEvidencePayload {
  rawObservation: RawObservation | null;
  collectionRun: CollectionRun | null;
  generatedAt: string;
  error?: string;
}

interface RunEvidencePayload {
  collectionRun: CollectionRun | null;
  rawObservationCount: number;
  generatedAt: string;
  error?: string;
}

interface CollectionRunListItem extends CollectionRun {
  rawObservationCount: number;
}

interface CollectionRunSummary extends CollectionRunListItem {
  sourceName: string;
  provider: string;
}

interface RawObservationSummary {
  id: string;
  sourceId: string;
  sourceName: string;
  provider: string;
  collectionRunId: string;
  sourceRecordId: string | null;
  observedAt: string;
  occurredAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
  archivePath: string;
  schemaVersion: number;
  parserVersion: string;
  evidenceClassification: string;
  metadata: Record<string, unknown>;
}

interface SourceDetailPayload {
  source: SourceSummary | null;
  recentEvents: WorldEvent[];
  recentQuotes: MarketQuote[];
  generatedAt: string;
  error?: string;
}

interface SourceRunsPayload {
  runs: CollectionRunListItem[];
  page: { limit: number; returned: number; nextCursor: string | null };
  generatedAt: string;
  filters: { sourceId: string };
  error?: string;
}

interface RunsPayload {
  runs: CollectionRunSummary[];
  page: { limit: number; returned: number; nextCursor: string | null };
  generatedAt: string;
  filters: {
    sourceIds: string[];
    statuses: string[];
    since: string | null;
    until: string | null;
  };
  error?: string;
}

interface RunRawPayload {
  rawObservations: RawObservationSummary[];
  page: { limit: number; returned: number; nextCursor: string | null };
  generatedAt: string;
  filters: { collectionRunId: string };
  error?: string;
}

interface OperationsTotals {
  sources: number;
  activeSources: number;
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  rawObservations: number;
  latestRunStartedAt: string | null;
  latestRunCompletedAt: string | null;
}

interface OperationsSourceHealth {
  sourceId: string;
  name: string;
  provider: string;
  status: string;
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunStartedAt: string | null;
  latestRunCompletedAt: string | null;
  latestRunError: Record<string, unknown> | null;
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  rawObservations: number;
  successRate: number | null;
}

interface OperationsSummaryPayload {
  totals: OperationsTotals;
  recent: OperationsTotals & { since: string };
  statusBreakdown: Array<{ status: string; count: number }>;
  sourceHealth: OperationsSourceHealth[];
  generatedAt: string;
  error?: string;
}

interface OperationsAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  kind: 'source_failed' | 'source_stale' | 'low_success_rate' | 'no_recent_raw';
  title: string;
  detail: string;
  sourceId: string;
  sourceName: string;
  provider: string;
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunStartedAt: string | null;
  latestRunCompletedAt: string | null;
  latestRunError: Record<string, unknown> | null;
  successRate: number | null;
  recentRuns: number;
  recentFailures: number;
  recentRawObservations: number;
}

interface OperationsAlertsPayload {
  alerts: OperationsAlert[];
  generatedAt: string;
  filters: { since: string };
  error?: string;
}

interface CoverageBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface CoverageCategory {
  category: EventCategory;
  events: number;
  sources: number;
  earliestOccurredAt: string | null;
  latestOccurredAt: string | null;
  latestObservedAt: string | null;
  bounds: CoverageBounds | null;
}

interface CoverageSource {
  sourceId: string;
  name: string;
  provider: string;
  events: number;
  quotes: number;
  rawObservations: number;
  latestEventAt: string | null;
  latestQuoteAt: string | null;
  latestRawObservedAt: string | null;
  categories: Partial<Record<EventCategory, number>>;
}

interface CoverageTimelineBucket {
  bucketStart: string;
  events: number;
  rawObservations: number;
  runs: number;
}

interface CoveragePayload {
  categories: CoverageCategory[];
  sources: CoverageSource[];
  timeline: CoverageTimelineBucket[];
  generatedAt: string;
  filters: {
    since: string | null;
    until: string | null;
  };
  error?: string;
}

interface MarketQuote {
  id: string;
  symbol: string;
  displayName: string;
  quoteType: string;
  provider: string;
  price: number;
  changePercent: number;
  up: boolean;
  observedAt: string;
  raw: { archivePath: string | null };
}

interface EventsPayload {
  events: WorldEvent[];
  page: { limit: number; returned: number; nextCursor: string | null };
  generatedAt: string;
  error?: string;
}

interface SourcesPayload {
  sources: SourceSummary[];
  generatedAt: string;
  error?: string;
}

interface QuotesPayload {
  quotes: MarketQuote[];
  generatedAt: string;
  error?: string;
}

interface WorldStateSnapshot {
  sourcePayload: SourcesPayload;
  eventPayload: EventsPayload;
  quotePayload: QuotesPayload;
  runPayload: RunsPayload;
  operationsPayload: OperationsSummaryPayload;
  operationsAlertsPayload: OperationsAlertsPayload;
  coveragePayload: CoveragePayload;
}

const CATEGORIES: Array<{ id: EventCategory; label: string; color: string }> = [
  { id: 'seismic', label: 'Seismic', color: '#ff9500' },
  { id: 'disaster', label: 'Disaster', color: '#ff3d3d' },
  { id: 'fire', label: 'Fire', color: '#ff6b00' },
  { id: 'weather', label: 'Weather', color: '#e040fb' },
  { id: 'air_quality', label: 'Air', color: '#00e676' },
  { id: 'internet_outage', label: 'Outage', color: '#448aff' },
  { id: 'aviation', label: 'Aviation', color: '#00e5ff' },
];

const WINDOWS = [
  { label: '24h', value: 24 },
  { label: '72h', value: 72 },
  { label: '7d', value: 168 },
  { label: '30d', value: 720 },
];

const RUN_STATUS_FILTERS: Array<{ label: string; value: RunStatusFilter }> = [
  { label: 'All runs', value: 'all' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Failed', value: 'failed' },
];

export default function WorldStatePage() {
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>(['seismic', 'disaster', 'fire', 'weather', 'internet_outage', 'aviation']);
  const [windowHours, setWindowHours] = useState(72);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [runs, setRuns] = useState<CollectionRunSummary[]>([]);
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummaryPayload | null>(null);
  const [operationsAlerts, setOperationsAlerts] = useState<OperationsAlertsPayload | null>(null);
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>('all');
  const [rawEvidence, setRawEvidence] = useState<RawEvidencePayload | null>(null);
  const [runEvidence, setRunEvidence] = useState<RunEvidencePayload | null>(null);
  const [rawEvidenceLoading, setRawEvidenceLoading] = useState(false);
  const [rawEvidenceError, setRawEvidenceError] = useState('');
  const [operationRunEvidence, setOperationRunEvidence] = useState<RunEvidencePayload | null>(null);
  const [operationRunRaw, setOperationRunRaw] = useState<RunRawPayload | null>(null);
  const [operationRunLoading, setOperationRunLoading] = useState(false);
  const [operationRunError, setOperationRunError] = useState('');
  const [sourceDetail, setSourceDetail] = useState<SourceDetailPayload | null>(null);
  const [sourceRuns, setSourceRuns] = useState<SourceRunsPayload | null>(null);
  const [sourceDetailLoading, setSourceDetailLoading] = useState(false);
  const [sourceDetailError, setSourceDetailError] = useState('');

  const sourceHealth = useMemo(() => {
    const active = sources.filter((source) => source.status === 'active').length;
    const succeeded = sources.filter((source) => source.latestRun.status === 'succeeded').length;
    const failed = sources.filter((source) => source.latestRun.status === 'failed').length;
    const rawObservations = sources.reduce((total, source) => total + source.totals.rawObservations, 0);
    return { active, succeeded, failed, rawObservations };
  }, [sources]);

  const categoryCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((counts, event) => {
      counts[event.category] = (counts[event.category] ?? 0) + 1;
      return counts;
    }, {});
  }, [events]);

  const selectedEvent = useMemo(() => (
    events.find((event) => event.id === selectedEventId) ?? events[0] ?? null
  ), [events, selectedEventId]);

  const selectedSource = useMemo(() => (
    selectedSourceId ? sources.find((source) => source.sourceId === selectedSourceId) ?? null : null
  ), [selectedSourceId, sources]);

  const selectedRun = useMemo(() => (
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null
  ), [runs, selectedRunId]);

  const applySnapshot = useCallback((snapshot: WorldStateSnapshot) => {
    setSources(snapshot.sourcePayload.sources ?? []);
    setEvents(snapshot.eventPayload.events ?? []);
    setQuotes(snapshot.quotePayload.quotes ?? []);
    setRuns(snapshot.runPayload.runs ?? []);
    setOperationsSummary(snapshot.operationsPayload);
    setOperationsAlerts(snapshot.operationsAlertsPayload);
    setCoverage(snapshot.coveragePayload);
    setNextCursor(snapshot.eventPayload.page?.nextCursor ?? null);
    setGeneratedAt(snapshot.eventPayload.generatedAt ?? snapshot.sourcePayload.generatedAt ?? snapshot.quotePayload.generatedAt ?? snapshot.runPayload.generatedAt ?? snapshot.operationsPayload.generatedAt ?? snapshot.operationsAlertsPayload.generatedAt ?? snapshot.coveragePayload.generatedAt ?? null);

    const message = snapshot.sourcePayload.error ?? snapshot.eventPayload.error ?? snapshot.quotePayload.error ?? snapshot.runPayload.error ?? snapshot.operationsPayload.error ?? snapshot.operationsAlertsPayload.error ?? snapshot.coveragePayload.error;
    setError(message ?? '');
    setSelectedEventId((current) => {
      const nextEvents = snapshot.eventPayload.events ?? [];
      if (current && nextEvents.some((event) => event.id === current)) return current;
      return nextEvents[0]?.id ?? null;
    });
    setSelectedRunId((current) => {
      const nextRuns = snapshot.runPayload.runs ?? [];
      if (current && nextRuns.some((run) => run.id === current)) return current;
      return nextRuns[0]?.id ?? null;
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applySnapshot(await fetchWorldStateSnapshot(selectedCategories, windowHours, selectedSourceId, runStatusFilter));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load World-State data');
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, runStatusFilter, selectedCategories, selectedSourceId, windowHours]);

  useEffect(() => {
    let cancelled = false;
    void fetchWorldStateSnapshot(selectedCategories, windowHours, selectedSourceId, runStatusFilter)
      .then((snapshot) => {
        if (!cancelled) applySnapshot(snapshot);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load World-State data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, runStatusFilter, selectedCategories, selectedSourceId, windowHours]);

  useEffect(() => {
    const rawObservationId = selectedEvent?.raw.rawObservationId ?? null;
    const collectionRunId = selectedEvent?.raw.collectionRunId ?? null;
    let cancelled = false;

    void Promise.resolve()
      .then(async () => {
        if (!rawObservationId) {
          return { rawPayload: null, runPayload: null };
        }

        if (!cancelled) {
          setRawEvidenceLoading(true);
          setRawEvidenceError('');
        }

        const [rawPayload, runPayload] = await Promise.all([
          fetchJson<RawEvidencePayload>(`/api/v1/raw/${encodeURIComponent(rawObservationId)}`),
          collectionRunId
            ? fetchJson<RunEvidencePayload>(`/api/v1/runs/${encodeURIComponent(collectionRunId)}`)
            : Promise.resolve(null),
        ]);

        return { rawPayload, runPayload };
      })
      .then(({ rawPayload, runPayload }) => {
        if (cancelled) return;
        setRawEvidence(rawPayload);
        setRunEvidence(runPayload);
        setRawEvidenceError(rawPayload?.error ?? runPayload?.error ?? '');
      })
      .catch((caught) => {
        if (!cancelled) {
          setRawEvidence(null);
          setRunEvidence(null);
          setRawEvidenceError(caught instanceof Error ? caught.message : 'Unable to load raw evidence');
        }
      })
      .finally(() => {
        if (!cancelled) setRawEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.raw.collectionRunId, selectedEvent?.raw.rawObservationId]);

  useEffect(() => {
    let cancelled = false;

    void Promise.resolve()
      .then(async () => {
        if (!selectedSourceId) {
          return null;
        }

        if (!cancelled) {
          setSourceDetailLoading(true);
          setSourceDetailError('');
        }

        const [detailPayload, runsPayload] = await Promise.all([
          fetchJson<SourceDetailPayload>(`/api/v1/sources/${encodeURIComponent(selectedSourceId)}`),
          fetchJson<SourceRunsPayload>(`/api/v1/sources/${encodeURIComponent(selectedSourceId)}/runs?limit=8`),
        ]);

        return { detailPayload, runsPayload };
      })
      .then((payloads) => {
        if (cancelled) return;
        setSourceDetail(payloads?.detailPayload ?? null);
        setSourceRuns(payloads?.runsPayload ?? null);
        setSourceDetailError(payloads?.detailPayload?.error ?? payloads?.runsPayload?.error ?? '');
      })
      .catch((caught) => {
        if (!cancelled) {
          setSourceDetail(null);
          setSourceRuns(null);
          setSourceDetailError(caught instanceof Error ? caught.message : 'Unable to load source detail');
        }
      })
      .finally(() => {
        if (!cancelled) setSourceDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSourceId]);

  useEffect(() => {
    const runId = selectedRun?.id ?? null;
    let cancelled = false;

    void Promise.resolve()
      .then(async () => {
        if (!runId) {
          return { detailPayload: null, rawPayload: null };
        }

        if (!cancelled) {
          setOperationRunLoading(true);
          setOperationRunError('');
        }

        const [detailPayload, rawPayload] = await Promise.all([
          fetchJson<RunEvidencePayload>(`/api/v1/runs/${encodeURIComponent(runId)}`),
          fetchJson<RunRawPayload>(`/api/v1/runs/${encodeURIComponent(runId)}/raw?limit=10`),
        ]);

        return { detailPayload, rawPayload };
      })
      .then(({ detailPayload, rawPayload }) => {
        if (cancelled) return;
        setOperationRunEvidence(detailPayload);
        setOperationRunRaw(rawPayload);
        setOperationRunError(detailPayload?.error ?? rawPayload?.error ?? '');
      })
      .catch((caught) => {
        if (!cancelled) {
          setOperationRunEvidence(null);
          setOperationRunRaw(null);
          setOperationRunError(caught instanceof Error ? caught.message : 'Unable to load run operations detail');
        }
      })
      .finally(() => {
        if (!cancelled) setOperationRunLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRun?.id]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
      const categoryQuery = selectedCategories.map((category) => `category=${encodeURIComponent(category)}`).join('&');
      const sourceQuery = selectedSourceId ? `&source_id=${encodeURIComponent(selectedSourceId)}` : '';
      const payload = await fetchJson<EventsPayload>(
        `/api/v1/events?${categoryQuery}${sourceQuery}&since=${encodeURIComponent(since)}&limit=100&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setEvents((current) => [...current, ...(payload.events ?? [])]);
      setNextCursor(payload.page?.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load more events');
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleCategory(category: EventCategory) {
    setSelectedCategories((current) => {
      if (current.includes(category)) {
        const next = current.filter((entry) => entry !== category);
        return next.length > 0 ? next : current;
      }
      return [...current, category];
    });
  }

  return (
    <main style={{
      minHeight: '100vh',
      overflow: 'auto',
      background: 'radial-gradient(circle at 18% 0%, rgba(212,175,55,0.18), transparent 30%), radial-gradient(circle at 80% 10%, rgba(0,229,255,0.11), transparent 26%), var(--bg-void)',
      color: 'var(--text-primary)',
      padding: 24,
    }}>
      <div style={{ maxWidth: 1440, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header className="glass-panel osiris-glow" style={{ padding: 22, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 18, alignItems: 'center' }}>
          <div>
            <p className="hud-label">OSIRIS world-state</p>
            <h1 style={{ margin: '6px 0 8px', fontSize: 34, letterSpacing: '-0.04em' }}>
              Historical intelligence explorer
            </h1>
            <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 850, lineHeight: 1.6 }}>
              Additive view over persisted collector output: source health, current event observations,
              raw archive provenance and market quote state. Existing OSIRIS live dashboard routes remain unchanged.
            </p>
          </div>
          <button type="button" onClick={loadInitial} disabled={loading} style={buttonStyle('primary')}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
          <StatCard label="Active sources" value={sourceHealth.active.toLocaleString()} detail={`${sourceHealth.succeeded} latest successes`} />
          <StatCard label="Raw observations" value={sourceHealth.rawObservations.toLocaleString()} detail="archive-backed records" />
          <StatCard label="Event rows loaded" value={events.length.toLocaleString()} detail={generatedAt ? `as of ${formatTime(generatedAt)}` : 'waiting for data'} />
          <StatCard label="Collector runs" value={runs.length.toLocaleString()} detail={runStatusFilter === 'all' ? 'recent operations' : `${runStatusFilter} only`} />
          <StatCard label="Market quotes" value={quotes.length.toLocaleString()} detail="latest persisted quote rows" />
        </section>

        {selectedSource ? (
          <section className="glass-panel" style={{ padding: 14, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <p className="hud-label">Source filter active</p>
              <div style={{ color: 'var(--text-heading)', fontSize: 15 }}>
                {selectedSource.name} <span style={{ color: 'var(--text-secondary)' }}>· {selectedSource.provider}</span>
              </div>
            </div>
            <button type="button" onClick={() => setSelectedSourceId(null)} style={buttonStyle('secondary')}>
              Clear source
            </button>
          </section>
        ) : null}

        <section className="glass-panel" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                style={{
                  border: `1px solid ${selectedCategories.includes(category.id) ? category.color : 'rgba(212,175,55,0.14)'}`,
                  background: selectedCategories.includes(category.id) ? `${category.color}22` : 'rgba(4,4,10,0.5)',
                  color: selectedCategories.includes(category.id) ? 'var(--text-heading)' : 'var(--text-secondary)',
                  borderRadius: 999,
                  padding: '8px 12px',
                  fontFamily: 'var(--font-hud)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {category.label} {categoryCounts[category.id] ? `· ${categoryCounts[category.id]}` : ''}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {WINDOWS.map((windowOption) => (
              <button
                key={windowOption.value}
                type="button"
                onClick={() => setWindowHours(windowOption.value)}
                style={buttonStyle(windowHours === windowOption.value ? 'primary' : 'secondary')}
              >
                {windowOption.label}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <div style={{
            border: '1px solid rgba(255,149,0,0.4)',
            background: 'rgba(255,149,0,0.08)',
            borderRadius: 12,
            padding: 14,
            color: '#ffd29a',
            fontSize: 13,
          }}>
            {error}
          </div>
        ) : null}

        <OperationsPanel
          runs={runs}
          selectedRun={selectedRun}
          selectedRunId={selectedRun?.id ?? null}
          runStatusFilter={runStatusFilter}
          selectedSource={selectedSource}
          operationsSummary={operationsSummary}
          operationsAlerts={operationsAlerts}
          operationRunEvidence={operationRunEvidence}
          operationRunRaw={operationRunRaw}
          loading={operationRunLoading}
          error={operationRunError}
          onSelectRun={setSelectedRunId}
          onChangeStatus={setRunStatusFilter}
          onClearSource={() => setSelectedSourceId(null)}
        />

        <CoveragePanel coverage={coverage} loading={loading} />

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(360px, 0.75fr)', gap: 16, alignItems: 'stretch' }}>
          <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 12 }}>
            <SectionTitle eyebrow="Spatial explorer" title="World-State map" detail="Persisted observations rendered as OSIRIS-style geospatial intelligence." />
            <WorldStateMap
              events={events}
              selectedEventId={selectedEvent?.id ?? null}
              onSelectEvent={setSelectedEventId}
            />
          </div>
          <EventDetailPanel
            event={selectedEvent}
            rawEvidence={rawEvidence}
            runEvidence={runEvidence}
            rawEvidenceLoading={rawEvidenceLoading}
            rawEvidenceError={rawEvidenceError}
          />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 0.65fr)', gap: 16, alignItems: 'start' }}>
          <div className="glass-panel" style={{ padding: 18, display: 'grid', gap: 12 }}>
            <SectionTitle eyebrow="Events API" title="/api/v1/events" detail="Unified geospatial event stream with provenance." />
            <div style={{ display: 'grid', gap: 10 }}>
              {events.length ? events.map((event) => (
                <EventCard
                  key={`${event.category}-${event.id}`}
                  event={event}
                  selected={event.id === selectedEvent?.id}
                  onSelect={() => setSelectedEventId(event.id)}
                />
              )) : (
                <EmptyState text={loading ? 'Loading persisted events…' : 'No persisted events returned for this filter window.'} />
              )}
            </div>
            {nextCursor ? (
              <button type="button" onClick={loadMore} disabled={loadingMore} style={buttonStyle('secondary')}>
                {loadingMore ? 'Loading…' : 'Load more events'}
              </button>
            ) : null}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div className="glass-panel" style={{ padding: 18, display: 'grid', gap: 12 }}>
              <SectionTitle eyebrow="Markets API" title="/api/v1/markets/quotes" detail="Latest persisted quote observations." />
              <div style={{ display: 'grid', gap: 8 }}>
                {quotes.length ? quotes.slice(0, 16).map((quote) => (
                  <QuoteRow key={quote.id} quote={quote} />
                )) : (
                  <EmptyState text="No persisted market quotes returned." />
                )}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 18, display: 'grid', gap: 12 }}>
              <SectionTitle eyebrow="Sources API" title="/api/v1/sources" detail="Collector catalogue and latest run status." />
              {selectedSourceId ? (
                <SourceDetailPanel
                  fallbackSource={selectedSource}
                  sourceDetail={sourceDetail}
                  sourceRuns={sourceRuns}
                  loading={sourceDetailLoading}
                  error={sourceDetailError}
                  onSelectEvent={setSelectedEventId}
                  onClear={() => setSelectedSourceId(null)}
                />
              ) : null}
              <div style={{ display: 'grid', gap: 8, maxHeight: 620, overflow: 'auto', paddingRight: 4 }}>
                {sources.length ? sources.map((source) => (
                  <SourceRow
                    key={source.sourceId}
                    source={source}
                    selected={source.sourceId === selectedSourceId}
                    onSelect={() => setSelectedSourceId((current) => current === source.sourceId ? null : source.sourceId)}
                  />
                )) : (
                  <EmptyState text="No source catalogue rows returned." />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok && !payload.error) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return payload as T;
}

async function fetchWorldStateSnapshot(
  selectedCategories: EventCategory[],
  windowHours: number,
  selectedSourceId: string | null,
  runStatusFilter: RunStatusFilter,
): Promise<WorldStateSnapshot> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const categoryQuery = selectedCategories.map((category) => `category=${encodeURIComponent(category)}`).join('&');
  const sourceQuery = selectedSourceId ? `&source_id=${encodeURIComponent(selectedSourceId)}` : '';
  const runStatusQuery = runStatusFilter === 'all' ? '' : `&status=${encodeURIComponent(runStatusFilter)}`;
  const [sourcePayload, eventPayload, quotePayload, runPayload, operationsPayload, operationsAlertsPayload, coveragePayload] = await Promise.all([
    fetchJson<SourcesPayload>('/api/v1/sources'),
    fetchJson<EventsPayload>(`/api/v1/events?${categoryQuery}${sourceQuery}&since=${encodeURIComponent(since)}&limit=100`),
    fetchJson<QuotesPayload>(`/api/v1/markets/quotes?limit=40${sourceQuery}`),
    fetchJson<RunsPayload>(`/api/v1/runs?limit=30${sourceQuery}${runStatusQuery}`),
    fetchJson<OperationsSummaryPayload>(`/api/v1/operations/summary?since=${encodeURIComponent(since)}`),
    fetchJson<OperationsAlertsPayload>(`/api/v1/operations/alerts?since=${encodeURIComponent(since)}`),
    fetchJson<CoveragePayload>(`/api/v1/coverage?since=${encodeURIComponent(since)}`),
  ]);
  return { sourcePayload, eventPayload, quotePayload, runPayload, operationsPayload, operationsAlertsPayload, coveragePayload };
}

function CoveragePanel({ coverage, loading }: { coverage: CoveragePayload | null; loading: boolean }) {
  const categories = coverage?.categories ?? [];
  const sources = coverage?.sources ?? [];
  const timeline = coverage?.timeline ?? [];
  const maxTimelineValue = Math.max(1, ...timeline.map((bucket) => bucket.events + bucket.rawObservations + bucket.runs));
  const totalEvents = categories.reduce((total, category) => total + category.events, 0);
  const totalRaw = sources.reduce((total, source) => total + source.rawObservations, 0);
  const totalQuotes = sources.reduce((total, source) => total + source.quotes, 0);
  const topSources = [...sources]
    .sort((left, right) => (right.events + right.rawObservations + right.quotes) - (left.events + left.rawObservations + left.quotes))
    .slice(0, 8);

  return (
    <section className="glass-panel osiris-glow-cyan" style={{ padding: 18, display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, alignItems: 'start' }}>
        <SectionTitle
          eyebrow="Coverage API"
          title="/api/v1/coverage"
          detail="Category, source and timeline coverage for the active World-State database window."
        />
        <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'right' }}>
          {coverage?.filters.since ? `since ${formatTime(coverage.filters.since)}` : 'all persisted time'}
          <br />
          {coverage?.generatedAt ? `generated ${formatTime(coverage.generatedAt)}` : 'waiting for data'}
        </div>
      </div>

      {coverage?.error ? (
        <div style={{ color: 'var(--alert-orange)', fontSize: 12 }}>{coverage.error}</div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <MiniFact label="covered categories" value={categories.length.toLocaleString()} />
        <MiniFact label="covered sources" value={sources.length.toLocaleString()} />
        <MiniFact label="covered events" value={totalEvents.toLocaleString()} />
        <MiniFact label="raw + quotes" value={(totalRaw + totalQuotes).toLocaleString()} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(340px, 0.8fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ border: '1px solid rgba(212,175,55,0.12)', borderRadius: 14, padding: 12, background: 'rgba(4,4,10,0.42)' }}>
            <p className="hud-label">Category coverage</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
              {categories.length ? categories.map((entry) => (
                <CoverageCategoryCard key={entry.category} category={entry} />
              )) : (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EmptyState text={loading ? 'Loading coverage categories…' : 'No persisted category coverage returned.'} />
                </div>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid rgba(0,229,255,0.12)', borderRadius: 14, padding: 12, background: 'rgba(4,4,10,0.42)' }}>
            <p className="hud-label">Timeline coverage</p>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(14, timeline.length))}, minmax(16px, 1fr))`, gap: 6, alignItems: 'end', minHeight: 120, marginTop: 12 }}>
              {timeline.length ? timeline.slice(-14).map((bucket) => {
                const total = bucket.events + bucket.rawObservations + bucket.runs;
                return (
                  <div key={bucket.bucketStart} title={`${formatTime(bucket.bucketStart)} · ${total} total`} style={{ display: 'grid', gap: 5, alignItems: 'end' }}>
                    <div style={{ height: 90, display: 'flex', alignItems: 'end' }}>
                      <div style={{
                        width: '100%',
                        minHeight: 4,
                        height: `${Math.max(4, Math.round((total / maxTimelineValue) * 90))}px`,
                        borderRadius: '8px 8px 2px 2px',
                        background: 'linear-gradient(180deg, rgba(0,229,255,0.85), rgba(212,175,55,0.55))',
                        boxShadow: '0 0 16px rgba(0,229,255,0.14)',
                      }} />
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>
                      {new Date(bucket.bucketStart).getUTCDate()}
                    </div>
                  </div>
                );
              }) : (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EmptyState text={loading ? 'Loading coverage timeline…' : 'No coverage timeline buckets returned.'} />
                </div>
              )}
            </div>
            {timeline.length ? (
              <div style={{ display: 'flex', gap: 12, marginTop: 10, color: 'var(--text-muted)', fontSize: 11 }}>
                <span>events</span>
                <span>raw observations</span>
                <span>runs</span>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ border: '1px solid rgba(212,175,55,0.12)', borderRadius: 14, padding: 12, background: 'rgba(4,4,10,0.42)', display: 'grid', gap: 10 }}>
          <p className="hud-label">Top covered sources</p>
          {topSources.length ? topSources.map((source) => (
            <CoverageSourceRow key={source.sourceId} source={source} />
          )) : (
            <EmptyState text={loading ? 'Loading source coverage…' : 'No source coverage returned.'} />
          )}
        </div>
      </div>
    </section>
  );
}

function CoverageCategoryCard({ category }: { category: CoverageCategory }) {
  const categoryMeta = CATEGORIES.find((entry) => entry.id === category.category);
  return (
    <div style={{
      border: `1px solid ${categoryMeta?.color ?? 'rgba(212,175,55,0.18)'}`,
      borderRadius: 12,
      padding: 12,
      background: 'rgba(4,4,10,0.42)',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: 'var(--text-heading)', fontFamily: 'var(--font-hud)', fontSize: 12 }}>
          {categoryMeta?.label ?? category.category}
        </span>
        <span style={{ color: categoryMeta?.color ?? 'var(--text-cyan)', fontFamily: 'var(--font-hud)', fontSize: 11 }}>
          {category.events.toLocaleString()}
        </span>
      </div>
      <KeyValueRows entries={[
        ['sources', category.sources.toLocaleString()],
        ['earliest', category.earliestOccurredAt ? formatTime(category.earliestOccurredAt) : 'not available'],
        ['latest', category.latestOccurredAt ? formatTime(category.latestOccurredAt) : 'not available'],
        ['bounds', category.bounds ? `${category.bounds.west.toFixed(1)},${category.bounds.south.toFixed(1)} → ${category.bounds.east.toFixed(1)},${category.bounds.north.toFixed(1)}` : 'not spatial'],
      ]} />
    </div>
  );
}

function CoverageSourceRow({ source }: { source: CoverageSource }) {
  const categoryEntries = Object.entries(source.categories)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .slice(0, 3);

  return (
    <div style={{
      border: '1px solid rgba(0,229,255,0.12)',
      borderRadius: 12,
      padding: 10,
      background: 'rgba(4,4,10,0.36)',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--text-heading)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{source.provider} · {source.sourceId}</div>
        </div>
        <span style={{ color: 'var(--text-cyan)', fontFamily: 'var(--font-hud)', fontSize: 11 }}>
          {(source.events + source.rawObservations + source.quotes).toLocaleString()}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
        <MiniFact label="events" value={source.events.toLocaleString()} />
        <MiniFact label="raw" value={source.rawObservations.toLocaleString()} />
        <MiniFact label="quotes" value={source.quotes.toLocaleString()} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {categoryEntries.length ? categoryEntries.map(([category, count]) => {
          const meta = CATEGORIES.find((entry) => entry.id === category);
          return (
            <span key={category} style={{
              border: `1px solid ${meta?.color ?? 'rgba(212,175,55,0.18)'}`,
              borderRadius: 999,
              padding: '4px 7px',
              color: 'var(--text-secondary)',
              fontSize: 10,
            }}>
              {meta?.label ?? category}: {count}
            </span>
          );
        }) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>No event categories in this window.</span>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        latest: {source.latestEventAt ? formatTime(source.latestEventAt) : source.latestRawObservedAt ? formatTime(source.latestRawObservedAt) : source.latestQuoteAt ? formatTime(source.latestQuoteAt) : 'not available'}
      </div>
    </div>
  );
}

function OperationsPanel({
  runs,
  selectedRun,
  selectedRunId,
  runStatusFilter,
  selectedSource,
  operationsSummary,
  operationsAlerts,
  operationRunEvidence,
  operationRunRaw,
  loading,
  error,
  onSelectRun,
  onChangeStatus,
  onClearSource,
}: {
  runs: CollectionRunSummary[];
  selectedRun: CollectionRunSummary | null;
  selectedRunId: string | null;
  runStatusFilter: RunStatusFilter;
  selectedSource: SourceSummary | null;
  operationsSummary: OperationsSummaryPayload | null;
  operationsAlerts: OperationsAlertsPayload | null;
  operationRunEvidence: RunEvidencePayload | null;
  operationRunRaw: RunRawPayload | null;
  loading: boolean;
  error: string;
  onSelectRun: (runId: string) => void;
  onChangeStatus: (status: RunStatusFilter) => void;
  onClearSource: () => void;
}) {
  const detailRun = operationRunEvidence?.collectionRun ?? selectedRun;
  const rawObservationCount = operationRunEvidence?.rawObservationCount ?? selectedRun?.rawObservationCount ?? 0;
  const rawObservations = operationRunRaw?.rawObservations ?? [];
  const detailSourceName = selectedRun?.sourceName ?? detailRun?.sourceId ?? 'Selected run';
  const recentSuccessRate = operationsSummary?.recent.runs
    ? Math.round((operationsSummary.recent.successfulRuns / operationsSummary.recent.runs) * 100)
    : null;
  const failingSources = operationsSummary?.sourceHealth
    .filter((source) => source.latestRunStatus === 'failed' || source.failedRuns > 0)
    .slice(0, 6) ?? [];
  const alerts = operationsAlerts?.alerts ?? [];

  return (
    <section className="glass-panel osiris-glow" style={{ padding: 18, display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, alignItems: 'start' }}>
        <SectionTitle
          eyebrow="Operations API"
          title="/api/v1/runs"
          detail="Collector execution history, status filters, run-level raw links and archive provenance."
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {RUN_STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => onChangeStatus(filter.value)}
              style={buttonStyle(runStatusFilter === filter.value ? 'primary' : 'secondary')}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {selectedSource ? (
        <div style={{
          border: '1px solid rgba(0,229,255,0.16)',
          borderRadius: 12,
          padding: 10,
          background: 'rgba(0,229,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
        }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            Operations scoped to <span style={{ color: 'var(--text-heading)' }}>{selectedSource.name}</span>
          </div>
          <button type="button" onClick={onClearSource} style={buttonStyle('secondary')}>
            Clear source scope
          </button>
        </div>
      ) : null}

      {operationsSummary ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ border: '1px solid rgba(255,149,0,0.2)', borderRadius: 12, padding: 12, background: 'rgba(255,149,0,0.05)' }}>
            <p className="hud-label">Operations alerts · /api/v1/operations/alerts</p>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {alerts.length ? alerts.slice(0, 6).map((alert) => (
                <OperationsAlertRow key={alert.id} alert={alert} />
              )) : (
                <EmptyState text="No operation alerts for the selected recent window." />
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <MiniFact label="recent success" value={recentSuccessRate === null ? 'n/a' : `${recentSuccessRate}%`} color={recentSuccessRate !== null && recentSuccessRate < 80 ? 'var(--alert-orange)' : 'var(--alert-green)'} />
            <MiniFact label="recent runs" value={operationsSummary.recent.runs.toLocaleString()} />
            <MiniFact label="recent failures" value={operationsSummary.recent.failedRuns.toLocaleString()} color={operationsSummary.recent.failedRuns > 0 ? 'var(--alert-red)' : 'var(--alert-green)'} />
            <MiniFact label="recent raw" value={operationsSummary.recent.rawObservations.toLocaleString()} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1.3fr)', gap: 12 }}>
            <div style={{ border: '1px solid rgba(212,175,55,0.12)', borderRadius: 12, padding: 12, background: 'rgba(4,4,10,0.34)' }}>
              <p className="hud-label">Status breakdown · /api/v1/operations/summary</p>
              <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
                {operationsSummary.statusBreakdown.length ? operationsSummary.statusBreakdown.map((entry) => (
                  <div key={entry.status} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: runStatusColor(entry.status), fontFamily: 'var(--font-hud)', fontSize: 11 }}>{entry.status}</span>
                    <div style={{ height: 6, borderRadius: 999, background: 'rgba(212,175,55,0.12)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.max(4, Math.round((entry.count / Math.max(1, operationsSummary.totals.runs)) * 100))}%`,
                        height: '100%',
                        background: runStatusColor(entry.status),
                      }} />
                    </div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{entry.count.toLocaleString()}</span>
                  </div>
                )) : (
                  <EmptyState text="No run status breakdown available." />
                )}
              </div>
            </div>

            <div style={{ border: '1px solid rgba(0,229,255,0.12)', borderRadius: 12, padding: 12, background: 'rgba(4,4,10,0.34)' }}>
              <p className="hud-label">Source health priorities</p>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {failingSources.length ? failingSources.map((source) => (
                  <div key={source.sourceId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, borderBottom: '1px solid rgba(212,175,55,0.08)', paddingBottom: 7 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-heading)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{source.provider} · {source.failedRuns.toLocaleString()} failed / {source.runs.toLocaleString()} runs</div>
                    </div>
                    <span style={{ color: runStatusColor(source.latestRunStatus), fontFamily: 'var(--font-hud)', fontSize: 11 }}>
                      {source.successRate === null ? 'n/a' : `${Math.round(source.successRate * 100)}%`}
                    </span>
                  </div>
                )) : (
                  <EmptyState text="No failing sources in the operations summary." />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(380px, 0.9fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8, maxHeight: 540, overflow: 'auto', paddingRight: 4 }}>
          {runs.length ? runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              selected={run.id === selectedRunId}
              onSelect={() => onSelectRun(run.id)}
            />
          )) : (
            <EmptyState text="No collection runs returned for this operations filter." />
          )}
        </div>

        <div style={{
          border: '1px solid rgba(212,175,55,0.12)',
          borderRadius: 14,
          padding: 12,
          background: 'rgba(4,4,10,0.42)',
          display: 'grid',
          gap: 12,
        }}>
          {detailRun ? (
            <>
              <div>
                <p className="hud-label">Run detail · /api/v1/runs/{detailRun.id}</p>
                <h3 style={{ margin: '6px 0 4px', color: 'var(--text-heading)', fontSize: 16 }}>
                  {detailSourceName}
                </h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                  {detailRun.endpoint}
                </p>
              </div>

              {loading ? <div style={{ color: 'var(--text-gold)', fontSize: 12 }}>Loading run raw records…</div> : null}
              {error ? <div style={{ color: 'var(--alert-orange)', fontSize: 12 }}>{error}</div> : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <MiniFact label="status" value={detailRun.status} color={runStatusColor(detailRun.status)} />
                <MiniFact label="HTTP" value={detailRun.httpStatus ? String(detailRun.httpStatus) : 'not recorded'} />
                <MiniFact label="records" value={detailRun.recordCount?.toLocaleString() ?? 'not recorded'} />
                <MiniFact label="raw linked" value={rawObservationCount.toLocaleString()} />
              </div>

              <KeyValueRows entries={[
                ['run', detailRun.id],
                ['started', formatTime(detailRun.startedAt)],
                ['completed', detailRun.completedAt ? formatTime(detailRun.completedAt) : 'not completed'],
                ['collector', detailRun.collectorVersion],
                ['parser', detailRun.parserVersion ?? 'not recorded'],
                ['archive', detailRun.archivePath ?? 'not available'],
                ['hash', detailRun.contentHash ?? 'not available'],
              ]} />

              <div style={{ display: 'grid', gap: 8 }}>
                <p className="hud-label">Raw records · /api/v1/runs/{detailRun.id}/raw</p>
                {rawObservations.length ? rawObservations.slice(0, 8).map((raw) => (
                  <RawObservationSummaryRow key={raw.id} rawObservation={raw} />
                )) : !loading ? (
                  <EmptyState text="No raw observation summaries returned for this run." />
                ) : null}
              </div>
            </>
          ) : (
            <EmptyState text="No collection run selected." />
          )}
        </div>
      </div>
    </section>
  );
}

function OperationsAlertRow({ alert }: { alert: OperationsAlert }) {
  return (
    <div style={{
      border: `1px solid ${alert.severity === 'critical' ? 'rgba(255,61,61,0.34)' : 'rgba(255,149,0,0.28)'}`,
      borderRadius: 10,
      padding: 10,
      background: alert.severity === 'critical' ? 'rgba(255,61,61,0.08)' : 'rgba(255,149,0,0.06)',
      display: 'grid',
      gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--text-heading)', fontSize: 13 }}>{alert.title}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45, marginTop: 3 }}>{alert.detail}</div>
        </div>
        <span style={{
          color: alert.severity === 'critical' ? 'var(--alert-red)' : 'var(--alert-orange)',
          fontFamily: 'var(--font-hud)',
          fontSize: 10,
          whiteSpace: 'nowrap',
        }}>
          {alert.severity}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        <span>{alert.provider}</span>
        <span>{alert.latestRunStatus ?? 'no run'}</span>
        <span>{alert.successRate === null ? 'n/a' : `${Math.round(alert.successRate * 100)}% success`}</span>
        <span>{alert.recentRawObservations.toLocaleString()} recent raw</span>
      </div>
    </div>
  );
}

function RunCard({ run, selected, onSelect }: { run: CollectionRunSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} style={{
      border: `1px solid ${selected ? 'rgba(0,229,255,0.45)' : 'rgba(212,175,55,0.12)'}`,
      borderRadius: 12,
      padding: 12,
      background: selected ? 'rgba(0,229,255,0.08)' : 'rgba(4,4,10,0.46)',
      display: 'grid',
      gap: 8,
      cursor: 'pointer',
      textAlign: 'left',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--text-heading)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {run.sourceName}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{run.provider} · {run.sourceId}</div>
        </div>
        <span style={{ color: runStatusColor(run.status), fontFamily: 'var(--font-hud)', fontSize: 11 }}>
          {run.status}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        <span>{formatTime(run.startedAt)}</span>
        <span>{run.httpStatus ? `HTTP ${run.httpStatus}` : 'HTTP n/a'}</span>
        <span>{run.recordCount?.toLocaleString() ?? 'n/a'} records</span>
        <span>{run.rawObservationCount.toLocaleString()} raw</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, wordBreak: 'break-word' }}>
        {run.archivePath ?? run.endpoint}
      </div>
    </button>
  );
}

function RawObservationSummaryRow({ rawObservation }: { rawObservation: RawObservationSummary }) {
  return (
    <div style={{
      border: '1px solid rgba(0,229,255,0.1)',
      borderRadius: 10,
      padding: 10,
      background: 'rgba(4,4,10,0.36)',
      display: 'grid',
      gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: 'var(--text-heading)', fontSize: 12 }}>{rawObservation.sourceRecordId ?? rawObservation.id}</span>
        <span style={{ color: 'var(--text-cyan)', fontFamily: 'var(--font-hud)', fontSize: 10 }}>
          {rawObservation.evidenceClassification}
        </span>
      </div>
      <KeyValueRows entries={[
        ['raw API', `/api/v1/raw/${rawObservation.id}`],
        ['observed', formatTime(rawObservation.observedAt)],
        ['archive', rawObservation.archivePath],
        ['hash', rawObservation.contentHash],
      ]} />
    </div>
  );
}

function EventDetailPanel({
  event,
  rawEvidence,
  runEvidence,
  rawEvidenceLoading,
  rawEvidenceError,
}: {
  event: WorldEvent | null;
  rawEvidence: RawEvidencePayload | null;
  runEvidence: RunEvidencePayload | null;
  rawEvidenceLoading: boolean;
  rawEvidenceError: string;
}) {
  if (!event) {
    return (
      <div className="glass-panel" style={{ padding: 18 }}>
        <SectionTitle eyebrow="Event detail" title="/api/v1/events/[id]" detail="Select a map point or event row to inspect provenance." />
        <EmptyState text="No persisted event selected." />
      </div>
    );
  }

  const category = CATEGORIES.find((entry) => entry.id === event.category);
  const evidenceMatches = rawEvidence?.rawObservation?.id === event.raw.rawObservationId;
  const runMatches = runEvidence?.collectionRun?.id === event.raw.collectionRunId;
  const rawObservation = evidenceMatches ? rawEvidence.rawObservation : null;
  const collectionRun = runMatches ? runEvidence.collectionRun : evidenceMatches ? rawEvidence.collectionRun : null;
  const rawObservationCount = runMatches ? runEvidence.rawObservationCount : null;
  const payloadPreview = rawObservation ? previewJson(rawObservation.payload, 4200) : null;
  const runStatusColor = collectionRun?.status === 'succeeded' ? 'var(--alert-green)' : collectionRun ? 'var(--alert-orange)' : 'var(--text-muted)';

  return (
    <aside className="glass-panel osiris-glow-cyan" style={{ padding: 18, display: 'grid', gap: 14, alignContent: 'start' }}>
      <div>
        <p className="hud-label">Event detail · /api/v1/events/{event.id}</p>
        <h2 style={{ margin: '7px 0 6px', fontSize: 22, color: 'var(--text-heading)' }}>{event.title}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
          {event.provider} · {event.sourceName} · {formatTime(event.occurredAt)}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <MiniFact label="category" value={category?.label ?? event.category} color={category?.color} />
        <MiniFact label="severity" value={event.severity ?? 'unscored'} color={severityColor(event.severity)} />
        <MiniFact label="evidence" value={event.evidenceClassification} />
        <MiniFact label="coordinates" value={`${event.point.lat.toFixed(4)}, ${event.point.lon.toFixed(4)}`} />
      </div>

      <div>
        <p className="hud-label">Normalised facts</p>
        <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
          {Object.entries(event.facts).filter(([, value]) => value !== null && value !== undefined).slice(0, 10).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(212,175,55,0.08)', paddingBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{key}</span>
              <span style={{ color: 'var(--text-primary)', fontSize: 12, textAlign: 'right' }}>{String(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="hud-label">Raw provenance</p>
        <div style={{ marginTop: 8, display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, wordBreak: 'break-word' }}>
          <div>raw observation: <span style={{ color: 'var(--text-cyan)' }}>{event.raw.rawObservationId}</span></div>
          <div>collection run: <span style={{ color: 'var(--text-cyan)' }}>{event.raw.collectionRunId ?? 'not linked'}</span></div>
          <div>archive: <span style={{ color: 'var(--text-cyan)' }}>{event.raw.archivePath ?? 'not available'}</span></div>
          <div>hash: <span style={{ color: 'var(--text-muted)' }}>{event.raw.contentHash ?? 'not available'}</span></div>
        </div>
      </div>

      <div style={{ border: '1px solid rgba(0,229,255,0.14)', borderRadius: 14, padding: 12, background: 'rgba(0,229,255,0.04)' }}>
        <p className="hud-label">Evidence chain</p>
        <div style={{ display: 'grid', gap: 7, marginTop: 8, color: 'var(--text-secondary)', fontSize: 12, wordBreak: 'break-word' }}>
          <div>raw API: <span style={{ color: 'var(--text-cyan)' }}>/api/v1/raw/{event.raw.rawObservationId}</span></div>
          <div>run API: <span style={{ color: 'var(--text-cyan)' }}>{event.raw.collectionRunId ? `/api/v1/runs/${event.raw.collectionRunId}` : 'not linked'}</span></div>
          {rawEvidenceLoading ? <div style={{ color: 'var(--text-gold)' }}>Loading raw payload and run metadata…</div> : null}
          {rawEvidenceError ? <div style={{ color: 'var(--alert-orange)' }}>{rawEvidenceError}</div> : null}
        </div>

        {rawObservation ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <MiniFact label="raw observed" value={formatTime(rawObservation.observedAt)} />
              <MiniFact label="raw first seen" value={formatTime(rawObservation.firstSeenAt)} />
              <MiniFact label="schema" value={`v${rawObservation.schemaVersion}`} />
              <MiniFact label="parser" value={rawObservation.parserVersion} />
            </div>
            <KeyValueRows entries={[
              ['source record', rawObservation.sourceRecordId ?? 'not supplied'],
              ['raw archive', rawObservation.archivePath],
              ['raw hash', rawObservation.contentHash],
              ['last seen', formatTime(rawObservation.lastSeenAt)],
            ]} />
          </div>
        ) : !rawEvidenceLoading ? (
          <EmptyState text="Raw observation detail is not loaded for this event." />
        ) : null}

        {collectionRun ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <p className="hud-label">Collection run</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <MiniFact label="status" value={collectionRun.status} color={runStatusColor} />
              <MiniFact label="HTTP" value={collectionRun.httpStatus ? String(collectionRun.httpStatus) : 'not recorded'} />
              <MiniFact label="records" value={collectionRun.recordCount?.toLocaleString() ?? 'not recorded'} />
              <MiniFact label="raw linked" value={rawObservationCount?.toLocaleString() ?? 'not counted'} />
              <MiniFact label="collector" value={collectionRun.collectorVersion} />
            </div>
            <KeyValueRows entries={[
              ['endpoint', collectionRun.endpoint],
              ['content type', collectionRun.contentType ?? 'not recorded'],
              ['completed', collectionRun.completedAt ? formatTime(collectionRun.completedAt) : 'not completed'],
              ['run archive', collectionRun.archivePath ?? 'not available'],
              ['legacy provenance', collectionRun.legacyProvenanceIncomplete ? 'incomplete' : 'complete'],
            ]} />
          </div>
        ) : null}
      </div>

      {payloadPreview ? (
        <div>
          <p className="hud-label">Raw payload preview</p>
          <pre style={{
            margin: '8px 0 0',
            maxHeight: 360,
            overflow: 'auto',
            border: '1px solid rgba(212,175,55,0.12)',
            borderRadius: 12,
            padding: 12,
            background: 'rgba(4,4,10,0.62)',
            color: 'var(--text-primary)',
            fontSize: 11,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}>
            {payloadPreview}
          </pre>
        </div>
      ) : null}

      {collectionRun && (Object.keys(collectionRun.responseHeaders).length || Object.keys(collectionRun.metrics).length) ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <ObjectPreview title="Response headers" value={collectionRun.responseHeaders} />
          <ObjectPreview title="Run metrics" value={collectionRun.metrics} />
        </div>
      ) : null}
    </aside>
  );
}

function KeyValueRows({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, wordBreak: 'break-word' }}>
      {entries.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ color: 'var(--text-primary)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectPreview({ title, value }: { title: string; value: Record<string, unknown> }) {
  const entries = Object.entries(value).slice(0, 8);
  if (!entries.length) return null;
  return (
    <div>
      <p className="hud-label">{title}</p>
      <KeyValueRows entries={entries.map(([key, entry]) => [key, String(entry)])} />
    </div>
  );
}

function MiniFact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: '1px solid rgba(212,175,55,0.12)', borderRadius: 12, padding: 10, background: 'rgba(4,4,10,0.42)' }}>
      <div className="hud-label">{label}</div>
      <div style={{ color: color ?? 'var(--text-heading)', fontFamily: 'var(--font-hud)', fontSize: 12, marginTop: 5 }}>{value}</div>
    </div>
  );
}

function EventCard({ event, selected, onSelect }: { event: WorldEvent; selected: boolean; onSelect: () => void }) {
  const category = CATEGORIES.find((entry) => entry.id === event.category);
  return (
    <article onClick={onSelect} style={{
      border: `1px solid ${selected ? category?.color ?? 'rgba(212,175,55,0.6)' : 'rgba(212,175,55,0.12)'}`,
      background: selected ? 'rgba(212,175,55,0.08)' : 'rgba(4,4,10,0.52)',
      borderRadius: 14,
      padding: 14,
      display: 'grid',
      gap: 10,
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: category?.color ?? 'var(--gold-primary)', boxShadow: `0 0 18px ${category?.color ?? '#d4af37'}` }} />
            <span className="hud-label">{category?.label ?? event.category}</span>
            <span className="hud-label">{event.evidenceClassification}</span>
          </div>
          <h3 style={{ margin: '7px 0 4px', fontSize: 16, color: 'var(--text-heading)' }}>{event.title}</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            {event.provider} · {event.sourceName} · {formatTime(event.occurredAt)}
          </p>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-hud)', fontSize: 11, color: 'var(--text-cyan)' }}>
          {event.point.lat.toFixed(3)}, {event.point.lon.toFixed(3)}
          <div style={{ color: severityColor(event.severity), marginTop: 6 }}>{event.severity ?? 'unscored'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(event.facts).filter(([, value]) => value !== null && value !== undefined).slice(0, 6).map(([key, value]) => (
          <span key={key} style={{
            border: '1px solid rgba(0,229,255,0.14)',
            borderRadius: 999,
            padding: '5px 8px',
            color: 'var(--text-secondary)',
            fontSize: 11,
          }}>
            {key}: {String(value)}
          </span>
        ))}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-hud)' }}>
        raw: {event.raw.rawObservationId}
        {event.raw.archivePath ? ` · ${event.raw.archivePath}` : ''}
      </div>
    </article>
  );
}

function QuoteRow({ quote }: { quote: MarketQuote }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, borderBottom: '1px solid rgba(212,175,55,0.08)', paddingBottom: 8 }}>
      <div>
        <div style={{ color: 'var(--text-heading)', fontFamily: 'var(--font-hud)', fontSize: 12 }}>{quote.symbol}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{quote.displayName} · {quote.quoteType}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: 'var(--text-heading)', fontFamily: 'var(--font-hud)', fontSize: 12 }}>
          {quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
        <div style={{ color: quote.up ? 'var(--alert-green)' : 'var(--alert-red)', fontSize: 12 }}>
          {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

function SourceDetailPanel({
  fallbackSource,
  sourceDetail,
  sourceRuns,
  loading,
  error,
  onSelectEvent,
  onClear,
}: {
  fallbackSource: SourceSummary | null;
  sourceDetail: SourceDetailPayload | null;
  sourceRuns: SourceRunsPayload | null;
  loading: boolean;
  error: string;
  onSelectEvent: (eventId: string) => void;
  onClear: () => void;
}) {
  const source = sourceDetail?.source ?? fallbackSource;
  if (!source) return null;

  const recentEvents = sourceDetail?.recentEvents ?? [];
  const recentQuotes = sourceDetail?.recentQuotes ?? [];
  const runs = sourceRuns?.runs ?? [];
  const latestOk = source.latestRun.status === 'succeeded';

  return (
    <div style={{
      border: '1px solid rgba(0,229,255,0.18)',
      borderRadius: 14,
      background: 'linear-gradient(180deg, rgba(0,229,255,0.07), rgba(4,4,10,0.38))',
      padding: 12,
      display: 'grid',
      gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <p className="hud-label">Source drilldown · /api/v1/sources/{source.sourceId}</p>
          <h3 style={{ margin: '6px 0 4px', color: 'var(--text-heading)', fontSize: 16 }}>{source.name}</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45 }}>
            {source.description ?? `${source.provider} collector source`}
          </p>
        </div>
        <button type="button" onClick={onClear} style={buttonStyle('secondary')}>
          Clear
        </button>
      </div>

      {loading ? <div style={{ color: 'var(--text-gold)', fontSize: 12 }}>Loading source detail…</div> : null}
      {error ? <div style={{ color: 'var(--alert-orange)', fontSize: 12 }}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <MiniFact label="status" value={source.status} color={source.status === 'active' ? 'var(--alert-green)' : 'var(--alert-orange)'} />
        <MiniFact label="latest run" value={source.latestRun.status ?? 'none'} color={latestOk ? 'var(--alert-green)' : 'var(--alert-orange)'} />
        <MiniFact label="runs" value={source.totals.runs.toLocaleString()} />
        <MiniFact label="raw rows" value={source.totals.rawObservations.toLocaleString()} />
      </div>

      <KeyValueRows entries={[
        ['provider', source.provider],
        ['access', source.accessMethod ?? 'not recorded'],
        ['cost', source.costClass ?? 'not recorded'],
        ['licence', source.licence ?? 'not recorded'],
        ['latest archive', source.latestRun.archivePath ?? 'not available'],
        ['latest complete', source.latestRun.completedAt ? formatTime(source.latestRun.completedAt) : 'never'],
      ]} />

      {runs.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="hud-label">Run history · /api/v1/sources/{source.sourceId}/runs</p>
          {runs.map((run) => (
            <div key={run.id} style={{
              border: '1px solid rgba(0,229,255,0.12)',
              borderRadius: 12,
              background: 'rgba(4,4,10,0.42)',
              padding: 10,
              display: 'grid',
              gap: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: run.status === 'succeeded' ? 'var(--alert-green)' : 'var(--alert-orange)', fontFamily: 'var(--font-hud)', fontSize: 11 }}>
                  {run.status}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {formatTime(run.startedAt)}
                </span>
              </div>
              <KeyValueRows entries={[
                ['run', run.id],
                ['endpoint', run.endpoint],
                ['HTTP', run.httpStatus ? String(run.httpStatus) : 'not recorded'],
                ['records', run.recordCount?.toLocaleString() ?? 'not recorded'],
                ['raw linked', run.rawObservationCount.toLocaleString()],
                ['archive', run.archivePath ?? 'not available'],
              ]} />
            </div>
          ))}
          {sourceRuns?.page.nextCursor ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              More run history is available from cursor {sourceRuns.page.nextCursor}.
            </div>
          ) : null}
        </div>
      ) : sourceRuns && !loading ? (
        <EmptyState text="No collection runs returned for this source." />
      ) : null}

      {recentEvents.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="hud-label">Recent source events</p>
          {recentEvents.slice(0, 4).map((event) => {
            const category = CATEGORIES.find((entry) => entry.id === event.category);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelectEvent(event.id)}
                style={{
                  border: '1px solid rgba(212,175,55,0.1)',
                  borderRadius: 10,
                  padding: 10,
                  background: 'rgba(4,4,10,0.38)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--text-heading)', fontSize: 12 }}>{event.title}</span>
                  <span style={{ color: category?.color ?? 'var(--text-cyan)', fontSize: 11, fontFamily: 'var(--font-hud)' }}>{category?.label ?? event.category}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 5 }}>
                  {formatTime(event.occurredAt)} · {event.severity ?? 'unscored'} · {event.raw.rawObservationId}
                </div>
              </button>
            );
          })}
        </div>
      ) : sourceDetail && !loading ? (
        <EmptyState text="No recent events returned for this source." />
      ) : null}

      {recentQuotes.length ? (
        <div style={{ display: 'grid', gap: 7 }}>
          <p className="hud-label">Recent source quotes</p>
          {recentQuotes.slice(0, 5).map((quote) => (
            <QuoteRow key={quote.id} quote={quote} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SourceRow({ source, selected, onSelect }: { source: SourceSummary; selected: boolean; onSelect: () => void }) {
  const ok = source.latestRun.status === 'succeeded';
  return (
    <button type="button" onClick={onSelect} style={{
      border: `1px solid ${selected ? 'rgba(0,229,255,0.45)' : 'rgba(212,175,55,0.1)'}`,
      borderRadius: 12,
      padding: 10,
      background: selected ? 'rgba(0,229,255,0.08)' : 'rgba(4,4,10,0.35)',
      textAlign: 'left',
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--text-heading)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{source.provider}</div>
        </div>
        <span style={{ color: ok ? 'var(--alert-green)' : 'var(--alert-orange)', fontFamily: 'var(--font-hud)', fontSize: 10 }}>
          {source.latestRun.status ?? 'none'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        <span>{source.totals.rawObservations.toLocaleString()} raw</span>
        <span>{source.latestRun.completedAt ? formatTime(source.latestRun.completedAt) : 'never'}</span>
      </div>
    </button>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="glass-panel" style={{ padding: 16 }}>
      <p className="hud-label">{label}</p>
      <div style={{ color: 'var(--text-heading)', fontSize: 28, fontFamily: 'var(--font-hud)', marginTop: 8 }}>{value}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div>
      <p className="hud-label">{eyebrow}</p>
      <h2 style={{ margin: '5px 0 4px', fontSize: 20 }}>{title}</h2>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>{detail}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ border: '1px dashed rgba(212,175,55,0.18)', borderRadius: 14, padding: 18, color: 'var(--text-muted)', fontSize: 13 }}>
      {text}
    </div>
  );
}

function buttonStyle(kind: 'primary' | 'secondary') {
  return {
    border: '1px solid rgba(212,175,55,0.36)',
    borderRadius: 10,
    background: kind === 'primary' ? 'rgba(212,175,55,0.18)' : 'rgba(4,4,10,0.62)',
    color: kind === 'primary' ? 'var(--text-heading)' : 'var(--text-gold)',
    padding: '10px 12px',
    fontFamily: 'var(--font-hud)',
    fontSize: 11,
    letterSpacing: '0.06em',
    cursor: 'pointer',
  } as const;
}

function severityColor(severity: string | null) {
  const value = severity?.toLowerCase();
  if (value === 'critical' || value === 'high' || value === 'hazardous') return 'var(--alert-red)';
  if (value === 'medium' || value === 'moderate' || value === 'unhealthy') return 'var(--alert-orange)';
  if (value === 'low' || value === 'good') return 'var(--alert-green)';
  return 'var(--text-muted)';
}

function runStatusColor(status: string | null) {
  const value = status?.toLowerCase();
  if (value === 'succeeded' || value === 'success') return 'var(--alert-green)';
  if (value === 'failed' || value === 'error') return 'var(--alert-red)';
  if (value === 'running' || value === 'started') return 'var(--text-cyan)';
  return 'var(--alert-orange)';
}

function previewJson(value: unknown, maxLength: number) {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  if (json.length <= maxLength) return json;
  return `${json.slice(0, maxLength)}\n… truncated`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
