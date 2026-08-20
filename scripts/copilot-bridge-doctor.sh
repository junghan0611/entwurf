#!/usr/bin/env bash
# copilot-bridge-doctor.sh — the FAIL-LOUD surface for the Copilot birth plugin (#82).
#
# WHY IT IS NOT `doctor-meta-bridge --copilot`. The Claude doctor's red conditions are
# sender marker, receiver marker, armed doorbell and live delivery. A Copilot citizen
# must have NONE of those: the shipped bundle carries no FileChanged, asyncRewake or
# watchPaths, so there is nothing to arm. A shared doctor would have to be taught to
# ignore exactly the evidence it exists to demand.
#
# THE ONE HONEST DIFFERENCE FROM THE CLAUDE DOCTOR. There, a plugin installed with
# zero meta-records is a SILENT MISS and exits non-zero, because a Claude session
# mints at session open — so zero records means something ate the hook. A Copilot
# session is born on its FIRST PROMPT (measured: opening the TUI fires no hook at
# all), so "installed, zero records" is the ordinary state of a Copilot that has been
# opened and not yet spoken to. Calling that red would train the operator to ignore
# the doctor. It is reported as NOT-YET, by name, and the red condition is a hook that
# RAN and FAILED — an ERROR line this unit wrote to the shared hook log.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-copilot-local"
PLUGIN="entwurf-meta-receive-copilot"
STALE_CLAUDE_UNIT="entwurf-meta-receive"
ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-copilot/.assembled"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SESSIONS_DIR="$AGENT_DIR/meta-sessions"
HOOK_LOG="$AGENT_DIR/meta-bridge-hook.log"

fail=0
ok()   { echo "  ok    $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }
note() { echo "  note  $*"; }

echo "[copilot-bridge-doctor] toolchain"
command -v copilot >/dev/null 2>&1 && ok "copilot CLI on PATH" || bad "copilot CLI missing from PATH"
command -v node >/dev/null 2>&1 && ok "node on PATH" || bad "node missing from PATH"

echo "[copilot-bridge-doctor] assembled artifact"
if [ -d "$ASM/$PLUGIN" ]; then
  ok "assembly present at $ASM"
else
  bad "assembly missing at $ASM — run ./run.sh install-copilot-bridge"
fi

LAUNCHER="$ASM/$PLUGIN/scripts/copilot-hook-launch.sh"
HOOKS="$ASM/$PLUGIN/hooks/hooks.json"
if [ -x "$LAUNCHER" ]; then
  ok "launcher present and executable"
  # The exec form names the launcher as THE executable — a lost +x bit is ENOEXEC at
  # first prompt, not a degraded path.
  if grep -q "__NODE_BIN__\|__HOOK_ENTRY__" "$LAUNCHER"; then
    bad "launcher still carries an installer placeholder (bake did not run)"
  else
    ok "launcher is baked (no placeholders)"
    BAKED_NODE="$(sed -n 's/^NODE_BIN="\(.*\)"$/\1/p' "$LAUNCHER" | head -1)"
    [ -x "$BAKED_NODE" ] && ok "baked node exists: $BAKED_NODE" \
      || bad "baked node is missing or not executable: ${BAKED_NODE:-(unparsed)} — node moved (NixOS store churn?); reinstall"
    BAKED_ENTRY="$(sed -n 's|^HOOK_ENTRY="\$PLUGIN_ROOT/\(.*\)"$|\1|p' "$LAUNCHER" | head -1)"
    [ -n "$BAKED_ENTRY" ] && [ -f "$ASM/$PLUGIN/$BAKED_ENTRY" ] && ok "hook entry present: $BAKED_ENTRY" \
      || bad "hook entry missing beside the launcher: ${BAKED_ENTRY:-(unparsed)}"
  fi
else
  bad "launcher missing or not executable: $LAUNCHER"
fi

[ -f "$ASM/$PLUGIN/entwurf-capabilities.json" ] \
  && ok "capability registry travels at the plugin root (every mint reads it)" \
  || bad "capability registry missing at the plugin root — every mint would throw"

if [ -f "$HOOKS" ]; then
  HOOKS_PATH="$HOOKS" ASM_LAUNCHER="$LAUNCHER" python3 - <<'PY'
import json, os, sys
from pathlib import Path
hooks = json.loads(Path(os.environ["HOOKS_PATH"]).read_text(encoding="utf-8"))
launcher = os.environ["ASM_LAUNCHER"]
problems = []
if hooks.get("version") != 1:
    problems.append("hooks.json root `version` must be the literal 1 (Copilot rejects the plugin otherwise)")
events = hooks.get("hooks") or {}
if set(events) != {"sessionStart", "userPromptSubmitted"}:
    problems.append(f"hook events drifted: {sorted(events)} — want exactly ['sessionStart', 'userPromptSubmitted']")
for name, entries in events.items():
    for i, entry in enumerate(entries if isinstance(entries, list) else []):
        exec_value = entry.get("exec")
        if not isinstance(exec_value, str):
            problems.append(f"hooks.{name}[{i}].exec must be a STRING (an array is rejected at plugin load)")
        elif exec_value != launcher:
            problems.append(f"hooks.{name}[{i}].exec does not point at the assembled launcher: {exec_value}")
        if "args" in entry:
            problems.append(f"hooks.{name}[{i}] carries `args`, which Copilot's schema has no key for")
for p in problems:
    print(f"  FAIL  {p}")
sys.exit(1 if problems else 0)
PY
  [ $? -eq 0 ] && ok "hooks.json is the Copilot native form, baked at the assembled launcher" || fail=1
else
  bad "hooks.json missing: $HOOKS"
fi

echo "[copilot-bridge-doctor] copilot wiring"
PLUGIN_LIST="$(copilot plugin list 2>/dev/null)"
case "$PLUGIN_LIST" in
  *"$PLUGIN"*) ok "$PLUGIN is installed in Copilot" ;;
  *) bad "$PLUGIN is NOT installed in Copilot — run ./run.sh install-copilot-bridge" ;;
