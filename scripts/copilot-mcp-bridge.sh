#!/usr/bin/env bash
# Copilot MCP install adapter. Birth plugin and personal MCP stay separate.
# Owns ONE mcpServers.entwurf-bridge key; file wrapper is always mcpServers.
# Entry type is "local" (Copilot CLI writer), never "stdio".
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
CONFIG_PY="$HERE/copilot-mcp-config.py"
CONFIG="${COPILOT_MCP_CONFIG:-$HOME/.copilot/mcp-config.json}"
COMMAND="${COPILOT_MCP_COMMAND:-entwurf-bridge}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-mcp"
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
BOOT_PROBED_INVOCATION=""
BOOT_PROBED_RC=1
BOOT_PROBED_OUT=""
BOOT_DETAIL=""
command_boots() {
  local invocation="$1" out rc
  if [ "$invocation" = "$BOOT_PROBED_INVOCATION" ]; then
    BOOT_DETAIL="$BOOT_PROBED_OUT"
    return "$BOOT_PROBED_RC"
  fi
  set +e
  out="$("$REPO_DIR/run.sh" probe-bridge-command --invocation-json "$invocation" 2>&1)"
  rc=$?
  set -e
  BOOT_PROBED_INVOCATION="$invocation"; BOOT_PROBED_RC="$rc"; BOOT_PROBED_OUT="$out"; BOOT_DETAIL="$out"
  return "$rc"
}
do_install() {
  log "[copilot-mcp install]"
  log "  target:  $CONFIG"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable; install records it and doctor stays red until it is on PATH"
  fi
  local out rc
  set +e
  out="$(run_config install "$CONFIG" "$COMMAND" "$STATE_FILE")"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: $out" ;;
    3) fail "refused (symlink) — $out" ;;
    4) fail "invalid config/state — $out" ;;
    *) fail "install error (rc=$rc) — $out" ;;
  esac
  log "  installed. Verify with: ./run.sh doctor-copilot-mcp"
}
do_uninstall() {
  log "[copilot-mcp uninstall]"
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
    required = ("serverKey", "command", "detectMode", "configExistedBefore", "preimage")
    if state.get("schemaVersion") != 1 or any(key not in state for key in required): raise ValueError()
    if state.get("serverKey") != "entwurf-bridge": raise ValueError()
    value = state.get("managedConfigPath")
    if not isinstance(value, str) or not os.path.isabs(value): raise ValueError()
    print(os.path.abspath(value))
except Exception:
    raise SystemExit(1)
PY
}
do_doctor() {
  log "[copilot-mcp doctor]"
  local hard_fail=0 status out rc installed=0
  [ -f "$STATE_FILE" ] && installed=1
  set +e
  out="$(run_config doctor-static "$CONFIG" "$COMMAND")"
  rc=$?
  set -e
  status="${out##*$'\n'}"
  if [ "$rc" -ne 0 ]; then
    log "  config: unexpected config reader failure (rc=$rc): $out"
    if [ "$installed" -eq 1 ]; then hard_fail=1; fi
  else
    case "$status" in
      configured\ *)
        local invocation
        if ! invocation="$(python3 "$CONFIG_PY" doctor-invocation "$CONFIG" "$COMMAND")"; then
          log "  config: configured → '$COMMAND' but its exact invocation is unreadable"
          [ "$installed" -eq 1 ] && hard_fail=1
        elif command_boots "$invocation"; then
          log "  config: configured → '$COMMAND' (the exact configured invocation boots the entwurf MCP surface)"
        else
          log "  config: configured → '$COMMAND' does NOT serve MCP with its configured args/env"
          log "        $BOOT_DETAIL"
          [ "$installed" -eq 1 ] && hard_fail=1
        fi ;;
      symlink)
        log "  config: REFUSED symlink (someone else's SSOT)"
        [ "$installed" -eq 1 ] && hard_fail=1 ;;
      invalid-json|invalid-entry)
        log "  config: $status"
        [ "$installed" -eq 1 ] && hard_fail=1 ;;
      file-absent|not-ours)
        if [ "$installed" -eq 1 ]; then
          log "  config: $status (owned state present — this is drift)"
          hard_fail=1
        else
          log "  config: $status (not ours; run install-copilot-mcp to adopt)"
        fi ;;
      *)
        log "  config: unexpected status '$out'"
        [ "$installed" -eq 1 ] && hard_fail=1 ;;
    esac
  fi
  if [ -f "$STATE_FILE" ]; then
    local managed expected managed_status
    expected="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$CONFIG")"
    if ! managed="$(state_target)"; then
      log "  state: CORRUPT — $STATE_FILE has no absolute managedConfigPath"
      hard_fail=1
    elif [ "$managed" != "$expected" ]; then
      log "  state: FOREIGN TARGET — state manages '$managed', Copilot reads '$expected'"
      hard_fail=1
    else
      managed_status="$(run_config doctor-static "$managed" "$COMMAND" | tail -1)"
      case "$managed_status" in
        configured\ *) log "  state: install-state present; managed config still configures entwurf-bridge." ;;
        file-absent)
          log "  state: ORPHANED — managed config disappeared; removing stale state."
          rm -f "$STATE_FILE" ;;
        *)
          log "  state: DRIFT — managed config no longer satisfies the MCP contract ($managed_status)."
          hard_fail=1 ;;
      esac
    fi
  else
    log "  state: absent (no MCP ownership recorded)"
  fi

  if [ "$hard_fail" -ne 0 ]; then
    fail "doctor found a broken Copilot MCP configuration."
  fi
  log "doctor: ok."
}

case "${1:-}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  doctor) do_doctor ;;
  *) echo "usage: copilot-mcp-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
