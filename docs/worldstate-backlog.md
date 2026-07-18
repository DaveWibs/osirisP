# World-State continuation backlog

This backlog mirrors the GitHub issues created for the next World-State
milestones. It exists so a local LLM handoff remains useful even if GitHub
context is not loaded.

Repository: `DaveWibs/osirisP`

## Priority order

1. [#43 Fold remaining persisted feeds into database-backed dashboard modes](https://github.com/DaveWibs/osirisP/issues/43)
   — implemented on `agent/worldstate-database-modes`; merge its PR
2. [#36 Run and document Ubuntu Server mounted-disk end-to-end verification](https://github.com/DaveWibs/osirisP/issues/36)
   — hardware-blocked; the last bring-up item
3. Robust World-State error logging and observability
   — planned; create a GitHub issue before implementation

Closed: #34 (PR #39), #35 (PR #41), #37 (PR #42), #38 (PR #40).

## #34 Add one-command World-State bring-up runner

Purpose: turn setup plus Compose plus runtime readiness into a repeatable
operator command.

Expected result:

```bash
npm run worldstate:up
```

Core behavior:

- validate `.env` without printing secrets;
- verify `WORLDSTATE_DB_DATA` and `RAW_ARCHIVE_HOST_PATH`;
- check archive permissions for `COLLECTOR_UID` and `COLLECTOR_GID`;
- run combined Compose validation;
- start `osiris` and `collector`;
- wait for Postgres, migrations, collector health, `/api/health`, and
  `/api/v1/readiness`;
- print final status and `/worldstate` URL.

Likely files:

- `package.json`
- `scripts/`
- possibly `src/lib/setup/` for testable helper logic
- `README.md`
- `docs/ubuntu-install-wizard.md`
- `docs/worldstate-development.md`

## #35 Add actionable remediation for World-State readiness failures

Purpose: make `/api/v1/readiness` tell the operator what to do next, not only
what is wrong.

Expected failure guidance:

- migrations not current → migration command;
- no collector runs → collector service/log commands;
- raw exists without archives → archive mount/permission checks;
- raw exists but no normalised events → parser/normaliser checks;
- database unconfigured → `.env`/Compose environment checks.

Likely files:

- `src/lib/worldstate/contract.ts`
- `src/lib/worldstate/service.ts`
- `src/app/api/v1/readiness/route.ts`
- `src/app/worldstate/page.tsx`
- `src/lib/worldstate/service.test.ts`
- `src/app/api/v1/evidence-routes.test.ts`
- `docs/worldstate-api.md`
- `docs/worldstate-development.md`

## #36 Run and document Ubuntu Server mounted-disk end-to-end verification

Purpose: prove the install path on the target class of machine.

Required verification:

- mounted storage path;
- setup wizard;
- `.env` generation;
- combined Compose startup;
- collector health;
- app health;
- `/api/v1/readiness`;
- `/worldstate`;
- restart/persistence check.

Documentation must include real command output with secrets removed.

## Robust World-State error logging and observability

Purpose: make failures visible and diagnosable without exposing secrets.

Expected result:

- structured server-side logs for collector runs, API failures, notification
  delivery, source-discovery writes and database operations;
- correlation IDs carried through request handling, collector runs,
  notification attempts and raw archive records where practical;
- sanitised context fields including source ID, run ID, endpoint identity,
  HTTP status, retry count, migration version and adapter name;
- explicit error categories for configuration, database, network, validation,
  upstream response, parser and archive-write failures;
- no secret-bearing URLs, bearer tokens, bot tokens, database passwords or full
  environment dumps in logs;
- operator-facing summaries surfaced through existing diagnostics/readiness
  APIs where useful.

Likely files:

- `collector/src/framework/`
- `collector/src/storage/`
- `src/lib/worldstate/service.ts`
- `src/app/api/v1/*/route.ts`
- `src/lib/worldstate/telegram-notifier.ts`
- `docs/worldstate-development.md`
- `docs/worldstate-api.md`

Likely files:

- `docs/ubuntu-install-wizard.md`
- `docs/worldstate-development.md`
- possibly a new `docs/worldstate-ubuntu-verification.md`

## #37 Expose collector diagnostics and recent source failures in the World-State UI

Purpose: make failed source bring-up easier to diagnose without shell access.

Expected output:

- recent failed sources;
- latest collector errors;
- source/run IDs;
- archive paths;
- timestamps;
- links into source/run drilldowns.

Likely files:

- `src/lib/worldstate/contract.ts`
- `src/lib/worldstate/service.ts`
- new or existing `/api/v1/operations/*` route
- `src/app/worldstate/page.tsx`
- tests and docs

## #38 Fix baseline TypeScript issue in main OSIRIS page

Purpose: restore a clean full repo typecheck.

Known failure:

```text
src/app/page.tsx:961
Property 'theme' does not exist on type 'OsintPanelProps'
```

Acceptance criteria:

- `npx tsc --noEmit --incremental false` passes;
- `npm run build` passes;
- existing OSINT panel behavior is preserved.

Likely files:

- `src/app/page.tsx`
- the component file defining `OsintPanelProps`

## Notes for future agents

- Keep these as separate PRs unless the user asks for a larger combined chunk.
- Issue #34 should be first because it directly advances “get it up and
  running”.
- Issue #38 is a quality gate and should not be hidden inside unrelated
  World-State feature PRs unless the user explicitly wants that.
- Satellite TLE and threat-intel compatibility modes have now been added on
  top of issue #43; do not reopen them as pending follow-up work.
- GDACS alert-level capture has also been added as migration
  `0022_gdacs_disaster_alert_level`, so weather database mode now includes
  persisted GDACS cyclone/flood/drought alerts.
- Market anomaly alert foundations have also been added as migration
  `0023_market_intelligence_alerts`, so crypto/market quote history is
  append-only and `/api/v1/alerts` can persist transparent price-movement
  anomaly alerts.
- Evidence-chain foundations have also been added as migration
  `0024_evidence_chain_graph`, so sourced directed graph edges can be stored
  and read through `/api/v1/evidence` without fabricating relationships.
- Notification outbox foundations have also been added as migration
  `0025_notification_outbox`, so active persisted alerts can be queued for
  enabled Telegram subscriptions without adding live delivery or secrets.
- Notification delivery lifecycle support has also been added as migration
  `0026_notification_delivery_attempts`, so send attempts can be audited and
  retries can move through sent, failed and dead-letter states.
- Telegram sender foundations have also been added, disabled by default, so a
  token-protected server-side trigger can claim queued Telegram notifications,
  call the Bot API and record delivery results without exposing bot tokens.
- Source-discovery foundations have also been added as migration
  `0027_source_discovery_candidates`, so candidate data sources can be stored,
  reviewed and listed through `/api/v1/source-discovery` before collector
  adapters are built.
