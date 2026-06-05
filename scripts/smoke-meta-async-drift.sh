#!/usr/bin/env bash
#
# smoke-meta-async-drift — 1.0.0 meta-bridge step 1: drift sentinel + capability gate
# (#30 bbot review refinement #2; NEXT.md MVP step 1, "record authority FIRST, hook
# LAST" — this is the protector that freezes the green BEFORE any record/hook lands).
#
# WHY THIS EXISTS
#   The whole Claude async-delivery path rides on UNDOCUMENTED Claude Code behavior:
#   `asyncRewake` force-prepends `Stop hook feedback:` and ignores `rewakeMessage`;
#   the payload channel is stderr-only; `watchPaths` can arm from only 3 hook events
#   (SessionStart / CwdChanged / FileChanged). Half the Gotchas in
#   scripts/raw-async-delivery/README.md are reverse-engineered. Claude ships ~weekly.
#   So the path can break SILENTLY on any upgrade. This gate makes it SCREAM instead —
#   direct lineage of the 0.8.x fail-fast tool-surface gates ("don't let a surface
#   break quietly, make the gate cry out").
#
# TWO TIERS (mirrors smoke-compaction-policy: deterministic default + LIVE=1 add-on)
#   DETERMINISTIC (default; free, offline, CI/pre-commit safe):
#     A. VERSION PINS  — the three backends are measured at the pinned versions; any
#        drift is reported loudly (the undocumented behaviors were verified at these
#        versions, so a bump invalidates the binary-marker assumptions until re-checked).
#     B. BINARY MARKERS — the undocumented-behavior identifiers must still be PRESENT in
#        the installed Claude binary (binary cross-validation). A marker dropping to
#        zero = the behavior was renamed/removed = the delivery path is dead = SCREAM.
#   LIVE (LIVE=1; spawns one `claude -p`, metered from 2026-06-15):
#     C. PLUGIN WATCH-ARM PROBE — delegate to repro-plugin-idle-wake.sh `probe`: the
#        plugin SessionStart hook must fire at STARTUP and arm a per-session watchPath
#        (a bare skill cannot — structural, see README). This is the end-to-end
#        confirmation that arming still works on this build.
#
# PIN DRIFT NOTE (2026-06-05): NEXT.md / #30 bbot review wrote "agy 0.136" — that was
#   a conflation with codex-cli 0.136.0. Measured truth on this host: agy 1.0.5. The
#   pins below are the MEASURED values, not the prose; fix the prose, trust the gate.
#
# USAGE: ./run.sh smoke-meta-async-drift   (LIVE=1 to add the plugin watch-arm probe)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_DIR="$HERE/raw-async-delivery"

# --- pinned versions (MEASURED, the verification baseline) ---------------------
PIN_CLAUDE="2.1.163"
PIN_CODEX="0.136.0"
PIN_AGY="1.0.5"

# --- undocumented-behavior identifiers that the delivery path rides on ---------
# Each MUST stay present in the installed Claude binary. Zero = drift = SCREAM.
MARKERS=(
  asyncRewake                     # active-turn doorbell (Stop hook)
  stop_hook_active                # infinite-loop guard field
  watchPaths                      # idle-wake arm channel
  flushPendingAsyncRewakeHooks    # engine turn-boundary flush (edge-bound delivery)
  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP # native re-wake cap
  FileChanged                     # idle-wake event
  rewakeMessage                   # the field asyncRewake IGNORES (doorbell-only proof)
  hookSpecificOutput              # the watchPaths emit envelope
  CwdChanged                      # the 2nd of the 3 watch-arming events
)

pass=0 ; fail=0 ; scream=0
ok()     { echo "  PASS: $*"; pass=$((pass+1)); }
bad()    { echo "  FAIL: $*"; fail=$((fail+1)); }
cry()    { echo "  DRIFT!: $*"; scream=$((scream+1)); }
section(){ echo; echo "== $* =="; }

