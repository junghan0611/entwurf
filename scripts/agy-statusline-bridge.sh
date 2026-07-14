#!/usr/bin/env bash
# agy-statusline-bridge — install/uninstall/doctor for the agy (Antigravity) statusLine ownership
# (#46 Task 1). Sets agy settings.statusLine to entwurf's stable-bin renderer so the ambient
# status area shows driver + garden id (the claude meta-bridge statusLine symmetry, mirrored as a
# SEPARATE agy adapter — 봉인 7). SEPARATE state from agy-bridge (mcp_config) and dev-bin.
#
#   install    own the WHOLE statusLine subtree of agy settings.json → {type:custom,
#              command:entwurf-agy-statusline, enabled:true} (adopt a regular file / create /
#              REFUSE a symlink), recording an install-state for an honest inverse. The command
#              is a BARE stable bin — dev resolves it via `expose-dev-bin`, installed via the npm
#              bin-link. NEVER a repo/checkout path (#46 tripwire).
#   uninstall  honest inverse from the install-state (restore the captured statusLine preimage).
#   doctor     STATIC: settings.json (the SINGLE root agy reads statusLine from — proven by the
#              Task-1 capture, NOT the 2-candidate mcp_config root) resolves, parses, and carries
#              OUR command that RESOLVES. LIVE: only when an agy process exists, else honest SKIP.
#
# Paths (all overridable for the isolated smoke):
#   AGY_SETTINGS_CONFIG    install target       (default: ~/.gemini/antigravity-cli/settings.json)
#   AGY_STATUSLINE_COMMAND command to register  (default: entwurf-agy-statusline — a stable bin)
#   XDG_DATA_HOME          install-state root    (state at $XDG_DATA_HOME/entwurf/agy-statusline/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/agy-statusline-config.py"

SETTINGS="${AGY_SETTINGS_CONFIG:-$HOME/.gemini/antigravity-cli/settings.json}"
COMMAND="${AGY_STATUSLINE_COMMAND:-entwurf-agy-statusline}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/agy-statusline"
STATE_FILE="$STATE_DIR/install-state.json"

