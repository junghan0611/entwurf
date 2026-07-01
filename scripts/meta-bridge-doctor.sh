#!/usr/bin/env bash
# meta-bridge-doctor.sh — the FAIL-LOUD surface for the meta-bridge (1.0.0 step 5).
#
# The runtime hook is best-effort + log (it must never scream into a user's
# terminal or block startup). THIS is where a silent miss becomes loud. It proves
# the whole chain a real user depends on:
#   platform -> claude/node toolchain -> the BAKED node path still resolves
#   (catches NixOS /nix/store churn after a rebuild) -> plugin installed+enabled
#   globally -> meta-record dir writable -> SessionStart actually landed a record
#   (hook log + >=1 claude-code meta-record). Plugin present but zero record
#   evidence = the dangerous silent miss -> non-zero exit.
#
# Exit 0 = the meta-bridge is wired AND proven to have created a garden citizen.
set -euo pipefail

MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"
CLAUDE_CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/meta-bridge-hook-log.sh
source "$REPO/scripts/meta-bridge-hook-log.sh"

fail=0
ok()   { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }

# pi agent dir resolution — mirror meta-session.ts (PI_CODING_AGENT_DIR or ~/.pi/agent).
agent_dir() {
  if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
    case "$PI_CODING_AGENT_DIR" in "~") echo "$HOME";; "~/"*) echo "$HOME/${PI_CODING_AGENT_DIR#\~/}";; *) echo "$PI_CODING_AGENT_DIR";; esac
  else echo "$HOME/.pi/agent"; fi
}
AGENT="$(agent_dir)"
META_SESSIONS="${ENTWURF_META_SESSIONS_DIR:-$AGENT/meta-sessions}"
HOOK_LOG="$AGENT/meta-bridge-hook.log"

echo "meta-bridge doctor"
echo "config=$CLAUDE_CFG  agent-dir=$AGENT"

echo "[platform]"
case "$(uname -s)" in
  Linux | Darwin) ok "$(uname -s) supported" ;;
  *) bad "$(uname -s) unsupported (Linux/macOS only)" ;;
esac

echo "[toolchain]"
if command -v claude >/dev/null; then ok "claude: $(claude --version 2>/dev/null | head -1)"; else bad "claude not on PATH"; fi
if command -v python3 >/dev/null; then ok "python3: $(python3 --version 2>/dev/null | head -1) (doorbell JSON parser)"; else bad "python3 not on PATH — FileChanged wake runtime would silently die"; fi
if command -v node >/dev/null; then
  NV="$(node -p 'process.versions.node' 2>/dev/null || echo 0)"; MJ="${NV%%.*}"; MN="$(printf '%s' "$NV" | cut -d. -f2)"
  if [ "${MJ:-0}" -gt 22 ] || { [ "${MJ:-0}" -eq 22 ] && [ "${MN:-0}" -ge 6 ]; }; then ok "node $NV (>= 22.6 strip-types)"; else bad "node $NV too old (need >= 22.6)"; fi
else bad "node not on PATH"; fi

echo "[managed config state]"
if command -v python3 >/dev/null; then
  # state.py check is the effect-based keyset-survival guard: it asserts every
  # pi-owned key (scalar policy, permissions items, plugin/marketplace,
  # statusLine, user MCP) still holds its expected value. If another consumer
  # (agent-config merge, hand edit) overwrote one, this fails. Surface WHICH key
  # drifted — a blanket "keyset drifted" sends the operator hunting.
  # NB: branch on the exit code, NOT on empty stderr. A bare CHECK_ERR="$(...)"
  # assignment dies under `set -e` the moment state.py exits nonzero (drift), so
  # the doctor would print "[managed config state]" and exit 1 BEFORE showing
  # which key drifted — silent instead of fail-loud. As an `if` condition the
  # substitution's nonzero status is consumed (set -e suspended), so we always
  # reach the detail. stderr (drift detail) is captured via `2>&1 >/dev/null`.
  if CHECK_ERR="$(python3 "$REPO/scripts/meta-bridge-state.py" check --repo "$REPO" --asm "$REPO/pi/meta-bridge/.assembled" 2>&1 >/dev/null)"; then
    ok "state file present and managed settings/MCP keyset survives intact"
  else
    bad "managed settings/MCP keyset missing or overwritten — another consumer may have clobbered a pi-owned key. Re-run ./run.sh install-meta-bridge. Drift detail:"
    printf '%s\n' "$CHECK_ERR" | sed 's/^/        /'
  fi
