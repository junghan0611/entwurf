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
META_SESSIONS="${PI_META_SESSIONS_DIR:-$AGENT/meta-sessions}"
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
  if python3 "$REPO/scripts/meta-bridge-state.py" check --repo "$REPO" --asm "$REPO/pi/meta-bridge/.assembled" >/dev/null 2>&1; then
    ok "state file present and managed settings/MCP keyset is installed"
  else
    bad "state file missing or managed settings/MCP keyset drifted — run ./run.sh install-meta-bridge (stateful Phase 2 installer)"
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
  BAKED="$(grep -oE '"command": "[^ ]+ \$\{CLAUDE_PLUGIN_ROOT\}/meta-bridge-hook.ts"' "$CACHE_HOOKS" | head -1 | sed -E 's/.*"command": "([^ ]+) .*/\1/')"
  if [ -n "$BAKED" ] && [ -x "$BAKED" ]; then ok "baked node exists + executable: $BAKED"
  elif [ -n "$BAKED" ]; then bad "baked node path is DEAD (nix GC / version bump?): $BAKED — re-run ./run.sh install-meta-bridge"
  else warn "could not parse baked node path from $CACHE_HOOKS"; fi
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
  SAMPLE_STATUSLINE_OUT="$(printf '%s' '{"session_id":"doctor-no-record","workspace":{"current_dir":"/tmp"},"model":{"id":"claude-sonnet-4-6"},"context_window":{"context_window_size":200000,"used_percentage":1,"current_usage":{"input_tokens":1}}}' | "$EXPECTED_STATUSLINE" 2>/dev/null || true)"
  if [ "$(printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | wc -l | tr -d ' ')" = "2" ] && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '1p' | grep -q 'tmp' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q '🪛' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q ' cc | s'; then ok "statusline synthetic execution emits two rows (work context + identity)"; else bad "statusline synthetic execution failed or omitted two-row work/identity marker"; fi
else
  bad "cannot validate statusline without python3"
fi

echo "[receiver MCP reach — entwurf_inbox_read in EVERY native session, NOT plugin-owned]"
# The plugin owns ONLY the wake/record hooks. The receiver self-fetch tool
# (entwurf_inbox_read) comes from the user's pi-tools-bridge MCP wiring — a Claude
# Code / agent-config responsibility, never injected here (injecting from the
# plugin duplicates the server and drops its identity env). The honest test is
# GLOBAL REACH: a native session in an arbitrary cwd must see the tool. A
# PROJECT-scoped ~/.mcp.json is NOT enough (it only reaches its own project; a
# /tmp session would wake with no way to record its receipt). USER scope is.
# So probe from a neutral non-project cwd, exactly like a real native session.
if command -v claude >/dev/null; then
	MCP_GET="$(cd /tmp && claude mcp get pi-tools-bridge 2>/dev/null || true)"
	if printf '%s\n' "$MCP_GET" | grep -q "Scope: User config" && printf '%s\n' "$MCP_GET" | grep -q "Status: .*Connected"; then
		ok "pi-tools-bridge reachable from a neutral cwd (/tmp) as USER-scope MCP — every native session can entwurf_inbox_read"
	else
		bad "pi-tools-bridge is not USER-scope+Connected from /tmp — a native session outside the wired project cannot entwurf_inbox_read, so a woken receipt is never recorded. A PROJECT-scoped ~/.mcp.json is not enough; wire it USER scope: claude mcp add -s user pi-tools-bridge -e PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code -- bash \"$REPO/mcp/pi-tools-bridge/start.sh\""
	fi
else
	warn "claude not on PATH — cannot probe MCP reach"
fi

echo "[meta-record store]"
mkdir -p "$META_SESSIONS" 2>/dev/null || true
if [ -d "$META_SESSIONS" ] && [ -w "$META_SESSIONS" ]; then ok "writable: $META_SESSIONS"; else bad "meta-sessions dir not writable: $META_SESSIONS"; fi
if command -v node >/dev/null; then
  if node --experimental-strip-types "$REPO/scripts/meta-bridge-store-doctor.ts" "$META_SESSIONS" >/dev/null 2>&1; then
    ok "full store scan: no corrupt records, duplicate nativeSessionId, body/filename drift, or backend↔wakeMode contradiction"
  else
    bad "full store scan failed — corrupt/duplicate/drift meta-record(s) present. Inspect with: node --experimental-strip-types $REPO/scripts/meta-bridge-store-doctor.ts $META_SESSIONS"
  fi
else
  bad "cannot scan meta-record store without node"
fi

echo "[SessionStart creation evidence (silent-miss guard)]"
CC_COUNT="$(grep -l '"backend": "claude-code"' "$META_SESSIONS"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')"
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

echo
if [ "$fail" -eq 0 ]; then echo "meta-bridge doctor: PASS"; else echo "meta-bridge doctor: FAIL (see above)"; exit 1; fi
