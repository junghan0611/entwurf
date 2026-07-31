// The TypeScript half of the release-gate STEP OUTCOME protocol
// (scripts/lib/step-outcome.sh owns the contract prose and the shell half).
//
// A LIVE smoke that lacks a prerequisite must be DISTINGUISHABLE from one that
// ran and passed. Before P1 every smoke exited 0 on a skip, so `run_live_step`
// counted it PASS and the release summary could not prove a required call had
// happened at all. `skipLive` is the single exit any smoke takes when it
// declines: one reserved code the aggregate classifies as SKIP, plus one marker
// line so an operator reading the log sees WHICH prerequisite was missing
// without decoding a number.
//
// The two halves must agree. `check-release-gate-outcomes` reads this constant
// and the shell one and refuses a mismatch — a protocol that drifted between
// languages would silently reclassify every skip as a failure (or worse).

/** SKIP. Must equal `ENTWURF_STEP_SKIP_EXIT` in scripts/lib/step-outcome.sh. */
export const LIVE_SKIP_EXIT = 97;

/** The machine-greppable prefix every skip line carries. */
export const LIVE_SKIP_MARKER = "[entwurf:skip]";

/**
 * Decline this smoke: print the marker + reason on stderr and exit with the
 * protocol's SKIP code. Never returns.
 *
 * `label` is the smoke's own name (so a multi-step aggregate log stays
 * attributable); `reason` states the missing prerequisite AND how to supply it —
 * an operator who hits a SKIP in a cut run needs the fix, not the diagnosis.
 */
export function skipLive(label: string, reason: string): never {
	console.error(`${LIVE_SKIP_MARKER} ${label} — ${reason}`);
	process.exit(LIVE_SKIP_EXIT);
}
