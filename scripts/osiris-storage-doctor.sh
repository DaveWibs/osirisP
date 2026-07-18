#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
TARGET_USER="${SUDO_USER:-$(id -un)}"

say() {
  printf '%s\n' "$*" >&2
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

confirm() {
  local prompt="$1"
  local answer
  read -r -p "${prompt} [y/N]: " answer
  [[ "${answer}" =~ ^[Yy]$ ]]
}

read_env_value() {
  local key="$1"
  awk -v wanted="${key}" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      if (line !~ /^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/) {
        next
      }
      name = line
      sub(/[[:space:]]*=.*/, "", name)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name != wanted) {
        next
      }
      value = line
      sub(/^[^=]*=/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (value !~ /^["'\''"]/) {
        sub(/[[:space:]]+#.*$/, "", value)
        gsub(/[[:space:]]+$/, "", value)
      }
      if ((value ~ /^".*"$/ || value ~ /^'\''.+'\''$/) && length(value) >= 2) {
        value = substr(value, 2, length(value) - 2)
      }
      result = value
    }
    END {
      if (result != "") {
        print result
      }
    }
  ' "${ENV_FILE}"
}

read_env_positive_int() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(read_env_value "${key}")"
  if [[ "${value}" =~ ^[0-9]+$ ]] && (( value > 0 )); then
    printf '%s' "${value}"
  else
    printf '%s' "${fallback}"
  fi
}

is_named_volume() {
  local value="$1"
  [[ -n "${value}" && "${value}" != /* && "${value}" != .* ]]
}

resolve_host_path() {
  local value="$1"
  if [[ "${value}" == /* ]]; then
    printf '%s' "${value%/}"
  else
    value="${value#./}"
    printf '%s/%s' "${ROOT_DIR%/}" "${value%/}"
  fi
}

mount_target_for_path() {
  local path="$1"
  findmnt -T "${path}" -no TARGET 2>/dev/null | head -n 1 || true
}

is_mount_root() {
  local path="$1"
  local target
  target="$(mount_target_for_path "${path}")"
  [[ -n "${target}" && "$(readlink -f "${target}")" == "$(readlink -f "${path}")" ]]
}

compose() {
  docker compose -f docker-compose.yml -f docker-compose.worldstate.yml "$@"
}

copy_preserved_data() {
  local preserved_root="$1"
  local mounted_root="$2"

  if command -v rsync >/dev/null 2>&1; then
    run_privileged rsync -aHAX --numeric-ids "${preserved_root}/" "${mounted_root}/"
  else
    run_privileged cp -a "${preserved_root}/." "${mounted_root}/"
  fi
}

print_zfs_help() {
  local mount_root="$1"
  say ""
  say "The 4.5T device was previously reported as zfs_member."
  say "If it is still ZFS, mount/import it in another shell before continuing:"
  say "  apt-get update"
  say "  apt-get install -y zfsutils-linux"
  say "  zpool import"
  say "  zpool import <pool-name>"
  say "  zfs list"
  say ""
  say "Then make an OSIRIS dataset mounted at ${mount_root}, for example:"
  say "  zfs create -o mountpoint=${mount_root} <pool-name>/osiris-worldstate"
  say ""
  say "If the pool already has the right dataset, set or mount it at ${mount_root}"
  say "instead of creating a new one. Do not format the disk."
}

main() {
  cd "${ROOT_DIR}"

  say "OSIRIS storage doctor"
  say "Repository: ${ROOT_DIR}"
  say ""

  if [[ ! -f "${ENV_FILE}" ]]; then
    say ".env does not exist. Run the setup wizard first:"
    say "  bash scripts/osiris-server-bootstrap.sh"
    exit 1
  fi

  local db_data archive_data db_path archive_path db_root archive_root data_root
  db_data="$(read_env_value WORLDSTATE_DB_DATA)"
  archive_data="$(read_env_value RAW_ARCHIVE_HOST_PATH)"

  if [[ -z "${db_data}" || -z "${archive_data}" ]]; then
    say ".env is missing WORLDSTATE_DB_DATA or RAW_ARCHIVE_HOST_PATH."
    exit 1
  fi
  if is_named_volume "${db_data}"; then
    say "WORLDSTATE_DB_DATA uses Docker named volume ${db_data}; there is no host disk root to repair."
    exit 1
  fi

  db_path="$(resolve_host_path "${db_data}")"
  archive_path="$(resolve_host_path "${archive_data}")"
  db_root="$(dirname "${db_path}")"
  archive_root="$(dirname "${archive_path}")"
  if [[ "${db_root}" != "${archive_root}" ]]; then
    say "Database and archive paths do not share one storage root:"
    say "  Database root: ${db_root}"
    say "  Archive root:  ${archive_root}"
    exit 1
  fi
  data_root="${db_root}"

  say "Configured data root: ${data_root}"
  say "PostgreSQL path:      ${db_path}"
  say "Raw archive path:     ${archive_path}"
  say "Backing mount:        $(mount_target_for_path "${data_root}")"

  if is_mount_root "${data_root}"; then
    say ""
    say "${data_root} is already a mounted filesystem."
  else
    say ""
    say "${data_root} is not a mounted filesystem, so OSIRIS data is currently on the OS disk."
    say "This workflow stops the stack, preserves that directory, recreates ${data_root}"
    say "as an empty mount point, then waits for you to mount/import the real disk."
    if ! confirm "Stop OSIRIS and preserve the current root-disk data now?"; then
      say "No changes made."
      exit 1
    fi

    say ""
    say "Stopping the World-State stack."
    compose down

    local preserved_root
    preserved_root="${data_root}.root-disk.$(date +%Y%m%d%H%M%S)"
    say "Moving ${data_root} to ${preserved_root}."
    run_privileged mv "${data_root}" "${preserved_root}"
    run_privileged install -d -m 0755 "${data_root}"

    print_zfs_help "${data_root}"
    say ""
    read -r -p "After the real disk is mounted at ${data_root}, press Enter to continue."

    if ! is_mount_root "${data_root}"; then
      say "${data_root} is still not a mounted filesystem."
      say "Preserved root-disk data remains at: ${preserved_root}"
      exit 1
    fi

    say "Copying preserved OSIRIS data onto the mounted disk."
    copy_preserved_data "${preserved_root}" "${data_root}"
    say "Preserved root-disk copy remains at: ${preserved_root}"
  fi

  local collector_uid collector_gid
  collector_uid="$(read_env_positive_int COLLECTOR_UID 1000)"
  collector_gid="$(read_env_positive_int COLLECTOR_GID 1000)"

  say ""
  say "Preparing mounted storage permissions."
  run_privileged chmod 0755 "${data_root}"
  run_privileged install -d -m 0750 "${db_path}"
  run_privileged install -d -m 0750 "${archive_path}"
  run_privileged chown "${collector_uid}:${collector_gid}" "${archive_path}" || true
  run_privileged chmod 0750 "${archive_path}"

  say ""
  say "Storage is ready on the mounted disk."
  say "Start OSIRIS with:"
  say "  bash scripts/osiris-server-bootstrap.sh --start"
}

main "$@"
