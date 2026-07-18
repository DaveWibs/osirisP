# World-State LLM handoff

This document is written for a fresh LLM or engineer taking over the OSIRIS
World-State work without access to the previous conversation.

## Non-negotiable repository rule

Work only in:

```text
DaveWibs/osirisP
```

Do not open pull requests against:

```text
simplifaisoul/osiris
```

That repository is the upstream/original and is out of scope for this work.

Also preserve the standing rule that PRs should be ready for review, not draft,
unless the user explicitly changes that instruction.

## Current state snapshot

As of 2026-07-18, the World-State work is in operational bring-up.

The latest open PR at the time this handoff was written is:

- PR: https://github.com/DaveWibs/osirisP/pull/33
- Title: `Add World-State runtime readiness`
- Branch: `agent/worldstate-runtime-readiness`
- Base: `master`
- Status when checked: open, ready-for-review, mergeable

The branch also contains the root status document:

- `WORLDSTATE_PROJECT_STATUS.md`

If PR #33 has not merged yet, continue from that branch or merge/rebase from
the fork master before starting the next milestone. If PR #33 has merged, start
from current `origin/master`.

## What exists

### Database and collector foundation

World-State persistence uses PostGIS and ordered SQL migrations:

- `docker-compose.worldstate.yml`
- `db/migrations/`
- `db/scripts/migrate.sh`
- `db/scripts/verify-clean-database.sh`
- `collector/`

The migration series currently ends at:

```text
0021_adsb_lol_aircraft_source
```

PR #33 runtime readiness treats 21 migrations and that latest version as the
current expected schema state.

### Versioned persisted API

The stable additive API surface is under `/api/v1`:

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
- `/api/v1/readiness` from PR #33

The existing live OSIRIS routes are intentionally left in place.

### Main World-State frontend

The additive frontend is:

```text
src/app/worldstate/page.tsx
```

It consumes the versioned APIs and renders:

- source catalogue and drilldown
- event list and map
- raw evidence chains
- collection run detail
- run raw-observation summaries
- market quotes
- operations summary
- operations alerts
- coverage rollups
- runtime readiness from PR #33

Do not replace the main OSIRIS dashboard as part of this work. Add World-State
surfaces alongside it.

### Setup wizard

Ubuntu setup work lives in:

- `scripts/osiris-install-wizard.sh`
- `scripts/osiris-gui-setup.sh`
- `src/app/setup/page.tsx`
- `src/app/api/setup/ubuntu/route.ts`
- `src/lib/setup/ubuntu-wizard.ts`
- `docs/ubuntu-install-wizard.md`

The setup wizard can prepare mounted-disk storage, generate `.env`, validate
Compose, and show setup readiness/next commands. It deliberately does not
format or partition disks.

## Known validation baseline

The repository has one known unrelated TypeScript baseline issue:

```text
src/app/page.tsx:961
OsintPanelProps.theme
```

`npx tsc --noEmit --incremental false` reports that `OsintPanel` is passed
`theme` and `setTheme` props not declared on `OsintPanelProps`.

World-State PRs should continue to report this honestly until it is fixed. Do
not claim a clean full typecheck while it remains.

`npm run build` has been passing because the current Next.js build skips full
type validation.

## Validation commands used so far

Use these commands for World-State application changes:

```bash
npx eslint src/lib/worldstate src/app/api/v1 src/app/worldstate src/app/api/health/route.ts
npm test -- src/lib/worldstate/service.test.ts src/app/api/v1/evidence-routes.test.ts
npm test
npm run build
git diff --check
npx tsc --noEmit --incremental false
```

For setup-wizard changes:

```bash
npx eslint src/lib/setup src/app/setup src/app/api/setup/ubuntu/route.ts
npm test -- src/lib/setup/ubuntu-wizard.test.ts
npm test
npm run build
git diff --check
npx tsc --noEmit --incremental false
```

For collector package changes:

