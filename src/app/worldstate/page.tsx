'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type EventCategory = 'seismic' | 'disaster' | 'fire' | 'weather' | 'air_quality' | 'internet_outage' | 'aviation';

interface SourceSummary {
  sourceId: string;
  name: string;
  provider: string;
  status: string;
  latestRun: {
    status: string | null;
    completedAt: string | null;
    recordCount: number | null;
    archivePath: string | null;
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

export default function WorldStatePage() {
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>(['seismic', 'disaster', 'fire', 'weather', 'internet_outage', 'aviation']);
  const [windowHours, setWindowHours] = useState(72);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

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

  const applySnapshot = useCallback((snapshot: WorldStateSnapshot) => {
    setSources(snapshot.sourcePayload.sources ?? []);
    setEvents(snapshot.eventPayload.events ?? []);
    setQuotes(snapshot.quotePayload.quotes ?? []);
    setNextCursor(snapshot.eventPayload.page?.nextCursor ?? null);
    setGeneratedAt(snapshot.eventPayload.generatedAt ?? snapshot.sourcePayload.generatedAt ?? snapshot.quotePayload.generatedAt ?? null);

    const message = snapshot.sourcePayload.error ?? snapshot.eventPayload.error ?? snapshot.quotePayload.error;
    setError(message ?? '');
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applySnapshot(await fetchWorldStateSnapshot(selectedCategories, windowHours));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load World-State data');
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, selectedCategories, windowHours]);

  useEffect(() => {
    let cancelled = false;
    void fetchWorldStateSnapshot(selectedCategories, windowHours)
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
  }, [applySnapshot, selectedCategories, windowHours]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
      const categoryQuery = selectedCategories.map((category) => `category=${encodeURIComponent(category)}`).join('&');
      const payload = await fetchJson<EventsPayload>(
        `/api/v1/events?${categoryQuery}&since=${encodeURIComponent(since)}&limit=100&cursor=${encodeURIComponent(nextCursor)}`,
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

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <StatCard label="Active sources" value={sourceHealth.active.toLocaleString()} detail={`${sourceHealth.succeeded} latest successes`} />
          <StatCard label="Raw observations" value={sourceHealth.rawObservations.toLocaleString()} detail="archive-backed records" />
          <StatCard label="Event rows loaded" value={events.length.toLocaleString()} detail={generatedAt ? `as of ${formatTime(generatedAt)}` : 'waiting for data'} />
          <StatCard label="Market quotes" value={quotes.length.toLocaleString()} detail="latest persisted quote rows" />
        </section>

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

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 0.65fr)', gap: 16, alignItems: 'start' }}>
          <div className="glass-panel" style={{ padding: 18, display: 'grid', gap: 12 }}>
            <SectionTitle eyebrow="Events API" title="/api/v1/events" detail="Unified geospatial event stream with provenance." />
            <div style={{ display: 'grid', gap: 10 }}>
              {events.length ? events.map((event) => (
                <EventCard key={`${event.category}-${event.id}`} event={event} />
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
              <div style={{ display: 'grid', gap: 8, maxHeight: 620, overflow: 'auto', paddingRight: 4 }}>
                {sources.length ? sources.map((source) => (
                  <SourceRow key={source.sourceId} source={source} />
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
): Promise<WorldStateSnapshot> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const categoryQuery = selectedCategories.map((category) => `category=${encodeURIComponent(category)}`).join('&');
  const [sourcePayload, eventPayload, quotePayload] = await Promise.all([
    fetchJson<SourcesPayload>('/api/v1/sources'),
    fetchJson<EventsPayload>(`/api/v1/events?${categoryQuery}&since=${encodeURIComponent(since)}&limit=100`),
    fetchJson<QuotesPayload>('/api/v1/markets/quotes?limit=40'),
  ]);
  return { sourcePayload, eventPayload, quotePayload };
}

function EventCard({ event }: { event: WorldEvent }) {
  const category = CATEGORIES.find((entry) => entry.id === event.category);
  return (
    <article style={{
      border: '1px solid rgba(212,175,55,0.12)',
      background: 'rgba(4,4,10,0.52)',
      borderRadius: 14,
      padding: 14,
      display: 'grid',
      gap: 10,
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

function SourceRow({ source }: { source: SourceSummary }) {
  const ok = source.latestRun.status === 'succeeded';
  return (
    <div style={{ border: '1px solid rgba(212,175,55,0.1)', borderRadius: 12, padding: 10, background: 'rgba(4,4,10,0.35)' }}>
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
    </div>
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