# ---------------------------------------------------------------------------- A
section "A. VERSION PINS (drift = undocumented-behavior assumptions may be stale)"

check_version() {
  local name="$1" pin="$2" raw="$3"
  if [ -z "$raw" ]; then
    echo "  SKIP: $name not on PATH (cannot verify pin $pin)"; return
  fi
  # extract first dotted version token (handles "2.1.163 (Claude Code)", "codex-cli 0.136.0", "1.0.5")
  local got
  got="$(printf '%s' "$raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ "$got" = "$pin" ]; then
    ok "$name $got == pinned $pin"
  else
    cry "$name $got != pinned $pin — re-verify binary markers + Gotchas on the new build, then bump the pin"
  fi
}

check_version claude "$PIN_CLAUDE" "$(claude --version 2>/dev/null || true)"
check_version codex  "$PIN_CODEX"  "$(codex  --version 2>/dev/null || true)"
check_version agy    "$PIN_AGY"    "$(agy    --version 2>/dev/null || true)"

# ---------------------------------------------------------------------------- B
section "B. BINARY MARKERS (undocumented Claude delivery behavior still present?)"

# Resolve the installed Claude binary. `claude` on PATH is a launcher shim; the
# real bundle lives under ~/.local/share/claude/versions/<ver>. Prefer the pinned
# version file; fall back to the newest if the pin moved.
CLAUDE_BIN=""
CLAUDE_VER_DIR="$HOME/.local/share/claude/versions"
if [ -f "$CLAUDE_VER_DIR/$PIN_CLAUDE" ]; then
  CLAUDE_BIN="$CLAUDE_VER_DIR/$PIN_CLAUDE"
elif [ -d "$CLAUDE_VER_DIR" ]; then
  CLAUDE_BIN="$(ls -1t "$CLAUDE_VER_DIR" 2>/dev/null | head -1 | sed "s#^#$CLAUDE_VER_DIR/#")"
fi

if [ -z "$CLAUDE_BIN" ] || [ ! -f "$CLAUDE_BIN" ]; then
  echo "  SKIP: Claude binary not found under $CLAUDE_VER_DIR — cannot cross-validate markers"
else
  echo "  binary: $CLAUDE_BIN"
  for m in "${MARKERS[@]}"; do
    n="$(grep -aoc "$m" "$CLAUDE_BIN" 2>/dev/null || true)"
    n="${n:-0}"
    if [ "$n" -gt 0 ]; then
      ok "marker present: $m ($n)"
    else
      cry "marker GONE: $m — delivery path likely broken on this build"
    fi
  done
fi

# ---------------------------------------------------------------------------- C
section "C. PLUGIN WATCH-ARM PROBE (LIVE only)"

if [ "${LIVE:-0}" = "1" ]; then
  echo "  LIVE=1 → delegating to repro-plugin-idle-wake.sh probe (spawns one claude -p)"
  if bash "$RAW_DIR/repro-plugin-idle-wake.sh" probe; then
    ok "plugin SessionStart hook armed a per-session watchPath at startup"
  else
    bad "plugin watch-arm probe failed (SessionStart did not arm the watch)"
  fi
else
  echo "  SKIP: set LIVE=1 to run the plugin watch-arm probe (spawns one metered claude -p)"
fi

# ---------------------------------------------------------------------------- summary
section "SUMMARY"
echo "  pass=$pass  fail=$fail  drift=$scream"
if [ "$scream" -gt 0 ]; then
  echo
  echo "  ***** DRIFT DETECTED *****"
  echo "  An undocumented behavior or a pinned version moved. The async-delivery path"
  echo "  is built on these; do NOT assume it still works. Re-run the raw probes in"
  echo "  scripts/raw-async-delivery/, re-read README §Gotchas, update DELIVERY.md, and"
  echo "  only then bump the pins in this gate."
  exit 1
fi
if [ "$fail" -gt 0 ]; then
  echo "  FAIL: $fail check(s) failed."
  exit 1
fi
echo "  OK: meta-async drift sentinel green at pinned versions."