else
  bad "cannot validate stateful install without python3"
fi

echo "[plugin install (global / --scope user)]"
if claude plugin list 2>/dev/null | grep -q "$PLUGIN@$MKT_NAME"; then
  ok "$PLUGIN@$MKT_NAME present"
  claude plugin list 2>/dev/null | grep -A3 "$PLUGIN@$MKT_NAME" | grep -qi "enabled" && ok "enabled" || bad "installed but NOT enabled"
else
  bad "$PLUGIN@$MKT_NAME not installed — run ./run.sh install-meta-bridge"
fi

echo "[baked node path still resolves (NixOS store-churn guard)]"
CACHE_HOOKS="$(ls "$CLAUDE_CFG/plugins/cache/$MKT_NAME/$PLUGIN/"*/hooks/hooks.json 2>/dev/null | head -1 || true)"
if [ -n "$CACHE_HOOKS" ]; then
  # `[ -n "$CACHE_HOOKS" ]` proves the file EXISTS, not that the pattern matches.
  # If a future hooks.json drifts the command format, grep finds nothing, exits 1,
  # and under `set -euo pipefail` the doctor would abort here instead of reaching
  # the parse-drift diagnostic below. Swallow grep's nonzero in-pipe (same idiom as
  # line 158) so BAKED="" routes to that bad(...): an installed hooks.json exists but
  # the doctor cannot read its load-bearing hook command, so the store-churn guard is
  # blind — a verify-impossible state must fail loud, not pass as a soft warn (A3b).
  BAKED="$({ grep -oE '"command": "[^ ]+ \$\{CLAUDE_PLUGIN_ROOT\}/meta-bridge-hook.ts"' "$CACHE_HOOKS" || true; } | head -1 | sed -E 's/.*"command": "([^ ]+) .*/\1/')"
  if [ -n "$BAKED" ] && [ -x "$BAKED" ]; then ok "baked node exists + executable: $BAKED"
  elif [ -n "$BAKED" ]; then bad "baked node path is DEAD (nix GC / version bump?): $BAKED — re-run ./run.sh install-meta-bridge"
  else bad "could not parse baked node path from $CACHE_HOOKS — hook command format drift; doctor cannot verify the NixOS store-churn guard. Re-run ./run.sh install-meta-bridge or update the doctor parser."; fi
else
  warn "no installed hooks.json in cache (plugin not installed?)"
fi

echo "[statusline — garden identity visible in native Claude]"
if command -v python3 >/dev/null; then
  STATUSLINE_CMD="$(python3 - <<'PY'
import json, os
p=os.path.expanduser('~/.claude/settings.json') if not os.environ.get('CLAUDE_CONFIG_DIR') else os.path.join(os.environ['CLAUDE_CONFIG_DIR'], 'settings.json')
try:
    d=json.load(open(p))
    sl=d.get('statusLine') if isinstance(d, dict) else None
    print(sl.get('command','') if isinstance(sl, dict) else '')
except Exception:
    print('')
PY
)"
  EXPECTED_STATUSLINE="$REPO/scripts/meta-bridge-statusline.sh"
  if [ "$STATUSLINE_CMD" = "$EXPECTED_STATUSLINE" ]; then ok "statusLine.command is repo-owned: $STATUSLINE_CMD"; else bad "statusLine.command drifted (got '$STATUSLINE_CMD', expected '$EXPECTED_STATUSLINE')"; fi
  if [ -x "$EXPECTED_STATUSLINE" ]; then ok "statusline executable"; else bad "statusline script not executable: $EXPECTED_STATUSLINE"; fi
  SAMPLE_STATUSLINE_OUT="$(printf '%s' '{"session_id":"doctor-no-record","workspace":{"current_dir":"/tmp"},"model":{"id":"claude-sonnet-5"},"context_window":{"context_window_size":200000,"used_percentage":1,"current_usage":{"input_tokens":1}}}' | "$EXPECTED_STATUSLINE" 2>/dev/null || true)"
  if [ "$(printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | wc -l | tr -d ' ')" = "2" ] && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '1p' | grep -q 'tmp' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q '🪛' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q ' cc | s'; then ok "statusline synthetic execution emits two rows (work context + identity)"; else bad "statusline synthetic execution failed or omitted two-row work/identity marker"; fi
