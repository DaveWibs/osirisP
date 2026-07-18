# Ubuntu install wizard

OSIRIS includes a first-pass Ubuntu setup wizard for self-hosted installs that
use the world-state database.

Run it from the repository root:

```bash
npm run setup:wizard
```

Or run the guarded browser wizard:

```bash
npm run setup:gui
```

The launcher prints `http://localhost:3000/setup` and the generated setup
token. Mutating setup actions are disabled unless `OSIRIS_SETUP_ENABLED=1` is
present. Use `OSIRIS_SETUP_TOKEN` for any network-reachable host; the
unauthenticated override is only for isolated local setup.

The wizard covers:

- mounted disk path selection for PostgreSQL data and raw archives;
- browser-based storage selection through `/setup`;
- optional mounting of an existing filesystem on Ubuntu Server;
- optional `/etc/fstab` entry creation so the selected disk mounts at boot;
- `.env` generation with database credentials and world-state paths;
- host directory creation and ownership preparation;
- Docker Compose availability checks;
- Compose configuration validation for the combined OSIRIS + world-state stack.

## Disk mounting model

The safe workflow is:

1. Mount the disk first.
2. Run the wizard.
3. Let the wizard create `postgres` and `archive` directories on that mounted
   filesystem.

For a desktop-capable Ubuntu machine, use the **Disks** GUI to format and mount
the target disk at a stable path such as `/mnt/osiris-worldstate`, with
“mount at startup” enabled.

For Ubuntu Server, you have two safe options:

1. Mount the disk with your normal server workflow first (`/etc/fstab`,
   cloud-init, Ansible, Cockpit, or similar), then provide the mounted path to
   the wizard.
2. Let the wizard mount an already-formatted filesystem. It lists block
   devices with `lsblk`, asks for a device path such as `/dev/sdb1`, mounts it
   at a stable path such as `/mnt/osiris-worldstate`, and can append a UUID
   based `/etc/fstab` entry.

The wizard intentionally does not format or partition disks, because those
operations are destructive and must stay explicit.

## Storage setup modes

The wizard presents three storage modes:

| Mode | Use when | Result |
|---|---|---|
| Already mounted path | The disk is mounted by Disks, Cockpit, cloud-init or manual server setup | The wizard validates that the path is a mount root, then prepares `postgres` and `archive` directories |
| Mount existing filesystem now | The disk partition already has a filesystem but is not mounted yet | The wizard mounts it, can add `/etc/fstab`, then prepares OSIRIS directories |
| Local default path | You are testing or do not have a dedicated disk yet | The wizard uses `/srv/osiris-worldstate` on the current root filesystem |

If you choose a mounted-disk mode and the selected path is only backed by `/`,
the wizard stops unless you explicitly continue. This prevents accidentally
putting PostgreSQL data on the OS disk when you intended to use a dedicated
volume.

## Generated storage settings

The wizard writes these key values to `.env`:

```env
WORLDSTATE_DB_DATA=/mnt/osiris-worldstate/postgres
RAW_ARCHIVE_HOST_PATH=/mnt/osiris-worldstate/archive
RAW_ARCHIVE_PATH=/archive
EARTHQUAKE_DATA_MODE=database_with_live_fallback
FLIGHTS_DATA_MODE=database_with_live_fallback
MARKETS_DATA_MODE=database_with_live_fallback
NEWS_DATA_MODE=database_with_live_fallback
FIRES_DATA_MODE=database_with_live_fallback
WEATHER_DATA_MODE=database_with_live_fallback
SPACE_WEATHER_DATA_MODE=database_with_live_fallback
RADAR_DATA_MODE=database_with_live_fallback
AIR_QUALITY_DATA_MODE=database_with_live_fallback
CRYPTO_DATA_MODE=database_with_live_fallback
SATELLITES_DATA_MODE=database_with_live_fallback
MALWARE_DATA_MODE=database_with_live_fallback
CYBER_ATTACKS_DATA_MODE=database_with_live_fallback
CYBER_THREATS_DATA_MODE=database_with_live_fallback
COLLECTOR_SOURCES=all
```

`WORLDSTATE_DB_DATA` may be either a Docker volume name or an absolute host
path. For mounted-disk installs, use an absolute host path.

`COLLECTOR_SOURCES=all` starts the full supported source set in one collector
process. Replace it with a comma-separated list when you want a smaller
deployment footprint, for example `usgs-earthquakes,gdacs-disasters`.

`RAW_ARCHIVE_HOST_PATH` is the host-side directory for preserved upstream
responses. `RAW_ARCHIVE_PATH` is the container-side path used by the collector.

## Starting after the wizard

The recommended path is the one-command bring-up runner:

```bash
npm run worldstate:up
```

It re-checks the wizard's output before touching Docker: `.env` exists with the
required World-State variables (never printing secrets), the database data and
raw archive paths exist, the archive directory is writable by the configured
`COLLECTOR_UID`/`COLLECTOR_GID`, and the combined Compose model validates. It
then starts `osiris` and `collector` (which pulls in the database, migrations
and the in-container archive check), waits for collector health, `/api/health`
and `/api/v1/readiness`, and prints the final status with the `/worldstate`
URL and troubleshooting commands.

Useful variants:

```bash
npm run worldstate:up -- --preflight-only
npm run worldstate:up -- --readiness-timeout 900
```

A fresh install reports readiness as `not_ready` until the first collection
cycle lands and typically passes through `degraded` while sources fill in; the
runner keeps polling until readiness is `ready` or the timeout expires.

The equivalent manual startup remains:

```bash
docker compose -f docker-compose.yml -f docker-compose.worldstate.yml \
  up -d osiris collector
```

Check status:

```bash
docker compose -f docker-compose.yml -f docker-compose.worldstate.yml ps
docker compose -f docker-compose.yml -f docker-compose.worldstate.yml logs -f collector
```

## Browser wizard

The `/setup` browser wizard writes the same storage contract as the terminal
wizard. It lists detected block devices with `lsblk`, validates mounted-path
choices with `findmnt`, creates `postgres` and `archive` directories, writes a
backed-up `.env`, and can run the combined Compose validation.

The browser page also shows a readiness panel before mutation. Treat failed
items as blockers and warning items as deliberate operator choices:

- setup lock state and token mode;
- Ubuntu host detection;
- Docker availability for Compose validation/startup;
- `lsblk`, `findmnt` and `mount` availability for storage inspection;
- root/passwordless-sudo capability for mounting an existing filesystem;
- detected formatted block devices;
- whether an existing `.env` will be backed up.

After a successful apply, the page renders the resolved data/archive paths, the
backed-up `.env` location when applicable, whether Compose validation ran, and
the next verification/startup commands. Those commands intentionally use
server-safe shell and `curl` checks, plus a final browser URL for
`/worldstate`.

Mounting through the browser wizard requires the OSIRIS setup server process to
have root privileges or passwordless sudo for `mount`, `install`, and optional
`tee -a /etc/fstab`. If sudo would prompt for a password, the browser wizard
fails closed and reports the command that needs elevated access; use the
terminal wizard or mount the filesystem outside OSIRIS in that case.
