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
# GLOBAL ROOT (the one file that matters): live agy reads its global MCP config from
# ~/.gemini/config/mcp_config.json (agy's own builtin doc: mcp_servers.md — "Global Configuration:
# ~/.gemini/config/mcp_config.json, applies to all sessions"). The ~/.gemini/antigravity-cli copy
# is a stale mis-wiring agy does NOT read as global — install now targets config/ and CLEANS the
# antigravity-cli entry (one-way migration). This is the "뭐가 글로벌인지" that had been confusing.
#
# Paths (all overridable for the isolated smoke):
#   AGY_MCP_CONFIG        install target (global) (default: ~/.gemini/config/mcp_config.json)
#   AGY_MCP_CONFIG_ALT    legacy root to clean    (default: ~/.gemini/antigravity-cli/mcp_config.json)
#   AGY_BRIDGE_COMMAND    command to register     (default: entwurf-bridge — a stable bin)
#   XDG_DATA_HOME         install-state root      (state at $XDG_DATA_HOME/entwurf/agy-bridge/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/agy-bridge-config.py"

GLOBAL_CONFIG="${AGY_MCP_CONFIG:-$HOME/.gemini/config/mcp_config.json}"
LEGACY_CONFIG="${AGY_MCP_CONFIG_ALT:-$HOME/.gemini/antigravity-cli/mcp_config.json}"
# agy's MCP tool-schema cache root (appDataDir/mcp). agy NEVER prunes an orphaned server's cache
# itself, so a cut-over-FROM key (pi-tools-bridge → entwurf-bridge rename) lingers forever as
# config garbage. install prunes ONLY these exact legacy keys — never a scan-and-delete that could
# touch another harness's LIVE MCP cache. Cache, not config: agy re-fetches if ever reconfigured.
AGY_MCP_CACHE_DIR="${AGY_MCP_CACHE_DIR:-$HOME/.gemini/antigravity-cli/mcp}"
LEGACY_CACHE_KEYS="pi-tools-bridge"
COMMAND="${AGY_BRIDGE_COMMAND:-entwurf-bridge}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/agy-bridge"
STATE_FILE="$STATE_DIR/install-state.json"
# agy's settings.json — the SAME file the statusline adapter owns, but a DIFFERENT element: it owns
# the `statusLine` subtree, we own one string in `permissions.allow`. Element-level ownership on
# both sides is what lets two adapters share a file without either clobbering the other (or the
# operator's own rules). Tracked in its own state file so each half has an honest inverse.
SETTINGS_FILE="${AGY_SETTINGS_CONFIG:-$HOME/.gemini/antigravity-cli/settings.json}"
PERMISSION_STATE_FILE="$STATE_DIR/permission-state.json"
ALLOW_RULE="mcp(entwurf-bridge/entwurf_v2)"

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

# Prune the agy MCP tool-schema cache for the KNOWN-legacy server keys (LEGACY_CACHE_KEYS). Removes
# ONLY the exact-named dirs — a symlink is left intact (not ours), and any OTHER server's cache is
# never touched. Idempotent (absent = no-op). One-shot cutover hygiene, not honest-inverse tracked.
prune_legacy_cache() {
  local key dir
  for key in $LEGACY_CACHE_KEYS; do
    dir="$AGY_MCP_CACHE_DIR/$key"
    [ -e "$dir" ] || continue
    if [ -L "$dir" ]; then
      log "  cache: legacy '$key' is a symlink — left intact (not ours to remove)"
      continue
    fi
    rm -rf "$dir" && log "  cache: pruned stale legacy MCP tool cache '$key'"
  done
}

do_install() {
  log "[agy-bridge install]"
  log "  target:  $GLOBAL_CONFIG"
  log "  command: $COMMAND"
  log "  state:   $STATE_FILE"
  if ! command_resolvable "$COMMAND"; then
    log "  note: '$COMMAND' is not currently resolvable on this host — install still records it"
    log "        (a stable bin is installed by the npm package; doctor will FAIL until it is on PATH)."
  fi
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" install "$GLOBAL_CONFIG" "$COMMAND" "$STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  ok: ${out}" ;;
    3) fail "refused (symlink) — ${out}" ;;
    4) fail "invalid JSON — ${out}" ;;
    *) fail "install error (rc=$rc) — ${out}" ;;
  esac
  # One-way migration: drop the stale entwurf-bridge entry from the LEGACY root (agy does not read
  # it as global MCP config). Non-fatal — a corrupt/symlinked legacy must not brick the install.
  local lout lrc
  set +e
  lout="$(python3 "$CONFIG_PY" clean-legacy "$LEGACY_CONFIG" 2>&1)"
  lrc=$?
  set -e
  case "$lout" in
    cleaned-*)     log "  legacy: removed stale entwurf-bridge from $LEGACY_CONFIG" ;;
    skip-symlink*) log "  legacy: $LEGACY_CONFIG is a symlink (someone else's SSOT) — left intact" ;;
    absent*|not-present*) : ;;  # nothing to clean
    *) [ "$lrc" -ne 0 ] && log "  legacy: WARN could not clean $LEGACY_CONFIG — ${lout}" ;;
  esac
  prune_legacy_cache
  install_permission
  log "  installed. Verify with: ./run.sh doctor-agy-bridge"
}

