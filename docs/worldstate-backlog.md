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
