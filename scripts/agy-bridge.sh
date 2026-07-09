#!/usr/bin/env bash
# agy-bridge — the agy (Antigravity) MCP install ADAPTER (봉인 7). Separate from the Claude
# marketplace install (no generalization); only the runner/reporting is shared, here.
#
#   install    register ONE entwurf-bridge server entry in the agy mcp_config (adopt a regular
#              file / create a new one / REFUSE a symlink — someone else's SSOT), recording an
#              install-state for an honest inverse. The command written is a STABLE bin
#              (`entwurf-bridge`), NEVER a repo/git-hash path (the oracle dangling lesson).
#   uninstall  honest inverse from the install-state (restore preimage / remove our key).
#   doctor     2-tier: STATIC proves both candidate configs (documented + observed) resolve,
#              parse, and carry a resolvable command; LIVE proves runtime-effectiveness only
#              when an agy process exists, else an honest SKIP (never a PASS in disguise).
#
# Paths (all overridable for the isolated smoke):
#   AGY_MCP_CONFIG        install target        (default: ~/.gemini/antigravity-cli/mcp_config.json)
#   AGY_MCP_CONFIG_ALT    2nd doctor candidate  (default: ~/.gemini/config/mcp_config.json)
#   AGY_BRIDGE_COMMAND    command to register   (default: entwurf-bridge — a stable bin)
#   XDG_DATA_HOME         install-state root    (state at $XDG_DATA_HOME/entwurf/agy-bridge/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/agy-bridge-config.py"

DOCUMENTED_CONFIG="${AGY_MCP_CONFIG:-$HOME/.gemini/antigravity-cli/mcp_config.json}"
OBSERVED_CONFIG="${AGY_MCP_CONFIG_ALT:-$HOME/.gemini/config/mcp_config.json}"
COMMAND="${AGY_BRIDGE_COMMAND:-entwurf-bridge}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/agy-bridge"
STATE_FILE="$STATE_DIR/install-state.json"

