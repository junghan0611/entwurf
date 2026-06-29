/**
 * check-entwurf-v2-release — deterministic gate for the PURE release-policy reducer
 * (0.11 Stage 0 step 5c-1). Proves the Fable-3 "release-after-observation" timing as
 * a pure state machine BEFORE any spawn/send IO exists:
 *
 *   1. decideReleasePolicy maps each transport correctly and ENFORCES the lock
 *      invariants (meta-mailbox ⇒ null else throw; in-domain ⇒ non-null AND
 *      lock.gardenId === plan.targetGardenId, else throw).
 *   2. no-lock policy NEVER releases — on any event.
 *   3. control-socket holds before send-final, releases EXACTLY ONCE on send-final
 *      (every terminal outcome), holds after.
 *   4. spawn-bg: spawn-started ALONE does NOT release (the load-bearing rule).
 *   5. spawn-bg: first socket-alive releases.
 *   6. spawn-bg: first child-exited (any code: 0 / non-zero / null-signal) releases.
 *   7. spawn-bg: socket↔exit race is idempotent — one release regardless of order.
 *   8. spawn-bg: spawn-start-failed finalizes (no child to watch) with one release.
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
const SPAWN_PLAN: ExecutionPlan = {
	transport: "spawn-bg",
	action: "resume",
	targetGardenId: GID,
	sessionId: GID,
	cwd: "/home/junghan/repos/gh/entwurf",
	prompt: "p",
	launchArgs: ["--approve"],
	expectedSocketPath: "/fake/ctl/s.sock",
	observeTimeoutMs: 30_000,
	releaseWhen: "socket-alive-or-child-exited",
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
	"policy: spawn-bg + lock → release-after-spawn-observation",
	decideReleasePolicy(SPAWN_PLAN, lockClaim()).kind === "release-after-spawn-observation",
);
ok(
	"policy: meta-mailbox + lock → throws (？7 violated)",
	throws(() => decideReleasePolicy(MAILBOX_PLAN, lockClaim())),
);
ok(
	"policy: control-socket + null → throws (must hold lock)",
	throws(() => decideReleasePolicy(CONTROL_PLAN, null)),
);
ok(
	"policy: spawn-bg + null → throws (must hold lock)",
	throws(() => decideReleasePolicy(SPAWN_PLAN, null)),
);
// in-domain lock whose gardenId ≠ plan target = mis-paired plan/lock (same grade as
// a null lock — a later release would free a DIFFERENT gid). Fail loud.
const WRONG_GID = "20260612T999999-bbbbbb";
ok(
	"policy: control-socket + mismatched lock gid → throws",
	throws(() => decideReleasePolicy(CONTROL_PLAN, { ...lockClaim(), gardenId: WRONG_GID })),
);
ok(
	"policy: spawn-bg + mismatched lock gid → throws",
	throws(() => decideReleasePolicy(SPAWN_PLAN, { ...lockClaim(), gardenId: WRONG_GID })),
);

// ── 2: no-lock NEVER releases ────────────────────────────────────────────────
{
	const policy: ReleasePolicy = { kind: "no-lock" };
	const flags = fold(policy, [
		{ kind: "mailbox-enqueued" },
		{ kind: "send-final", outcome: "sent" },
		{ kind: "socket-alive" },
		{ kind: "child-exited", code: 0 },
		{ kind: "spawn-started", pid: 1 },
	]);
	ok(
		"no-lock: never releases on any event",
		flags.every((f) => f === false),
	);
}

// ── 3: control-socket holds before send-final, releases once, holds after ────
{
	const policy: ReleasePolicy = { kind: "release-after-send-final" };
	ok("control: spawn-started before final → hold", fold(policy, [{ kind: "spawn-started", pid: 1 }])[0] === false);
	ok("control: socket-alive before final → hold", fold(policy, [{ kind: "socket-alive" }])[0] === false);
	for (const outcome of ["sent", "fallback-sent", "rejected", "failed"] as const) {
		const flags = fold(policy, [
			{ kind: "send-final", outcome },
			{ kind: "send-final", outcome },
		]);
		ok(`control: send-final(${outcome}) releases exactly once`, flags[0] === true && flags[1] === false);
	}
}

// ── 4: spawn-bg — spawn-started ALONE does NOT release (load-bearing) ─────────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	ok("spawn: spawn-started alone → NO release", fold(policy, [{ kind: "spawn-started", pid: 99 }])[0] === false);
	ok(
		"spawn: spawn-started then socket-alive → release only on observation",
		(() => {
			const f = fold(policy, [{ kind: "spawn-started", pid: 99 }, { kind: "socket-alive" }]);
			return f[0] === false && f[1] === true;
		})(),
	);
}

// ── 5: spawn-bg — first socket-alive releases ────────────────────────────────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	ok("spawn: socket-alive releases", fold(policy, [{ kind: "socket-alive" }])[0] === true);
}

// ── 6: spawn-bg — first child-exited (any code) releases ─────────────────────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	for (const code of [0, 1, 137, null] as const) {
		ok(`spawn: child-exited(code=${code}) releases`, fold(policy, [{ kind: "child-exited", code }])[0] === true);
	}
}

// ── 7: spawn-bg — socket↔exit race idempotent (one release, either order) ────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	const socketThenExit = fold(policy, [{ kind: "socket-alive" }, { kind: "child-exited", code: 0 }]);
	ok(
		"spawn: socket-alive then child-exited → release only on first",
		socketThenExit[0] === true && socketThenExit[1] === false,
	);
	const exitThenSocket = fold(policy, [{ kind: "child-exited", code: 1 }, { kind: "socket-alive" }]);
	ok(
		"spawn: child-exited then socket-alive → release only on first",
		exitThenSocket[0] === true && exitThenSocket[1] === false,
	);
}

// ── 8: spawn-bg — spawn-start-failed finalizes (no child to watch) ───────────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	ok(
		"spawn: spawn-start-failed releases (frees the gid, no child)",
		fold(policy, [{ kind: "spawn-start-failed", error: "ENOENT" }])[0] === true,
	);
	const startedThenFailedImpossibleButSafe = fold(policy, [
		{ kind: "spawn-started", pid: 1 },
		{ kind: "spawn-start-failed", error: "late" },
	]);
	ok(
		"spawn: started(hold) then start-failed(release) — still one release",
		startedThenFailedImpossibleButSafe[0] === false && startedThenFailedImpossibleButSafe[1] === true,
	);
}

// ── 9: single-release — after release, no later event releases again ─────────
{
	const policy: ReleasePolicy = { kind: "release-after-spawn-observation" };
	const flags = fold(policy, [
		{ kind: "socket-alive" },
		{ kind: "child-exited", code: 0 },
		{ kind: "child-exited", code: 1 },
		{ kind: "socket-alive" },
	]);
	ok(
		"single-release: exactly one release across many triggers",
		flags.filter((f) => f).length === 1 && flags[0] === true,
	);
}

console.log(`\n[check-entwurf-v2-release] ${passed} assertions ok`);