esac
case "$PLUGIN_LIST" in
  *"$STALE_CLAUDE_UNIT"*)
    bad "the Claude unit '$STALE_CLAUDE_UNIT' is still installed in Copilot — it fires on every prompt and exits 1 before node starts (no `args` in Copilot's schema). Re-run the installer without --keep-stale-claude-unit." ;;
  *) ok "the Claude unit is not installed in Copilot" ;;
esac

echo "[copilot-bridge-doctor] birth evidence"
COPILOT_RECORDS=0
if [ -d "$SESSIONS_DIR" ]; then
  COPILOT_RECORDS="$(grep -l '"backend": "copilot"' "$SESSIONS_DIR"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')"
fi
if [ "$COPILOT_RECORDS" -gt 0 ]; then
  ok "$COPILOT_RECORDS copilot meta-record(s) in $SESSIONS_DIR — the citizen exists"
else
  # NOT a failure. See the header: a Copilot session mints on its first prompt, so an
  # opened-but-unspoken session legitimately has no record yet.
  note "no copilot meta-record yet. A Copilot session is born on its FIRST PROMPT, not when"
  note "the window opens — open Copilot, send one prompt, then re-run this doctor."
fi

if [ -f "$HOOK_LOG" ]; then
  COPILOT_ERRORS="$(grep -c ' ERROR \[copilot\] ' "$HOOK_LOG" 2>/dev/null || echo 0)"
  if [ "$COPILOT_ERRORS" -gt 0 ]; then
    bad "$COPILOT_ERRORS ERROR line(s) from this unit in $HOOK_LOG — the hook RAN and did not mint:"
    grep ' ERROR \[copilot\] ' "$HOOK_LOG" | tail -3 | sed 's/^/        /'
  else
    ok "no copilot ERROR lines in $HOOK_LOG"
  fi
else
  note "no hook log yet at $HOOK_LOG (nothing has fired on this host)"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "[copilot-bridge-doctor] FAIL"
  exit 1
fi
echo "[copilot-bridge-doctor] PASS"
