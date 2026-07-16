#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"

if [[ -z "${OSIRIS_SETUP_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    OSIRIS_SETUP_TOKEN="$(openssl rand -hex 24)"
  else
    OSIRIS_SETUP_TOKEN="$(date +%s%N | sha256sum | awk '{print $1}')"
  fi
fi

export OSIRIS_SETUP_ENABLED="${OSIRIS_SETUP_ENABLED:-1}"
export OSIRIS_SETUP_TOKEN

cat >&2 <<EOF
OSIRIS guarded GUI setup
========================
URL:   http://localhost:${PORT}/setup
Token: ${OSIRIS_SETUP_TOKEN}

Mutating setup actions are enabled for this server process only.
Stop the process when setup is complete.
EOF

cd "${ROOT_DIR}"
exec npm run dev -- --port "${PORT}"
