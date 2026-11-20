#!/usr/bin/env bash
# Raw ACP session measurement launcher (#171). NOT a gate; in no check tier. LIVE only: it drives the
# real claude-agent-acp and agy, spends subscription turns, and the vendors authenticate through
# overlay symlinks to the operator's real config directories (see README "What it touches").
#
#   LIVE=1 scripts/raw-acp-session-measure/run.sh <scenario> <out-dir> [claude|agy]
#
#   scenario  rail0 | agy | resume-unknown | experiments | z5
#   out-dir   an EXISTING directory outside this repository; each run gets a new subdirectory
#   claude|agy  optional backend filter, experiments and z5 only
#
# Environment read here, before the environment is cleared for the child:
#   ENTWURF_RAW_CLAUDE_DIR  default "$HOME/.claude"   (production's real Claude config dir)
#   ENTWURF_RAW_GEMINI_DIR  default "$HOME/.gemini"   (production's real Gemini dir for agy)
#   ENTWURF_AGY_BIN         default `command -v agy`
#   PROBE_MODEL, PROBE_EFFORT  optional, rail0 and agy only
set -euo pipefail

die() {
	echo "[raw-acp-session] $*" >&2
	exit 2
}

[ "${LIVE:-}" = "1" ] || die "set LIVE=1 to drive real vendor ACP agents (spends subscription turns)."
[ $# -ge 2 ] && [ $# -le 3 ] || die "usage: LIVE=1 $0 <rail0|agy|resume-unknown|experiments|z5> <out-dir> [claude|agy]"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
SCENARIO="$1"
OUT_ARG="$2"
ONLY="${3:-}"

case "$SCENARIO" in
rail0 | agy | resume-unknown | experiments | z5) ;;
*) die "unknown scenario: $SCENARIO" ;;
esac
case "$ONLY" in
"") ;;
claude | agy)
	[ "$SCENARIO" = experiments ] || [ "$SCENARIO" = z5 ] || die "only experiments and z5 take a backend filter"
	;;
*) die "backend filter must be claude or agy: $ONLY" ;;
esac

# Hard Rule 12: run output never lands in the repository. Resolved with symlinks followed.
[ -d "$OUT_ARG" ] || die "out-dir must be an existing directory: $OUT_ARG"
OUT="$(cd "$OUT_ARG" && pwd -P)"
case "$OUT/" in
"$REPO"/*) die "out-dir must be outside the repository: $OUT" ;;
esac

DIST="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/acp"
[ -f "$DIST/backend-adapter.js" ] || die "bridge dist missing at $DIST: build it from the HEAD you measure (pnpm run build-bridge)"

CLAUDE_DIR="${ENTWURF_RAW_CLAUDE_DIR:-$HOME/.claude}"
GEMINI_DIR="${ENTWURF_RAW_GEMINI_DIR:-$HOME/.gemini}"
AGY_BIN="${ENTWURF_AGY_BIN:-$(command -v agy || true)}"

RUN="$OUT/$SCENARIO-$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$RUN" ] || die "run directory already exists: $RUN"
mkdir -p "$RUN/home/.pi/agent" "$RUN/xdg/config" "$RUN/xdg/data" "$RUN/xdg/state" "$RUN/xdg/cache"
git -C "$REPO" rev-parse HEAD >"$RUN/repo-head.txt"
git -C "$REPO" status --porcelain >"$RUN/repo-status.txt"

child_env=(
	PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM=dumb LIVE=1
	HOME="$RUN/home"
	XDG_CONFIG_HOME="$RUN/xdg/config" XDG_DATA_HOME="$RUN/xdg/data"
	XDG_STATE_HOME="$RUN/xdg/state" XDG_CACHE_HOME="$RUN/xdg/cache"
	PI_CODING_AGENT_DIR="$RUN/home/.pi/agent"
	ENTWURF_ACP_ENGRAVING_PATH="$REPO/pi-extensions/lib/acp/prompts/engraving.md"
	ENTWURF_RAW_CLAUDE_DIR="$CLAUDE_DIR" ENTWURF_RAW_GEMINI_DIR="$GEMINI_DIR" ENTWURF_AGY_BIN="$AGY_BIN"
)
if [ -n "${PROBE_MODEL:-}" ]; then child_env+=(PROBE_MODEL="$PROBE_MODEL"); fi
if [ -n "${PROBE_EFFORT:-}" ]; then child_env+=(PROBE_EFFORT="$PROBE_EFFORT"); fi
child_args=("$RUN")
if [ -n "$ONLY" ]; then child_args+=("$ONLY"); fi

echo "[raw-acp-session] $SCENARIO -> $RUN" >&2
cd "$RUN"
exec env -i "${child_env[@]}" node "$HERE/$SCENARIO.mjs" "${child_args[@]}" >"$RUN/stdout.json" 2>"$RUN/probe-stderr.log"
