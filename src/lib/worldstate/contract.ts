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

export interface WorldStateRawObservation {
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
  evidenceClassification: WorldStateEvidenceClassification;
  metadata: Record<string, unknown>;
}

export interface WorldStateRawObservationSummary {
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
  evidenceClassification: WorldStateEvidenceClassification;
  metadata: Record<string, unknown>;
}

export interface WorldStateCollectionRun {
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

export interface WorldStateCollectionRunListItem extends WorldStateCollectionRun {
  rawObservationCount: number;
}

export interface WorldStateCollectionRunSummary extends WorldStateCollectionRunListItem {
  sourceName: string;
  provider: string;
}

export interface WorldStateRawObservationResponse {
  rawObservation: WorldStateRawObservation | null;
  collectionRun: WorldStateCollectionRun | null;
  generatedAt: string;
}

export interface WorldStateCollectionRunResponse {
  collectionRun: WorldStateCollectionRun | null;
  rawObservationCount: number;
  generatedAt: string;
}

export interface WorldStateCollectionRunsResponse {
  runs: WorldStateCollectionRunListItem[];
  page: WorldStatePageInfo;
  generatedAt: string;
  filters: {
    sourceId: string;
  };
}

export interface WorldStateCollectionRunListResponse {
  runs: WorldStateCollectionRunSummary[];
  page: WorldStatePageInfo;
  generatedAt: string;
  filters: {
    sourceIds: string[];
    statuses: string[];
    since: string | null;
    until: string | null;
  };
}

export interface WorldStateRunRawObservationsResponse {
  rawObservations: WorldStateRawObservationSummary[];
  page: WorldStatePageInfo;
  generatedAt: string;
  filters: {
    collectionRunId: string;
  };
}

export interface WorldStateOperationsTotals {
  sources: number;
  activeSources: number;
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  rawObservations: number;
  latestRunStartedAt: string | null;
  latestRunCompletedAt: string | null;
}

export interface WorldStateOperationsStatusCount {
  status: string;
  count: number;
}

export interface WorldStateOperationsSourceHealth {
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

export interface WorldStateOperationsSummaryResponse {
  totals: WorldStateOperationsTotals;
  recent: WorldStateOperationsTotals & { since: string };
  statusBreakdown: WorldStateOperationsStatusCount[];
  sourceHealth: WorldStateOperationsSourceHealth[];
  generatedAt: string;
}

export type WorldStateOperationsAlertSeverity = 'critical' | 'warning' | 'info';

export type WorldStateOperationsAlertKind =
  | 'source_failed'
  | 'source_stale'
  | 'low_success_rate'
  | 'no_recent_raw';

export interface WorldStateOperationsAlert {
  id: string;
  severity: WorldStateOperationsAlertSeverity;
  kind: WorldStateOperationsAlertKind;
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

export interface WorldStateOperationsAlertsResponse {
  alerts: WorldStateOperationsAlert[];
  generatedAt: string;
  filters: {
    since: string;
  };
}

export interface WorldStateCoverageBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface WorldStateCoverageCategory {
  category: WorldStateEventCategory;
  events: number;
  sources: number;
  earliestOccurredAt: string | null;
  latestOccurredAt: string | null;
  latestObservedAt: string | null;
  bounds: WorldStateCoverageBounds | null;
}

export interface WorldStateCoverageSource {
  sourceId: string;
  name: string;
  provider: string;
  events: number;
  quotes: number;
  rawObservations: number;
  latestEventAt: string | null;
  latestQuoteAt: string | null;
  latestRawObservedAt: string | null;
  categories: Partial<Record<WorldStateEventCategory, number>>;
}

export interface WorldStateCoverageTimelineBucket {
  bucketStart: string;
  events: number;
  rawObservations: number;
  runs: number;
}

export interface WorldStateCoverageResponse {
  categories: WorldStateCoverageCategory[];
  sources: WorldStateCoverageSource[];
  timeline: WorldStateCoverageTimelineBucket[];
  generatedAt: string;
  filters: {
    since: string | null;
    until: string | null;
  };
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
