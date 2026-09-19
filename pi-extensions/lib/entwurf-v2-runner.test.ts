/**
 * entwurf-v2-runner — the 5d-1 execute-router (`executeDispatch`) and the 5d-2a
 * composition (`runEntwurfV2`), proven beside the module they live in (#119 V3).
 *
 * MIGRATED from scripts/check-entwurf-v2-runner.ts, assertion for assertion. Every case
 * builds its own fake hands inside its own test: the central claim of this file is
 * "EXACTLY one hand ran", and a call log shared across tests would carry a neighbour's
 * entry and turn that claim into noise.
 *
 * The original header, unchanged — deterministic gate for the 5d-1 execute-router
 * (`executeDispatch`). It proves the DECISION→hand routing + the outcome-rich result
 * mapping over injected fake hands, with NO socket or timer:
 *
 *   1. reject decision        → kind "rejected", receipt+diagnostic carried, NO hand called.
 *   2. control-socket execute → sendControl(plan, lock) called with the SAME plan + lock;
 *      result outcome "sent" → executed{control-socket, outcome:"sent"}.
 *   4. meta-mailbox execute   → sendMailbox(plan, null) with the NULL lock (？7); success
 *      → executed{meta-mailbox, success:true}.
 *   5. N3 — control rejected with rejectReason → executed{outcome:"rejected", rejectReason}
 *      carried verbatim.
 *   6. N1 — control hand throws SendDeliveredReleaseFailedError → execution-failed with
 *      finalizedOutcome + releaseFailed:true + retrySafe:false.
 *   7. control hand throws a PLAIN transport error → execution-failed, retrySafe:false,
 *      NO finalizedOutcome / releaseFailed (a failed send, lock already released).
 *   8. the mailbox hand throws → execution-failed, retrySafe:false.
 *   9. mailbox hand returns {success:false} → CONTRACT VIOLATION (a mailbox has no
 *      in-band reject) → fail loud → execution-failed, NOT a silent success.
 *  (exactly ONE hand runs per execute — the other two are never called — is asserted
 *   inline in cases 2/3/4.)
 *
 * 5d-2a adds the `runEntwurfV2` COMPOSITION gate (cases 10–14): `decide → execute` joined
 * over a FAKE `decide` (not the real decider — that is entwurf-v2-decider.test.ts's job):
 *  10. decide called EXACTLY once, with the SAME input.
 *  11. reject decision  → no executor hand called, the rejected result returned.
 *  12. execute decision → the matching executor hand ran (control/mailbox).
 *  13. decide THROWS    → propagates (no decision = no receipt to wrap).
 *  14. executeDispatch result returned VERBATIM (passthrough, no re-wrapping).
 *
 * No real IO — fake hands record (plan, lock) so "the decided plan + lock reach the
 * matching hand, and only that hand" is asserted structurally.
 */

import { describe, expect, it } from "vitest";

import type {
	DispatchDecision,
	DispatchInput,
	ExecutionPlan,
	RejectReceipt,
	SuccessReceipt,
} from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import type { NativePushPlan, NativePushSendResult } from "./entwurf-v2-native-push.ts";
import {
	type DispatchExecutorDeps,
	type EntwurfV2RunDeps,
	executeDispatch,
	runEntwurfV2,
} from "./entwurf-v2-runner.ts";
import type { ControlSocketPlan, ControlSocketSendResult, MetaMailboxPlan, RpcSendResult } from "./entwurf-v2-send.ts";
import { SendDeliveredReleaseFailedError } from "./entwurf-v2-send.ts";

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
const MAILBOX_PLAN: MetaMailboxPlan = {
	transport: "meta-mailbox",
	action: "send",
	targetGardenId: GID,
	mailboxDir: "/fake/mailbox",
	sessionsDir: "/fake/sessions",
	wantsReply: false,
	message: "m",
};
const NATIVE_PUSH_PLAN: NativePushPlan = {
	transport: "native-push",
	action: "send",
	targetGardenId: GID,
	backend: "antigravity",
	nativeSessionId: "conv-xyz",
	route: { backend: "antigravity", lsAddress: "127.0.0.1:5599" },
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
	mailboxArgs?: { plan: MetaMailboxPlan; lock: LockClaim | null };
	nativePushArgs?: { plan: NativePushPlan; lock: LockClaim | null };
}

