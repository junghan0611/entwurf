#!/usr/bin/env bash
# Raw ACP session measurement launcher (#171). NOT a gate; in no check tier. LIVE only: it drives the
# real claude-agent-acp and agy, spends subscription turns, and the vendors authenticate through
# overlay symlinks to the operator's real config directories (see README "What it touches").
#
#   LIVE=1 scripts/raw-acp-session-measure/run.sh <scenario> <out-dir> [claude|agy]
#
#   scenario  rail0 | agy | resume-unknown | experiments | z5 | continuity | pi-smoke | pi-upgrade | pi-unknown |
#             pi-quit | pi-compact | compact-resume | all
#   out-dir   an EXISTING directory outside this repository; each run gets a new subdirectory
#   claude|agy  optional backend filter: experiments, z5, continuity and all
#
# `all` (#171 step 7) runs the regression scenarios first and checks each against expected.json with
# compare.mjs; the first differing key, failed probe or comparator error stops it before any continuity
# turn is spent. Then it runs continuity. Every run lands in one `all-<time>` directory with order.txt.
#
# After EVERY probe, sweep.mjs scans for what the probe left: processes carrying the run's token
# (RAW171_SWEEP_TOKEN, set here and inherited by every agent and its descendants) are SIGKILLed, and
# processes under the run directory without it are reported; either one fails the run (sweep.json).
# The legacy probes keep their own leader-only kill, so their receipts stay comparable.
#
# Exit: 0 done; 1 a key differs from expected.json; 2 usage, or compare.mjs failed; 3 a probe failed;
# 4 continuity was clean but a mandatory U sample is inconclusive or missing (summary run.incomplete);
# 5 a process survived a probe. A single scenario exits with its probe's status, or 5.
#   all claude   rail0, resume-unknown, experiments claude, z5 claude, continuity claude
#   all agy      agy, resume-unknown, experiments agy, z5 agy, continuity agy
#   all          the claude regression set, then agy, experiments agy, z5 agy, then continuity (both)
#
# Environment read here, before the environment is cleared for the child:
#   ENTWURF_RAW_CLAUDE_DIR  default "$HOME/.claude"   (production's real Claude config dir)
#   ENTWURF_RAW_GEMINI_DIR  default "$HOME/.gemini"   (production's real Gemini dir for agy)
#   ENTWURF_AGY_BIN         default `command -v agy`
#   ENTWURF_RAW_CLAUDE_ACP_PREFIX  optional: a directory OUTSIDE the repository holding
#                           node_modules/@agentclientprotocol/claude-agent-acp; Claude then runs that
#                           version (a copy of claude-acp-launch.js is written to the prefix root)
#   ENTWURF_RAW_U26_AGY_SOURCE  optional: a stored `agy` scenario run directory; continuity's agy U26
#                           resumes a COPY of its session
#   ENTWURF_RAW_U26_AGY_PAIR    "<stored>:<launched>": the agy version pair U26 must cross
#   ENTWURF_RAW_U26_CLAUDE_PAIR "<stored>:<launched>": the Claude pair U26 must cross, pin and prefix
#                           in either order (default: the pin, then the prefix)
#   ENTWURF_RAW_AGY_MODEL       optional: continuity's agy model (default gemini-3.8-flash)
#   ENTWURF_RAW_ROWS            optional: continuity's rows, a comma list (default every row)
#   PROBE_MODEL, PROBE_EFFORT  optional, rail0 and agy only
#   ENTWURF_RAW_PI_MODEL        optional: the Pi scenarios' entwurf model
#   ENTWURF_RAW_PI_CLI          optional (#175): an absolute Pi dist/bundle/cli.js run instead of `pi`
#   ENTWURF_RAW_PI_EARLIER      pi-upgrade (#176): an installed earlier Entwurf package OUTSIDE the
#                           repository; it births the session that this checkout then reopens
#   ENTWURF_RAW_PI_RESERVE_TOKENS  optional (#175): the sandbox Pi's compaction.reserveTokens
#   ENTWURF_RAW_QUIT_VARIANT, ENTWURF_RAW_QUIT_KEEPALIVE  optional (#175): pi-quit's variant
#   ENTWURF_RAW_COMPACT_MODE    optional (#175): pi-compact's manual | threshold
#   ENTWURF_RAW_FILLER_TOKENS   optional (#175): pi-compact and compact-resume filler size
#   ENTWURF_RAW_PLANT_PARTS     optional (#175): compact-resume's number of plant prompts (1-4)
#   ENTWURF_RAW_COMPACT_REPEAT  optional (#175 D-3): compact-resume's number of `/compact` prompts in a row (1-3)
set -euo pipefail

