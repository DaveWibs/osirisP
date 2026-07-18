#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
TARGET_USER="${SUDO_USER:-$(id -un)}"
SELECTED_MOUNT_ROOT=""

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

ask() {
  local prompt="$1"
  local default_value="$2"
  local value
  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt} [${default_value}]: " value
    printf '%s' "${value:-${default_value}}"
  else
    read -r -p "${prompt}: " value
    printf '%s' "${value}"
  fi
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

require_command() {
  command -v "$1" >/dev/null 2>&1
}

device_field() {
  local device="$1"
  local field="$2"
  lsblk -no "${field}" "${device}" 2>/dev/null | head -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

show_block_devices() {
  if ! require_command lsblk; then
    say "lsblk is unavailable; cannot list disks automatically."
    return
  fi

  say ""
  say "Current block devices:"
  lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINTS,MODEL >&2
}

append_fstab_entry() {
  local uuid="$1"
  local mount_point="$2"
  local fstype="$3"
  local escaped_mount

  if [[ -z "${uuid}" ]]; then
    say "No UUID detected; skipping /etc/fstab persistence."
    return
  fi

  if ! confirm "Add UUID=${uuid} to /etc/fstab so ${mount_point} mounts at boot?"; then
    say "Skipping /etc/fstab update."
    return
  fi

  escaped_mount="${mount_point// /\\040}"
  if grep -qs "UUID=${uuid}[[:space:]]" /etc/fstab; then
    say "/etc/fstab already contains UUID=${uuid}; leaving it unchanged."
    return
  fi

  say "Adding persistent mount entry to /etc/fstab."
  printf 'UUID=%s %s %s defaults,nofail 0 2\n' "${uuid}" "${escaped_mount}" "${fstype}" \
    | run_privileged tee -a /etc/fstab >/dev/null
}

update_env_storage_paths() {
  local data_root="$1"
  local env_tmp env_backup
  env_tmp="${ENV_FILE}.tmp.$$"
  env_backup="${ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"

  say "Updating .env storage paths to ${data_root}."
  cp "${ENV_FILE}" "${env_backup}"
  awk -v db_path="${data_root}/postgres" -v archive_path="${data_root}/archive" '
    /^WORLDSTATE_DB_DATA=/ {
      print "WORLDSTATE_DB_DATA=" db_path
      next
    }
    /^RAW_ARCHIVE_HOST_PATH=/ {
      print "RAW_ARCHIVE_HOST_PATH=" archive_path
      next
    }
    {
      print
    }
  ' "${ENV_FILE}" >"${env_tmp}"
  mv "${env_tmp}" "${ENV_FILE}"
  say "Backed up previous .env to ${env_backup}."
}

mount_existing_filesystem() {
  local mount_point="$1"
  local device fstype uuid current_mount

  show_block_devices
  say ""
  say "Enter the ext4 partition to mount at ${mount_point}."
  say "Example: /dev/sdb1"
  device="$(ask "Device path" "/dev/sdb1")"

  if [[ -z "${device}" || ! -b "${device}" ]]; then
    say "Device does not exist or is not a block device: ${device}"
    exit 1
  fi

  fstype="$(device_field "${device}" "FSTYPE")"
  uuid="$(device_field "${device}" "UUID")"
  current_mount="$(lsblk -no MOUNTPOINTS "${device}" 2>/dev/null | head -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

  if [[ -z "${fstype}" ]]; then
    say "${device} has no detected filesystem. Format it outside this script, then rerun."
    exit 1
  fi
  if [[ "${fstype}" != "ext4" ]]; then
    say "${device} is ${fstype}, not ext4. This doctor will mount existing filesystems but will not format or convert disks."
    if ! confirm "Continue mounting ${device} anyway?"; then
      exit 1
    fi
  fi
  if [[ -n "${current_mount}" && "${current_mount}" != "${mount_point}" ]]; then
    say "${device} is already mounted at ${current_mount}, not ${mount_point}."
    if confirm "Use ${current_mount} as the OSIRIS data root and update .env?"; then
      SELECTED_MOUNT_ROOT="${current_mount%/}"
      append_fstab_entry "${uuid}" "${SELECTED_MOUNT_ROOT}" "${fstype}"
      return
    fi
    say "No changes made. Unmount or adjust .env/mount point first."
    exit 1
  fi

  run_privileged install -d -m 0755 "${mount_point}"
  if ! is_mount_root "${mount_point}"; then
    say "Mounting ${device} at ${mount_point}."
    if [[ -n "${uuid}" ]]; then
      run_privileged mount "UUID=${uuid}" "${mount_point}"
    else
      run_privileged mount "${device}" "${mount_point}"
    fi
  fi

  if ! is_mount_root "${mount_point}"; then
    say "Mount failed or ${mount_point} is not a mount root."
    exit 1
  fi

  append_fstab_entry "${uuid}" "${mount_point}" "${fstype}"
  SELECTED_MOUNT_ROOT="${mount_point}"
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

latest_preserved_root() {
  local data_root="$1"
  local latest=""
  while IFS= read -r candidate; do
    latest="${candidate}"
  done < <(compgen -G "${data_root}.root-disk.*" | sort)
  printf '%s' "${latest}"
}

prepare_mount_point() {
  local data_root="$1"
  local suffix
  suffix="${data_root}.mountpoint.$(date +%Y%m%d%H%M%S)"

  if [[ -e "${data_root}" ]]; then
    say "Moving current unmounted ${data_root} aside to ${suffix}."
    run_privileged mv "${data_root}" "${suffix}"
  fi
  run_privileged install -d -m 0755 "${data_root}"
}

print_manual_mount_help() {
  local mount_root="$1"
  say ""
  say "Mount the formatted disk at ${mount_root} before continuing."
  say "For ext4, this script can do that for you. For another filesystem, mount it"
  say "manually in another shell and then continue here."
  say ""
  say "This script does not format disks."
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

    local preserved_root existing_preserved_root original_data_root
    original_data_root="${data_root}"
    existing_preserved_root="$(latest_preserved_root "${data_root}")"
    if [[ -n "${existing_preserved_root}" ]]; then
      preserved_root="${existing_preserved_root}"
      say "Using existing preserved root-disk data: ${preserved_root}"
      prepare_mount_point "${data_root}"
    else
      preserved_root="${data_root}.root-disk.$(date +%Y%m%d%H%M%S)"
      say "Moving ${data_root} to ${preserved_root}."
      run_privileged mv "${data_root}" "${preserved_root}"
      run_privileged install -d -m 0755 "${data_root}"
    fi

    print_manual_mount_help "${data_root}"
    say ""
    SELECTED_MOUNT_ROOT=""
    if confirm "Mount an existing ext4 filesystem now?"; then
      mount_existing_filesystem "${data_root}"
    else
      read -r -p "After the real disk is mounted at ${data_root}, press Enter to continue."
      SELECTED_MOUNT_ROOT="${data_root}"
    fi

    if [[ -n "${SELECTED_MOUNT_ROOT}" && "${SELECTED_MOUNT_ROOT}" != "${data_root}" ]]; then
      data_root="${SELECTED_MOUNT_ROOT}"
      db_path="${data_root}/postgres"
      archive_path="${data_root}/archive"
      update_env_storage_paths "${data_root}"
    fi

    if ! is_mount_root "${data_root}"; then
      say "${data_root} is still not a mounted filesystem."
      say "Preserved root-disk data remains at: ${preserved_root}"
      exit 1
    fi

    if [[ "${data_root}" != "${original_data_root}" ]]; then
      say "OSIRIS storage root changed from ${original_data_root} to ${data_root}."
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
