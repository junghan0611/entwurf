/**
 * check-entwurf-v2-send-fallback — deterministic gate for the 5c-2b same-lock
 * re-resolve resolver (`resolveDeadControlSendFallback`). Proves the dead-control-send
 * fallback routing over injected fakes, with NO filesystem, AND that the resolver never
 * releases / never spawns / never mis-routes off the held gid:
 *
 *   1. mis-wire: plan/lock gid mismatch → throws BEFORE any IO (no resolveTarget call).
 *   2. bad-target (identity null) → reject, NO inspect/probe.
 *   3. preProbeAddressConflict → reject, NO inspect/probe.
 *   4. unsupported backend + seam deliverable → meta-mailbox plan, NO inspect/probe;
 *      message/wantsReply preserved, same target gid.
 *   5. unsupported backend + seam undeliverable → reject, NO inspect/probe. A self-fetch
 *      citizen with an INACTIVE receiver is refused here too (SE-2 2d-3 active-receiver gate).
 *   6. in-domain pi + socket-file + probe alive → control-socket plan with the INSPECTED
 *      socketPath; message/mode/wantsReply preserved, same target gid.
 *   7. in-domain pi + absent (ENOENT → dead) → reject (dormant-fire-forget-unsupported);
 *      NEVER a spawn-bg plan, NEVER a mailbox.
 *   8. in-domain pi + probe indeterminate → reject (indeterminate-no-spawn); no mailbox.
 *   9. in-domain pi + inspect indeterminate → reject; no probe connect, no mailbox.
 *  10. address-conflict (symlink) → reject (target-address-conflict).
 *  11. probe throw / inspect throw → PROPAGATE (resolver does not catch; the 5c-2a hand
 *      owns failed+release). The resolver NEVER calls a release seam (it has none).
 *  12. every execute plan targets plan.targetGardenId === lock.gardenId, and is one of
 *      control-socket / meta-mailbox — never spawn-bg.
 *
 * No real IO — fakes count inspect/probe calls so "short-circuits before probing" is
 * asserted structurally.
 */