die() {
	echo "[raw-acp-session] $*" >&2
	exit 2
}

SCENARIOS="rail0|agy|resume-unknown|experiments|z5|continuity|pi-smoke|pi-upgrade|pi-unknown|pi-quit|pi-compact|compact-resume|all"
[ "${LIVE:-}" = "1" ] || die "set LIVE=1 to drive real vendor ACP agents (spends subscription turns)."
[ $# -ge 2 ] && [ $# -le 3 ] || die "usage: LIVE=1 $0 <$SCENARIOS> <out-dir> [claude|agy]"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
SCENARIO="$1"
OUT_ARG="$2"
ONLY="${3:-}"

case "$SCENARIO" in
rail0 | agy | resume-unknown | experiments | z5 | continuity | pi-smoke | pi-upgrade | pi-unknown | pi-quit | pi-compact | compact-resume | all) ;;
*) die "unknown scenario: $SCENARIO" ;;
esac
case "$ONLY" in
"") ;;
claude | agy)
	case "$SCENARIO" in
	experiments | z5 | continuity | pi-smoke | pi-upgrade | pi-unknown | pi-quit | pi-compact | compact-resume | all) ;;
	*) die "only experiments, z5, continuity, the pi-* scenarios, compact-resume and all take a backend filter" ;;
	esac
	;;
*) die "backend filter must be claude or agy: $ONLY" ;;
esac

