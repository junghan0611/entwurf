/**
 * entwurf-v2-release — the PURE release-policy reducer (0.11 Stage 0 step 5c-1), proven
 * beside the code it certifies (#119 V3).
 *
 * MIGRATED from scripts/check-entwurf-v2-release.ts, assertion for assertion. The contract
 * did not change and is restated here so this file can be read without the old one: the
 * Fable-3 "release-after-observation" timing is a pure state machine, provable before any
 * send IO exists.
 *
 *   1. decideReleasePolicy maps each transport AND enforces the lock invariants —
 *      meta-mailbox ⇒ null lock else throw; in-domain ⇒ non-null AND
 *      lock.gardenId === plan.targetGardenId, else throw.
 *   2. a no-lock policy NEVER releases, on any event.
 *   3. control-socket holds before send-final, releases EXACTLY ONCE on send-final for
 *      every terminal outcome, and holds after.
 *   9. single-release: once released, no later event releases again.
 *
 * No IO. The reducer is pure; these tests fold event sequences and read the transitions.
 */

import { describe, expect, it } from "vitest";

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import {
	decideReleasePolicy,
	initialReleaseState,
	type ReleaseEvent,
	type ReleasePolicy,
	reduceRelease,
} from "./entwurf-v2-release.ts";

const GID = "20260612T100000-aaaaaa";

function lockClaim(): LockClaim {
	return {
		gardenId: GID,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-12T01:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${GID}.lock`,
	};
}

const MAILBOX_PLAN: ExecutionPlan = {
	transport: "meta-mailbox",
	action: "send",
	targetGardenId: GID,
	mailboxDir: "/fake/mailbox",
	sessionsDir: "/fake/sessions",
	wantsReply: false,
	message: "m",
};
const CONTROL_PLAN: ExecutionPlan = {
	transport: "control-socket",
	action: "send",
	targetGardenId: GID,
	socketPath: "/fake/ctl/s.sock",
	mode: "follow_up",
	wantsReply: false,
	message: "m",
};

/** Fold a sequence of events; return the shouldRelease flag emitted per event. */
function fold(policy: ReleasePolicy, events: ReleaseEvent[]): boolean[] {
	let state = initialReleaseState();
	const flags: boolean[] = [];
	for (const ev of events) {
		const r = reduceRelease(policy, state, ev);
		state = r.state;
		flags.push(r.shouldRelease);
	}
	return flags;
}

describe("decideReleasePolicy — transport mapping and lock-nullness", () => {
	it("meta-mailbox + null → no-lock", () => {
		expect(decideReleasePolicy(MAILBOX_PLAN, null).kind).toBe("no-lock");
	});

	it("control-socket + lock → release-after-send-final", () => {
		expect(decideReleasePolicy(CONTROL_PLAN, lockClaim()).kind).toBe("release-after-send-final");
	});

	it("meta-mailbox + lock → throws (？7 violated)", () => {
		expect(() => decideReleasePolicy(MAILBOX_PLAN, lockClaim())).toThrow();
	});

	it("control-socket + null → throws (must hold lock)", () => {
		expect(() => decideReleasePolicy(CONTROL_PLAN, null)).toThrow();
	});

	// An in-domain lock whose gardenId ≠ the plan target is a MIS-PAIRED plan/lock, and it is
	// the same grade of defect as a null lock: a later release would free a DIFFERENT gid.
	it("control-socket + mismatched lock gid → throws", () => {
		const WRONG_GID = "20260612T999999-bbbbbb";
		expect(() => decideReleasePolicy(CONTROL_PLAN, { ...lockClaim(), gardenId: WRONG_GID })).toThrow();
	});
});

describe("reduceRelease — when a lock is actually freed", () => {
	it("no-lock never releases, on any event", () => {
		const flags = fold({ kind: "no-lock" }, [{ kind: "mailbox-enqueued" }, { kind: "send-final", outcome: "sent" }]);
		expect(flags.every((f) => f === false)).toBe(true);
	});

	// Every terminal outcome releases, and releases once: a policy that only freed the lock on
	// success would strand it for exactly the sessions that most need the next attempt.
	for (const outcome of ["sent", "fallback-sent", "rejected", "failed"] as const) {
		it(`control: send-final(${outcome}) releases exactly once`, () => {
			const flags = fold({ kind: "release-after-send-final" }, [
				{ kind: "send-final", outcome },
				{ kind: "send-final", outcome },
			]);
			expect(flags).toEqual([true, false]);
		});
	}

	// Restated on the control-socket policy: the spawn observation events this used to fold went
	// with their transport, but the at-most-once guarantee is the reducer's own and still has to
	// hold against repeated terminal events.
	it("single-release: exactly one release across many terminal events", () => {
		const flags = fold({ kind: "release-after-send-final" }, [
			{ kind: "send-final", outcome: "sent" },
			{ kind: "send-final", outcome: "fallback-sent" },
			{ kind: "send-final", outcome: "failed" },
		]);
		expect(flags.filter((f) => f).length).toBe(1);
		expect(flags[0]).toBe(true);
	});
});