interface FakeSpec {
	control?: { result: ControlSocketSendResult } | { throw: unknown };
	mailbox?: { result: RpcSendResult } | { throw: unknown };
	nativePush?: { result: NativePushSendResult } | { throw: unknown };
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
		async sendMailbox(plan, lock) {
			trace.calls.push("sendMailbox");
			trace.mailboxArgs = { plan, lock };
			if (!spec.mailbox) throw new Error("test: sendMailbox called but no spec");
			if ("throw" in spec.mailbox) throw spec.mailbox.throw;
			return spec.mailbox.result;
		},
		async sendNativePush(plan, lock) {
			trace.calls.push("sendNativePush");
			trace.nativePushArgs = { plan, lock };
			if (!spec.nativePush) throw new Error("test: sendNativePush called but no spec");
			if ("throw" in spec.nativePush) throw spec.nativePush.throw;
			return spec.nativePush.result;
		},
	};
	return { deps, trace };
}

const DISPATCH_INPUT: DispatchInput = {
	target: GID,
	intent: "fire-and-forget",
	mode: "follow_up",
	wantsReply: false,
	message: "m",
};

/** A fake decide that records how it was called and returns a scripted decision (or throws). */
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

describe("executeDispatch — a reject never reaches a hand", () => {
	it("carries the receipt and the diagnostic, and calls nothing", async () => {
		const { deps, trace } = makeDeps({});
		const conflict = {
			reason: "target-locked" as const,
			lockPath: "/fake/locks/x.lock",
			holder: lockClaim(),
			detail: "held",
		};
		const res = await executeDispatch(
			{ kind: "reject", receipt: REJECT_RECEIPT, diagnostic: { kind: "target-locked", conflict } },
			deps,
		);
		expect(res.kind).toBe("rejected");
		expect(res.kind === "rejected" && res.receipt).toBe(REJECT_RECEIPT);
		expect(res.kind === "rejected" && res.diagnostic?.kind).toBe("target-locked");
		expect(trace.calls).toEqual([]);
	});
});

