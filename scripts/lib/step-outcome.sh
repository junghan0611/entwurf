# shellcheck shell=bash
# Release-gate STEP OUTCOME protocol — the one place PASS / SKIP / FAIL is decided.
#
# SOURCE-ONLY. It carries the executable bit because check-pack requires every
# shipped `.sh` to have one (a blanket packaging invariant worth more than an
# exception carved for this file), not because anyone should run it.
#
# Sourced by run.sh's `release_gate`; sourced directly by
# scripts/check-release-gate-outcomes.ts so the truth table is exercised as a
# unit instead of being re-derived by eye from the aggregate's output.
#
# WHY A PROTOCOL AND NOT A PER-BACKEND BRANCH (P1, 2026-07-31). The aggregate's
# prose said a cut needs `LIVE=1` and `SKIP=0`, but its exit authority read only
# the FAIL counter, so `./run.sh release-gate` returned 0 with 14 SKIPs and the
# summary still printed "all green". Worse, a step that WAS invoked could decide
# it lacked a prerequisite and exit 0 — Cortex with no
# `ENTWURF_ACP_CORTEX_CONNECTION` is the measured case — and the aggregate
# counted that as PASS. Both holes have the same shape: a skip that cannot be
# told from an acceptance. So the fix is one outcome protocol every step speaks,
# never a special case per backend or per prerequisite.
#
# EXIT CONTRACT (house style: the verdict IS the exit code)
#   0                          PASS — the step ran and its assertions held.
#   ENTWURF_STEP_SKIP_EXIT     SKIP — the step declined a prerequisite it does
#                              not have. NOT acceptance, and never rounded up.
#   anything else              FAIL — including a crash or a signal death.
#
# WHY 97. The repo already spends 0..4 on per-tool exit contracts that mean
# different things per tool (meta-bridge-fresh-cut's 3 = "cut transition
# incomplete", meta-bridge-store-doctor's 3 = "unreadable store", dev-bin's 3 =
# "refused a foreign link"), and 126+ belongs to the shell. A LIVE smoke shells
# out to some of those tools, so reusing a low number would let a dependency's
# unrelated verdict surface as a false SKIP — the exact confusion this protocol
# exists to remove. 97 is reserved for THIS cross-tool protocol and nothing else.
ENTWURF_STEP_SKIP_EXIT=97

# Classify one step's exit code. Prints PASS | SKIP | FAIL on stdout.
entwurf_step_outcome() {
	case "${1:-}" in
		0) printf 'PASS\n' ;;
		"$ENTWURF_STEP_SKIP_EXIT") printf 'SKIP\n' ;;
		*) printf 'FAIL\n' ;;
	esac
}

# The release authority. Returns 0 when the run may be read as a cut floor.
#
#   $1 MUST fail count   $2 MUST skip count   $3 cut mode (1 = a real cut)
#
# A FAIL always blocks. A SKIP blocks ONLY in cut mode: an ordinary diagnostic
# `./run.sh release-gate <dir>` must stay runnable unattended and still exit 0
# while honestly reporting what it did not call. `--cut` is the executable half
# of "a CUT needs LIVE=1, SKIP=0" — and it needs no separate LIVE assertion,
# because with LIVE unset every LIVE-gated step skips and the skip count blocks.
entwurf_release_releasable() {
	local failc="${1:-0}" skipc="${2:-0}" cut="${3:-0}"
	[ "$failc" -gt 0 ] && return 1
	if [ "$cut" = "1" ] && [ "$skipc" -gt 0 ]; then
		return 1
	fi
	return 0
}

# The same decision as ONE greppable token, because "why is this red" must be
# machine-readable and not parsed out of prose.
#
#   $1 MUST fail count   $2 MUST skip count   $3 cut mode (1 = a real cut)
#
# A step that RAN AND BROKE and a step that NEVER RAN are different facts, and a
# release record that blurs them is worthless: the first is a defect to fix, the
# second is a prerequisite to supply. So the counters are never fudged either —
# a policy block keeps `FAIL=0 SKIP=n` and says `BLOCKED (MUST SKIP)`. Reporting
# a synthetic `FAIL=1` for the policy block would destroy exactly the
# distinction this protocol exists to create.
entwurf_release_verdict() {
	local failc="${1:-0}" skipc="${2:-0}" cut="${3:-0}"
	if [ "$failc" -gt 0 ]; then
		printf 'cut: BLOCKED (MUST FAIL)\n'
	elif [ "$cut" = "1" ] && [ "$skipc" -gt 0 ]; then
		printf 'cut: BLOCKED (MUST SKIP)\n'
	elif [ "$cut" = "1" ]; then
		printf 'cut: OK\n'
	elif [ "$skipc" -gt 0 ]; then
		printf 'cut: n/a (diagnostic, %s SKIP)\n' "$skipc"
	else
		printf 'cut: n/a (diagnostic)\n'
	fi
}
