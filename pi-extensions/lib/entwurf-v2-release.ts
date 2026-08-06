/**
 * entwurf-v2-release — the PURE release-policy reducer for the 5c transport hand
 * (0.11 Stage 0 step 5c-1). It answers ONE question with zero IO: given the plan
 * the 5b decider chose and the lock it handed over, on WHICH execution event may
 * the transport hand release that lock — and it guarantees the release fires
 * AT MOST ONCE.
 *
 * Why a pure reducer before any transport IO (5b discipline = gate-first →
 * pure-before-IO → wire): the load-bearing risk of 5c is NOT the send IO, it is the
 * RELEASE TIMING. A dispatch that releases its lock too early — on an ack instead of
 * on a final outcome — reopens the window 5a's per-gid lock exists to close. So the
 * timing logic is isolated here as a pure state machine the gate drives over every
 * event order, and 5c-2/5c-4 only WIRE the real send/mailbox IO onto it. The hand
 * feeds events; this module decides release.
 *
 * The two policies (one per ExecutionPlan transport):
 *   - no-lock                       — meta-mailbox and native-push (？7 / 봉인 4: no
 *     lock was ever held). Nothing to release on any event.
 *   - release-after-send-final      — control-socket send. The lock is held only for
 *     the at-most-once re-resolve; release once the send reaches a FINAL outcome.
 *
 * There was a third, `release-after-spawn-observation`, for the spawn-bg resume: hold
 * the lock until an OBSERVED liveness transition (socket-alive / child-exited), never
 * on spawn-started. It went with that transport in the visible-first cut, and with it
 * the spawn event vocabulary. The rule it encoded — a launch is finalized by an
 * observation, not by having started — is the one a visible resume will have to
 * restate for itself; it is not inherited by anything shipped here.
 *
 * The release authority is ALWAYS the LockClaim the decider handed over (5c wires it
 * through). This module never re-derives a lock by gid, never re-resolves a path —
 * it is pure routing logic over opaque events.
 */

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";

// ── ReleasePolicy (derived once from the plan + held lock) ───────────────────
export type ReleasePolicy = { kind: "no-lock" } | { kind: "release-after-send-final" };

// ── ReleaseEvent (the transport hand feeds these as execution proceeds) ──────
// `send-final` carries the terminal send outcome (legacy parity: a fallback-sent is
// a real final outcome, not a hidden retry). `mailbox-enqueued` is the terminal ack on
// the lock-free path. The four spawn/observation events (spawn-started,
// spawn-start-failed, socket-alive, child-exited) went with the spawn-bg transport.
export type ReleaseEvent =
	| { kind: "send-final"; outcome: "sent" | "fallback-sent" | "rejected" | "failed" }
	| { kind: "mailbox-enqueued" };

// ── ReleaseState (single-release accumulator) ───────────────────────────────
export interface ReleaseState {
	released: boolean;
}

export function initialReleaseState(): ReleaseState {
	return { released: false };
}

/**
 * An in-domain execute (control-socket) must hold a lock whose gardenId
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
 * control-socket) ⇒ lock non-null AND lock.gardenId === plan.targetGardenId. A mismatch is
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
		case "native-push":
			// Native-push is the other lock-free rail (봉인 4) — like meta-mailbox it holds no
			// lock, so a non-null lock is a decider contract violation. (The native-push hand
			// never actually routes through this reducer; the case keeps the switch exhaustive
			// and pins the lock-free invariant.)
			if (lock !== null) {
				throw new Error("entwurf-v2-release: a native-push plan must carry no lock (봉인 4 lock-free rail violated).");
			}
			return { kind: "no-lock" };
		case "control-socket":
			assertInDomainLock(plan, lock);
			return { kind: "release-after-send-final" };
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
 * guarantee is what let the retired spawn watcher race two observations without a
 * double release, and it is why the control-socket hand can feed a final outcome more
 * than once without paying for it twice.
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
	}
}
