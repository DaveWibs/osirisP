#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_STACK=0
SKIP_WIZARD=0
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_GROUP="$(id -gn "${TARGET_USER}" 2>/dev/null || printf '%s' "${TARGET_USER}")"

usage() {
  cat >&2 <<'EOF'
Usage: bash scripts/osiris-server-bootstrap.sh [--start] [--skip-wizard]

Run this on the Ubuntu Server destination after cloning DaveWibs/osirisP.

It installs missing Ubuntu prerequisites, checks Docker Compose access, installs
Node dependencies from lockfiles, runs the setup wizard when .env is missing,
validates the World-State preflight, and can start the stack.

Options:
  --start        Run npm run worldstate:up after preflight passes.
  --skip-wizard  Do not run the interactive setup wizard even when .env is missing.
  --help         Show this help.
EOF
}

say() {
  printf '%s\n' "$*" >&2
}

run_as_target() {
  if [[ "${EUID}" -eq 0 && "${TARGET_USER}" != "root" ]]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo -H -u "${TARGET_USER}" "$@"
    else
      runuser -u "${TARGET_USER}" -- "$@"
    fi
  else
    "$@"
  fi
}

run_privileged() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    say "sudo is required for: $*"
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    say "Missing required command: $1"
    exit 1
  fi
}

apt_install() {
  run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

apt_update() {
  disable_invalid_docker_source
  run_privileged apt-get update
}

disable_invalid_docker_source() {
  local docker_source="/etc/apt/sources.list.d/docker.list"
  if [[ ! -f "${docker_source}" ]]; then
    return
  fi
  local source_line codename
  source_line="$(grep -E '^deb \[arch=[^ ]+ signed-by=/etc/apt/keyrings/docker\.gpg\] https://download\.docker\.com/linux/ubuntu [a-z]+ stable$' "${docker_source}" || true)"
  if [[ -z "${source_line}" ]]; then
    say "Disabling malformed Docker apt source at ${docker_source}."
    run_privileged mv "${docker_source}" "${docker_source}.disabled.$(date +%Y%m%d%H%M%S)"
    return
  fi

  codename="$(awk '{print $(NF-1)}' <<<"${source_line}")"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL "https://download.docker.com/linux/ubuntu/dists/${codename}/Release" >/dev/null; then
      return
    fi
    say "Disabling unsupported Docker apt source for Ubuntu '${codename}' at ${docker_source}."
    run_privileged mv "${docker_source}" "${docker_source}.disabled.$(date +%Y%m%d%H%M%S)"
    return
  fi

  case "${codename}" in
    noble|jammy|focal)
      return
      ;;
  esac

  say "Disabling unverified Docker apt source for Ubuntu '${codename}' at ${docker_source}."
  run_privileged mv "${docker_source}" "${docker_source}.disabled.$(date +%Y%m%d%H%M%S)"
}

ensure_base_packages() {
  apt_update
  apt_install ca-certificates curl gnupg
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  say "Installing git."
  apt_update
  apt_install git
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
    if [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= 22 )); then
      return
    fi
    say "Node.js $(node --version) is too old; installing Node.js 22."
  else
    say "Installing Node.js 22 and npm."
  fi

  ensure_base_packages
  run_privileged install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | run_privileged gpg --batch --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg
  run_privileged chmod a+r /etc/apt/keyrings/nodesource.gpg
  printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
    | run_privileged tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  apt_update
  apt_install nodejs
}

docker_repo_codename() {
  # Docker sometimes lags brand-new Ubuntu codenames. Try the host codename
  # first, then fall back to current LTS repositories that Docker publishes.
  local host_codename=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    host_codename="${VERSION_CODENAME:-}"
  fi

  local candidate
  for candidate in "${host_codename}" noble jammy focal; do
    [[ -z "${candidate}" ]] && continue
    if curl -fsSL "https://download.docker.com/linux/ubuntu/dists/${candidate}/Release" >/dev/null; then
      printf '%s' "${candidate}"
      return
    fi
  done

  say "Could not find a supported Docker apt repository for this Ubuntu release."
  exit 1
}

install_docker_engine() {
  say "Installing Docker Engine and Docker Compose plugin."
  ensure_base_packages
  run_privileged install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | run_privileged gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  run_privileged chmod a+r /etc/apt/keyrings/docker.gpg

  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="$(docker_repo_codename)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' "${arch}" "${codename}" \
    | run_privileged tee /etc/apt/sources.list.d/docker.list >/dev/null

  apt_update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  run_privileged systemctl enable --now docker >/dev/null 2>&1 || true

  if [[ "${TARGET_USER}" != "root" ]]; then
    run_privileged usermod -aG docker "${TARGET_USER}" || true
  fi
}

ensure_docker_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  install_docker_engine
}

run_worldstate_command() {
  if run_as_target docker compose version >/dev/null 2>&1; then
    run_as_target "$@"
  elif [[ "${EUID}" -eq 0 ]] && docker compose version >/dev/null 2>&1; then
    "$@"
  else
    say "Docker works, but ${TARGET_USER} cannot access it yet."
    say "Run this once, then log out/in or run 'newgrp docker':"
    say "  sudo usermod -aG docker ${TARGET_USER}"
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

say "[1/6] Installing/checking host prerequisites"
ensure_git
ensure_node
ensure_docker_compose
require_command git
require_command npm
require_command docker
say "  git: $(git --version)"
say "  node: $(node --version)"
say "  npm: $(npm --version)"
say "  docker: $(docker --version)"

say ""
say "[2/6] Checking repository remote"
origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ "${origin_url}" != "https://github.com/DaveWibs/osirisP.git" && "${origin_url}" != "git@github.com:DaveWibs/osirisP.git" ]]; then
  say "warning: origin is ${origin_url:-unset}; expected DaveWibs/osirisP."
fi
git status --short --branch

say ""
say "[3/6] Checking Docker Compose"
docker compose version

say ""
say "[4/6] Installing Node dependencies from lockfiles"
run_as_target npm ci
run_as_target npm ci --prefix collector

say ""
say "[5/6] Ensuring .env exists"
if [[ -f .env ]]; then
  say ".env already exists; leaving it unchanged."
elif [[ "${SKIP_WIZARD}" -eq 1 ]]; then
  say ".env is missing and --skip-wizard was supplied."
  say "Run npm run setup:wizard before starting World-State."
  exit 1
else
  run_as_target npm run setup:wizard
fi

say ""
say "[6/6] Running World-State preflight"
run_worldstate_command npm run worldstate:up -- --preflight-only

say ""
if [[ "${START_STACK}" -eq 1 ]]; then
  say "Starting World-State stack."
  run_worldstate_command npm run worldstate:up
else
  say "Bootstrap complete. Start the stack with:"
  say "  npm run worldstate:up"
  say ""
  say "Or rerun this bootstrap with --start."
fi
