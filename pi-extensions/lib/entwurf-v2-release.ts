/**
 * entwurf-v2-release — the PURE release-policy reducer for the 5c transport hand
 * (0.11 Stage 0 step 5c-1). It answers ONE question with zero IO: given the plan
 * the 5b decider chose and the lock it handed over, on WHICH execution event may
 * the transport hand release that lock — and it guarantees the release fires
 * AT MOST ONCE.
 *
 * Why a pure reducer before any transport IO (5b discipline = gate-first →
 * pure-before-IO → wire): the load-bearing risk of 5c is NOT the spawn/send IO, it
 * is the RELEASE TIMING (Fable 3, "release-after-observation"). A spawn-bg dispatch
 * that releases its lock too early — on spawn-started/ack instead of on an observed
 * liveness transition — reopens the exact double-spawn window 5a's per-gid lock
 * exists to close. So the timing logic is isolated here as a pure state machine the
 * gate drives over every event order, and 5c-2/5c-3/5c-4 only WIRE the real
 * send/spawn/mailbox IO onto it. The hand feeds events; this module decides release.
 *
 * The three policies (one per ExecutionPlan transport):
 *   - no-lock                       — meta-mailbox (？7: no lock was ever held).
 *     Nothing to release on any event.
 *   - release-after-send-final      — control-socket send. The lock is held only for
 *     the at-most-once re-resolve; release once the send reaches a FINAL outcome.
 *   - release-after-spawn-observation — spawn-bg resume. The lock is held until the
 *     FIRST observable transition: socket-alive OR child-exited (any code). A
 *     spawn-started event is explicitly NOT a release trigger (that is the whole
 *     point). A spawn that never started (spawn-start-failed) has no child to watch,
 *     so it releases to free the gid — keeping the lock would pin it forever.
 *
 * The release authority is ALWAYS the LockClaim the decider handed over (5c wires it
 * through). This module never re-derives a lock by gid, never re-resolves a path —
 * it is pure routing logic over opaque events.
 */

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";

// ── ReleasePolicy (derived once from the plan + held lock) ───────────────────
export type ReleasePolicy =
	| { kind: "no-lock" }
	| { kind: "release-after-send-final" }
	| { kind: "release-after-spawn-observation" };

// ── ReleaseEvent (the transport hand feeds these as execution proceeds) ──────
// `send-final` carries the terminal send outcome (legacy parity: a fallback-sent is
// a real final outcome, not a hidden retry). `child-exited` carries the code (null =
// killed by signal) but the policy releases on ANY code. `mailbox-enqueued` is the
// terminal ack on the lock-free path. `spawn-started`/`spawn-start-failed` bracket
// the spawn attempt — only the FAILURE finalizes; a successful start must wait for an
// observed transition.
export type ReleaseEvent =
	| { kind: "send-final"; outcome: "sent" | "fallback-sent" | "rejected" | "failed" }
	| { kind: "spawn-started"; pid: number }
	| { kind: "spawn-start-failed"; error: string }
	| { kind: "socket-alive" }
	| { kind: "child-exited"; code: number | null }
	| { kind: "mailbox-enqueued" };

// ── ReleaseState (single-release accumulator) ───────────────────────────────
export interface ReleaseState {
	released: boolean;
}

export function initialReleaseState(): ReleaseState {
	return { released: false };
}

/**
 * An in-domain execute (control-socket / spawn-bg) must hold a lock whose gardenId
 * IS the plan's target. Both halves are 5b decider-contract invariants, not runtime
 * conditions: a null lock or a lock paired with the WRONG plan are the same grade of
 * mis-wiring (a later release would free nothing, or free a DIFFERENT gid's lock), so
 * both fail loud here rather than silently mis-releasing. Asserts the lock non-null
 * so the caller may use it as a `LockClaim`.
 */
function assertInDomainLock(plan: ExecutionPlan, lock: LockClaim | null): asserts lock is LockClaim {
	if (lock === null) {
		throw new Error(`entwurf-v2-release: an in-domain (${plan.transport}) execute must hold a lock.`);
	}
	if (lock.gardenId !== plan.targetGardenId) {
		throw new Error(
			`entwurf-v2-release: lock gardenId (${lock.gardenId}) does not match plan target (${plan.targetGardenId}) — mis-paired plan/lock.`,
		);
	}
}

/**
 * Derive the release policy from the plan, cross-checking the lock invariants the 5b
 * decider guarantees: meta-mailbox ⇒ lock null (？7); in-domain (control-socket /
 * spawn-bg) ⇒ lock non-null AND lock.gardenId === plan.targetGardenId. A mismatch is
 * a decider contract violation, not a runtime condition — it throws so a mis-wired
 * hand fails loud instead of silently dropping or mis-releasing a lock.
 */
export function decideReleasePolicy(plan: ExecutionPlan, lock: LockClaim | null): ReleasePolicy {
	switch (plan.transport) {
		case "meta-mailbox":
			if (lock !== null) {
				throw new Error("entwurf-v2-release: a meta-mailbox plan must carry no lock (？7 invariant violated).");
			}
			return { kind: "no-lock" };
		case "control-socket":
			assertInDomainLock(plan, lock);
			return { kind: "release-after-send-final" };
		case "spawn-bg":
			assertInDomainLock(plan, lock);
			return { kind: "release-after-spawn-observation" };
	}
}

export interface ReduceReleaseResult {
	state: ReleaseState;
	shouldRelease: boolean;
}

/**
 * Fold one execution event into the release decision. `shouldRelease` is true
 * EXACTLY ONCE — on the first event that satisfies the policy's release condition;
 * every later event (after `state.released`) returns false. The single-release
 * guarantee is what lets the spawn watcher race socket-alive against child-exit
 * without a double release: whichever fires first releases, the other is a no-op.
 */
export function reduceRelease(policy: ReleasePolicy, state: ReleaseState, event: ReleaseEvent): ReduceReleaseResult {
	if (state.released) {
		return { state, shouldRelease: false };
	}
	const release = (): ReduceReleaseResult => ({ state: { released: true }, shouldRelease: true });
	const hold = (): ReduceReleaseResult => ({ state, shouldRelease: false });

	switch (policy.kind) {
		case "no-lock":
			// No lock was ever held → nothing to release on any event.
			return hold();
		case "release-after-send-final":
			// Release once the send reaches a final outcome; hold before that.
			return event.kind === "send-final" ? release() : hold();
		case "release-after-spawn-observation":
			// Fable 3: spawn-started is NOT a release event. Release on the first
			// observed transition (socket-alive / child-exited, any code), or on a
			// failed start (no child to watch).
			switch (event.kind) {
				case "socket-alive":
				case "child-exited":
				case "spawn-start-failed":
					return release();
				case "spawn-started":
				case "send-final":
				case "mailbox-enqueued":
					return hold();
			}
	}
}
