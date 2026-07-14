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
#     A. VERSION LINE PINS — the three backends stay on the pinned MAJOR.MINOR
#        lines. Patch drift is tolerated; minor/major drift screams.
#     B. BINARY MARKERS — the undocumented-behavior identifiers must still be PRESENT in
#        the installed Claude binary (binary cross-validation). A marker dropping to
#        zero = the behavior was renamed/removed = the delivery path is dead = SCREAM.
#   LIVE (LIVE=1; spawns one `claude -p`, metered from 2026-06-15):
#     C. PLUGIN WATCH-ARM PROBE — delegate to repro-plugin-idle-wake.sh `probe`: the
#        plugin SessionStart hook must fire at STARTUP and arm a per-session watchPath
#        (a bare skill cannot — structural, see README). This is the end-to-end
#        confirmation that arming still works on this build.
#
# PIN POLICY (2026-06-05): pins are MAJOR.MINOR lines, not exact patches. Claude
#   ships ~weekly (observed 2.1.163 -> 2.1.165 same day, all 9 markers unchanged),
#   so an exact-patch pin screams on every bump and the signal is lost. The
#   binary-marker check (B) is the real net and runs against whatever patch is
#   installed; the version check (A) only fires on a MINOR/MAJOR move, which is the
#   genuine "re-verify markers + Gotchas + raw/LIVE probes" trigger. (bbot's
#   "agy 0.136" was a conflation with codex-cli 0.136.0; agy's line is 1.0.)
#
# USAGE: ./run.sh smoke-meta-async-drift   (LIVE=1 to add the plugin watch-arm probe)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_DIR="$HERE/raw-async-delivery"

# --- pinned MINOR lines (major.minor; PATCH is intentionally NOT pinned) --------
# Claude/codex/agy ship fast. A PATCH bump (e.g. 2.1.163 -> 2.1.165) almost never
# touches the undocumented delivery behavior — the binary-marker cross-validation
# in section B is the real safety net and runs against whatever patch is actually
# installed. Pinning the patch made the sentinel scream on every weekly bump =
# signal lost (observed 2026-06-05: 2.1.163 -> 2.1.165, all 9 markers unchanged).
# So pin the MINOR line; a MINOR/MAJOR move (2.1.x -> 2.2 / 3.x, 0.136 -> 0.137,
# 1.0 -> 1.1) is the real "re-verify the markers + Gotchas + raw/LIVE probes"
# trigger and DOES scream.
PIN_CLAUDE_MINOR="2.1"
# codex 0.144 (2026-07-14): OBSERVED bump, not a re-verification. Codex is not a shipped
# native-citizen lane in 0.12.x; the probe evidence in DELIVERY.md §Codex was measured at
# 0.136.0 and has NOT been re-run on 0.144 — that explicit verdict lives there. Re-run the
# raw probes before building any codex adapter on this line.
PIN_CODEX_MINOR="0.144"
# agy 1.1 (2026-07-14): re-verified live — entwurf_self called without a permission prompt,
# bidirectional native-push reply on the same gid, LIVE=1 smoke-agy-native-push-live 13/13
# at agy 1.1.0 (evidence recorded in DELIVERY.md §Antigravity).
PIN_AGY_MINOR="1.1"

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
section "A. VERSION LINE PINS (minor/major drift = undocumented-behavior assumptions may be stale)"

# major.minor of an X.Y.Z token ("2.1.165" -> "2.1", "0.136.0" -> "0.136").
minor_of() { printf '%s' "$1" | cut -d. -f1-2; }
extract_semver() { printf '%s' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }

check_version() {
  local name="$1" pin_minor="$2" raw="$3"
  if [ -z "$raw" ]; then
    echo "  SKIP: $name not on PATH (cannot verify pinned minor ${pin_minor}.x)"; return
  fi
  # extract first dotted version token (handles "2.1.165 (Claude Code)", "codex-cli 0.136.0", "1.0.5")
  local got got_minor
  got="$(extract_semver "$raw")"
  if [ -z "$got" ]; then
    cry "$name version output did not contain an X.Y.Z token (raw: $raw) — cannot verify pinned minor ${pin_minor}.x"
    return
  fi
  got_minor="$(minor_of "$got")"
  if [ "$got_minor" = "$pin_minor" ]; then
    ok "$name $got within pinned minor ${pin_minor}.x (patch drift ignored)"
  else
    cry "$name $got left pinned minor ${pin_minor}.x — re-verify binary markers + Gotchas + raw/LIVE probes on the new minor, then bump the pin"
  fi
}

CLAUDE_RAW="$(claude --version 2>/dev/null || true)"
check_version claude "$PIN_CLAUDE_MINOR" "$CLAUDE_RAW"
check_version codex  "$PIN_CODEX_MINOR"  "$(codex  --version 2>/dev/null || true)"
check_version agy    "$PIN_AGY_MINOR"    "$(agy    --version 2>/dev/null || true)"
# Full patch version drives binary resolution in section B (the marker check must
# run against the ACTUAL installed patch, not a hardcoded one).
CLAUDE_FULL="$(extract_semver "$CLAUDE_RAW")"

# ---------------------------------------------------------------------------- B
section "B. BINARY MARKERS (undocumented Claude delivery behavior still present?)"

# Resolve the installed Claude binary. `claude` on PATH is a launcher shim; the
# real bundle lives under ~/.local/share/claude/versions/<ver>. Use the ACTUAL
# installed patch (from `claude --version`); fall back to the newest on disk.
CLAUDE_BIN=""
CLAUDE_VER_DIR="$HOME/.local/share/claude/versions"
if [ -n "$CLAUDE_FULL" ] && [ -f "$CLAUDE_VER_DIR/$CLAUDE_FULL" ]; then
  CLAUDE_BIN="$CLAUDE_VER_DIR/$CLAUDE_FULL"
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
echo "  OK: meta-async drift sentinel green at pinned minor lines."