import assert from "node:assert/strict";
import type { TargetResolution } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { ControlSocketPlan } from "../pi-extensions/lib/entwurf-v2-send.ts";
import {
	type DeadFallbackDeps,
	resolveDeadControlSendFallback,
} from "../pi-extensions/lib/entwurf-v2-send-fallback.ts";
import type { MetaBackendV2, MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import type { TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

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

function identity(backend: MetaBackendV2): MetaIdentity {
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

async function main(): Promise<void> {
	// ── 1: mis-wire → throws before any IO ───────────────────────────────────
	{
		const { deps, trace } = makeDeps({ resolution: present(identity("pi")) });
		const err = await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(WRONG_GID), deps));
		ok("mis-wire (plan/lock gid mismatch) → throws", err instanceof Error);
		ok("mis-wire → no inspect/probe (fail-loud before IO)", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 2: bad-target → reject, no inspect/probe ──────────────────────────────
	{
		const { deps, trace } = makeDeps({ resolution: { identity: null, preProbeAddressConflict: false } });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("bad-target → reject", r.kind === "reject" && r.reason === "bad-target");
		ok("bad-target → no inspect/probe", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 3: preProbeAddressConflict → reject, no inspect/probe ──────────────────
	{
		const { deps, trace } = makeDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: true },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("preProbeAddressConflict → reject", r.kind === "reject" && r.reason === "target-address-conflict");
		ok("preProbeAddressConflict → no inspect/probe", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 4: unsupported + deliverable → meta-mailbox plan, no inspect/probe ─────
	// Deliverability is the seam's verdict (active receiver), not wake-mode alone.
	{
		const { deps, trace } = makeDeps({ resolution: present(identity("claude-code")), mailboxDeliverable: true });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("unsupported + deliverable → execute", r.kind === "execute");
		ok(
			"unsupported + deliverable → meta-mailbox plan, same target, msg preserved",
			r.kind === "execute" &&
				r.plan.transport === "meta-mailbox" &&
				r.plan.targetGardenId === GID &&
				r.plan.message === "hello" &&
				r.plan.wantsReply === true,
		);
		ok("unsupported → no inspect/probe (mailbox mini-table)", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 5: unsupported + seam undeliverable → reject, no inspect/probe ─────────
	{
		const { deps, trace } = makeDeps({ resolution: present(identity("codex")), mailboxDeliverable: false });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("unsupported + undeliverable → reject (mailbox-undeliverable)", r.kind === "reject");
		ok("unsupported + undeliverable → no inspect/probe", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 5b: SE-2 2d-3 — a self-fetch CITIZEN with an INACTIVE receiver (seam false) →
	// reject, NO inspect/probe. The dead-fallback honours the same active-receiver gate as
	// the decider, so a re-resolve cannot smuggle a reply into a terminated session's mailbox.
	{
		const { deps, trace } = makeDeps({ resolution: present(identity("claude-code")), mailboxDeliverable: false });
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("self-fetch citizen + inactive receiver → reject (SE-2 2d-3)", r.kind === "reject");
		ok("self-fetch citizen + inactive → no inspect/probe", trace.inspectCalls === 0 && trace.probeCalls === 0);
	}

	// ── 6: in-domain pi + socket-file + probe alive → control-socket retry ─────
	{
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/fresh.sock" },
			probe: "alive",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("pi + alive → execute control-socket", r.kind === "execute" && r.plan.transport === "control-socket");
		ok(
			"pi + alive → uses the INSPECTED socketPath, preserves mode/msg/wantsReply, same target",
			r.kind === "execute" &&
				r.plan.transport === "control-socket" &&
				r.plan.socketPath === "/fake/ctl/fresh.sock" &&
				r.plan.mode === "follow_up" &&
				r.plan.message === "hello" &&
				r.plan.wantsReply === true &&
				r.plan.targetGardenId === GID,
		);
		ok("pi + alive → inspected once, probed once", trace.inspectCalls === 1 && trace.probeCalls === 1);
	}

	// ── 7: in-domain pi + absent (dead) → reject, NEVER spawn-bg/mailbox ───────
	{
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "absent", socketPath: "/fake/ctl/gone.sock" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("pi + dead → reject (dormant-fire-forget-unsupported)", r.kind === "reject");
		ok(
			"pi + dead → reject reason is the fire-and-forget dormant cell",
			r.kind === "reject" && r.reason === "dormant-fire-forget-unsupported",
		);
		ok("pi + dead → never probes (absent short-circuits)", trace.probeCalls === 0);
	}

	// ── 8: in-domain pi + probe indeterminate → reject, no mailbox ────────────
	{
		const { deps } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/stall.sock" },
			probe: "indeterminate",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("pi + probe indeterminate → reject (indeterminate-no-spawn)", r.kind === "reject");
	}

	// ── 9: in-domain pi + inspect indeterminate → reject, no probe ────────────
	{
		const { deps, trace } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "indeterminate", socketPath: "/fake/ctl/x.sock", error: "EACCES" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok("pi + inspect indeterminate → reject", r.kind === "reject");
		ok("pi + inspect indeterminate → never connects (no probe)", trace.probeCalls === 0);
	}

	// ── 9b: A1 narrow — a socket-only pi endpoint (identity null + socketOnlyPi) re-resolves
	// as IN-DOMAIN pi, NOT bad-target. This is the TOCTOU path for a record-less live pi whose
	// socket died between the decision and the send: fire-and-forget → alive retries the
	// control-send, dead is the honest dormant reject, never a mailbox/spawn. `inspectCalls === 1`
	// proves it went through the in-domain probe path and did NOT short-circuit to bad-target
	// (inspectCalls === 0) — the regression guard for the fallback fix. ─────────────────────────
	const socketOnly: TargetResolution = { identity: null, preProbeAddressConflict: false, socketOnlyPi: true };
	{
		const { deps, trace } = makeDeps({
			resolution: socketOnly,
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/fresh.sock" },
			probe: "alive",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok(
			"socketOnly + alive → control-socket retry (NOT bad-target)",
			r.kind === "execute" && r.plan.transport === "control-socket",
		);
		ok(
			"socketOnly + alive → re-inspected once, probed once (in-domain path)",
			trace.inspectCalls === 1 && trace.probeCalls === 1,
		);
	}
	{
		const { deps, trace } = makeDeps({
			resolution: socketOnly,
			inspection: { kind: "absent", socketPath: "/fake/ctl/gone.sock" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok(
			"socketOnly + dead → reject dormant-fire-forget-unsupported (NOT bad-target, NOT mailbox)",
			r.kind === "reject" && r.reason === "dormant-fire-forget-unsupported",
		);
		ok(
			"socketOnly + dead → entered in-domain inspect (inspectCalls === 1, not short-circuit)",
			trace.inspectCalls === 1,
		);
	}
	{
		const { deps } = makeDeps({
			resolution: socketOnly,
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/stall.sock" },
			probe: "indeterminate",
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok(
			"socketOnly + probe indeterminate → reject indeterminate-no-spawn",
			r.kind === "reject" && r.reason === "indeterminate-no-spawn",
		);
	}

	// ── 10: address-conflict (symlink) → reject ───────────────────────────────
	{
		const { deps } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "address-conflict", socketPath: "/fake/ctl/link.sock", reason: "symlink" },
		});
		const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
		ok(
			"address-conflict → reject (target-address-conflict)",
			r.kind === "reject" && r.reason === "target-address-conflict",
		);
	}

	// ── 11: probe throw / inspect throw → PROPAGATE (resolver never catches) ───
	{
		const probeBoom = new Error("probe boom");
		const { deps: d1 } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/p.sock" },
			probe: { throw: probeBoom },
		});
		const e1 = await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), d1));
		ok("probe throw → propagates (hand owns failed+release)", e1 === probeBoom);

		const inspectBoom = new Error("inspect boom");
		const { deps: d2 } = makeDeps({
			resolution: present(identity("pi")),
			inspection: { throw: inspectBoom },
		});
		const e2 = await rejects(() => resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), d2));
		ok("inspect throw → propagates", e2 === inspectBoom);
	}

	// ── 12: every execute plan targets the held gid, never spawn-bg ───────────
	{
		const cases: FakeSpec[] = [
			{ resolution: present(identity("claude-code")), mailboxDeliverable: true },
			{
				resolution: present(identity("pi")),
				inspection: { kind: "socket-file", socketPath: "/fake/ctl/a.sock" },
				probe: "alive",
			},
		];
		let allSameTargetNonSpawn = true;
		for (const s of cases) {
			const { deps } = makeDeps(s);
			const r = await resolveDeadControlSendFallback(CONTROL_PLAN, lockClaim(), deps);
			if (r.kind !== "execute") allSameTargetNonSpawn = false;
			else if (r.plan.targetGardenId !== GID) allSameTargetNonSpawn = false;
			else if (r.plan.transport === "spawn-bg") allSameTargetNonSpawn = false;
		}
		ok("every execute plan: same target gid, never spawn-bg", allSameTargetNonSpawn);
	}

	console.log(`\n[check-entwurf-v2-send-fallback] ${passed} assertions ok`);
}

await main();