else
  bad "cannot validate statusline without python3"
fi

echo "[receiver MCP reach — entwurf_inbox_read in EVERY native session, NOT plugin-owned]"
# The plugin owns ONLY the wake/record hooks. The receiver self-fetch tool
# (entwurf_inbox_read) comes from the user's entwurf-bridge MCP wiring — a Claude
# Code / agent-config responsibility, never injected here (injecting from the
# plugin duplicates the server and drops its identity env). The honest test is
# GLOBAL REACH: a native session in an arbitrary cwd must see the tool. A
# PROJECT-scoped ~/.mcp.json is NOT enough (it only reaches its own project; a
# /tmp session would wake with no way to record its receipt). USER scope is.
# So probe from a neutral non-project cwd, exactly like a real native session.
if command -v claude >/dev/null; then
	MCP_GET="$(cd /tmp && claude mcp get entwurf-bridge 2>/dev/null || true)"
	if printf '%s\n' "$MCP_GET" | grep -q "Scope: User config" && printf '%s\n' "$MCP_GET" | grep -q "Status: .*Connected"; then
		ok "entwurf-bridge reachable from a neutral cwd (/tmp) as USER-scope MCP — every native session can entwurf_inbox_read"
	else
		bad "entwurf-bridge is not USER-scope+Connected from /tmp — a native session outside the wired project cannot entwurf_inbox_read, so a woken receipt is never recorded. A PROJECT-scoped ~/.mcp.json is not enough; wire it USER scope: claude mcp add -s user entwurf-bridge -e ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code -- bash \"$REPO/mcp/entwurf-bridge/start.sh\""
	fi
else
	warn "claude not on PATH — cannot probe MCP reach"
fi

