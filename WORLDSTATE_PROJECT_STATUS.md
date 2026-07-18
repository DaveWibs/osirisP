# OSIRIS World-State project status

Last updated: 2026-07-18

Repository in use: `DaveWibs/osirisP`

Do not open pull requests against `simplifaisoul/osiris`. That upstream/original repository is out of scope for this work.

## Current position

The project is in the transition from “infrastructure exists” to “self-hosted operational bring-up”. The core World-State persistence layer, collector stack, database-backed APIs, `/worldstate` frontend console, Ubuntu setup wizard, disk-mount setup path and operational coverage panels are now in place.

The current open PR is:

- PR #33: `Add World-State runtime readiness`
- URL: https://github.com/DaveWibs/osirisP/pull/33
- Branch: `agent/worldstate-runtime-readiness`
- Target: `DaveWibs/osirisP:master`
- Status at time of writing: open, ready-for-review, mergeable
- Scope: adds `/api/v1/readiness` and a runtime readiness panel to `/worldstate`

Approximate completion for the current “get World-State running properly” layer: 78–80%.

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

- `0021_adsb_lol_aircraft_source`

The runtime readiness work in PR #33 expects 21 migrations and treats `0021_adsb_lol_aircraft_source` as the current latest migration.

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
- `/api/v1/raw/[id]`
- `/api/v1/runs`
- `/api/v1/runs/[id]`
- `/api/v1/runs/[id]/raw`
- `/api/v1/markets/quotes`
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

## Recently merged PRs

The recent sequence has been:

- PR #28: `Add World-State operations console`
- PR #29: `Add World-State operations summary`
- PR #30: `Add World-State operations alerts`
- PR #31: `Add World-State coverage console`
- PR #32: `Improve World-State setup readiness`

Open:

- PR #33: `Add World-State runtime readiness`

All PRs in this sequence were targeted at `DaveWibs/osirisP:master`, not the upstream/original repository.

## Validation status

For PR #33, the following passed locally:

- `npx eslint src/lib/worldstate src/app/api/v1 src/app/worldstate src/app/api/health/route.ts`
- `npm test -- src/lib/worldstate/service.test.ts src/app/api/v1/evidence-routes.test.ts`
- `npm test`
- `npm run build`
- `git diff --check`

The full test suite at the time of PR #33 was:

- 102 passed
- 2 skipped

The production build passed and included `/api/v1/readiness`.

Known baseline TypeScript issue remains:

- `src/app/page.tsx:961`
- `OsintPanelProps.theme`
- `npx tsc --noEmit --incremental false` reports that unrelated existing baseline issue

This baseline TypeScript issue has not been introduced by the World-State work. It should be fixed separately before claiming a clean full typecheck.

## Current branch state

At time of writing, the local checkout is on:

- `agent/worldstate-runtime-readiness`

Tracking:

- `origin/agent/worldstate-runtime-readiness`

Latest commit:

- `8e3fcb3 Add World-State runtime readiness`

PR #33 is open and mergeable.

## What is still missing before this is genuinely “up and running”

### 1. One-command bring-up

The next major milestone should be an operator-grade bring-up command, not more visual polish.

Target outcome:

```bash
npm run worldstate:up
```

or similar.

It should:

- check `.env`
- verify storage paths exist
- verify archive path permissions
- run Compose config validation
- start `osiris`, `db`, migration and collector services
- wait for Postgres health
- wait for collector health
- wait for `/api/health`
- poll `/api/v1/readiness`
- print a clear final status and URL

This should turn the existing setup pieces into a real install/start workflow.

### 2. Runtime failure guidance

The readiness panel currently reports state. The next layer should translate failures into exact actions.

Examples:

- migrations not current → run migration command
- no collector runs → check collector service/logs
- raw observations but no archive paths → check archive mount/permissions
- no events but raw exists → check parser/normaliser path
- database unconfigured → check `.env`/Compose service env

This can be done in API response `detail` strings first, and later expanded into UI action blocks.

### 3. Collector/service log access

The app does not yet expose collector logs or recent service errors in a friendly way.

Useful next API/UI:

- latest collector run errors
- failed source summaries
- recent error payloads
- archive path samples
- source-level “why not ready” detail

Some of this exists indirectly in operations summary/alerts, but it is not yet a complete bring-up troubleshooting console.

### 4. Real install verification on Ubuntu Server

Local tests/builds pass, but the full Ubuntu Server path still needs to be exercised on an actual target:

1. run the setup wizard
2. mount/select the storage path
3. generate `.env`
4. start Compose
5. let collector run
6. confirm `/api/v1/readiness` moves to `ready` or a sensible `degraded`
7. confirm `/worldstate` loads persisted data

Until this is run end-to-end on Ubuntu Server with mounted storage, there is still integration risk around:

- permissions
- Docker volume/bind mount behavior
- fstab entries
- collector UID/GID
- archive write access
- Postgres startup timing

### 5. The known TypeScript baseline issue

The existing `src/app/page.tsx:961` issue should be fixed soon because it prevents `npx tsc --noEmit --incremental false` from being clean.

This is not directly blocking World-State behavior because `npm run build` passes, but it is a quality gate problem.

## Recommended next milestone

After PR #33 merges, the next large PR should be:

## `Add World-State bring-up command`

Tracked in GitHub as:

- https://github.com/DaveWibs/osirisP/issues/34

Expected scope:

- add a root script, probably under `scripts/`
- add `package.json` command such as `worldstate:up` or `setup:worldstate:up`
- perform safe preflight checks
- start the combined Compose stack
- poll health/readiness endpoints
- print final status, URLs and next troubleshooting commands
- document the flow in `README.md`, `docs/ubuntu-install-wizard.md` and `docs/worldstate-development.md`
- add tests for any pure helper logic

This is the biggest practical step toward “we can install this and know it is running.”

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

- #34: https://github.com/DaveWibs/osirisP/issues/34 — Add one-command World-State bring-up runner
- #35: https://github.com/DaveWibs/osirisP/issues/35 — Add actionable remediation for World-State readiness failures
- #36: https://github.com/DaveWibs/osirisP/issues/36 — Run and document Ubuntu Server mounted-disk end-to-end verification
- #37: https://github.com/DaveWibs/osirisP/issues/37 — Expose collector diagnostics and recent source failures in the World-State UI
- #38: https://github.com/DaveWibs/osirisP/issues/38 — Fix baseline TypeScript issue in main OSIRIS page

## Short summary

The World-State work has moved from schema and API construction into operational bring-up. The project can now persist data, expose it through versioned APIs, render it in `/worldstate`, guide Ubuntu storage setup, and report runtime readiness through PR #33.

The next job is to make the full self-host startup path executable and verifiable with one command.
