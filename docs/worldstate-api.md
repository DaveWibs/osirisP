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

## `GET /api/v1/operations/diagnostics`

Returns direct collector bring-up diagnostics: which sources are failing and
the most recent failed collection runs, with enough context to answer why a
source is stale, failed or low-yield without shell access.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `since` | `2026-07-16T00:00:00Z` | Recent-window lower bound; defaults to the last 24 hours |
| `limit` | `20` | Maximum recent failed runs returned (1-100, default 20) |

The response contains:

- `failingSources`: one row per source with a failed run in the window —
  source labels/status, recent run/failure counts, the latest failed run ID,
  failure timestamp, HTTP status, endpoint, archive path and the collector
  error payload;
- `recentFailures`: the latest failed collection runs across all sources with
  run IDs, timestamps, HTTP status, endpoint, archive path, record count and
  error payloads.

Endpoints and error payloads are sanitised before exposure: URL credentials
are removed, sensitive-looking query parameters and object keys (key, token,
secret, password, signature, authorization) are redacted, embedded URLs inside
error messages get the same treatment, and long strings are truncated. Raw
un-sanitised evidence remains available only in the immutable archive.

## `GET /api/v1/readiness`

Returns the runtime bring-up state for a self-hosted World-State install. Use
this after running migrations and starting the Compose stack to confirm the app
can see a usable database, collector output and archive-backed evidence.

The response includes:

- top-level `status`: `ready`, `degraded` or `not_ready`;
- `checks`: migrations, active source catalogue, collector runs, raw archive
  evidence and normalised event availability;
- per-check `remediation`: concrete operator next actions for a `degraded` or
  `not_ready` check (migration/Compose commands, `.env` variable names to
  verify, API drilldown paths); empty when the check is `ready`;
- `summary`: migration count/latest version, source counts, run counts,
  raw/archive counts, event count and latest run/raw timestamps.

The database-unconfigured `503` response carries the same shape, with a single
`database` check whose remediation covers `.env`/Compose environment checks.
Remediation lines name variables and commands only; they never include secret
values.

This route intentionally reports operational readiness from the persisted data
model. It does not contact external providers or mutate the database.

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

## `GET /api/v1/notifications/outbox`

Returns queued notification rows with linked alert evidence and subscription
metadata. Destination references are not returned.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `status` | `pending,failed` | One or more queue statuses |
| `adapter` | `telegram` | Notification adapter |
| `topic` | `market_price_movement` | Notification topic |
| `severity` | `critical,warning` | One or more severities |
| `since` | `2026-07-16T00:00:00Z` | Inclusive lower queue-created bound |
| `limit` | `20` | Page size, capped server-side |
| `cursor` | `20` | Cursor returned by the prior page |

## `POST /api/v1/notifications/outbox`

Enqueues active persisted alerts for enabled notification subscriptions. The
insert is idempotent by alert, subscription and topic, so repeated calls do not
create duplicate queued messages.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `adapter` | `telegram` | Adapter to enqueue for |
| `kind` | `market_price_movement` | Alert kind to enqueue |
| `severity` | `critical,warning` | Alert severities to enqueue |
| `since` | `2026-07-16T00:00:00Z` | Inclusive lower alert-detected bound |

## `POST /api/v1/notifications/telegram/deliver`

Claims queued Telegram notifications, calls the Telegram Bot API when enabled,
and records each send result in `notification_delivery_attempts`.

This endpoint fails closed unless `WORLDSTATE_TELEGRAM_DELIVERY_TOKEN` is set
server-side and the request supplies `Authorization: Bearer <token>`.
`TELEGRAM_BOT_TOKEN` remains server-side and is required only when
`WORLDSTATE_TELEGRAM_NOTIFICATIONS_ENABLED=1` and dry-run mode is off.

## `GET /api/v1/source-discovery`

Returns durable candidate source metadata for provider review before new
collector adapters are promoted into the source catalogue.

Filters:

| Query parameter | Example | Meaning |
|---|---|---|
| `status` | `candidate,needs_review` | One or more review statuses |
| `provider` | `NOAA` | One or more provider names |
| `cost_class` | `free,free_tier` | One or more cost classes |
| `limit` | `20` | Page size, capped server-side |
| `cursor` | `20` | Cursor returned by the prior page |

## `POST /api/v1/source-discovery`

Creates or updates a candidate source by provider and endpoint URL. The route
requires `Authorization: Bearer <WORLDSTATE_SOURCE_DISCOVERY_TOKEN>` and fails
closed when that token is unset. Submitted endpoint, documentation and terms
URLs must be absolute HTTP(S) URLs without embedded credentials.

## Frontend

Open `/worldstate` to use the first browser explorer for these endpoints. It
shows source health, source filtering, global operations history, operations
alerts, runtime readiness, coverage by category/source/timeline, source run
history, selected-run raw summaries, operations summary health metrics, a
MapLibre geospatial event map, recent persisted events, market quotes, raw
archive references, collection-run metadata and raw-payload previews while
leaving the existing live OSIRIS dashboard untouched.
