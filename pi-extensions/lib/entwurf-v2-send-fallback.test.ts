/**
 * entwurf-v2-send-fallback — the 5c-2b same-lock re-resolve resolver
 * (`resolveDeadControlSendFallback`), proven beside the code it certifies (#119 V3).
 *
 * MIGRATED from scripts/check-entwurf-v2-send-fallback.ts, assertion for assertion. The
 * contract did not change and is restated so this file reads without the one it replaced:
 * the dead-control-send fallback routes over injected fakes with NO filesystem, and it
 * never releases, never spawns and never mis-routes off the held gid.
 *
 *   1. mis-wire: plan/lock gid mismatch → throws BEFORE any IO (no resolveTarget call).
 *   2. bad-target (identity null) → reject, NO inspect/probe.
 *   3. preProbeAddressConflict → reject, NO inspect/probe.
 *   4. unsupported backend + seam deliverable → meta-mailbox plan, NO inspect/probe;
 *      message/wantsReply preserved, same target gid.
 *   5. unsupported backend + seam undeliverable → reject, NO inspect/probe. A self-fetch
 *      citizen with an INACTIVE receiver is refused here too (SE-2 2d-3).
 *   6. in-domain pi + socket-file + probe alive → control-socket plan with the INSPECTED
 *      socketPath; message/mode/wantsReply preserved, same target gid.
 *   7. in-domain pi + absent (ENOENT → dead) → reject (dormant-fire-forget-unsupported);
 *      NEVER a mailbox.
 *   8. in-domain pi + probe indeterminate → reject (indeterminate-no-spawn); no mailbox.
 *   9. in-domain pi + inspect indeterminate → reject; no probe connect, no mailbox.
 *  10. address-conflict (symlink) → reject (target-address-conflict).
 *  11. probe throw / inspect throw → PROPAGATE (the resolver does not catch; the 5c-2a
 *      hand owns failed+release). The resolver NEVER calls a release seam — it has none.
 *  12. every execute plan targets plan.targetGardenId === lock.gardenId, and is one of
 *      control-socket / meta-mailbox only.
 *
 * No real IO. The fakes COUNT inspect/probe calls, which is what makes "short-circuits
 * before probing" a structural assertion rather than a hopeful one. Every case builds its
 * own deps inside its own test: a trace shared across tests would count another test's
 * calls and the short-circuit claims would stop meaning anything.
 */

import { describe, expect, it } from "vitest";

