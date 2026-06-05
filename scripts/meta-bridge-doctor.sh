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
if command -v node >/dev/null; then
  NV="$(node -p 'process.versions.node' 2>/dev/null || echo 0)"; MJ="${NV%%.*}"; MN="$(printf '%s' "$NV" | cut -d. -f2)"
  if [ "${MJ:-0}" -gt 22 ] || { [ "${MJ:-0}" -eq 22 ] && [ "${MN:-0}" -ge 6 ]; }; then ok "node $NV (>= 22.6 strip-types)"; else bad "node $NV too old (need >= 22.6)"; fi
else bad "node not on PATH"; fi

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

echo "[meta-record store]"
mkdir -p "$META_SESSIONS" 2>/dev/null || true
if [ -d "$META_SESSIONS" ] && [ -w "$META_SESSIONS" ]; then ok "writable: $META_SESSIONS"; else bad "meta-sessions dir not writable: $META_SESSIONS"; fi

echo "[SessionStart creation evidence (silent-miss guard)]"
REC_COUNT="$(ls "$META_SESSIONS"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')"
CC_COUNT="$(grep -l '"backend": "claude-code"' "$META_SESSIONS"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')"
if [ -f "$HOOK_LOG" ]; then ok "hook log present: $HOOK_LOG ($(wc -l < "$HOOK_LOG" | tr -d ' ') lines)"; else warn "no hook log yet ($HOOK_LOG) — open a Claude Code session first"; fi
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
