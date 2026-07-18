# OSIRIS World-State project status

Last updated: 2026-07-18

Repository in use: `DaveWibs/osirisP`

Do not open pull requests against `simplifaisoul/osiris`. That upstream/original repository is out of scope for this work.

## Current position

The project is in the transition from “infrastructure exists” to “self-hosted operational bring-up”. The core World-State persistence layer, collector stack, database-backed APIs, `/worldstate` frontend console, Ubuntu setup wizard, disk-mount setup path and operational coverage panels are now in place.

On 2026-07-18 the continuation backlog was executed: PR #39 (issue #34,
one-command bring-up runner `npm run worldstate:up`), PR #40 (issue #38,
TypeScript baseline fix — `npx tsc --noEmit --incremental false` is now clean),
PR #41 (issue #35, actionable readiness remediation) and PR #42 (issue #37,
collector diagnostics API/panel) all merged to master.

The current work is issue #43 on branch `agent/worldstate-database-modes`:
folding the remaining persisted feeds (news, fires, weather, space weather,
internet outages, air quality, crypto prices) into the same
live/database/database_with_live_fallback dashboard modes that earthquakes,
flights and markets already use.

Approximate completion for the “get World-State running properly” layer: 95%
code-complete. The only remaining bring-up item is issue #36 — real Ubuntu
Server mounted-disk end-to-end verification, which needs target hardware.

This percentage is not the whole OSIRIS product. It refers to the World-State persistence/setup/bring-up layer we have been building before moving deeper into the main body of the application.

For a fresh LLM takeover, read these files in order:

1. `WORLDSTATE_PROJECT_STATUS.md`
2. `docs/worldstate-llm-handoff.md`
3. `docs/worldstate-backlog.md`
4. `docs/worldstate-development.md`
5. `docs/ubuntu-install-wizard.md`

## What has been built

### 1. World-State persistence foundation

The repository now has a PostGIS-backed World-State database overlay with ordered migrations under `db/migrations/`.

Key components:

- `docker-compose.worldstate.yml`
- `db/scripts/migrate.sh`
- `db/scripts/verify-clean-database.sh`
- collector package under `collector/`
- world-state database adapter under `src/lib/worldstate/database.ts`
- world-state service layer under `src/lib/worldstate/service.ts`
- shared contracts under `src/lib/worldstate/contract.ts`

The migration set currently runs through:

- `0025_notification_outbox`

Runtime readiness expects 25 migrations and treats `0025_notification_outbox` as the current latest migration.

### 2. Collector/source coverage

The collector supports a broad initial source set through `COLLECTOR_SOURCES=all`, including:

- USGS earthquakes
- GDACS disasters
- NASA FIRMS / EONET fire and weather data
- NOAA weather / space-weather feeds
- abuse.ch / CISA threat intel
- satellite/TLE sources
- OpenAQ air-quality
- CoinGecko / Yahoo market data
- BBC / Al Jazeera / GDACS RSS
- Georgia Tech IODA internet outages
- airplanes.live / adsb.lol military ADS-B

Collector tests and normaliser tests already exist under `collector/test/`.

### 3. Versioned World-State API

The versioned persisted API surface now includes:

- `/api/v1/sources`
- `/api/v1/sources/[id]`
- `/api/v1/sources/[id]/runs`
- `/api/v1/events`
- `/api/v1/events/[id]`
- `/api/v1/evidence`
- `/api/v1/notifications/outbox`
- `/api/v1/raw/[id]`
- `/api/v1/runs`
- `/api/v1/runs/[id]`
- `/api/v1/runs/[id]/raw`
- `/api/v1/markets/quotes`
- `/api/v1/alerts`
- `/api/v1/operations/summary`
- `/api/v1/operations/alerts`
- `/api/v1/coverage`
- `/api/v1/readiness` in PR #33

These are additive. Existing live OSIRIS routes are not replaced.

### 4. `/worldstate` frontend

The `/worldstate` route is now the durable-data frontend for persisted observations.

It currently shows:

- source catalogue and source drilldown
- source filters
- event list and selected event detail
- MapLibre geospatial event display
- raw evidence chain
- collection-run detail
- run raw-observation summaries
- market quote rows
- operations summary
- operations alerts
- coverage by category/source/timeline
- runtime readiness panel in PR #33

The frontend intentionally reuses OSIRIS styling and is additive rather than a replacement for the main live dashboard.

### 5. Ubuntu setup wizard and disk path work

The setup work now covers both terminal and browser-guided setup.

Files:

- `scripts/osiris-install-wizard.sh`
- `scripts/osiris-gui-setup.sh`
- `src/app/setup/page.tsx`
- `src/app/api/setup/ubuntu/route.ts`
- `src/lib/setup/ubuntu-wizard.ts`
- `docs/ubuntu-install-wizard.md`