import type { TargetResolution } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import type { ControlSocketPlan } from "./entwurf-v2-send.ts";
import { type DeadFallbackDeps, resolveDeadControlSendFallback } from "./entwurf-v2-send-fallback.ts";
import type { MetaCitizenBackend, MetaIdentity } from "./meta-session.ts";
import type { TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

const GID = "20260612T100000-aaaaaa";
const WRONG_GID = "20260612T999999-bbbbbb";
const CWD = "/home/junghan/repos/gh/entwurf";

function lockClaim(gardenId = GID): LockClaim {
	return {
		gardenId,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-12T01:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${gardenId}.lock`,
	};
}

function identity(backend: MetaCitizenBackend): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: GID,
		backend,
		nativeSessionId: `native-${GID}`,
		cwd: CWD,
		model: null,
		transcriptPath: null,
		createdAt: "2026-06-12T01:00:00.000Z",
		recordUpdatedAt: "2026-06-12T01:00:00.000Z",
	};
}

const CONTROL_PLAN = {
	transport: "control-socket",
	action: "send",
	targetGardenId: GID,
	socketPath: "/fake/ctl/orig.sock",
	mode: "follow_up",
	wantsReply: true,
	message: "hello",
} as const satisfies ControlSocketPlan;

interface Trace {
	inspectCalls: number;
	probeCalls: number;
}

interface FakeSpec {
	resolution: TargetResolution;
	/** SE-2 2d-3: the verdict the injected mailboxDeliverabilityFor seam returns on the
	 * unsupported path. Default false (fail-closed) — the resolver trusts the seam's
	 * active-receiver judgement, never wake-mode alone. */
	mailboxDeliverable?: boolean;
	inspection?: TargetSocketInspection | { throw: unknown };
	probe?: SocketLiveness | { throw: unknown };
}

function makeDeps(spec: FakeSpec): { deps: DeadFallbackDeps; trace: Trace } {
	const trace: Trace = { inspectCalls: 0, probeCalls: 0 };
	const deps: DeadFallbackDeps = {
		async resolveTarget() {
			return spec.resolution;
		},
		async inspectSocket(_gid) {
			trace.inspectCalls++;
			if (!spec.inspection) throw new Error("test: inspectSocket called but no inspection spec");
			if ("throw" in spec.inspection) throw spec.inspection.throw;
			return spec.inspection;
		},
		async probeSocket(_path) {
			trace.probeCalls++;
			if (spec.probe === undefined) throw new Error("test: probeSocket called but no probe spec");
			if (typeof spec.probe === "object" && "throw" in spec.probe) throw spec.probe.throw;
			return spec.probe;
		},
		mailboxDeliverabilityFor: () => ({ deliverable: spec.mailboxDeliverable ?? false, reason: "fake-deliverability" }),
	};
	return { deps, trace };
}

function present(identityArg: MetaIdentity): TargetResolution {
	return { identity: identityArg, preProbeAddressConflict: false };
}

async function rejects(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
		return Symbol("did-not-throw");
	} catch (err) {
		return err;
	}
}

describe("before any IO", () => {
	it("mis-wire (plan/lock gid mismatch) → throws, and never touches inspect/probe", async () => {
		const { deps, trace } = makeDeps({ resolution: present(identity("pi")) });
		const err = await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(WRONG_GID), deps));
		expect(err).toBeInstanceOf(Error);
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});

	it("bad-target → reject, no inspect/probe", async () => {
		const { deps, trace } = makeDeps({ resolution: { identity: null, preProbeAddressConflict: false } });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "reject" && r.reason).toBe("bad-target");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});

	it("preProbeAddressConflict → reject, no inspect/probe", async () => {
		const { deps, trace } = makeDeps({ resolution: { identity: identity("pi"), preProbeAddressConflict: true } });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "reject" && r.reason).toBe("target-address-conflict");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});
});

describe("the unsupported-backend mailbox mini-table", () => {
	// Deliverability is the seam's verdict (an active receiver), never wake-mode alone.
	it("unsupported + deliverable → meta-mailbox plan, same target, message preserved", async () => {
		const { deps, trace } = makeDeps({ resolution: present(identity("claude-code")), mailboxDeliverable: true });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("execute");
		expect(r.kind === "execute" && r.plan.transport).toBe("meta-mailbox");
		expect(r.kind === "execute" && r.plan.targetGardenId).toBe(GID);
		expect(r.kind === "execute" && r.plan.message).toBe("hello");
		expect(r.kind === "execute" && r.plan.wantsReply).toBe(true);
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});

	it("unsupported + undeliverable → reject, no inspect/probe", async () => {
		const { deps, trace } = makeDeps({ resolution: present(identity("codex")), mailboxDeliverable: false });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("reject");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});

	// SE-2 2d-3: the dead-fallback honours the same active-receiver gate as the decider, so a
	// re-resolve cannot smuggle a reply into a terminated session's mailbox.
	it("self-fetch citizen + inactive receiver → reject (SE-2 2d-3)", async () => {
		const { deps, trace } = makeDeps({ resolution: present(identity("claude-code")), mailboxDeliverable: false });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("reject");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});
});

describe("the in-domain socket path", () => {
	it("pi + alive → control-socket on the INSPECTED path, mode/msg/wantsReply preserved", async () => {
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/fresh.sock" },
			probe: "alive",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "execute" && r.plan.transport).toBe("control-socket");
		expect(r.kind === "execute" && r.plan.transport === "control-socket" && r.plan.socketPath).toBe(
			"/fake/ctl/fresh.sock",
		);
		expect(r.kind === "execute" && r.plan.transport === "control-socket" && r.plan.mode).toBe("follow_up");
		expect(r.kind === "execute" && r.plan.message).toBe("hello");
		expect(r.kind === "execute" && r.plan.wantsReply).toBe(true);
		expect(r.kind === "execute" && r.plan.targetGardenId).toBe(GID);
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([1, 1]);
	});

	it("pi + absent → reject dormant-fire-forget-unsupported, and NEVER a mailbox", async () => {
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "absent", socketPath: "/fake/ctl/gone.sock" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("reject");
		expect(r.kind === "reject" && r.reason).toBe("dormant-fire-forget-unsupported");
		// absent short-circuits: there is nothing to connect to.
		expect(trace.probeCalls).toBe(0);
	});

	it("pi + probe indeterminate → reject (indeterminate-no-spawn), no mailbox", async () => {
		const { deps } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/stall.sock" },
			probe: "indeterminate",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("reject");
	});

	it("pi + inspect indeterminate → reject, and never connects", async () => {
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "indeterminate", socketPath: "/fake/ctl/x.sock", error: "EACCES" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind).toBe("reject");
		expect(trace.probeCalls).toBe(0);
	});

	it("address-conflict (symlink) → reject target-address-conflict", async () => {
		const { deps } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "address-conflict", socketPath: "/fake/ctl/link.sock", reason: "symlink" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "reject" && r.reason).toBe("target-address-conflict");
	});
});

// #50 C4. A record that VANISHED mid-dispatch while its socket remains re-resolves to the
// honest `record-less-socket` reject — a diagnostic state, never a retry into a socket the
// record no longer authorizes, and never the `bad-target` "absent" lie. A plain vanished
// target with no socket stays bad-target: the two must not blur into one answer.
describe("a record that vanished while its socket remained", () => {
	it("recordLess → reject record-less-socket, with NO in-domain inspect/probe", async () => {
		const recordLess: TargetResolution = { identity: null, preProbeAddressConflict: false, recordLessSocket: true };
		const { deps, trace } = makeDeps({
			resolution: recordLess,
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/fresh.sock" },
			probe: "alive",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "reject" && r.reason).toBe("record-less-socket");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});

	it("a vanished target with no socket stays bad-target", async () => {
		const { deps, trace } = makeDeps({
			resolution: { identity: null, preProbeAddressConflict: false, recordLessSocket: false },
			inspection: { kind: "absent", socketPath: "/fake/ctl/gone.sock" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		expect(r.kind === "reject" && r.reason).toBe("bad-target");
		expect([trace.inspectCalls, trace.probeCalls]).toEqual([0, 0]);
	});
});

describe("what the resolver refuses to own", () => {
	it("a probe throw propagates — the 5c-2a hand owns failed+release", async () => {
		const probeBoom = new Error("probe boom");
		const { deps } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/p.sock" },
			probe: { throw: probeBoom },
		});
		expect(await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps))).toBe(probeBoom);
	});

	it("an inspect throw propagates", async () => {
		const inspectBoom = new Error("inspect boom");
		const { deps } = makeDeps({ resolution: present(identity("pi")), inspection: { throw: inspectBoom } });
		expect(await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps))).toBe(inspectBoom);
	});

	it("every execute plan targets the held gid — a SEND fallback never re-targets", async () => {
		const cases: FakeSpec[] = [
			{ resolution: present(identity("claude-code")), mailboxDeliverable: true },
			{
				resolution: present(identity("pi")),
				inspection: { kind: "socket-file", socketPath: "/fake/ctl/a.sock" },
				probe: "alive",
			},
		];
		for (const s of cases) {
			const { deps } = makeDeps(s);
			const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
			expect(r.kind).toBe("execute");
			expect(r.kind === "execute" && r.plan.targetGardenId).toBe(GID);
		}
	});
});
