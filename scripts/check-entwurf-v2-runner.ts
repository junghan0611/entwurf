/**
 * check-entwurf-v2-runner — deterministic gate for the 5d-1 execute-router
 * (`executeDispatch`). It proves the DECISION→hand routing + the outcome-rich result
 * mapping over injected fake hands, with NO socket/spawn/timer:
 *
 *   1. reject decision        → kind "rejected", receipt+diagnostic carried, NO hand called.
 *   2. control-socket execute → sendControl(plan, lock) called with the SAME plan + lock;
 *      result outcome "sent" → executed{control-socket, outcome:"sent"}.
 *   3. spawn-bg execute       → resumeSpawnBg(plan, lock); a `socket-alive` result rides
 *      executed; a `lock-retained` result ALSO rides executed (fail-closed, not a failure).
 *   4. meta-mailbox execute   → sendMailbox(plan, null) with the NULL lock (？7); success
 *      → executed{meta-mailbox, success:true}.
 *   5. N3 — control rejected with rejectReason → executed{outcome:"rejected", rejectReason}
 *      carried verbatim.
 *   6. N1 — control hand throws SendDeliveredReleaseFailedError → execution-failed with
 *      finalizedOutcome + releaseFailed:true + retrySafe:false.
 *   7. control hand throws a PLAIN transport error → execution-failed, retrySafe:false,
 *      NO finalizedOutcome / releaseFailed (a failed send, lock already released).
 *   8. spawn / mailbox hand throws → execution-failed, retrySafe:false.
 *   9. mailbox hand returns {success:false} → CONTRACT VIOLATION (a mailbox has no
 *      in-band reject) → fail loud → execution-failed, NOT a silent success.
 *  (exactly ONE hand runs per execute — the other two are never called — is asserted
 *   inline in cases 2/3/4.)
 *
 * 5d-2a adds the `runEntwurfV2` COMPOSITION gate (cases 10–14): `decide → execute` joined
 * over a FAKE `decide` (not the real decider — that is check-entwurf-v2-decider's job):
 *  10. decide called EXACTLY once, with the SAME input.
 *  11. reject decision  → no executor hand called, the rejected result returned.
 *  12. execute decision → the matching executor hand ran (control/spawn/mailbox).
 *  13. decide THROWS    → propagates (no decision = no receipt to wrap).
 *  14. executeDispatch result returned VERBATIM (passthrough, no re-wrapping).
 *
 * No real IO — fake hands record (plan, lock) so "the decided plan + lock reach the
 * matching hand, and only that hand" is asserted structurally.
 */

import assert from "node:assert/strict";
import type {
	DispatchDecision,
	DispatchInput,
	ExecutionPlan,
	RejectReceipt,
	SuccessReceipt,
} from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	type DispatchExecutorDeps,
	type EntwurfV2RunDeps,
	executeDispatch,
	runEntwurfV2,
} from "../pi-extensions/lib/entwurf-v2-runner.ts";
import type {
	ControlSocketPlan,
	ControlSocketSendResult,
	MetaMailboxPlan,
	RpcSendResult,
} from "../pi-extensions/lib/entwurf-v2-send.ts";
import { SendDeliveredReleaseFailedError } from "../pi-extensions/lib/entwurf-v2-send.ts";
import type { SpawnBgPlan, SpawnBgResumeResult } from "../pi-extensions/lib/entwurf-v2-spawn.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260613T100000-aaaaaa";