The setup wizard can:

- choose an already mounted path
- mount an existing formatted filesystem when the process has root/passwordless sudo
- optionally add a UUID-based `/etc/fstab` entry
- prepare `postgres` and `archive` directories
- write `.env`
- back up an existing `.env`
- enable database-backed compatibility modes
- set `COLLECTOR_SOURCES=all`
- validate the combined Compose model
- show readiness checks and next commands after setup

It deliberately does not format or partition disks.

### 6. Runtime readiness milestone

PR #33 adds a runtime bring-up check that answers: “is this installed system actually healthy enough to use?”

The new readiness API checks:

- database migrations are current
- active sources exist
- collector runs have been recorded
- raw observations exist
- raw observations have archive paths
- normalised event rows exist

It reports:

- top-level status: `ready`, `degraded`, or `not_ready`
- individual checks
- migration count/latest migration
- source counts
- run counts
- raw/archive counts
- event counts
- latest run/raw timestamps

The `/worldstate` page consumes this as a top-level runtime readiness panel.

### 7. Database-backed dashboard modes (issue #43, current branch)

The live dashboard's compatibility routes can now serve persisted World-State
data through the same three-mode contract as earthquakes/flights/markets:

- shared core: `src/lib/persisted/` (`database.ts` pool resolution keyed per
  feed, `service.ts` mode state machine + `persistedResponseHeaders`,
  `test-executor.ts` test double)
- per-feed libraries: `src/lib/{news,fires,weather,space-weather,radar,air-quality,crypto,satellites,threat-intel}/persisted.ts`
  each holding the SQL over the latest successful `collection_runs` row plus a
  builder that reproduces the exact live response contract
- rewired routes: `/api/news`, `/api/fires`, `/api/weather`,
  `/api/space-weather`, `/api/radar`, `/api/air-quality`, `/api/crypto`,
  `/api/satellites`, `/api/malware`, `/api/cyber-attacks`,
  `/api/cyber-threats`
- env contract per feed: `<PREFIX>_DATA_MODE`, `<PREFIX>_DATABASE_MAX_AGE_MS`,
  `<PREFIX>_DATABASE_WINDOW_MS` (event feeds default to a 24 h window, quote
  feeds 15 min)
- wiring: `docker-compose.yml` osiris env passthrough, `.env.example`, wizard
  `buildWizardEnv` enables all persisted modes, docs updated

`live` stays the default everywhere and never opens a database connection.
`database` fails closed with 503. `database_with_live_fallback` serves fresh
persisted data and logs a sanitised reason before falling back live.

The latest local continuation also added `0022_gdacs_disaster_alert_level`,
threaded GDACS RSS `alertlevel` and `country` through the collector evidence
path, and folded GDACS cyclone/flood/drought rows into weather database mode.

The alert-foundation continuation added `0023_market_intelligence_alerts`,
append-only crypto/market quote history, persisted `intelligence_alerts`,
and `/api/v1/alerts` GET/POST support for transparent market price-movement
anomaly alerts.

The evidence-chain continuation added `0024_evidence_chain_graph`, durable
`evidence_nodes` and `evidence_edges` tables, and read-only `/api/v1/evidence`
access for sourced directed graph edges.

The notification continuation added `0025_notification_outbox`, durable
notification subscriptions and outbox rows, and `/api/v1/notifications/outbox`
GET/POST support for queueing alert notifications without live Telegram
delivery or committed secrets.

## Recently merged PRs

The recent sequence has been:

- PR #28: `Add World-State operations console`
- PR #29: `Add World-State operations summary`
- PR #30: `Add World-State operations alerts`
- PR #31: `Add World-State coverage console`
- PR #32: `Improve World-State setup readiness`
- PR #33: `Add World-State runtime readiness`
- PR #39: `Add one-command World-State bring-up runner` (issue #34)
- PR #40: `Fix baseline TypeScript error in main OSIRIS page` (issue #38)
- PR #41: `Add actionable remediation to World-State readiness` (issue #35)
- PR #42: `Expose collector diagnostics in the World-State UI` (issue #37)

All PRs in this sequence were targeted at `DaveWibs/osirisP:master`, not the upstream/original repository.

## Validation status

For the issue #43 database-modes branch, the following passed locally:

- focused tests for the latest satellite/threat-intel slice:
  `npm test -- src/lib/satellites/persisted.test.ts src/lib/threat-intel/persisted.test.ts src/lib/setup/ubuntu-wizard.test.ts`
  — 15 passed