describe("executeDispatch — the decided plan and lock reach the matching hand, and only that hand", () => {
	it("control-socket → sendControl(plan, lock), outcome sent", async () => {
		const lock = lockClaim();
		const { deps, trace } = makeDeps({ control: { result: { outcome: "sent" } } });
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lock), deps);
		expect(trace.calls).toEqual(["sendControl"]);
		expect(trace.controlArgs?.plan).toBe(CONTROL_PLAN);
		expect(trace.controlArgs?.lock).toBe(lock);
		expect(res.kind === "executed" && res.outcome.transport).toBe("control-socket");
		expect(res.kind === "executed" && res.outcome.transport === "control-socket" && res.outcome.outcome).toBe("sent");
		expect(res.kind === "executed" && res.receipt).toBe(SUCCESS_RECEIPT);
	});

	it("meta-mailbox → sendMailbox(plan, null), the NULL lock passed verbatim (？7)", async () => {
		const { deps, trace } = makeDeps({ mailbox: { result: { success: true } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		expect(trace.calls).toEqual(["sendMailbox"]);
		expect(trace.mailboxArgs?.lock).toBeNull();
		expect(trace.mailboxArgs?.plan).toBe(MAILBOX_PLAN);
		expect(res.kind === "executed" && res.outcome.transport).toBe("meta-mailbox");
		expect(res.kind === "executed" && res.outcome.transport === "meta-mailbox" && res.outcome.success).toBe(true);
	});

	// #98 R: a dep that reports no path leaves the receipt undefined. The runner must not
	// invent one — a guessed path is worse than no path.
	it("a dep that reports no enqueue path leaves messagePath undefined, never invented", async () => {
		const { deps } = makeDeps({ mailbox: { result: { success: true } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		expect(res.kind === "executed" && res.outcome.transport === "meta-mailbox" && res.outcome.messagePath).toBe(
			undefined,
		);
	});

	it("a dep that reports an enqueue path carries it through verbatim", async () => {
		const { deps } = makeDeps({ mailbox: { result: { success: true, messagePath: "/fake/mailbox/g/2026.msg" } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		expect(res.kind === "executed" && res.outcome.transport === "meta-mailbox" && res.outcome.messagePath).toBe(
			"/fake/mailbox/g/2026.msg",
		);
	});

	// 봉인 4: the native-push rail is lock-free too.
	it("native-push → sendNativePush(plan, null), success with retried:false", async () => {
		const { deps, trace } = makeDeps({ nativePush: { result: { success: true, retried: false } } });
		const res = await executeDispatch(executeDecision(NATIVE_PUSH_PLAN, null), deps);
		expect(trace.calls).toEqual(["sendNativePush"]);
		expect(trace.nativePushArgs?.lock).toBeNull();
		expect(trace.nativePushArgs?.plan).toBe(NATIVE_PUSH_PLAN);
		expect(res.kind === "executed" && res.outcome.transport).toBe("native-push");
		expect(res.kind === "executed" && res.outcome.transport === "native-push" && res.outcome.success).toBe(true);
		expect(res.kind === "executed" && res.outcome.transport === "native-push" && res.outcome.retried).toBe(false);
	});

	it("the native-push retried flag surfaces onto the executed outcome", async () => {
		const { deps } = makeDeps({ nativePush: { result: { success: true, retried: true } } });
		const res = await executeDispatch(executeDecision(NATIVE_PUSH_PLAN, null), deps);
		expect(res.kind === "executed" && res.outcome.transport === "native-push" && res.outcome.retried).toBe(true);
	});

	// N3: a control hand that rejects in-band carries its reason out verbatim.
	it("a control rejectReason is carried onto the executed result", async () => {
		const { deps } = makeDeps({
			control: { result: { outcome: "rejected", rejectReason: "dormant-fire-forget-unsupported" } },
		});
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		expect(res.kind === "executed" && res.outcome.transport === "control-socket" && res.outcome.rejectReason).toBe(
			"dormant-fire-forget-unsupported",
		);
	});
});

describe("executeDispatch — what a throwing hand becomes", () => {
	// N1: the send landed and the release did not. Retrying would re-deliver, so the result
	// says so rather than looking like an ordinary failure.
	it("SendDeliveredReleaseFailedError → finalizedOutcome + releaseFailed + retrySafe:false", async () => {
		const { deps } = makeDeps({
			control: { throw: new SendDeliveredReleaseFailedError("sent", new Error("release boom")) },
		});
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.finalizedOutcome).toBe("sent");
		expect(res.kind === "execution-failed" && res.releaseFailed).toBe(true);
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
	});

	it("a plain transport throw → execution-failed with no finalizedOutcome and no releaseFailed", async () => {
		const { deps } = makeDeps({ control: { throw: new Error("connect indeterminate / dep boom") } });
		const res = await executeDispatch(executeDecision(CONTROL_PLAN, lockClaim()), deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
		expect(res.kind === "execution-failed" && res.finalizedOutcome).toBe(undefined);
		expect(res.kind === "execution-failed" && res.releaseFailed).toBe(undefined);
	});

	it("a mailbox throw → execution-failed", async () => {
		const { deps } = makeDeps({ mailbox: { throw: new Error("enqueue boom") } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.transport).toBe("meta-mailbox");
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
	});

	it("a native-push throw → execution-failed, retry-unsafe", async () => {
		const { deps } = makeDeps({ nativePush: { throw: new Error("agy send boom") } });
		const res = await executeDispatch(executeDecision(NATIVE_PUSH_PLAN, null), deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.transport).toBe("native-push");
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
	});

	// 5c-4: a mailbox enqueue is {success:true} OR a throw — there is no in-band reject. A
	// success:false is a CONTRACT VIOLATION and must not be rendered as a success.
	it("a mailbox {success:false} fails loud instead of passing as a silent success", async () => {
		const { deps } = makeDeps({ mailbox: { result: { success: false, error: "should never happen" } } });
		const res = await executeDispatch(executeDecision(MAILBOX_PLAN, null), deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.transport).toBe("meta-mailbox");
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
	});
});

// 5d-2a. The composition is joined over a FAKE decide — exercising the real decider is
// entwurf-v2-decider.test.ts's job, and doing it twice would prove it in neither place.
describe("runEntwurfV2 — decide, then execute", () => {
	it("decide is called exactly once, with the SAME input object", async () => {
		const { deps, decideCalls } = makeRunDeps({ decision: { kind: "reject", receipt: REJECT_RECEIPT } }, {});
		await runEntwurfV2(DISPATCH_INPUT, deps);
		expect(decideCalls.length).toBe(1);
		expect(decideCalls[0]).toBe(DISPATCH_INPUT);
	});

	it("a reject decision returns the rejected result and calls no executor hand", async () => {
		const { deps, trace } = makeRunDeps({ decision: { kind: "reject", receipt: REJECT_RECEIPT } }, {});
		const res = await runEntwurfV2(DISPATCH_INPUT, deps);
		expect(res.kind).toBe("rejected");
		expect(res.kind === "rejected" && res.receipt).toBe(REJECT_RECEIPT);
		expect(trace.calls).toEqual([]);
	});

	it("a control execute decision runs sendControl and nothing else", async () => {
		const ctl = makeRunDeps(
			{ decision: executeDecision(CONTROL_PLAN, lockClaim()) },
			{ control: { result: { outcome: "sent" } } },
		);
		const rc = await runEntwurfV2(DISPATCH_INPUT, ctl.deps);
		expect(ctl.trace.calls).toEqual(["sendControl"]);
		expect(rc.kind === "executed" && rc.outcome.transport).toBe("control-socket");
	});

	it("a mailbox execute decision runs sendMailbox and nothing else", async () => {
		const mbx = makeRunDeps(
			{ decision: executeDecision(MAILBOX_PLAN, null) },
			{ mailbox: { result: { success: true } } },
		);
		const rmb = await runEntwurfV2(DISPATCH_INPUT, mbx.deps);
		expect(mbx.trace.calls).toEqual(["sendMailbox"]);
		expect(rmb.kind === "executed" && rmb.outcome.transport).toBe("meta-mailbox");
	});

	it("a throwing decide propagates the SAME error, and no hand runs", async () => {
		const boom = new Error("decider boom");
		const { deps, trace } = makeRunDeps({ throw: boom }, {});
		await expect(runEntwurfV2(DISPATCH_INPUT, deps)).rejects.toBe(boom);
		expect(trace.calls).toEqual([]);
	});

	// The runner adds no wrapping over executeDispatch's mapping: an N1 from the hand has to
	// surface through the composition unchanged, or the retry-unsafe signal is lost.
	it("an executeDispatch result passes through verbatim", async () => {
		const { deps } = makeRunDeps(
			{ decision: executeDecision(CONTROL_PLAN, lockClaim()) },
			{ control: { throw: new SendDeliveredReleaseFailedError("sent", new Error("release boom")) } },
		);
		const res = await runEntwurfV2(DISPATCH_INPUT, deps);
		expect(res.kind).toBe("execution-failed");
		expect(res.kind === "execution-failed" && res.finalizedOutcome).toBe("sent");
		expect(res.kind === "execution-failed" && res.releaseFailed).toBe(true);
		expect(res.kind === "execution-failed" && res.retrySafe).toBe(false);
	});
});
