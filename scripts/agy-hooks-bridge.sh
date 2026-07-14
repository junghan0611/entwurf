#!/usr/bin/env bash
# agy-hooks-bridge — install/uninstall/doctor for Antigravity PreInvocation birth imprint.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/agy-hooks-config.py"
HOOKS="${AGY_HOOKS_CONFIG:-$HOME/.gemini/config/plugins/entwurf-agy-imprint/hooks.json}"
LEGACY_HOOKS="${AGY_LEGACY_HOOKS_CONFIG:-$HOME/.gemini/antigravity-cli/hooks.json}"
LEGACY_PLUGIN_HOOKS="${AGY_LEGACY_PLUGIN_HOOKS_CONFIG:-$HOME/.gemini/config/plugins/entwurf-probe/hooks.json}"
PLUGIN_JSON="$(dirname "$HOOKS")/plugin.json"
COMMAND="${AGY_IMPRINT_COMMAND:-entwurf-agy-imprint}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/agy-hooks"
STATE_FILE="$STATE_DIR/install-state.json"

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

command_resolvable() {
  local cmd="$1"
  case "$cmd" in
    */*) [ -x "$cmd" ] ;;
    *) command -v "$cmd" >/dev/null 2>&1 ;;
  esac
}

do_install() {
  log "[agy-hooks install]"
  log "  target:  $HOOKS"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable on this host — install still records it"
    log "        (expose-dev-bin/npm bin-link provides it; doctor will FAIL until it is on PATH)."
  fi
  mkdir -p "$(dirname "$PLUGIN_JSON")"
  if [ ! -e "$PLUGIN_JSON" ]; then
    printf '{\n  "name": "entwurf-agy-imprint",\n  "version": "1.0.0",\n  "description": "Entwurf Antigravity PreInvocation imprint hook"\n}\n' > "$PLUGIN_JSON"
  fi
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" install "$HOOKS" "$COMMAND" "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    3) fail "refused (symlink) — ${out}" ;;
    4) fail "invalid JSON — ${out}" ;;
    *) fail "install error (rc=$rc) — ${out}" ;;
  esac

  # Hard-cut SSOT: agy's live hook surface is the plugin hooks.json above. A previous probe pass
  # wrote the same birth hook into ~/.gemini/antigravity-cli/hooks.json, which creates ambiguity
  # (or double PreInvocation if a future agy reads both). Remove ONLY our known legacy keys there;
  # preserve unrelated user hooks; refuse symlinks/corrupt JSON rather than guessing.
  local legacy_out legacy_rc legacy_plugin_out legacy_plugin_rc
  set +e
  legacy_out="$(python3 "$CONFIG_PY" cleanup-legacy "$LEGACY_HOOKS" "$HOOKS" 2>&1)"
  legacy_rc=$?
  set -e
  case "$legacy_rc" in
    0) log "  legacy top-level: ${legacy_out}" ;;
    3) fail "legacy top-level cleanup refused (symlink) — ${legacy_out}" ;;
    4) fail "legacy top-level cleanup invalid JSON — ${legacy_out}" ;;
    *) fail "legacy top-level cleanup error (rc=$legacy_rc) — ${legacy_out}" ;;
  esac
  set +e
  legacy_plugin_out="$(python3 "$CONFIG_PY" cleanup-legacy "$LEGACY_PLUGIN_HOOKS" "$HOOKS" 2>&1)"
  legacy_plugin_rc=$?
  set -e
  case "$legacy_plugin_rc" in
    0)
      log "  legacy plugin(entwurf-probe): ${legacy_plugin_out}"
      if [ ! -e "$LEGACY_PLUGIN_HOOKS" ]; then
        rm -f "$(dirname "$LEGACY_PLUGIN_HOOKS")/plugin.json"
        rmdir "$(dirname "$LEGACY_PLUGIN_HOOKS")" 2>/dev/null || true
      fi
      ;;
    3) fail "legacy plugin cleanup refused (symlink) — ${legacy_plugin_out}" ;;
    4) fail "legacy plugin cleanup invalid JSON — ${legacy_plugin_out}" ;;
    *) fail "legacy plugin cleanup error (rc=$legacy_plugin_rc) — ${legacy_plugin_out}" ;;
  esac
  log "  installed. Verify with: ./run.sh doctor-agy-hooks"
}

do_uninstall() {
  log "[agy-hooks uninstall]"
  log "  state: $STATE_FILE"
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" uninstall "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    2) log "  note: ${out}" ;;
    3) fail "refused (symlink) — ${out}" ;;
    *) fail "uninstall error (rc=$rc) — ${out}" ;;
  esac
}

do_doctor() {
  log "[agy-hooks doctor]"
  local hard_fail=0 link_note=""
  if [ -L "$HOOKS" ]; then link_note=" [symlink → $(readlink "$HOOKS")]"; fi

  log "── static (hooks root: Antigravity plugin PreInvocation birth imprint)"
  local status
  status="$(python3 "$CONFIG_PY" doctor-static "$HOOKS")"
  case "$status" in
    file-absent)    log "  hooks: file absent$link_note" ;;
    not-configured) log "  hooks: entwurf-agy-imprint hook absent$link_note" ;;
    invalid-json)   log "  hooks: INVALID JSON$link_note"; hard_fail=1 ;;
    not-ours)       log "  hooks: entwurf-agy-imprint key present but NOT ours$link_note" ;;
    configured\ *)
      local cmd="${status#configured }"
      if command_resolvable "$cmd"; then
        log "  hooks: configured → '$cmd' (resolvable)$link_note"
      else
        log "  hooks: configured → '$cmd' DANGLING (not on PATH / not executable)$link_note"
        hard_fail=1
      fi ;;
    *) log "  hooks: unexpected status '$status'$link_note"; hard_fail=1 ;;
  esac

  log "── legacy hook guards (must not carry entwurf/probe keys)"
  local legacy_status legacy_plugin_status
  legacy_status="$(python3 "$CONFIG_PY" doctor-legacy "$LEGACY_HOOKS" "$HOOKS")"
  case "$legacy_status" in
    absent) log "  legacy top-level: absent (ok)" ;;
    same-path) log "  legacy top-level: same as active target (ok under override)" ;;
    clean) log "  legacy top-level: present but carries no entwurf/probe hook keys (ok)" ;;
    symlink\ *) log "  legacy top-level: SYMLINK ${legacy_status#symlink } — cannot prove single-hook ownership"; hard_fail=1 ;;
    invalid-json) log "  legacy top-level: INVALID JSON — cannot prove single-hook ownership"; hard_fail=1 ;;
    owned\ *) log "  legacy top-level: DRIFT — still carries ${legacy_status#owned } (run install-agy-hooks to clean)"; hard_fail=1 ;;
    *) log "  legacy top-level: unexpected status '$legacy_status'"; hard_fail=1 ;;
  esac
  legacy_plugin_status="$(python3 "$CONFIG_PY" doctor-legacy "$LEGACY_PLUGIN_HOOKS" "$HOOKS")"
  case "$legacy_plugin_status" in
    absent) log "  legacy plugin(entwurf-probe): absent (ok)" ;;
    same-path) log "  legacy plugin(entwurf-probe): same as active target (ok under override)" ;;
    clean) log "  legacy plugin(entwurf-probe): present but carries no entwurf/probe hook keys (ok)" ;;
    symlink\ *) log "  legacy plugin(entwurf-probe): SYMLINK ${legacy_plugin_status#symlink } — cannot prove single-hook ownership"; hard_fail=1 ;;
    invalid-json) log "  legacy plugin(entwurf-probe): INVALID JSON — cannot prove single-hook ownership"; hard_fail=1 ;;
    owned\ *) log "  legacy plugin(entwurf-probe): DRIFT — still carries ${legacy_plugin_status#owned } (run install-agy-hooks to clean)"; hard_fail=1 ;;
    *) log "  legacy plugin(entwurf-probe): unexpected status '$legacy_plugin_status'"; hard_fail=1 ;;
  esac

  if [ -f "$STATE_FILE" ]; then
    local managed expected_hooks
    expected_hooks="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$HOOKS")"
    if ! managed="$(python3 -c 'import json,os,sys; v=json.load(open(sys.argv[1])).get("managedHooksPath"); assert isinstance(v,str) and os.path.isabs(v); print(os.path.abspath(v))' "$STATE_FILE" 2>/dev/null)"; then
      # isabs: install always records an absolute path — a relative one is corrupt, and
      # normalizing it against OUR cwd could bless whatever directory the doctor runs from.
      log "  state: CORRUPT — install-state is unreadable or its managedHooksPath is missing/non-absolute: $STATE_FILE"
      hard_fail=1
    elif [ "$managed" != "$expected_hooks" ]; then
      # The state describes a DIFFERENT hooks file than the one agy loads here — so the live hook
      # is unowned: uninstall would leave it in place, and its provenance (what the file held
      # before we wrote it) is unrecorded. A test run that isolated HOME but SHARED XDG_DATA_HOME
      # produces exactly this shape.
      log "  state: FOREIGN TARGET — install-state manages '$managed', but agy loads '$expected_hooks' on this host. The live PreInvocation hook is unowned. Re-run install-agy-hooks against this host (and check whether an isolated test leaked its state)."
      hard_fail=1
    else
      local managed_status
      managed_status="$(python3 "$CONFIG_PY" doctor-static "$managed")"
      case "$managed_status" in
        configured\ *) log "  state: install-state present; its managed hooks still configure entwurf-agy-imprint." ;;
        file-absent)
          log "  state: ORPHANED — install-state records $managed but the file is absent (HOME reset). Auto-cleaning stale state."
          rm -f "$STATE_FILE"
          ;;
        *) log "  state: DRIFT — install-state records $managed but it no longer configures entwurf-agy-imprint."; hard_fail=1 ;;
      esac
    fi
  else
    case "$status" in
      configured\ *) : ;;
      *) log "  note: no install-state and imprint hook not entwurf-owned (never installed — this keeps agy at '?'; run install-agy-hooks)." ;;
    esac
  fi

  if [ "$hard_fail" -ne 0 ]; then
    fail "doctor found broken agy hooks (invalid JSON / dangling command / drift)."
  fi
  log "doctor: ok."
}

case "${1:-}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  doctor) do_doctor ;;
  *) echo "usage: agy-hooks-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