echo "[meta-record store]"
mkdir -p "$META_SESSIONS" 2>/dev/null || true
if [ -d "$META_SESSIONS" ] && [ -w "$META_SESSIONS" ]; then ok "writable: $META_SESSIONS"; else bad "meta-sessions dir not writable: $META_SESSIONS"; fi
if command -v node >/dev/null; then
  # Full store scan — mode by LOCATION (mirror mcp/entwurf-bridge/start.sh). Node
  # REFUSES --experimental-strip-types for a .ts under node_modules
  # (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so an INSTALLED package must scan
  # via the prebuilt dist JS (build-bridge emits it; files:["mcp/"] ships it); a DEV
  # CLONE lives outside node_modules and runs the .ts source. Before this split the
  # doctor always ran the .ts and reported a FALSE "corrupt records" FAIL on every
  # installed host (the 0.12.0 strip-types-under-node_modules class the bridge boot
  # already fixed, but this doctor helper still ran raw .ts).
  case "$REPO" in
    */node_modules/*)
      store_doctor="$REPO/mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"
      if [ -f "$store_doctor" ]; then
        store_scan=(node "$store_doctor" "$META_SESSIONS")
      else
        bad "installed under node_modules but prebuilt store-doctor missing: $store_doctor — the tarball ships it via prepack; reinstall @junghanacs/entwurf"
        store_scan=()
      fi
      ;;
    *)
      store_scan=(node --experimental-strip-types "$REPO/scripts/meta-bridge-store-doctor.ts" "$META_SESSIONS")
      ;;
  esac
  # Guard the expansion: bash 3.2 (macOS) + set -u errors on "${arr[@]}" for a
  # zero-length array, so only run/print when the command was actually built.
  if [ "${#store_scan[@]}" -gt 0 ]; then
    if "${store_scan[@]}" >/dev/null 2>&1; then
      ok "full store scan: no corrupt records, duplicate nativeSessionId, body/filename drift, or backend↔wakeMode contradiction"
    else
      bad "full store scan failed — corrupt/duplicate/drift meta-record(s) present. Inspect with: ${store_scan[*]}"
    fi
  fi
else
  bad "cannot scan meta-record store without node"
fi

echo "[SessionStart creation evidence (silent-miss guard)]"
# `set -euo pipefail` + empty store = doctor abort: with no *.meta.json the glob
# stays literal, grep exits 2 (no such file) / 1 (no match), pipefail propagates,
# and the doctor dies right after the section header — hiding the very "open a
# session" hint a fresh-but-correct install needs. Swallow grep's nonzero IN the
# pipe (same idiom as the `[ -f ] || continue` guard below) so CC_COUNT=0 cleanly.
CC_COUNT="$({ grep -l '"backend": "claude-code"' "$META_SESSIONS"/*.meta.json 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [ -f "$HOOK_LOG" ]; then
  ok "hook log present: $HOOK_LOG ($(wc -l < "$HOOK_LOG" | tr -d ' ') lines)"
  # ERROR is sticky in an append-only log: a one-time miss that was later recovered
  # must NOT keep the doctor red forever. Recovery is deliberately narrow: only a
  # later `INFO armed watch` proves a real SessionStart/CwdChanged wake path is
  # back. A later UserPromptSubmit `INFO attach record` is degraded record
  # backfill and must NOT clear an arm/upsert failure.
  if hook_status="$(meta_bridge_hook_log_status "$HOOK_LOG")"; then
    if [ "$hook_status" = "no-error" ]; then
      ok "hook log contains no ERROR line(s)"
    else
      ok "hook log has past ERROR(s) but a later INFO armed watch recovered the wake path"
    fi
  else
    bad "unrecovered hook ERROR (no later INFO armed watch) — last ERROR: $hook_status"
  fi
  if grep -q ' INFO sender marker ' "$HOOK_LOG"; then
    ok "sender marker evidence present (native meta-session can send as replyable garden-id)"
  else
    bad "no sender marker evidence in hook log — native sessions may receive mail but send as anonymous external-mcp. Re-run ./run.sh install-meta-bridge, then trigger a Claude prompt/SessionStart so the updated hook writes the marker."
  fi
else warn "no hook log yet ($HOOK_LOG) — open a Claude Code session first"; fi
if [ "${CC_COUNT:-0}" -ge 1 ]; then
  ok "$CC_COUNT claude-code meta-record(s) landed (garden citizen proven)"
else
  if claude plugin list 2>/dev/null | grep -q "$PLUGIN@$MKT_NAME"; then
    bad "plugin installed but ZERO claude-code meta-records — SILENT MISS. Open a Claude Code session; if still zero, inspect $HOOK_LOG."
  else
    warn "no meta-records yet (plugin not installed)"
  fi
fi

# ── writer-version parity (source ↔ assembled ↔ installed) ──────────────────
# The dangerous lag: a meta-record schema cut updates the repo SOURCE but the
# DEPLOYED bundle (what the live SessionStart hook runs) is not re-assembled, so
# new sessions are still written by the old writer — invisibly. "source complete"
# ≠ "deployed complete". This section makes the running writer version legible:
# live-write schema = does the bundle carry serializeMetaIdentity (v2 identity
# write) or only mintMetaRecord (v1). Hash = drift catch. The authority for "what
# records me" is the INSTALLED bundle; a mismatch vs source is a loud FAIL.
echo
echo "writer-version parity"
livewrite_schema() { # $1=meta-session.ts → v2|v1|absent
  [ -f "$1" ] || { echo "absent"; return; }
  if grep -q "serializeMetaIdentity" "$1"; then echo "v2"; else echo "v1"; fi
}
hash12() { [ -f "$1" ] && sha256sum "$1" | cut -c1-12 || echo "------------"; }
registry_for_ms() { # $1=bundle meta-session.ts → sibling plugin-root registry path
  [ -f "$1" ] || { echo ""; return; }
  dirname "$(dirname "$1")"
}

SRC_MS="$REPO/pi-extensions/lib/meta-session.ts"
SRC_REG="$REPO/pi/entwurf-capabilities.json"
ASM_MS="$REPO/pi/meta-bridge/.assembled/$PLUGIN/lib/meta-session.ts"
INST_MS="$(ls "$CLAUDE_CFG"/plugins/cache/"$MKT_NAME"/"$PLUGIN"/*/lib/meta-session.ts 2>/dev/null | head -1 || true)"