log()  { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# Is COMMAND runnable? NOTE: this checks OUR shell's PATH. The honest question is "does the bin
# resolve in the environment AGY runs in" — agy lives at ~/.local/bin/agy, so a dev-bin link in
# ~/.local/bin (agy's own dir) naturally shares that PATH. This check is the best local proxy; a
# PATH divergence between our shell and agy's would still be a real (rare) gap. A bare name is
# looked up on PATH; an absolute/relative path must be an executable file.
command_resolvable() {
  local cmd="$1"
  case "$cmd" in
    */*) [ -x "$cmd" ] ;;
    *)   command -v "$cmd" >/dev/null 2>&1 ;;
  esac
}

do_install() {
  log "[agy-statusline install]"
  log "  target:  $SETTINGS"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable on this host — install still records it"
    log "        (expose-dev-bin/npm bin-link provides it; doctor will FAIL until it is on PATH)."
  fi
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" install "$SETTINGS" "$COMMAND" "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    3) fail "refused (symlink) — ${out}" ;;
    4) fail "invalid JSON — ${out}" ;;
    *) fail "install error (rc=$rc) — ${out}" ;;
  esac
  log "  installed. Verify with: ./run.sh doctor-agy-statusline"
}

do_uninstall() {
  log "[agy-statusline uninstall]"
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

do_doctor() {
  log "[agy-statusline doctor]"
  local hard_fail=0 runtime_ready=0 link_note=""
  if [ -L "$SETTINGS" ]; then
    link_note=" [symlink → $(readlink "$SETTINGS")]"
  fi

  log "── static (settings root: the single root agy reads statusLine from)"
  local status
  status="$(python3 "$CONFIG_PY" doctor-static "$SETTINGS")"
  case "$status" in
    file-absent)    log "  settings: file absent$link_note" ;;
    absent)         log "  settings: statusLine absent$link_note" ;;
    invalid-json)   log "  settings: INVALID JSON$link_note"; hard_fail=1 ;;
    not-ours)       log "  settings: statusLine present but NOT entwurf-owned (still the prior/agent-config command)$link_note" ;;
    configured\ *)
      local cmd="${status#configured }"
      if command_resolvable "$cmd"; then
        runtime_ready=1
        log "  settings: configured → '$cmd' (resolvable)$link_note"
      else
        log "  settings: configured → '$cmd' DANGLING (not on PATH / not executable — run expose-dev-bin)$link_note"
        hard_fail=1
      fi ;;
    *) log "  settings: unexpected status '$status'$link_note"; hard_fail=1 ;;
  esac

  # state-evidence (mirrors agy-bridge N1): install-state present ⇒ its managed settings MUST
  # still configure OUR command. state ∧ not-configured = DRIFT (installed, then removed) → FAIL.
  if [ -f "$STATE_FILE" ]; then
    local managed expected_settings
    expected_settings="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$SETTINGS")"
    if ! managed="$(python3 -c 'import json,os,sys; v=json.load(open(sys.argv[1])).get("managedSettingsPath"); assert isinstance(v,str) and os.path.isabs(v); print(os.path.abspath(v))' "$STATE_FILE" 2>/dev/null)"; then
      # isabs: install always records an absolute path — a relative one is corrupt, and
      # normalizing it against OUR cwd could bless whatever directory the doctor runs from.
      log "  state: CORRUPT — install-state is unreadable or its managedSettingsPath is missing/non-absolute: $STATE_FILE"
      hard_fail=1
    elif [ "$managed" != "$expected_settings" ]; then
      # The state describes a DIFFERENT settings file than the one agy reads here. The live
      # statusLine's provenance (whose command was there before ours) is therefore NOT recorded:
      # uninstalling would drop the key instead of restoring the operator's own command. A test
      # run that isolated HOME but SHARED XDG_DATA_HOME produces exactly this shape.
      log "  state: FOREIGN TARGET — install-state manages '$managed', but agy reads '$expected_settings' on this host. The live statusLine has no recorded preimage, so uninstall could not restore what was there before. Re-run install-agy-statusline against this host (and check whether an isolated test leaked its state)."
      hard_fail=1
    else
      local managed_status
      managed_status="$(python3 "$CONFIG_PY" doctor-static "$managed")"
      case "$managed_status" in
        configured\ *) log "  state: install-state present; its managed settings still configure entwurf-agy-statusline." ;;
        file-absent)
          log "  state: ORPHANED — install-state records $managed but the file is absent (HOME reset). Auto-cleaning stale state."
          rm -f "$STATE_FILE"
          ;;
        *) log "  state: DRIFT — install-state records $managed but it no longer configures entwurf-agy-statusline (removed since install)."; hard_fail=1 ;;
      esac
    fi
  else
    case "$status" in
      configured\ *) : ;;
      *) log "  note: no install-state and statusLine not entwurf-owned (never installed — this is the '?'; run install-agy-statusline)." ;;
    esac
  fi

  log "── live (runtime wiring)"
  if command -v pgrep >/dev/null 2>&1 && pgrep -x agy >/dev/null 2>&1; then
    if [ "$runtime_ready" -eq 1 ]; then
      if [ "$hard_fail" -eq 0 ]; then
        log "  live: agy is running AND statusLine resolves to our renderer — consistent with runtime wiring (statusline read NOT proven; agy re-reads settings on launch)."
      else
        log "  live: agy is running and statusLine resolves to our renderer, but ownership/state errors above keep this doctor red (statusline read NOT proven)."
      fi
    else
      log "  live: agy is running but statusLine is not our resolvable command — runtime wiring is broken."
      hard_fail=1
    fi
  else
    log "  live: SKIP — no agy process (cannot check runtime wiring; NOT a pass)."
  fi

  if [ "$hard_fail" -ne 0 ]; then
    fail "doctor found a broken statusLine (invalid JSON / dangling command / drift / broken live wiring)."
  fi
  log "doctor: ok."
}

case "${1:-}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  doctor)    do_doctor ;;
  *) echo "usage: agy-statusline-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