# The other half of a usable bridge: agy defaults every `mcp` action to Ask, so a registered-but-
# ungranted server stops for a y/n on EVERY entwurf_v2 call. We grant exactly our own tool —
# never mcp(*), never the operator's command/file rules; those are their trust decision, not the
# installer's.
#
# FAIL LOUD on an explicit install. A grant we could not write is a HALF-installed bridge: the
# server is registered, every call prompts, and reporting "installed" over that is the exact shape
# this repo exists to remove (a layer saying yes while the surface says no). The tolerance lives one
# level up, where it belongs: setup's wire_agy_bridge catches this nonzero and degrades to a
# reason-specific WARN, because agy is optional and must never brick a pi/Claude host.
install_permission() {
  local out rc
  set +e
  out="$(python3 "$CONFIG_PY" permission-install "$SETTINGS_FILE" "$PERMISSION_STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  permission: ${out} in $SETTINGS_FILE" ;;
    3) fail "permission refused (symlink) — $SETTINGS_FILE is someone else's SSOT; left intact. The MCP server is registered but NOT granted, so agy would prompt on every entwurf_v2 call. Add '$ALLOW_RULE' to permissions.allow there, or replace the symlink with a regular file and re-run." ;;
    4) fail "permission invalid JSON — $SETTINGS_FILE could not be parsed; left intact. The MCP server is registered but NOT granted, so agy would prompt on every entwurf_v2 call. Repair that file, then re-run." ;;
    *) fail "permission could not be granted (rc=$rc) — ${out}" ;;
  esac
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
  # Honest inverse of the grant. If the operator ALREADY had the rule before we installed, the
  # state records that and the rule stays — it was never ours to take away. A revoke we cannot
  # perform is a FAILED inverse, not a footnote: uninstall would otherwise report success while
  # leaving our rule in the operator's settings.
  set +e
  out="$(python3 "$CONFIG_PY" permission-uninstall "$PERMISSION_STATE_FILE" 2>&1)"
  rc=$?
  set -e
  case "$rc" in
    0) log "  permission: ${out}" ;;
    2) : ;;                              # never granted → nothing to undo (idempotent)
    3) fail "permission refused (symlink) — $SETTINGS_FILE became a symlink since install; our rule is STILL THERE. Remove '$ALLOW_RULE' from permissions.allow by hand at the link target." ;;
    *) fail "permission could not be revoked (rc=$rc) — ${out}" ;;
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

# Is our tool actually callable without a prompt? A registered server that stops for a y/n on every
# call is a half-installed bridge, and "why does agy ask me every time?" must not be a mystery — so
# the permission is doctor evidence, not silent state. The shadow case is the subtle one: agy
# evaluates Deny > Ask > Allow, so an operator rule like mcp(*) in their ask/deny list overrides our
# allow while our install-state still looks green. Name it rather than report a false pass.
doctor_permission() {
  local status installed=0
  # "Installed" = we have state for either half. A missing grant is only a NOTE on a host that never
  # installed the bridge; on an installed one it is DRIFT — the server is registered and every call
  # prompts, which is precisely the half-installed surface a green doctor must never bless. Same
  # distinction the mcp-key N1 check draws between "never installed" and "installed then loosened".
  if [ -f "$STATE_FILE" ] || [ -f "$PERMISSION_STATE_FILE" ]; then installed=1; fi
  status="$(python3 "$CONFIG_PY" permission-doctor "$SETTINGS_FILE")"
  case "$status" in
    configured)
      log "  permission ($SETTINGS_FILE): allow → '$ALLOW_RULE' (agy calls entwurf_v2 without prompting)"; return 0 ;;
    not-configured|absent)
      local what="'$ALLOW_RULE' NOT granted"
      [ "$status" = absent ] && what="settings file absent, so no grant"
      if [ "$installed" -eq 1 ]; then
        log "  permission ($SETTINGS_FILE): DRIFT — $what, but the bridge IS installed. agy defaults mcp to Ask, so EVERY entwurf_v2 call prompts: the server is registered and unusable without a y/n. Fix: ./run.sh install-agy-bridge"
        return 1
      fi
      log "  permission ($SETTINGS_FILE): $what (bridge not installed here — nothing to grant yet)"; return 0 ;;
    invalid-json)
      log "  permission ($SETTINGS_FILE): INVALID JSON — cannot read the permission engine's config"; return 1 ;;
    shadowed-by-*)
      local list rule
      list="${status%% *}"; list="${list#shadowed-by-}"
      rule="${status#* }"
      log "  permission ($SETTINGS_FILE): SHADOWED — your '$list' list carries '$rule', and agy evaluates Deny > Ask > Allow, so it OVERRIDES our allow of '$ALLOW_RULE'. agy will keep prompting (or blocking) on every entwurf_v2 call until that rule is narrowed."; return 1 ;;
    *) log "  permission ($SETTINGS_FILE): unexpected status '$status'"; return 1 ;;
  esac
}

do_doctor() {
  log "[agy-bridge doctor]"
  local hard_fail=0 configured_any=0

  log "── static (configured candidates)"
  doctor_static_one "global ($GLOBAL_CONFIG)" "$GLOBAL_CONFIG" || hard_fail=1
  doctor_static_one "legacy ($LEGACY_CONFIG)" "$LEGACY_CONFIG" || hard_fail=1
  doctor_permission || hard_fail=1
  # Did EITHER candidate carry a configured entwurf-bridge? (best-effort — re-read cheaply.)
  for c in "$GLOBAL_CONFIG" "$LEGACY_CONFIG"; do
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
