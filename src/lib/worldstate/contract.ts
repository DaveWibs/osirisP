export type WorldStateEvidenceClassification =
  | 'observed'
  | 'reported'
  | 'derived'
  | 'inferred'
  | 'hypothesis';

export type WorldStateEventCategory =
  | 'seismic'
  | 'disaster'
  | 'fire'
  | 'weather'
  | 'air_quality'
  | 'internet_outage'
  | 'aviation';

export interface WorldStatePoint {
  lat: number;
  lon: number;
}

export interface WorldStateRawReference {
  rawObservationId: string;
  collectionRunId: string | null;
  archivePath: string | null;
  contentHash: string | null;
}

export interface WorldStateSourceSummary {
  sourceId: string;
  name: string;
  provider: string;
  description: string | null;
  accessMethod: string;
  costClass: string;
  licence: string | null;
  termsUrl: string | null;
  documentationUrl: string | null;
  status: string;
  metadata: Record<string, unknown>;
  latestRun: {
    id: string | null;
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    responseReceivedAt: string | null;
    upstreamTimestamp: string | null;
    recordCount: number | null;
    archivePath: string | null;
    error: Record<string, unknown> | null;
  };
  totals: {
    runs: number;
    successes: number;
    failures: number;
    rawObservations: number;
  };
}

export interface WorldStateEvent {
  id: string;
  category: WorldStateEventCategory;
  eventType: string;
  sourceId: string;
  sourceName: string;
  provider: string;
  sourceRecordId: string;
  title: string;
  description: string | null;
  occurredAt: string;
  updatedAt: string | null;
  observedAt: string | null;
  severity: string | null;
  point: WorldStatePoint;
  evidenceClassification: WorldStateEvidenceClassification;
  parserVersion: string;
  facts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  raw: WorldStateRawReference;
}

export interface WorldStateMarketQuote {
  id: string;
  sourceId: string;
  sourceName: string;
  provider: string;
  symbol: string;
  displayName: string;
  quoteType: string;
  currency: string | null;
  price: number;
  changePercent: number;
  up: boolean;
  observedAt: string;
  updatedAt: string;
  evidenceClassification: WorldStateEvidenceClassification;
  parserVersion: string;
  metadata: Record<string, unknown>;
  raw: WorldStateRawReference;
}

export interface WorldStatePageInfo {
  limit: number;
  returned: number;
  nextCursor: string | null;
}

export interface WorldStateSourcesResponse {
  sources: WorldStateSourceSummary[];
  generatedAt: string;
}

export interface WorldStateSourceDetailResponse {
  source: WorldStateSourceSummary | null;
  recentEvents: WorldStateEvent[];
  recentQuotes: WorldStateMarketQuote[];
  generatedAt: string;
}

export interface WorldStateEventsResponse {
  events: WorldStateEvent[];
  page: WorldStatePageInfo;
  generatedAt: string;
  filters: {
    categories: WorldStateEventCategory[];
    sourceIds: string[];
    since: string | null;
    until: string | null;
    bbox: [number, number, number, number] | null;
  };
}

export interface WorldStateEventDetailResponse {
  event: WorldStateEvent | null;
  generatedAt: string;
}

export interface WorldStateMarketQuotesResponse {
  quotes: WorldStateMarketQuote[];
  page: WorldStatePageInfo;
  generatedAt: string;
  filters: {
    symbols: string[];
    quoteTypes: string[];
    sourceIds: string[];
    since: string | null;
  };
}