function lockClaim(gardenId = GID): LockClaim {
	return {
		gardenId,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-13T01:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${gardenId}.lock`,
	};
}

const CONTROL_PLAN: ControlSocketPlan = {
	transport: "control-socket",
	action: "send",
	targetGardenId: GID,
	socketPath: "/fake/ctl/s.sock",
	mode: "follow_up",
	wantsReply: false,
	message: "m",
};
const SPAWN_PLAN: SpawnBgPlan = {
	transport: "spawn-bg",
	action: "resume",
	targetGardenId: GID,
	sessionId: GID,
	cwd: "/home/junghan/repos/gh/entwurf",
	prompt: "p",
	launchArgs: [],
	expectedSocketPath: "/fake/ctl/s.sock",
	observeTimeoutMs: 30_000,
	releaseWhen: "socket-alive-or-child-exited",
};
const MAILBOX_PLAN: MetaMailboxPlan = {
	transport: "meta-mailbox",
	action: "send",
	targetGardenId: GID,
	mailboxDir: "/fake/mailbox",
	sessionsDir: "/fake/sessions",
	wantsReply: false,
	message: "m",
};

const SUCCESS_RECEIPT: SuccessReceipt = {
	ok: true,
	action: "send",
	transport: "control-socket",
	ownership: "ack-only",
	observedLiveness: "alive",
};
const REJECT_RECEIPT: RejectReceipt = { ok: false, reason: "bad-target", observedLiveness: null };

function executeDecision(plan: ExecutionPlan, lock: LockClaim | null): Extract<DispatchDecision, { kind: "execute" }> {
	return { kind: "execute", receipt: SUCCESS_RECEIPT, plan, lock };
}

interface Trace {
	calls: string[];
	controlArgs?: { plan: ControlSocketPlan; lock: LockClaim | null };
	spawnArgs?: { plan: SpawnBgPlan; lock: LockClaim | null };
	mailboxArgs?: { plan: MetaMailboxPlan; lock: LockClaim | null };
}

interface FakeSpec {
	control?: { result: ControlSocketSendResult } | { throw: unknown };
	spawn?: { result: SpawnBgResumeResult } | { throw: unknown };
	mailbox?: { result: RpcSendResult } | { throw: unknown };
}

function makeDeps(spec: FakeSpec): { deps: DispatchExecutorDeps; trace: Trace } {
	const trace: Trace = { calls: [] };
	const deps: DispatchExecutorDeps = {
		async sendControl(plan, lock) {
			trace.calls.push("sendControl");
			trace.controlArgs = { plan, lock };
			if (!spec.control) throw new Error("test: sendControl called but no spec");
			if ("throw" in spec.control) throw spec.control.throw;
			return spec.control.result;
		},
		async resumeSpawnBg(plan, lock) {
			trace.calls.push("resumeSpawnBg");
			trace.spawnArgs = { plan, lock };
			if (!spec.spawn) throw new Error("test: resumeSpawnBg called but no spec");
			if ("throw" in spec.spawn) throw spec.spawn.throw;
			return spec.spawn.result;
		},
		async sendMailbox(plan, lock) {
			trace.calls.push("sendMailbox");
			trace.mailboxArgs = { plan, lock };
			if (!spec.mailbox) throw new Error("test: sendMailbox called but no spec");
			if ("throw" in spec.mailbox) throw spec.mailbox.throw;
			return spec.mailbox.result;
		},
	};
	return { deps, trace };
}

async function main(): Promise<void> {
	// ── 1: reject → no hand called, receipt+diagnostic carried ────────────────
	{
		const { deps, trace } = makeDeps({});
		const conflict = {
			reason: "target-locked" as const,
			lockPath: "/fake/locks/x.lock",
			holder: lockClaim(),
			detail: "held",
		};
		const decision: DispatchDecision = {
			kind: "reject",
			receipt: REJECT_RECEIPT,
			diagnostic: { kind: "target-locked", conflict },
		};
		const res = await executeDispatch(decision, deps);
		ok("1: reject → kind 'rejected'", res.kind === "rejected");
		ok("1: reject → receipt carried", res.kind === "rejected" && res.receipt === REJECT_RECEIPT);
		ok("1: reject → diagnostic carried", res.kind === "rejected" && res.diagnostic?.kind === "target-locked");
		ok("1: reject → NO hand called", trace.calls.length === 0);
	}

	// ── 2: control-socket execute → sendControl(plan, lock), sent ─────────────
	{
		const lock = lockClaim();
		const { deps, trace } = makeDeps({ control: { result: { outcome: "sent" } } });
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lock), deps);
		ok("2: only sendControl ran", trace.calls.length === 1 && trace.calls[0] === "sendControl");
		ok(
			"2: same plan + lock reach the hand",
			trace.controlArgs?.plan === CONTROL_PLAN && trace.controlArgs?.lock === lock,
		);
		ok(
			"2: executed{control-socket, sent}",
			res.kind === "executed" && res.outcome.transport === "control-socket" && res.outcome.outcome === "sent",
		);
		ok("2: success receipt carried", res.kind === "executed" && res.receipt === SUCCESS_RECEIPT);
	}

	// ── 3: spawn-bg execute → socket-alive AND lock-retained both ride executed ─
	{
		const lock = lockClaim();
		const alive = makeDeps({ spawn: { result: { kind: "socket-alive", released: true, pid: 7 } } });
		const r1 = await executeDispatch(executeDecision(SPAWN_PLAN, lock), alive.deps);
		ok("3: spawn → only resumeSpawnBg ran", alive.trace.calls.length === 1 && alive.trace.calls[0] === "resumeSpawnBg");
		ok(
			"3: spawn plan + lock reach the hand",
			alive.trace.spawnArgs?.plan === SPAWN_PLAN && alive.trace.spawnArgs?.lock === lock,
		);
		ok(
			"3: socket-alive → executed{spawn-bg, socket-alive}",
			r1.kind === "executed" && r1.outcome.transport === "spawn-bg" && r1.outcome.result.kind === "socket-alive",
		);

		const retainedResult: SpawnBgResumeResult = {
			kind: "lock-retained",
			released: false,
			reason: "observe-failed",
			diagnostic: {
				targetGardenId: GID,
				lockPath: "/fake/locks/x.lock",
				expectedSocketPath: "/fake/ctl/s.sock",
				observeTimeoutMs: 30_000,
				killGraceMs: 5_000,
			},
		};
		const retained = makeDeps({ spawn: { result: retainedResult } });
		const r2 = await executeDispatch(executeDecision(SPAWN_PLAN, lock), retained.deps);
		ok(
			"3: lock-retained rides executed (fail-closed, not a failure)",
			r2.kind === "executed" && r2.outcome.transport === "spawn-bg" && r2.outcome.result.kind === "lock-retained",
		);
	}

	// ── 4: meta-mailbox execute → sendMailbox(plan, null), success ────────────
	{
		const { deps, trace } = makeDeps({ mailbox: { result: { success: true } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		ok("4: only sendMailbox ran", trace.calls.length === 1 && trace.calls[0] === "sendMailbox");
		ok(
			"4: NULL lock passed verbatim (？7)",
			trace.mailboxArgs?.lock === null && trace.mailboxArgs?.plan === MAILBOX_PLAN,
		);
		ok(
			"4: executed{meta-mailbox, success}",
			res.kind === "executed" && res.outcome.transport === "meta-mailbox" && res.outcome.success === true,
		);
	}

	// ── 5: N3 — control rejected with rejectReason carried ────────────────────
	{
		const { deps } = makeDeps({
			control: { result: { outcome: "rejected", rejectReason: "dormant-fire-forget-unsupported" } },
		});
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		ok(
			"5: N3 rejectReason carried onto executed result",
			res.kind === "executed" &&
				res.outcome.transport === "control-socket" &&
				res.outcome.rejectReason === "dormant-fire-forget-unsupported",
		);
	}

	// ── 6: N1 — SendDeliveredReleaseFailedError → execution-failed, no-retry ───
	{
		const releaseErr = new Error("release boom");
		const { deps } = makeDeps({ control: { throw: new SendDeliveredReleaseFailedError("sent", releaseErr) } });
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		ok("6: N1 → execution-failed", res.kind === "execution-failed");
		ok(
			"6: N1 → finalizedOutcome 'sent' + releaseFailed + retrySafe:false",
			res.kind === "execution-failed" &&
				res.finalizedOutcome === "sent" &&
				res.releaseFailed === true &&
				res.retrySafe === false,
		);
	}

	// ── 7: control PLAIN throw → execution-failed, no finalizedOutcome ────────
	{
		const { deps } = makeDeps({ control: { throw: new Error("connect indeterminate / dep boom") } });
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		ok(
			"7: plain throw → execution-failed, retrySafe:false",
			res.kind === "execution-failed" && res.retrySafe === false,
		);
		ok(
			"7: plain throw → no finalizedOutcome / releaseFailed",
			res.kind === "execution-failed" && res.finalizedOutcome === undefined && res.releaseFailed === undefined,
		);
	}

	// ── 8: spawn / mailbox hand throw → execution-failed ──────────────────────
	{
		const s = makeDeps({ spawn: { throw: new Error("spawn boom") } });
		const rs = await executeDispatch(executeDecision(SPAWN_PLAN, lockClaim()), s.deps);
		ok(
			"8: spawn throw → execution-failed",
			rs.kind === "execution-failed" && rs.transport === "spawn-bg" && rs.retrySafe === false,
		);

		const m = makeDeps({ mailbox: { throw: new Error("enqueue boom") } });
		const rm = await executeDispatch(executeDecision(MAILBOX_PLAN, null), m.deps);
		ok(
			"8: mailbox throw → execution-failed",
			rm.kind === "execution-failed" && rm.transport === "meta-mailbox" && rm.retrySafe === false,
		);
	}

	// ── 9: mailbox returns {success:false} → CONTRACT VIOLATION, fail loud ─────
	// 5c-4: a mailbox enqueue is {success:true} OR a throw — there is no in-band reject.
	// A success:false must NOT be silently rendered as a success; the runner fails loud.
	{
		const { deps } = makeDeps({ mailbox: { result: { success: false, error: "should never happen" } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		ok(
			"9: mailbox success:false → execution-failed (not a silent success)",
			res.kind === "execution-failed" && res.transport === "meta-mailbox" && res.retrySafe === false,
		);
	}

	// ── 10–14: runEntwurfV2 composition (5d-2a) over a FAKE decide ─────────────
	const DISPATCH_INPUT: DispatchInput = {
		target: GID,
		intent: "fire-and-forget",
		mode: "follow_up",
		wantsReply: false,
		message: "m",
	};

	// A fake decide records how it was called and returns a scripted decision (or throws).
	function makeRunDeps(
		decideSpec: { decision: DispatchDecision } | { throw: unknown },
		execSpec: FakeSpec,
	): { deps: EntwurfV2RunDeps; decideCalls: DispatchInput[]; trace: Trace } {
		const { deps: executor, trace } = makeDeps(execSpec);
		const decideCalls: DispatchInput[] = [];
		const deps: EntwurfV2RunDeps = {
			decide(input) {
				decideCalls.push(input);
				if ("throw" in decideSpec) throw decideSpec.throw;
				return decideSpec.decision;
			},
			executor,
		};
		return { deps, decideCalls, trace };
	}

	// ── 10: decide called exactly once, with the same input ───────────────────
	{
		const decision: DispatchDecision = { kind: "reject", receipt: REJECT_RECEIPT };
		const { deps, decideCalls } = makeRunDeps({ decision }, {});
		await runEntwurfV2(DISPATCH_INPUT, deps);
		ok("10: decide called exactly once", decideCalls.length === 1);
		ok("10: decide got the SAME input", decideCalls[0] === DISPATCH_INPUT);
	}

	// ── 11: reject decision → no hand called, rejected result returned ────────
	{
		const decision: DispatchDecision = { kind: "reject", receipt: REJECT_RECEIPT };
		const { deps, trace } = makeRunDeps({ decision }, {});
		const res = await runEntwurfV2(DISPATCH_INPUT, deps);
		ok("11: reject → rejected result", res.kind === "rejected" && res.receipt === REJECT_RECEIPT);
		ok("11: reject → NO executor hand called", trace.calls.length === 0);
	}

	// ── 12: execute decision → the matching hand ran (per transport) ──────────
	{
		const lock = lockClaim();
		const ctl = makeRunDeps(
			{ decision: executeDecision(CONTROL_PLAN, lock) },
			{ control: { result: { outcome: "sent" } } },
		);
		const rc = await runEntwurfV2(DISPATCH_INPUT, ctl.deps);
		ok(
			"12: control execute → sendControl ran, executed{control-socket}",
			ctl.trace.calls.length === 1 &&
				ctl.trace.calls[0] === "sendControl" &&
				rc.kind === "executed" &&
				rc.outcome.transport === "control-socket",
		);

		const spw = makeRunDeps(
			{ decision: executeDecision(SPAWN_PLAN, lock) },
			{ spawn: { result: { kind: "socket-alive", released: true, pid: 7 } } },
		);
		const rsp = await runEntwurfV2(DISPATCH_INPUT, spw.deps);
		ok(
			"12: spawn execute → resumeSpawnBg ran, executed{spawn-bg}",
			spw.trace.calls.length === 1 &&
				spw.trace.calls[0] === "resumeSpawnBg" &&
				rsp.kind === "executed" &&
				rsp.outcome.transport === "spawn-bg",
		);

		const mbx = makeRunDeps(
			{ decision: executeDecision(MAILBOX_PLAN, null) },
			{ mailbox: { result: { success: true } } },
		);
		const rmb = await runEntwurfV2(DISPATCH_INPUT, mbx.deps);
		ok(
			"12: mailbox execute → sendMailbox ran, executed{meta-mailbox}",
			mbx.trace.calls.length === 1 &&
				mbx.trace.calls[0] === "sendMailbox" &&
				rmb.kind === "executed" &&
				rmb.outcome.transport === "meta-mailbox",
		);
	}

	// ── 13: decide THROWS → propagates (no decision = no receipt to wrap) ─────
	{
		const boom = new Error("decider boom");
		const { deps, trace } = makeRunDeps({ throw: boom }, {});
		let caught: unknown;
		try {
			await runEntwurfV2(DISPATCH_INPUT, deps);
		} catch (err) {
			caught = err;
		}
		ok("13: decide throw → propagates the SAME error", caught === boom);
		ok("13: decide throw → NO executor hand called", trace.calls.length === 0);
	}

	// ── 14: executeDispatch result returned VERBATIM (passthrough) ────────────
	// A control hand throwing the N1 error must surface AS execution-failed{...} through
	// runEntwurfV2 unchanged — the runner adds no wrapping over executeDispatch's mapping.
	{
		const releaseErr = new Error("release boom");
		const { deps } = makeRunDeps(
			{ decision: executeDecision(CONTROL_PLAN, lockClaim()) },
			{ control: { throw: new SendDeliveredReleaseFailedError("sent", releaseErr) } },
		);
		const res = await runEntwurfV2(DISPATCH_INPUT, deps);
		ok(
			"14: N1 surfaces verbatim → execution-failed{finalizedOutcome,releaseFailed,retrySafe:false}",
			res.kind === "execution-failed" &&
				res.finalizedOutcome === "sent" &&
				res.releaseFailed === true &&
				res.retrySafe === false,
		);
	}

	console.log(`\ncheck-entwurf-v2-runner: ${passed} checks passed`);
}

await main();