```bash
npm ci --prefix collector
npm --prefix collector test
npm --prefix collector run lint
npm --prefix collector run typecheck
npm --prefix collector run build
```

Do not paste rendered Docker Compose config into docs or PRs because it can
include secrets. Use `config --quiet`, `config --services`, or targeted output.

## Immediate next milestone

Issue #34 (https://github.com/DaveWibs/osirisP/issues/34) is implemented:

```bash
npm run worldstate:up
```

runs `scripts/worldstate-up.mjs`, which validates `.env` without printing
secrets, checks the World-State storage/archive paths and archive write
permissions for the collector UID/GID, validates the combined Compose model,
starts `osiris` and `collector`, waits for collector health, `/api/health`
and `/api/v1/readiness`, then prints the final status and the `/worldstate`
URL. Pure helper logic lives in `scripts/worldstate-up-lib.mjs` with tests in
`scripts/worldstate-up.test.mjs` (included in `npm test`).

The next milestones are issue #35 (actionable readiness remediation) and issue
#36 (real Ubuntu Server mounted-disk verification, which also proves the
bring-up runner on target hardware).

## GitHub backlog created for continuation

Issues are enabled on `DaveWibs/osirisP` and the initial takeover backlog is:

- #34: https://github.com/DaveWibs/osirisP/issues/34 — Add one-command World-State bring-up runner
- #35: https://github.com/DaveWibs/osirisP/issues/35 — Add actionable remediation for World-State readiness failures
- #36: https://github.com/DaveWibs/osirisP/issues/36 — Run and document Ubuntu Server mounted-disk end-to-end verification
- #37: https://github.com/DaveWibs/osirisP/issues/37 — Expose collector diagnostics and recent source failures in the World-State UI
- #38: https://github.com/DaveWibs/osirisP/issues/38 — Fix baseline TypeScript issue in main OSIRIS page

Start with #34 unless the user explicitly changes priority.

## Branch and PR hygiene

Before opening or updating a PR:

1. Confirm `origin` is `https://github.com/DaveWibs/osirisP.git`.
2. Check the current branch and worktree.
3. Check for duplicate PRs in `DaveWibs/osirisP`.
4. Check that no PR exists in `simplifaisoul/osiris` for the branch.
5. Stage only intended files.
6. Push to the fork only.
7. Open ready PRs against `DaveWibs/osirisP:master`.

Useful checks:

```bash
git remote -v
git status --short --branch
gh repo view --json nameWithOwner,defaultBranchRef,url
gh pr list --repo DaveWibs/osirisP --head <branch> --state open --json number,title,url,headRefName,baseRefName,isDraft
gh pr list --repo simplifaisoul/osiris --head DaveWibs:<branch> --state open --json number,title,url,headRefName,baseRefName,isDraft
```

The second `gh pr list` is a guardrail only. Do not create or update upstream
PRs.

## Practical takeover sequence

1. Read `WORLDSTATE_PROJECT_STATUS.md`.
2. Read this file.
3. Check PR #33:

   ```bash
   gh pr view 33 --repo DaveWibs/osirisP --json state,mergedAt,url,headRefName,baseRefName,isDraft,mergeable
   ```

4. If PR #33 is open, decide whether to amend it or wait for merge.
5. If PR #33 is merged, update local master:

   ```bash
   git checkout master
   git pull --ff-only origin master
   ```

6. Start issue #34 on a new branch:

   ```bash
   git checkout -b agent/worldstate-bringup-runner
   ```

7. Build the bring-up runner in small testable helpers, then wire the script.
8. Validate with the commands above.
9. Open a ready PR to `DaveWibs/osirisP:master`.

## What not to do next

- Do not spend the next milestone on cosmetic UI improvements.
- Do not add Vercel configuration.
- Do not replace existing live OSIRIS routes.
- Do not make destructive disk operations automatic.
- Do not print secrets in docs, logs, PR bodies, or test output.
- Do not claim the Ubuntu Server mounted-disk path is proven until issue #36 is completed.
