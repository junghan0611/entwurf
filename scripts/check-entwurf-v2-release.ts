/**
 * check-entwurf-v2-release — deterministic gate for the PURE release-policy reducer
 * (0.11 Stage 0 step 5c-1). Proves the Fable-3 "release-after-observation" timing as
 * a pure state machine BEFORE any send IO exists:
 *
 *   1. decideReleasePolicy maps each transport correctly and ENFORCES the lock
 *      invariants (meta-mailbox ⇒ null else throw; in-domain ⇒ non-null AND
 *      lock.gardenId === plan.targetGardenId, else throw).
 *   2. no-lock policy NEVER releases — on any event.
 *   3. control-socket holds before send-final, releases EXACTLY ONCE on send-final
 *      (every terminal outcome), holds after.
 *   9. single-release: after a release, no later event releases again.
 *
 * No IO — the reducer is pure; the gate folds event sequences and checks the
 * shouldRelease transitions.
 */

import assert from "node:assert/strict";
import type { ExecutionPlan } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	decideReleasePolicy,
	initialReleaseState,
	type ReleaseEvent,
	type ReleasePolicy,
	reduceRelease,
} from "../pi-extensions/lib/entwurf-v2-release.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

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

// Fold a sequence of events; return the shouldRelease flag emitted per event.
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

function throws(fn: () => unknown): boolean {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
}

// ── 1: decideReleasePolicy mapping + lock-nullness enforcement ───────────────
ok("policy: meta-mailbox + null → no-lock", decideReleasePolicy(MAILBOX_PLAN, null).kind === "no-lock");
ok(
	"policy: control-socket + lock → release-after-send-final",
	decideReleasePolicy(CONTROL_PLAN, lockClaim()).kind === "release-after-send-final",
);
ok(
	"policy: meta-mailbox + lock → throws (？7 violated)",
	throws(() => decideReleasePolicy(MAILBOX_PLAN, lockClaim())),
);
ok(
	"policy: control-socket + null → throws (must hold lock)",
	throws(() => decideReleasePolicy(CONTROL_PLAN, null)),
);
// in-domain lock whose gardenId ≠ plan target = mis-paired plan/lock (same grade as
// a null lock — a later release would free a DIFFERENT gid). Fail loud.
const WRONG_GID = "20260612T999999-bbbbbb";
ok(
	"policy: control-socket + mismatched lock gid → throws",
	throws(() => decideReleasePolicy(CONTROL_PLAN, { ...lockClaim(), gardenId: WRONG_GID })),
);

// ── 2: no-lock NEVER releases ────────────────────────────────────────────────
{
	const policy: ReleasePolicy = { kind: "no-lock" };
	const flags = fold(policy, [{ kind: "mailbox-enqueued" }, { kind: "send-final", outcome: "sent" }]);
	ok(
		"no-lock: never releases on any event",
		flags.every((f) => f === false),
	);
}

// ── 3: control-socket holds before send-final, releases once, holds after ────
{
	const policy: ReleasePolicy = { kind: "release-after-send-final" };
	for (const outcome of ["sent", "fallback-sent", "rejected", "failed"] as const) {
		const flags = fold(policy, [
			{ kind: "send-final", outcome },
			{ kind: "send-final", outcome },
		]);
		ok(`control: send-final(${outcome}) releases exactly once`, flags[0] === true && flags[1] === false);
	}
}

// ── 9: single-release — after release, no later event releases again ─────────
// Restated on the control-socket policy: the spawn observation events this used to fold
// went with their transport, but the at-most-once guarantee is the reducer's own and must
// still be proven against repeated terminal events.
{
	const policy: ReleasePolicy = { kind: "release-after-send-final" };
	const flags = fold(policy, [
		{ kind: "send-final", outcome: "sent" },
		{ kind: "send-final", outcome: "fallback-sent" },
		{ kind: "send-final", outcome: "failed" },
	]);
	ok(
		"single-release: exactly one release across many terminal events",
		flags.filter((f) => f).length === 1 && flags[0] === true,
	);
}

console.log(`\n[check-entwurf-v2-release] ${passed} assertions ok`);
