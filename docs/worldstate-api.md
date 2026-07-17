# World-State API v1

The `/api/v1` World-State API is the first stable persisted-data surface for
OSIRIS. It is additive: existing live compatibility endpoints such as
`/api/earthquakes`, `/api/flights` and `/api/markets` remain available.

All endpoints require the OSIRIS server to have database access through either
`WORLDSTATE_PG*` settings or `DATABASE_URL`.

## `GET /api/v1/sources`

Returns source catalogue metadata, latest collection-run status, run totals and
raw-observation counts.

Useful for:

- source health panels;
- explaining provider coverage;
- linking an event back to source metadata.

## `GET /api/v1/sources/[id]`

Returns one source catalogue entry plus a small recent persisted-data sample:

- `source`;
- `recentEvents`;
- `recentQuotes`.

The `/worldstate` explorer uses source IDs as filters for the map, event list
and market quote strip. The detail route is the stable API anchor for deeper
source-inspection panels.

## `GET /api/v1/sources/[id]/runs`

Returns recent collection runs for one source, ordered newest first.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `limit` | `20` | Page size, capped server-side |
| `cursor` | `20` | Cursor returned by the prior page |

Each run includes the full collection-run contract plus `rawObservationCount`,
so the frontend can show whether a collector execution produced archived raw
records without making one request per run.

## `GET /api/v1/operations/summary`

Returns aggregate collector health for the operations console.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `since` | `2026-07-16T00:00:00Z` | Lower bound for the `recent` window; defaults to the last 24 hours |

The response includes:

- all-time totals for sources, runs, successes, failures and raw observations;
- recent-window totals using the supplied/default `since`;
- status breakdown counts across all collection runs;
- per-source operational health, including latest run status, latest error,
  run counts, raw-observation counts and success rate.

## `GET /api/v1/operations/alerts`

Returns derived collector health alerts for the operations console.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `since` | `2026-07-16T00:00:00Z` | Recent-window lower bound; defaults to the last 24 hours |

Current alert kinds:

- `source_failed`: the latest source run failed;
- `source_stale`: an active source has no recent run in the window;
- `no_recent_raw`: recent runs exist but produced no raw observations;
- `low_success_rate`: historical run success rate is below the service threshold.

Each alert includes severity, source labels, latest run metadata, success rate,
recent run/failure/raw counts and a human-readable title/detail.

## `GET /api/v1/coverage`

Returns coverage rollups for the persisted World-State estate. This endpoint is
intended for frontend health/coverage panels and for quickly answering which
categories, sources and dates are currently represented in the database.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `since` | `2026-07-15T00:00:00Z` | Inclusive lower bound for event occurrence, raw observation and run timestamps |
| `until` | `2026-07-17T00:00:00Z` | Inclusive upper bound for event occurrence, raw observation and run timestamps |

The response includes:

- `categories`: event counts, contributing source counts, earliest/latest event
  timestamps, latest observation timestamp and spatial bounds per category;
- `sources`: event, quote and raw-observation counts per source, latest
  timestamps and per-category event counts;
- `timeline`: daily buckets containing event, raw-observation and run counts.

## `GET /api/v1/events`

Returns a unified event stream across persisted geospatial observation tables.

Current categories:

- `seismic`
- `disaster`
- `fire`
- `weather`
- `air_quality`
- `internet_outage`
- `aviation`

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `category` | `seismic,fire` | One or more event categories |
| `source_id` | `usgs-earthquakes` | One or more source catalogue IDs |
| `since` | `2026-07-01T00:00:00Z` | Inclusive lower occurrence-time bound |
| `until` | `2026-07-17T00:00:00Z` | Inclusive upper occurrence-time bound |
| `bbox` | `-10,35,40,70` | `west,south,east,north` point filter |
| `limit` | `100` | Page size, capped server-side |
| `cursor` | `100` | Opaque-enough offset cursor returned by the prior page |

Each event includes:

- source/provider labels;
- event category and type;
- occurrence/update/observation timestamps;
- point geometry;
- evidence classification;
- normalised facts;
- source metadata;
- raw observation ID, collection run ID, archive path and content hash.

## `GET /api/v1/events/[id]`

Returns a single persisted event using the same event contract as the list
endpoint. The route is used by the `/worldstate` explorer detail panel and is
the stable anchor for selected event drilldown.

## `GET /api/v1/raw/[id]`

Returns one raw observation plus the collection run that produced it.

The response includes:

- source and collection-run IDs;
- source record ID, observation and first/last-seen timestamps;
- archive path, content hash, schema version and parser version;
- evidence classification and metadata;
- the stored raw payload;
- linked collection-run status, endpoint, HTTP metadata, response headers,
  archive path, collector/parser versions, error details and metrics.

Use this endpoint when the frontend needs to show what the collector actually
stored before normalisation.

## `GET /api/v1/runs/[id]`

Returns one collection run plus `rawObservationCount` for that run.

The route exposes the collector execution record: source ID, status, endpoint,
timings, HTTP response details, archive path, content hash, collector/parser
versions, legacy-provenance marker, error payload and metrics. It is the API
anchor for run-level health and replay/debug panels.

## `GET /api/v1/runs`

Returns recent collection runs across all sources, newest first, with source
labels and `rawObservationCount` included per run.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `source_id` | `usgs-earthquakes` | One or more source catalogue IDs |
| `status` | `succeeded,failed` | One or more collector run statuses |
| `since` | `2026-07-01T00:00:00Z` | Inclusive lower run-start bound |
| `until` | `2026-07-17T00:00:00Z` | Inclusive upper run-start bound |
| `limit` | `30` | Page size, capped server-side |
| `cursor` | `30` | Cursor returned by the prior page |

This endpoint backs the `/worldstate` operations console.

## `GET /api/v1/runs/[id]/raw`

Returns payload-light raw-observation summaries for one collection run. Each
row includes source labels, timestamps, evidence classification, archive path
and content hash, but not the full raw payload. Fetch `/api/v1/raw/[id]` when a
full payload is required.

## `GET /api/v1/markets/quotes`

Returns persisted market quote observations.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `symbol` | `RTX,LMT,BTC-USD` | One or more quote symbols |
| `quote_type` | `equity,crypto` | One or more quote types |
| `source_id` | `yahoo-finance-market-quotes` | One or more source catalogue IDs |
| `since` | `2026-07-01T00:00:00Z` | Inclusive lower observation-time bound |
| `limit` | `40` | Page size, capped server-side |
| `cursor` | `40` | Cursor returned by the prior page |

## Frontend

Open `/worldstate` to use the first browser explorer for these endpoints. It
shows source health, source filtering, global operations history, operations
alerts, coverage by category/source/timeline, source run history, selected-run
raw summaries, operations summary health metrics, a MapLibre geospatial event
map, recent persisted events, market quotes, raw archive references,
collection-run metadata and raw-payload previews while leaving the existing
live OSIRIS dashboard untouched.