log()  { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# Is COMMAND runnable? A bare name is looked up on PATH; an absolute/relative path must be an
# executable file. A "dangling" command (the oracle lesson) fails here.
command_resolvable() {
  local cmd="$1"
  case "$cmd" in
    */*) [ -x "$cmd" ] ;;                 # a path → must be an executable file
    *)   command -v "$cmd" >/dev/null 2>&1 ;;  # a bare name → must be on PATH
  esac
}

do_install() {
  log "[agy-bridge install]"
  log "  target:  $DOCUMENTED_CONFIG"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable on this host — install still records it"
    log "        (a stable bin is installed by the npm package; doctor will FAIL until it is on PATH)."
  fi
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" install "$DOCUMENTED_CONFIG" "$COMMAND" "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    3) fail "refused (symlink) — ${out}" ;;
    4) fail "invalid JSON — ${out}" ;;
    *) fail "install error (rc=$rc) — ${out}" ;;
  esac
  log "  installed. Verify with: ./run.sh doctor-agy-bridge"
}

do_uninstall() {
  log "[agy-bridge uninstall]"
  log "  state: $STATE_FILE"
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" uninstall "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    2) log "  note: ${out}" ;;          # no state → nothing to undo (idempotent)
    3) fail "refused (symlink) — ${out}" ;;
    *) fail "uninstall error (rc=$rc) — ${out}" ;;
  esac
}

# Static-check ONE candidate config. Prints a status line; returns 1 on a hard failure
# (invalid JSON / configured-but-dangling command), 0 otherwise (absent / not-configured /
# configured+resolvable are not doctor failures — a candidate may legitimately be unused).
doctor_static_one() {
  local label="$1" candidate="$2"
  local link_note=""
  if [ -L "$candidate" ]; then
    link_note=" [symlink → $(readlink "$candidate")]"
  fi
  local status
  status="$(python3 "$CONFIG_PY" doctor-static "$candidate")"
  case "$status" in
    absent)         log "  $label: absent$link_note"; return 0 ;;
    not-configured) log "  $label: present but entwurf-bridge NOT configured$link_note"; return 0 ;;
    invalid-json)   log "  $label: INVALID JSON$link_note"; return 1 ;;
    configured\ *)
      local cmd="${status#configured }"
      if command_resolvable "$cmd"; then
        log "  $label: configured → '$cmd' (resolvable)$link_note"
        return 0
      fi
      log "  $label: configured → '$cmd' DANGLING (not on PATH / not executable)$link_note"
      return 1 ;;
    *) log "  $label: unexpected status '$status'$link_note"; return 1 ;;
  esac
}

do_doctor() {
  log "[agy-bridge doctor]"
  local hard_fail=0 configured_any=0

  log "── static (configured candidates)"
  doctor_static_one "documented ($DOCUMENTED_CONFIG)" "$DOCUMENTED_CONFIG" || hard_fail=1
  doctor_static_one "observed   ($OBSERVED_CONFIG)"   "$OBSERVED_CONFIG"   || hard_fail=1
  # Did EITHER candidate carry a configured entwurf-bridge? (best-effort — re-read cheaply.)
  for c in "$DOCUMENTED_CONFIG" "$OBSERVED_CONFIG"; do
    case "$(python3 "$CONFIG_PY" doctor-static "$c")" in configured\ *) configured_any=1 ;; esac
  done

  # N1 (state-evidence, mirrors the meta-bridge doctor): if we HAVE an install-state, the
  # managed config it recorded MUST still configure entwurf-bridge. state ∧ missing-key = DRIFT
  # (installed, then someone removed it — the actual "wiring came loose / ?" case) → FAIL. This
  # is the honest distinction from "never installed" (a note, below), which no state backs.
  if [ -f "$STATE_FILE" ]; then
    local managed
    managed="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("managedConfigPath",""))' "$STATE_FILE" 2>/dev/null || true)"
    if [ -n "$managed" ]; then
      local managed_status
      managed_status="$(python3 "$CONFIG_PY" doctor-static "$managed")"
      case "$managed_status" in
        configured\ *) log "  state: install-state present; its managed config still configures entwurf-bridge." ;;
        absent)
          log "  state: ORPHANED — install-state records $managed but the file is absent (HOME reset). Auto-cleaning stale state."
          rm -f "$STATE_FILE"
          ;;
        *) log "  state: DRIFT — install-state records $managed but it no longer configures entwurf-bridge (removed since install)."; hard_fail=1 ;;
      esac
    fi
  elif [ "$configured_any" -eq 0 ]; then
    log "  note: no install-state and neither candidate configures entwurf-bridge (never installed — this is the '?' the operator sees; run install-agy-bridge)."
  fi

  log "── live (runtime wiring)"
  if command -v pgrep >/dev/null 2>&1 && pgrep -x agy >/dev/null 2>&1; then
    if [ "$configured_any" -eq 1 ] && [ "$hard_fail" -eq 0 ]; then
      # HONEST label (N2): a running agy + a resolvable configured candidate is CONSISTENT with
      # runtime wiring, but it does NOT prove agy actually read that config — that needs MCP
      # tool-listing-grade evidence (deferred). Do not overclaim "runtime-effective".
      log "  live: agy is running AND a configured candidate has a resolvable command — consistent with runtime wiring (config-read NOT proven; MCP-tool-listing evidence deferred)."
    else
      log "  live: agy is running but no resolvable configured candidate — runtime wiring is broken."
      hard_fail=1
    fi
  else
    log "  live: SKIP — no agy process (cannot check runtime wiring; NOT a pass)."
  fi

  if [ "$hard_fail" -ne 0 ]; then
    fail "doctor found a broken candidate (invalid JSON / dangling command / broken live wiring)."
  fi
  log "doctor: ok (static candidates clean)."
}

case "${1:-}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  doctor)    do_doctor ;;
  *) echo "usage: agy-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
