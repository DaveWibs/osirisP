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
shows source health, recent persisted events, market quotes and raw archive
references while leaving the existing live OSIRIS dashboard untouched.