- `npm test` — 189 passed, 2 skipped
- `npm --prefix collector test` — 114 passed
- `npm --prefix collector run lint` — clean
- `npm --prefix collector run typecheck` — clean
- `npm --prefix collector run build` — clean
- `npx eslint` on every touched lib/route/setup path — clean (the repo still
  carries pre-existing lint debt in untouched routes and `src/app/page.tsx`)
- `docker compose -f docker-compose.yml -f docker-compose.worldstate.yml config --quiet`
- `npm run build`
- `git diff --check`
- `npx tsc --noEmit --incremental false` — **0 errors** (the old
  `src/app/page.tsx:961` baseline issue was fixed in PR #40; do not reintroduce
  type errors)

## Current branch state

At time of writing, the local checkout is on:

- `agent/worldstate-database-modes`

branched from `master` after the PR #42 merge. It carries issue #43: the
shared persisted-mode core (`src/lib/persisted/`), persisted feed libraries
for news, fires, weather, space weather, radar, air quality, crypto,
satellites and threat intel, the rewired routes, Compose/env/wizard wiring and
documentation.

## What is still missing before this is genuinely “up and running”

### 1. Real install verification on Ubuntu Server (issue #36 — needs hardware)

Everything else in the bring-up layer is code-complete and merged or in
review, but the full path has never been exercised on an actual Ubuntu Server
target with a mounted disk:

1. run the setup wizard (`npm run setup:wizard` or `npm run setup:gui`)
2. mount/select the storage path
3. generate `.env`
4. run `npm run worldstate:up`
5. let the collector complete a cycle
6. confirm `/api/v1/readiness` reaches `ready` (use the per-check remediation
   and `/api/v1/operations/diagnostics` if it does not)
7. confirm `/worldstate` and the database-backed dashboard feeds serve
   persisted data
8. restart and confirm persistence

Until this runs end-to-end there is residual integration risk around
permissions, Docker bind mounts, fstab, collector UID/GID, archive write
access and Postgres startup timing. Document the run with secrets removed
(issue #36 suggests a new `docs/worldstate-ubuntu-verification.md`).

### 2. Database-modes PR (issue #43) needs review/merge

The branch `agent/worldstate-database-modes` adds persisted dashboard modes
for news, fires, weather, space weather, radar, air quality and crypto. After
it merges, every captured feed except the known gaps below can serve durable
data.

Known deliberate gaps in the database modes:

- Space-weather flares report `begin`/`end` as null in database mode (the
  normalised row keys by peak time only; raw payloads retain full times).
- News database mode serves the persisted BBC/Al Jazeera/GDACS RSS capture;
  the Telegram scrape remains live-only by design (not captured).

### 3. Remaining operational polish (not started)

- Archive/database orphan reconciliation remains an explicit manual operation.

## Recommended next milestone

1. Review/merge the PR for issue #43 (database-backed dashboard modes).
2. Issue #36 — Ubuntu Server mounted-disk end-to-end verification, as soon as
   target hardware is available. This closes the bring-up layer.
3. Optional follow-ups: archive/database orphan reconciliation tooling.

## Repository rules to preserve

- Work only against `DaveWibs/osirisP`.
- Do not open PRs against `simplifaisoul/osiris`.
- Do not add Vercel deployment/configuration changes.
- PRs should be ready for review, not draft.
- Check for duplicate PRs before opening a new one.
- Mention the known `src/app/page.tsx:961` TypeScript baseline issue honestly if `tsc` is run.

## GitHub tickets created for continuation

Issues were enabled on `DaveWibs/osirisP` on 2026-07-18 so the continuation
work can be tracked in GitHub. The initial backlog is:

- #34: closed by PR #39 — one-command bring-up runner
- #35: closed by PR #41 — actionable readiness remediation
- #36: OPEN, blocked on hardware — Ubuntu Server mounted-disk end-to-end verification
- #37: closed by PR #42 — collector diagnostics
- #38: closed by PR #40 — TypeScript baseline fix
- #43: https://github.com/DaveWibs/osirisP/issues/43 — database-backed dashboard modes (current branch)

## Short summary

The World-State layer now persists 25 sources, exposes them through versioned
APIs and the `/worldstate` console, guides Ubuntu setup, brings the stack up
with one command (`npm run worldstate:up`), explains readiness failures with
concrete remediation, surfaces collector diagnostics, and (on the current
branch) serves persisted data through every captured dashboard feed via
database-backed modes, including satellites and threat-intel surfaces. The
full repo typecheck is clean.

What remains: merge issue #43, then prove the whole path on real Ubuntu Server
hardware (issue #36). After that, the bring-up layer is done and work can move
into analysis features on top of the persisted data.