ASM_ROOT="$(registry_for_ms "$ASM_MS")"
INST_ROOT="$(registry_for_ms "${INST_MS:-}")"
ASM_REG="${ASM_ROOT:+$ASM_ROOT/entwurf-capabilities.json}"
INST_REG="${INST_ROOT:+$INST_ROOT/entwurf-capabilities.json}"

src_v="$(livewrite_schema "$SRC_MS")";            src_h="$(hash12 "$SRC_MS")";  src_reg_h="$(hash12 "$SRC_REG")"
asm_v="$(livewrite_schema "$ASM_MS")";            asm_h="$(hash12 "$ASM_MS")";  asm_reg_h="$(hash12 "${ASM_REG:-/none}")"
inst_v="$(livewrite_schema "${INST_MS:-/none}")"; inst_h="$(hash12 "${INST_MS:-/none}")"; inst_reg_h="$(hash12 "${INST_REG:-/none}")"

echo "  source    : $src_v  ($src_h)  registry=$src_reg_h"
echo "  assembled : $asm_v  ($asm_h)  registry=$asm_reg_h"
echo "  installed : $inst_v  ($inst_h)  registry=$inst_reg_h  ${INST_MS:-<none>}"

# store reality — distribution of schemaVersion across landed records.
sv1=0; sv2=0
for mf in "$META_SESSIONS"/*.meta.json; do
  [ -f "$mf" ] || continue
  case "$(grep -o '"schemaVersion"[[:space:]]*:[[:space:]]*[0-9]*' "$mf" | grep -o '[0-9]*$' | head -1)" in
    1) sv1=$((sv1 + 1)) ;; 2) sv2=$((sv2 + 1)) ;;
  esac
done
echo "  store     : v1=$sv1 v2=$sv2  (dual-read reads both)"

if [ -z "${INST_MS:-}" ]; then
  warn "no installed bundle to compare — run ./run.sh install-meta-bridge"
elif [ "$inst_h" = "$src_h" ]; then
  ok "deployed writer matches source ($inst_v) — no version lag"
else
  bad "deployed writer STALE: installed=$inst_v($inst_h) vs source=$src_v($src_h). The live hook records sessions with the OLD writer. Run ./run.sh install-meta-bridge to redeploy, then open a Claude session and re-run this doctor."
fi
if [ -f "$ASM_MS" ] && [ "$asm_h" != "$src_h" ]; then
  warn "assembled bundle differs from source ($asm_v vs $src_v) — stale .assembled; install re-assembles it"
fi

# v2 writer dependency: loadMetaCapabilityRegistry reads entwurf-capabilities.json
# at runtime. In the bundle layout it must sit at the plugin ROOT (resolved via
# `../` from lib/). A v2 bundle WITHOUT it throws on every mint/parse — a silent
# hook break that hash parity alone cannot see (it only hashes meta-session.ts).
check_registry_dep() { # $1=bundle meta-session.ts  $2=label  $3=registry-path  $4=registry-hash
  local ms="$1" label="$2" reg="$3" reg_h="$4"
  [ -f "$ms" ] && grep -q "serializeMetaIdentity" "$ms" || return 0 # v1/absent: no registry dep
  if [ ! -f "$reg" ]; then
    bad "$label is v2 but MISSING entwurf-capabilities.json at plugin root ($reg) — the v2 writer throws on mint/parse (silent hook break). Re-run ./run.sh install-meta-bridge (now bundles the registry)."
  elif [ "$reg_h" != "$src_reg_h" ]; then
    bad "$label v2 carries a STALE capability registry: $reg_h vs source=$src_reg_h ($reg). Re-run ./run.sh install-meta-bridge so the live writer and its load-bearing registry move together."
  else
    ok "$label v2 carries capability registry ($reg, $reg_h)"
  fi
}
check_registry_dep "$ASM_MS" "assembled" "${ASM_REG:-}" "$asm_reg_h"
check_registry_dep "$INST_MS" "installed" "${INST_REG:-}" "$inst_reg_h"

echo
echo "[entwurf-control / v2 dispatch surface]"
# The entwurf_v2 verb (0.11 step 5d-3) rides two surfaces: the pi-native tool (which
# depends on the --entwurf-control flag) and the MCP verb. These are SOURCE/static +
# single-gate checks — a live `pi --entwurf-control` model turn is 5d-5 matrix / live-smoke
# territory (it takes auth/model state), NOT the doctor's job. `pi --help | grep` is also
# avoided: flag exposure depends on extension-load conditions, so source+gate is the honest signal.
V2_CONTROL_SRC="$REPO/pi-extensions/entwurf-control.ts"
V2_SURFACE_SRC="$REPO/pi-extensions/lib/entwurf-v2-surface.ts"
V2_MCP_SRC="$REPO/mcp/entwurf-bridge/src/index.ts"
if [ -f "$V2_CONTROL_SRC" ] && grep -q 'ENTWURF_FLAG = "entwurf-control"' "$V2_CONTROL_SRC" && grep -q 'registerFlag(ENTWURF_FLAG' "$V2_CONTROL_SRC"; then
  ok "pi-native --entwurf-control flag registered (ENTWURF_FLAG)"
else
  bad "pi-native --entwurf-control flag not found in entwurf-control.ts — the v2 pi tool depends on it"
fi
if [ -f "$V2_CONTROL_SRC" ] && grep -q 'registerEntwurfV2Tool' "$V2_CONTROL_SRC" && grep -q 'name: "entwurf_v2"' "$V2_CONTROL_SRC"; then
  ok "pi-native entwurf_v2 tool registered"
else
  bad "pi-native entwurf_v2 tool not found in entwurf-control.ts"
fi
if [ -f "$V2_MCP_SRC" ] && grep -q 'server.tool(' "$V2_MCP_SRC" && grep -q '"entwurf_v2"' "$V2_MCP_SRC"; then
  ok "MCP entwurf_v2 verb registered"
else
  bad "MCP entwurf_v2 verb not found in entwurf-bridge"
fi
# check-entwurf-v2-surface is a SOURCE-SHAPE gate: it strip-types-runs a .ts gate
# (which imports typebox, a dev dep) to assert the surface source shape. Under
# node_modules that cannot run (strip-types refused + dev deps absent), AND its
# subject — the shipped surface source shape — is a repo/release invariant already
# enforced by the release gate. So on an INSTALLED host, confirm the surface source
# SHIPPED and defer the exhaustive gate; the live runtime wiring (flag/tool/MCP verb)
# is already proven by the grep checks just above. Running the full .ts gate here
# produced a FALSE "gate FAILED" on every installed host.
case "$REPO" in
  */node_modules/*)
    if [ -f "$V2_SURFACE_SRC" ]; then
      ok "check-entwurf-v2-surface: shipped surface source present; exhaustive source-shape gate is a repo/release invariant (not run under node_modules)"
    else
      bad "entwurf-v2-surface.ts missing from the installed package — the v2 surface source did not ship"
    fi
    ;;
  *)
    if [ -f "$V2_SURFACE_SRC" ] && (cd "$REPO" && node --experimental-strip-types scripts/check-entwurf-v2-surface.ts >/dev/null 2>&1); then
      ok "check-entwurf-v2-surface gate passes (surface adapter + pi-native/MCP wiring)"
    else
      bad "check-entwurf-v2-surface gate FAILED or surface adapter missing — run: ./run.sh check-entwurf-v2-surface"
    fi
    ;;
esac
# prefixRoots operator policy (5d-4b): the shared env SSOT both v2 surfaces read. Display
# ONLY — the parser SSOT lives in entwurf-v2-surface.ts (proven by check-entwurf-v2-surface);
# the doctor does NOT re-implement parsing. Unset ⇒ no prefix promotion (the safe default).
if [ -z "${ENTWURF_PREFIX_ROOTS:-}" ]; then
  ok "ENTWURF_PREFIX_ROOTS unset → no prefix auto-approve (preflight default trust)"
else
  ok "ENTWURF_PREFIX_ROOTS set → operator prefix-approve roots: $ENTWURF_PREFIX_ROOTS"
fi

echo
if [ "$fail" -eq 0 ]; then echo "meta-bridge doctor: PASS"; else echo "meta-bridge doctor: FAIL (see above)"; exit 1; fi