# Hard Rule 12: run output never lands in the repository. Resolved with symlinks followed.
outside_repo() { # <label> <existing dir> -> the resolved path on stdout
	[ -d "$2" ] || die "$1 must be an existing directory: $2"
	local resolved
	resolved="$(cd "$2" && pwd -P)"
	case "$resolved/" in
	"$REPO"/*) die "$1 must be outside the repository: $resolved" ;;
	esac
	printf '%s\n' "$resolved"
}
OUT="$(outside_repo out-dir "$OUT_ARG")"

DIST="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/acp"
[ -f "$DIST/backend-adapter.js" ] || die "bridge dist missing at $DIST: build it from the HEAD you measure (pnpm run build-bridge)"

CLAUDE_DIR="${ENTWURF_RAW_CLAUDE_DIR:-$HOME/.claude}"
GEMINI_DIR="${ENTWURF_RAW_GEMINI_DIR:-$HOME/.gemini}"
AGY_BIN="${ENTWURF_AGY_BIN:-$(command -v agy || true)}"

child_env=(
	PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM=dumb LIVE=1
	ENTWURF_ACP_ENGRAVING_PATH="$REPO/pi-extensions/lib/acp/prompts/engraving.md"
	ENTWURF_RAW_CLAUDE_DIR="$CLAUDE_DIR" ENTWURF_RAW_GEMINI_DIR="$GEMINI_DIR" ENTWURF_AGY_BIN="$AGY_BIN"
)
if [ -n "${PROBE_MODEL:-}" ]; then child_env+=(PROBE_MODEL="$PROBE_MODEL"); fi
if [ -n "${PROBE_EFFORT:-}" ]; then child_env+=(PROBE_EFFORT="$PROBE_EFFORT"); fi
if [ -n "${ENTWURF_RAW_AGY_MODEL:-}" ]; then child_env+=(ENTWURF_RAW_AGY_MODEL="$ENTWURF_RAW_AGY_MODEL"); fi
if [ -n "${ENTWURF_RAW_PI_MODEL:-}" ]; then child_env+=(ENTWURF_RAW_PI_MODEL="$ENTWURF_RAW_PI_MODEL"); fi
if [ -n "${ENTWURF_RAW_ROWS:-}" ]; then child_env+=(ENTWURF_RAW_ROWS="$ENTWURF_RAW_ROWS"); fi
for name in ENTWURF_RAW_PI_CLI ENTWURF_RAW_PI_RESERVE_TOKENS ENTWURF_RAW_QUIT_VARIANT ENTWURF_RAW_QUIT_KEEPALIVE \
	ENTWURF_RAW_COMPACT_MODE ENTWURF_RAW_FILLER_TOKENS ENTWURF_RAW_PLANT_PARTS ENTWURF_RAW_COMPACT_REPEAT; do
	if [ -n "${!name:-}" ]; then child_env+=("$name=${!name}"); fi
done
if [ -n "${ENTWURF_RAW_PI_EARLIER:-}" ]; then
	EARLIER="$(outside_repo ENTWURF_RAW_PI_EARLIER "$ENTWURF_RAW_PI_EARLIER")"
	[ -f "$EARLIER/package.json" ] || die "ENTWURF_RAW_PI_EARLIER must be an installed Entwurf package: $EARLIER"
	child_env+=(ENTWURF_RAW_PI_EARLIER="$EARLIER")
elif [ "$SCENARIO" = pi-upgrade ]; then
	die "pi-upgrade needs ENTWURF_RAW_PI_EARLIER: the earlier Entwurf package that births the session"
fi
if [ -n "${ENTWURF_RAW_CLAUDE_ACP_PREFIX:-}" ]; then
	case "$ENTWURF_RAW_CLAUDE_ACP_PREFIX" in
	/*) ;;
	*) die "ENTWURF_RAW_CLAUDE_ACP_PREFIX must be absolute: $ENTWURF_RAW_CLAUDE_ACP_PREFIX" ;;
	esac
	PREFIX="$(outside_repo ENTWURF_RAW_CLAUDE_ACP_PREFIX "$ENTWURF_RAW_CLAUDE_ACP_PREFIX")"
	[ -f "$PREFIX/node_modules/@agentclientprotocol/claude-agent-acp/package.json" ] ||
		die "no @agentclientprotocol/claude-agent-acp under $PREFIX/node_modules"
	child_env+=(ENTWURF_RAW_CLAUDE_ACP_PREFIX="$PREFIX")
fi
PREFIX="${PREFIX:-}"
if [ -n "${ENTWURF_RAW_U26_AGY_SOURCE:-}" ]; then
	U26_SOURCE="$(outside_repo ENTWURF_RAW_U26_AGY_SOURCE "$ENTWURF_RAW_U26_AGY_SOURCE")"
	[ -f "$U26_SOURCE/summary.json" ] && [ -d "$U26_SOURCE/home/.pi/agent/agy-gemini-overlay" ] ||
		die "ENTWURF_RAW_U26_AGY_SOURCE must be a stored agy run (summary.json and its overlay): $U26_SOURCE"
	child_env+=(ENTWURF_RAW_U26_AGY_SOURCE="$U26_SOURCE")
fi
if [ -n "${ENTWURF_RAW_U26_AGY_PAIR:-}" ]; then
	[[ "$ENTWURF_RAW_U26_AGY_PAIR" =~ ^[^:]+:[^:]+$ ]] ||
		die "ENTWURF_RAW_U26_AGY_PAIR must be <stored>:<launched>: $ENTWURF_RAW_U26_AGY_PAIR"
	child_env+=(ENTWURF_RAW_U26_AGY_PAIR="$ENTWURF_RAW_U26_AGY_PAIR")
fi
if [ -n "${ENTWURF_RAW_U26_CLAUDE_PAIR:-}" ]; then
	[[ "$ENTWURF_RAW_U26_CLAUDE_PAIR" =~ ^[^:]+:[^:]+$ ]] ||
		die "ENTWURF_RAW_U26_CLAUDE_PAIR must be <stored>:<launched>: $ENTWURF_RAW_U26_CLAUDE_PAIR"
	[ -n "$PREFIX" ] || die "ENTWURF_RAW_U26_CLAUDE_PAIR needs ENTWURF_RAW_CLAUDE_ACP_PREFIX: U26 crosses the pin and the prefix"
	child_env+=(ENTWURF_RAW_U26_CLAUDE_PAIR="$ENTWURF_RAW_U26_CLAUDE_PAIR")
fi

# One probe run in a new sandboxed directory under <parent>, then the sweep. Sets RUN and SWEEP_STATUS;
# returns the probe's status.
SWEEP_STATUS=0
run_one() { # <parent> <scenario> [claude|agy]
	local parent="$1" scenario="$2" only="${3:-}" token status=0
	token="$(cat /proc/sys/kernel/random/uuid)"
	RUN="$parent/$scenario${only:+-$only}-$(date -u +%Y%m%dT%H%M%SZ)"
	[ ! -e "$RUN" ] || die "run directory already exists: $RUN"
	mkdir -p "$RUN/home/.pi/agent" "$RUN/xdg/config" "$RUN/xdg/data" "$RUN/xdg/state" "$RUN/xdg/cache"
	git -C "$REPO" rev-parse HEAD >"$RUN/repo-head.txt"
	git -C "$REPO" status --porcelain >"$RUN/repo-status.txt"
	# compare.mjs reads the filter so a backend that was not asked to run is "not run", not "differ".
	if [ -n "$only" ]; then printf '%s\n' "$only" >"$RUN/backend-filter.txt"; fi
	# Which claude-agent-acp this run launches and the ACP SDK on each side (package.json reads only).
	if [ -n "$PREFIX" ]; then
		env -i PATH="$PATH" node "$HERE/provenance.mjs" "$PREFIX" >"$RUN/provenance.json"
	else
		env -i PATH="$PATH" node "$HERE/provenance.mjs" >"$RUN/provenance.json"
	fi
	local args=("$RUN")
	if [ -n "$only" ]; then args+=("$only"); fi
	echo "[raw-acp-session] $scenario${only:+ $only} -> $RUN" >&2
	(
		cd "$RUN"
		exec env -i "${child_env[@]}" RAW171_SWEEP_TOKEN="$token" \
			HOME="$RUN/home" PI_CODING_AGENT_DIR="$RUN/home/.pi/agent" \
			XDG_CONFIG_HOME="$RUN/xdg/config" XDG_DATA_HOME="$RUN/xdg/data" \
			XDG_STATE_HOME="$RUN/xdg/state" XDG_CACHE_HOME="$RUN/xdg/cache" \
			node "$HERE/$scenario.mjs" "${args[@]}" >"$RUN/stdout.json" 2>"$RUN/probe-stderr.log"
	) || status=$?
	SWEEP_STATUS=0
	env -i PATH="$PATH" node "$HERE/sweep.mjs" "$RUN" "$token" >"$RUN/sweep.json" || SWEEP_STATUS=$?
	return "$status"
}

if [ "$SCENARIO" != all ]; then
	status=0
	run_one "$OUT" "$SCENARIO" "$ONLY" || status=$?
	if [ "$SWEEP_STATUS" -ne 0 ]; then
		echo "[raw-acp-session] processes survived $SCENARIO (sweep exited $SWEEP_STATUS): $RUN/sweep.json" >&2
		exit 5
	fi
	exit "$status"
fi

claude_set=("rail0:" "resume-unknown:" "experiments:claude" "z5:claude")
agy_set=("agy:" "resume-unknown:" "experiments:agy" "z5:agy")
case "$ONLY" in
claude) steps=("${claude_set[@]}" "continuity:claude") ;;
agy) steps=("${agy_set[@]}" "continuity:agy") ;;
"") steps=("${claude_set[@]}" "agy:" "experiments:agy" "z5:agy" "continuity:") ;;
esac

ALL="$OUT/all${ONLY:+-$ONLY}-$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$ALL" ] || die "run directory already exists: $ALL"
mkdir -p "$ALL"
note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$ALL/order.txt" >&2; }
note "steps: ${steps[*]}"
for step in "${steps[@]}"; do
	scenario="${step%%:*}"
	only="${step#*:}"
	status=0
	run_one "$ALL" "$scenario" "$only" || status=$?
	if [ "$SWEEP_STATUS" -ne 0 ]; then
		note "STOP $scenario${only:+ $only}: processes survived the probe (sweep exited $SWEEP_STATUS; see $RUN/sweep.json)"
		exit 5
	fi
	if [ "$status" -ne 0 ]; then
		# The summary of a failed probe is still compared, so verdict.json shows what it did measure.
		if [ -f "$RUN/summary.json" ]; then
			env -i PATH="$PATH" node "$HERE/compare.mjs" check "$scenario" "$RUN" --write | tee -a "$ALL/order.txt" >&2 || true
		fi
		if [ "$status" -eq 4 ]; then
			note "INCOMPLETE $scenario${only:+ $only}: a mandatory sample is inconclusive or missing (see $RUN/stdout.json run.incomplete)"
			exit 4
		fi
		note "STOP $scenario${only:+ $only}: the probe exited $status (see $RUN/probe-stderr.log)"
		exit 3
	fi
	status=0
	env -i PATH="$PATH" node "$HERE/compare.mjs" check "$scenario" "$RUN" --write | tee -a "$ALL/order.txt" >&2 || status=${PIPESTATUS[0]}
	case "$status" in
	0) note "ok $scenario${only:+ $only} ($RUN)" ;;
	1)
		note "STOP $scenario${only:+ $only}: a key differs from expected.json (see $RUN/verdict.json)"
		exit 1
		;;
	*)
		note "STOP $scenario${only:+ $only}: compare.mjs failed with $status"
		exit 2
		;;
	esac
done
note "done: $ALL"
