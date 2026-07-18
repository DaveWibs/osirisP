#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_STACK=0
SKIP_WIZARD=0

usage() {
  cat >&2 <<'EOF'
Usage: bash scripts/osiris-server-bootstrap.sh [--start] [--skip-wizard]

Run this on the Ubuntu Server destination after cloning DaveWibs/osirisP.

It checks Docker access, installs Node dependencies from lockfiles, runs the
setup wizard when .env is missing, and validates the World-State preflight.

Options:
  --start        Run npm run worldstate:up after preflight passes.
  --skip-wizard  Do not run the interactive setup wizard even when .env is missing.
  --help         Show this help.
EOF
}

say() {
  printf '%s\n' "$*" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    say "Missing required command: $1"
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      START_STACK=1
      ;;
    --skip-wizard)
      SKIP_WIZARD=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      say "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

cd "${ROOT_DIR}"

say "OSIRIS World-State server bootstrap"
say "Repository: ${ROOT_DIR}"
say ""

require_command git
require_command npm
require_command docker

say "[1/5] Checking repository remote"
origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ "${origin_url}" != "https://github.com/DaveWibs/osirisP.git" && "${origin_url}" != "git@github.com:DaveWibs/osirisP.git" ]]; then
  say "warning: origin is ${origin_url:-unset}; expected DaveWibs/osirisP."
fi
git status --short --branch

say ""
say "[2/5] Checking Docker access"
if ! docker compose version >/dev/null; then
  say "Docker Compose is not available to this user."
  say "Install Docker Engine with the Compose plugin and make sure this user can access /var/run/docker.sock."
  exit 1
fi
docker compose version

say ""
say "[3/5] Installing Node dependencies from lockfiles"
npm ci
npm ci --prefix collector

say ""
say "[4/5] Ensuring .env exists"
if [[ -f .env ]]; then
  say ".env already exists; leaving it unchanged."
elif [[ "${SKIP_WIZARD}" -eq 1 ]]; then
  say ".env is missing and --skip-wizard was supplied."
  say "Run npm run setup:wizard before starting World-State."
  exit 1
else
  npm run setup:wizard
fi

say ""
say "[5/5] Running World-State preflight"
npm run worldstate:up -- --preflight-only

say ""
if [[ "${START_STACK}" -eq 1 ]]; then
  say "Starting World-State stack."
  npm run worldstate:up
else
  say "Bootstrap complete. Start the stack with:"
  say "  npm run worldstate:up"
  say ""
  say "Or rerun this bootstrap with --start."
fi
