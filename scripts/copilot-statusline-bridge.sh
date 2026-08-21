#!/usr/bin/env bash
# Copilot custom-footer state adapter; plugin birth and personal settings stay separate.
# Owns statusLine whole plus footer.showCustom only; dev-bin/npm resolves the bare command.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/copilot-statusline-config.py"
SETTINGS="${COPILOT_SETTINGS_CONFIG:-$HOME/.copilot/settings.json}"
COMMAND="${COPILOT_STATUSLINE_COMMAND:-entwurf-copilot-statusline}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-statusline"
STATE_FILE="$STATE_DIR/install-state.json"
log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
command_resolvable() {
  case "$1" in
    */*) [ -x "$1" ] ;;
    *) command -v "$1" >/dev/null 2>&1 ;;
  esac
}
run_config() {
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" "$@" 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  return "$rc"
}
do_install() {
  log "[copilot-statusline install]"
  log "  target:  $SETTINGS"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable; install records it and doctor stays red"
  fi
  local out rc
  set +e
  out="$(run_config install "$SETTINGS" "$COMMAND" "$STATE_FILE")"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: $out" ;;
    3) fail "refused (symlink) — $out" ;;
    4) fail "invalid settings/state — $out" ;;
    *) fail "install error (rc=$rc) — $out" ;;
  esac
  log "  installed. Verify with: ./run.sh doctor-copilot-statusline"
}
do_uninstall() {
  log "[copilot-statusline uninstall]"
  local out rc
  set +e
  out="$(run_config uninstall "$STATE_FILE")"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: $out" ;;
    2) log "  note: $out" ;;
    3) fail "refused (symlink) — $out" ;;
    *) fail "uninstall error (rc=$rc) — $out" ;;
  esac
}
state_target() {
  python3 - "$STATE_FILE" <<'PY'
import json, os, sys
try:
    state = json.load(open(sys.argv[1]))
    required = ("settingsExistedBefore", "statusLineExisted", "statusLinePreimage", "footerExisted", "showCustomExisted", "showCustomPreimage")
    if state.get("schemaVersion") != 1 or any(key not in state for key in required): raise ValueError()
    value = state.get("managedSettingsPath")
    if not isinstance(value, str) or not os.path.isabs(value): raise ValueError()
    print(os.path.abspath(value))
except Exception:
    raise SystemExit(1)
PY
}
do_doctor() {
  log "[copilot-statusline doctor]"
  local hard_fail=0 status out rc
  set +e
  out="$(run_config doctor-static "$SETTINGS" "$COMMAND")"
  rc=$?
  set -e
  status="${out##*$'\n'}"
  if [ "$rc" -ne 0 ]; then
    log "  settings: unexpected config reader failure (rc=$rc): $out"
    hard_fail=1
  else
    case "$status" in
      configured\ *)
        if command_resolvable "$COMMAND"; then
          log "  settings: configured → '$COMMAND' (resolvable; render receipt not claimed)"
        else
          log "  settings: configured → '$COMMAND' DANGLING (not on PATH / not executable)"
          hard_fail=1
        fi ;;
      custom-disabled)
        log "  settings: statusLine is ours but footer.showCustom is not true"
        hard_fail=1 ;;
      symlink)
        log "  settings: REFUSED symlink (someone else's SSOT)"
        hard_fail=1 ;;
      invalid-json)
        log "  settings: INVALID JSON"
        hard_fail=1 ;;
      file-absent|not-ours)
        log "  settings: $status (not owned; run install-copilot-statusline to adopt)" ;;
      *)
        log "  settings: unexpected status '$out'"
        hard_fail=1 ;;
    esac
  fi
  if [ -f "$STATE_FILE" ]; then
    local managed expected managed_status
    expected="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$SETTINGS")"
    if ! managed="$(state_target)"; then
      log "  state: CORRUPT — $STATE_FILE has no absolute managedSettingsPath"
      hard_fail=1
    elif [ "$managed" != "$expected" ]; then
      log "  state: FOREIGN TARGET — state manages '$managed', Copilot reads '$expected'"
      hard_fail=1
    else
      managed_status="$(run_config doctor-static "$managed" "$COMMAND" | tail -1)"
      case "$managed_status" in
        configured\ *) log "  state: install-state present; managed settings remain configured." ;;
        file-absent)
          log "  state: ORPHANED — managed settings disappeared; removing stale state."
          rm -f "$STATE_FILE" ;;
        *)
          log "  state: DRIFT — managed settings no longer satisfy the footer contract ($managed_status)."
          hard_fail=1 ;;
      esac
    fi
  else
    log "  state: absent (no settings ownership recorded)"
  fi

  if [ "$hard_fail" -ne 0 ]; then
    fail "doctor found a broken Copilot statusLine configuration."
  fi
  log "doctor: ok."
}

case "${1:-}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  doctor) do_doctor ;;
  *) echo "usage: copilot-statusline-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
