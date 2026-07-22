/**
 * check-entwurf-v2-decider — deterministic gate for the PURE dispatch decider
 * (0.11 Stage 0 step 5b). Drives `decideDispatch` over INJECTED fakes (no IO) and
 * proves the frozen invariants (design §5):
 *
 *   1. reject ⇒ NO plan AND NO lock retained (any acquired lock was released).
 *   2. execute ⇒ plan present ∧ receipt.transport === plan.transport ∧
 *      (in-domain ⇒ lock non-null, mailbox ⇒ lock null).
 *   3. pre-probe rejects (bad-target / target-locked / target-address-conflict)
 *      carry observedLiveness=null; untrusted-fail-fast carries the measured
 *      `dead` (non-null), and the deny path releases the lock (nonce-owned).
 *   4. resume plan has NO mode/wantsReply, HAS expectedSocketPath/observeTimeoutMs/
 *      releaseWhen; meta-mailbox plan has NO mode.
 *   5. control-socket execute lock non-null; meta-mailbox execute lock null (？7).
 *   6. the unsupported (mailbox) path acquires NO lock (？7).
 *   7. a pre-probe address conflict rejects WITHOUT probing (inspectSocket unused).
 *   8. unsupported + fire-and-forget: deliverability comes from the REQUIRED
 *      mailboxDeliverabilityFor seam (active-receiver), NOT wake-mode alone. seam
 *      deliverable=true ⇒ meta-mailbox execute; false ⇒ mailbox-undeliverable reject —
 *      a self-fetch citizen with an INACTIVE receiver is refused (SE-2 2d-3), no plan,
 *      no lock, no probe; the seam is consulted exactly once on the resolved identity.
 *   9. an invalid garden id throws BEFORE any path/lock is built (F2-P1).
 *  10. no spawn-bg plan carries provider/model (D4: 5c-owned launch identity).
 *  11. (B2) a throw AFTER the lock is acquired (inspect/probe/preflight) releases
 *      the held lock before the error propagates — no leak. A reject-path
 *      releaseLock that itself throws is RETRIED (the unlink never happened, so the
 *      lock is still ours) and the ORIGINAL error propagates — retry-pinned so a
 *      refactor cannot drop it.
 *  12. (B3) a target-locked reject carries the lock's holder evidence as a
 *      diagnostic (pid/lockPath/detail), including the corrupt null-holder case;
 *      no other reject carries one.
 *
 * No IO — the target lookup, lock, socket inspection/probe, and preflight are all
 * REQUIRED injected deps (the decider keeps NO live IO default); lock
 * acquire/release calls are tracked so "no-lock-retained" is proven, not assumed.
 */

import assert from "node:assert/strict";
import type { PreflightOutcome } from "../pi-extensions/lib/entwurf-preflight.ts";
import {
	type DispatchDeciderDeps,
	type DispatchDecision,
	decideDispatch,
	ENTWURF_V2_OBSERVE_TIMEOUT_MS,
	type ExecutionPlan,
	resolveMailboxWakeModeCapability,
	type TargetResolution,
} from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { MetaBackendV2, MetaCapability, MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import type { NativePushProbeResult } from "../pi-extensions/lib/native-push/adapter.ts";
import { controlSocketPath, type TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260612T100000-aaaaaa";
const CWD = "/home/junghan/repos/gh/entwurf";

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

function lockClaim(gardenId: string): LockClaim {
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

const APPROVE: PreflightOutcome = {
	kind: "approve",
	reason: "saved-true",
	launchArgs: ["--approve"],
	trustStoreDecision: true,
	trustStoreInherited: false,
	hasTrustInputs: true,
	canonicalCwd: CWD,
};
const TRUSTED_NO_ARG: PreflightOutcome = {
	kind: "trusted-no-arg",
	reason: "no-trust-inputs",
	launchArgs: [],
	trustStoreDecision: null,
	trustStoreInherited: false,
	hasTrustInputs: false,
	canonicalCwd: CWD,
};
const DENY: PreflightOutcome = {
	kind: "deny",
	reason: "fail-fast",
	launchArgs: [],
	trustStoreDecision: null,
	trustStoreInherited: false,
	hasTrustInputs: true,
	canonicalCwd: CWD,
};

function capability(wakeMode: "self-fetch" | "direct-inject"): MetaCapability {
	return { wakeMode, deliveryLevel: "D6", nativeIdLabel: "session" };
}

interface ScenarioOpts {
	resolution: TargetResolution;
	lock?: "ok" | "conflict";
	inspection?: TargetSocketInspection;
	probe?: SocketLiveness;
	preflight?: PreflightOutcome;
	/** SE-2 2d-3: the verdict the injected mailboxDeliverabilityFor seam returns on the
	 * unsupported path. Default false (fail-closed) — the decider trusts the seam, never
	 * wake-mode alone, so this is how a test asserts both the deliverable and inactive cells. */
	mailboxDeliverable?: boolean;
	/** 봉인 4: the native-push adapter probe result the injected nativePushProbe seam returns
	 * (only reached on a nativePushSupported backend, e.g. antigravity). */
	nativePush?: NativePushProbeResult;
}

interface Tracked {
	deps: DispatchDeciderDeps;
	acquireCalls: string[];
	releaseCalls: LockClaim[];
	inspectCalls: string[];
	mailboxCalls: MetaIdentity[];
	nativePushCalls: MetaIdentity[];
}

// Build injected deps with call tracking. A lock "conflict" returns a failed
// acquire; "ok" returns a fresh claim. If the unsupported path is exercised the
// acquireLock fake STILL records its (non-)use so the no-lock invariant is provable.
function mkDeps(opts: ScenarioOpts): Tracked {
	const acquireCalls: string[] = [];
	const releaseCalls: LockClaim[] = [];
	const inspectCalls: string[] = [];
	const mailboxCalls: MetaIdentity[] = [];
	const nativePushCalls: MetaIdentity[] = [];
	const deps: DispatchDeciderDeps = {
		resolveTarget: () => opts.resolution,
		acquireLock: (gardenId: string): AcquireLockResult => {
			acquireCalls.push(gardenId);
			if (opts.lock === "conflict") {
				return {
					ok: false,
					conflict: {
						reason: "target-locked",
						lockPath: `/fake/locks/${gardenId}.lock`,
						holder: lockClaim(gardenId),
						detail: "held by a live dispatcher",
					},
				};
			}
			return { ok: true, claim: lockClaim(gardenId) };
		},
		releaseLock: (claim: LockClaim) => {
			releaseCalls.push(claim);
		},
		inspectSocket: async (gardenId: string): Promise<TargetSocketInspection> => {
			inspectCalls.push(gardenId);
			return opts.inspection ?? { kind: "absent", socketPath: controlSocketPath(gardenId, "/fake/ctl") };
		},
		probeSocket: async (): Promise<SocketLiveness> => opts.probe ?? "dead",
		preflightForCwd: () => opts.preflight ?? APPROVE,
		mailboxDeliverabilityFor: (identity: MetaIdentity) => {
			mailboxCalls.push(identity);
			return { deliverable: opts.mailboxDeliverable ?? false, reason: "fake-deliverability" };
		},
		nativePushProbe: (identity: MetaIdentity): NativePushProbeResult => {
			nativePushCalls.push(identity);
			return opts.nativePush ?? { status: "dead", reason: "fake: no native-push probe configured" };
		},
		mailboxDir: "/fake/mailbox",
		sessionsDir: "/fake/sessions",
	};
	return { deps, acquireCalls, releaseCalls, inspectCalls, mailboxCalls, nativePushCalls };
}

function isExecute(d: DispatchDecision): d is Extract<DispatchDecision, { kind: "execute" }> {
	return d.kind === "execute";
}
function planKeys(plan: ExecutionPlan): string[] {
	return Object.keys(plan).sort();
}

async function main(): Promise<void> {
	// ── 1+3: bad-target — no citizen → reject, observedLiveness null, NO lock ────
	{
		const t = mkDeps({ resolution: { identity: null, preProbeAddressConflict: false } });
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "hi" }, t.deps);
		ok("bad-target: reject", d.kind === "reject");
		ok("bad-target: no plan field", !("plan" in d));
		ok("bad-target: observedLiveness null (pre-probe)", d.kind === "reject" && d.receipt.observedLiveness === null);
		ok("bad-target: reason", d.kind === "reject" && d.receipt.reason === "bad-target");
		ok("bad-target: no lock acquired", t.acquireCalls.length === 0);
		ok("bad-target: no diagnostic (only target-locked carries one)", d.kind === "reject" && d.diagnostic === undefined);
	}

	// ── 7: pre-probe address conflict — reject WITHOUT probing or locking ────────
	{
		const t = mkDeps({ resolution: { identity: identity("claude-code"), preProbeAddressConflict: true } });
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, t.deps);
		ok(
			"preprobe-conflict: reject target-address-conflict",
			d.kind === "reject" && d.receipt.reason === "target-address-conflict",
		);
		ok("preprobe-conflict: observedLiveness null", d.kind === "reject" && d.receipt.observedLiveness === null);
		ok("preprobe-conflict: NOT probed (inspectSocket unused)", t.inspectCalls.length === 0);
		ok("preprobe-conflict: no lock acquired", t.acquireCalls.length === 0);
	}

	// ── target-locked: acquire conflict → reject, null, nothing to release ───────
	{
		const t = mkDeps({ resolution: { identity: identity("pi"), preProbeAddressConflict: false }, lock: "conflict" });
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "hi" }, t.deps);
		ok("target-locked: reject", d.kind === "reject" && d.receipt.reason === "target-locked");
		ok("target-locked: observedLiveness null (pre-probe)", d.kind === "reject" && d.receipt.observedLiveness === null);
		ok("target-locked: lock acquire attempted", t.acquireCalls.length === 1);
		ok("target-locked: no release (acquire failed → nothing held)", t.releaseCalls.length === 0);
		ok("target-locked: not probed (lock before probe)", t.inspectCalls.length === 0);
		// B3: the holder evidence the lock produced must survive to the decision.
		ok("target-locked: diagnostic carried", d.kind === "reject" && d.diagnostic?.kind === "target-locked");
		ok(
			"target-locked: diagnostic holder pid preserved",
			d.kind === "reject" && d.diagnostic?.conflict.holder?.pid === 4242,
		);
		ok(
			"target-locked: diagnostic lockPath preserved",
			d.kind === "reject" && d.diagnostic?.conflict.lockPath === `/fake/locks/${GID}.lock`,
		);
	}

	// ── B3: target-locked with a corrupt (null holder) lockfile still carries the ─
	// diagnostic (lockPath + detail) — a human needs the path even when the body is
	// empty/corrupt and there is no pid to show.
	{
		const d = await decideDispatch(
			{ target: GID, intent: "owned-outcome", message: "hi" },
			{
				resolveTarget: () => ({ identity: identity("pi"), preProbeAddressConflict: false }),
				acquireLock: () => ({
					ok: false,
					conflict: {
						reason: "target-locked",
						lockPath: `/fake/locks/${GID}.lock`,
						holder: null,
						detail: "lockfile is empty, corrupt, or holds a different garden id",
					},
				}),
				releaseLock: () => {},
				inspectSocket: async () => {
					throw new Error("target-locked(corrupt): must not probe after a lock conflict");
				},
				probeSocket: async () => "dead",
				preflightForCwd: () => APPROVE,
				mailboxDeliverabilityFor: () => {
					throw new Error("target-locked(corrupt): in-domain pi never consults the mailbox seam");
				},
				nativePushProbe: () => {
					throw new Error("target-locked(corrupt): in-domain pi never consults the native-push seam");
				},
			},
		);
		ok("target-locked(corrupt): reject", d.kind === "reject" && d.receipt.reason === "target-locked");
		ok(
			"target-locked(corrupt): diagnostic carried with null holder",
			d.kind === "reject" && d.diagnostic?.kind === "target-locked" && d.diagnostic.conflict.holder === null,
		);
		ok(
			"target-locked(corrupt): diagnostic detail preserved",
			d.kind === "reject" &&
				d.diagnostic?.conflict.detail === "lockfile is empty, corrupt, or holds a different garden id",
		);
	}

	// ── post-lock address conflict (pi + symlinked own socket) → release+reject ──
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "address-conflict", socketPath: "/fake/ctl/s.sock", reason: "symlink" },
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "hi" }, t.deps);
		ok(
			"postlock-conflict: reject target-address-conflict",
			d.kind === "reject" && d.receipt.reason === "target-address-conflict",
		);
		ok(
			"postlock-conflict: observedLiveness null (pre-probe reason)",
			d.kind === "reject" && d.receipt.observedLiveness === null,
		);
		ok("postlock-conflict: lock acquired", t.acquireCalls.length === 1);
		ok("postlock-conflict: lock RELEASED (no-lock-retained)", t.releaseCalls.length === 1);
	}

	// ── owned-outcome + LIVE → owned-live-no-autosend, release ───────────────────
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/s.sock" },
			probe: "alive",
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "hi" }, t.deps);
		ok(
			"owned-live: reject owned-live-no-autosend",
			d.kind === "reject" && d.receipt.reason === "owned-live-no-autosend",
		);
		ok(
			"owned-live: observedLiveness alive (post-probe, non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "alive",
		);
		ok("owned-live: lock released", t.releaseCalls.length === 1);
		ok("owned-live: no plan", !("plan" in d));
	}

	// ── indeterminate → indeterminate-no-spawn, release ──────────────────────────
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "indeterminate", socketPath: "/fake/ctl/s.sock", error: "EACCES" },
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "hi" }, t.deps);
		ok(
			"indeterminate: reject indeterminate-no-spawn",
			d.kind === "reject" && d.receipt.reason === "indeterminate-no-spawn",
		);
		ok(
			"indeterminate: observedLiveness indeterminate (non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "indeterminate",
		);
		ok("indeterminate: lock released", t.releaseCalls.length === 1);
	}

	// ── fire-and-forget + DORMANT pi → dormant-fire-forget-unsupported, release ──
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "absent", socketPath: "/fake/ctl/s.sock" },
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, t.deps);
		ok(
			"ff-dormant: reject dormant-fire-forget-unsupported",
			d.kind === "reject" && d.receipt.reason === "dormant-fire-forget-unsupported",
		);
		ok("ff-dormant: observedLiveness dead (non-null)", d.kind === "reject" && d.receipt.observedLiveness === "dead");
		ok("ff-dormant: lock released", t.releaseCalls.length === 1);
	}

	// ── 2+4+5: control-socket SEND execute (ff + live) — lock RETAINED ───────────
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/s.sock" },
			probe: "alive",
		});
		const d = await decideDispatch(
			{ target: GID, intent: "fire-and-forget", mode: "steer", wantsReply: true, message: "ping" },
			t.deps,
		);
		ok("send-execute: kind execute", isExecute(d));
		if (isExecute(d)) {
			ok("send-execute: plan transport control-socket", d.plan.transport === "control-socket");
			ok("send-execute: receipt.transport === plan.transport", d.receipt.transport === d.plan.transport);
			ok("send-execute: lock RETAINED (non-null)", d.lock !== null);
			ok("send-execute: NOT released", t.releaseCalls.length === 0);
			ok("send-execute: observedLiveness alive", d.receipt.observedLiveness === "alive");
			if (d.plan.transport === "control-socket") {
				ok("send-execute: socketPath planted", d.plan.socketPath === "/fake/ctl/s.sock");
				ok("send-execute: mode carried", d.plan.mode === "steer");
				ok("send-execute: wantsReply carried", d.plan.wantsReply === true);
				assert.deepStrictEqual(
					planKeys(d.plan),
					["action", "message", "mode", "socketPath", "targetGardenId", "transport", "wantsReply"],
					`control-socket plan keyset drift: ${planKeys(d.plan).join(",")}`,
				);
				ok("send-execute: plan keyset exact (no provider/model)", true);
			}
		}
	}

	// ── 2+4+10: spawn-bg RESUME execute (owned + dormant + preflight allow) ──────
	for (const pf of [APPROVE, TRUSTED_NO_ARG]) {
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "absent", socketPath: "/fake/ctl/expected.sock" },
			preflight: pf,
		});
		const d = await decideDispatch(
			{ target: GID, intent: "owned-outcome", mode: "steer", wantsReply: true, message: "do X" },
			t.deps,
		);
		ok(`resume-execute(${pf.kind}): kind execute`, isExecute(d));
		if (isExecute(d) && d.plan.transport === "spawn-bg") {
			ok(`resume-execute(${pf.kind}): receipt.transport === plan.transport`, d.receipt.transport === "spawn-bg");
			ok(`resume-execute(${pf.kind}): lock RETAINED`, d.lock !== null);
			ok(`resume-execute(${pf.kind}): NOT released`, t.releaseCalls.length === 0);
			ok(`resume-execute(${pf.kind}): sessionId === gardenId (D3)`, d.plan.sessionId === GID);
			ok(`resume-execute(${pf.kind}): prompt = message`, d.plan.prompt === "do X");
			ok(`resume-execute(${pf.kind}): launchArgs from preflight`, d.plan.launchArgs === pf.launchArgs);
			ok(
				`resume-execute(${pf.kind}): expectedSocketPath planted`,
				d.plan.expectedSocketPath === "/fake/ctl/expected.sock",
			);
			ok(
				`resume-execute(${pf.kind}): observeTimeoutMs default`,
				d.plan.observeTimeoutMs === ENTWURF_V2_OBSERVE_TIMEOUT_MS,
			);
			ok(`resume-execute(${pf.kind}): releaseWhen A2 predicate`, d.plan.releaseWhen === "socket-alive-or-child-exited");
			assert.deepStrictEqual(
				planKeys(d.plan),
				[
					"action",
					"cwd",
					"expectedSocketPath",
					"launchArgs",
					"observeTimeoutMs",
					"prompt",
					"releaseWhen",
					"sessionId",
					"targetGardenId",
					"transport",
				],
				`spawn-bg plan keyset drift: ${planKeys(d.plan).join(",")}`,
			);
			ok(`resume-execute(${pf.kind}): NO mode/wantsReply/provider/model in plan`, true);
		}
	}

	// ── 1+3: untrusted-fail-fast — resume verdict + preflight DENY → release ─────
	{
		const t = mkDeps({
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: { kind: "absent", socketPath: "/fake/ctl/s.sock" },
			preflight: DENY,
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "do X" }, t.deps);
		ok("untrusted: reject untrusted-fail-fast", d.kind === "reject" && d.receipt.reason === "untrusted-fail-fast");
		ok(
			"untrusted: observedLiveness dead (measured, non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "dead",
		);
		ok("untrusted: lock RELEASED (nonce-owned, no-lock-retained)", t.releaseCalls.length === 1);
		ok("untrusted: no plan", !("plan" in d));
	}

	// ── 2+5+6: meta-mailbox SEND execute (unsupported claude + ff + deliverable) ─
	// Deliverability comes from the required seam (active receiver), NOT wake-mode alone.
	{
		const t = mkDeps({
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: true,
		});
		const d = await decideDispatch(
			{ target: GID, intent: "fire-and-forget", mode: "steer", wantsReply: true, message: "mail" },
			t.deps,
		);
		ok("mailbox-execute: kind execute", isExecute(d));
		ok("mailbox-execute: deliverability seam consulted exactly once", t.mailboxCalls.length === 1);
		ok("mailbox-execute: seam asked about the resolved identity", t.mailboxCalls[0]?.gardenId === GID);
		if (isExecute(d) && d.plan.transport === "meta-mailbox") {
			ok("mailbox-execute: receipt.transport === plan.transport", d.receipt.transport === "meta-mailbox");
			ok("mailbox-execute: lock NULL (？7 no lock)", d.lock === null);
			ok("mailbox-execute: acquireLock NOT called", t.acquireCalls.length === 0);
			ok("mailbox-execute: observedLiveness unsupported", d.receipt.observedLiveness === "unsupported");
			ok("mailbox-execute: mailboxDir planted", d.plan.mailboxDir === "/fake/mailbox");
			ok("mailbox-execute: sessionsDir planted (D2)", d.plan.sessionsDir === "/fake/sessions");
			assert.deepStrictEqual(
				planKeys(d.plan),
				["action", "mailboxDir", "message", "sessionsDir", "targetGardenId", "transport", "wantsReply"],
				`meta-mailbox plan keyset drift: ${planKeys(d.plan).join(",")}`,
			);
			ok("mailbox-execute: NO mode in plan (？2)", !("mode" in d.plan));
		}
	}

	// ── 8: unsupported + ff + seam says undeliverable → reject, no plan, no lock ─
	{
		const t = mkDeps({
			resolution: { identity: identity("codex"), preProbeAddressConflict: false },
			mailboxDeliverable: false,
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "mail" }, t.deps);
		ok("mailbox-undeliverable: reject", d.kind === "reject" && d.receipt.reason === "mailbox-undeliverable");
		ok(
			"mailbox-undeliverable: observedLiveness unsupported (non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "unsupported",
		);
		ok("mailbox-undeliverable: no plan", !("plan" in d));
		ok("mailbox-undeliverable: acquireLock NOT called", t.acquireCalls.length === 0);
	}

	// ── SE-2 2d-3 KEY ROW: a self-fetch CITIZEN whose receiver is INACTIVE (the seam
	// says not deliverable — terminated session / drifted marker) → mailbox-undeliverable
	// reject, NO plan, NO lock, NO inspect/probe. This is the v2 closure of the gap slice
	// 2d-2 closed for v1: the decider no longer trusts wake-mode alone; the required seam's
	// active-receiver verdict governs, so a reply to a dead claude-code is refused, not
	// enqueued as mailbox garbage. (Indistinguishable here from the codex case at the
	// receipt level — that is the point: the seam, not the backend, decides.) ────────────
	{
		const t = mkDeps({
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: false,
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "mail" }, t.deps);
		ok(
			"se2-inactive: reject mailbox-undeliverable",
			d.kind === "reject" && d.receipt.reason === "mailbox-undeliverable",
		);
		ok("se2-inactive: no plan (no enqueue plan minted)", !("plan" in d));
		ok("se2-inactive: acquireLock NOT called (？7)", t.acquireCalls.length === 0);
		ok("se2-inactive: never inspect/probe (unsupported axis)", t.inspectCalls.length === 0);
		ok("se2-inactive: deliverability seam consulted exactly once", t.mailboxCalls.length === 1);
	}

	// ── unsupported + owned-outcome → backend-liveness-unsupported, no lock ──────
	{
		const t = mkDeps({
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: true,
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "x" }, t.deps);
		ok(
			"unsupported-owned: reject backend-liveness-unsupported",
			d.kind === "reject" && d.receipt.reason === "backend-liveness-unsupported",
		);
		ok("unsupported-owned: acquireLock NOT called", t.acquireCalls.length === 0);
	}

	// ── A1 narrow (0.11.0): socket-only pi endpoint (identity null + socketOnlyPi) ──
	// A record-LESS live pi control socket is a REAL, addressable citizen — every intent runs
	// the SAME in-domain probe table under allowResume:false (NO pre-probe short-circuit).
	// fire-and-forget + alive → control-socket execute (lock acquired + inspected, retained);
	// owned-outcome + alive → owned-live-no-autosend (honest table verdict, NOT the `bad-target`
	// lie — a live citizen is never "absent"); owned-outcome + dormant →
	// socket-only-no-resume-authority (the allowResume:false guard, post-probe, never a spawn);
	// fire-and-forget + dormant/indeterminate → the existing honest reject, lock released.
	const socketOnly: TargetResolution = { identity: null, preProbeAddressConflict: false, socketOnlyPi: true };
	{
		const t = mkDeps({
			resolution: socketOnly,
			lock: "ok",
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/s.sock" },
			probe: "alive",
		});
		const d = await decideDispatch(
			{ target: GID, intent: "fire-and-forget", mode: "follow_up", wantsReply: false, message: "ping" },
			t.deps,
		);
		ok("socketOnly ff+alive: kind execute", isExecute(d));
		ok("socketOnly ff+alive: plan transport control-socket", isExecute(d) && d.plan.transport === "control-socket");
		ok("socketOnly ff+alive: lock RETAINED", isExecute(d) && d.lock !== null);
		ok("socketOnly ff+alive: NOT released", t.releaseCalls.length === 0);
		ok("socketOnly ff+alive: observedLiveness alive", isExecute(d) && d.receipt.observedLiveness === "alive");
		ok("socketOnly ff+alive: lock acquired (in-domain)", t.acquireCalls.length === 1);
		ok("socketOnly ff+alive: socket inspected under lock", t.inspectCalls.length === 1);
		ok("socketOnly ff+alive: mailbox seam NEVER consulted (pi is in-domain)", t.mailboxCalls.length === 0);
	}
	{
		// (a) owned-outcome + ALIVE → owned-live-no-autosend (the honest table verdict), NOT
		// the `bad-target` lie. The live socket-only citizen runs the SAME in-domain path as a
		// record-backed pi: lock acquired, socket probed, then the table rejects owned×live and
		// the lock is released. observedLiveness is the measured `alive` (post-probe, non-null).
		const t = mkDeps({
			resolution: socketOnly,
			lock: "ok",
			inspection: { kind: "socket-file", socketPath: "/fake/ctl/s.sock" },
			probe: "alive",
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "do X" }, t.deps);
		ok(
			"socketOnly owned+alive: reject owned-live-no-autosend (NOT bad-target)",
			d.kind === "reject" && d.receipt.reason === "owned-live-no-autosend",
		);
		ok(
			"socketOnly owned+alive: observedLiveness alive (post-probe, non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "alive",
		);
		ok("socketOnly owned+alive: lock acquired (in-domain, no pre-lock lie)", t.acquireCalls.length === 1);
		ok("socketOnly owned+alive: socket probed under lock", t.inspectCalls.length === 1);
		ok("socketOnly owned+alive: lock released", t.releaseCalls.length === 1);
		ok("socketOnly owned+alive: no plan (no execute)", !("plan" in d));
	}
	{
		// (c) owned-outcome + DORMANT → socket-only-no-resume-authority. The probe ran
		// (post-probe), the table yields a resume verdict, and the allowResume:false guard
		// refuses it — a record-less endpoint has no trusted cwd/resume authority, so spawn-bg
		// never opens. observedLiveness is the measured `dead`, NOT the pre-probe `bad-target`
		// null lie. Lock acquired then released; no spawn plan.
		const t = mkDeps({
			resolution: socketOnly,
			lock: "ok",
			inspection: { kind: "absent", socketPath: "/fake/ctl/s.sock" },
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "do X" }, t.deps);
		ok(
			"socketOnly owned+dormant: reject socket-only-no-resume-authority",
			d.kind === "reject" && d.receipt.reason === "socket-only-no-resume-authority",
		);
		ok(
			"socketOnly owned+dormant: observedLiveness dead (post-probe, non-null)",
			d.kind === "reject" && d.receipt.observedLiveness === "dead",
		);
		ok("socketOnly owned+dormant: lock acquired (in-domain)", t.acquireCalls.length === 1);
		ok("socketOnly owned+dormant: socket probed under lock", t.inspectCalls.length === 1);
		ok("socketOnly owned+dormant: lock released", t.releaseCalls.length === 1);
		ok("socketOnly owned+dormant: NO spawn plan", !("plan" in d));
	}
	{
		// fire-and-forget + dormant (socket vanished between presence-hint and the under-lock
		// probe) → the existing honest reject, lock released, NEVER promoted to a resume/spawn.
		const t = mkDeps({
			resolution: socketOnly,
			lock: "ok",
			inspection: { kind: "absent", socketPath: "/fake/ctl/s.sock" },
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "ping" }, t.deps);
		ok(
			"socketOnly ff+dormant: reject dormant-fire-forget-unsupported",
			d.kind === "reject" && d.receipt.reason === "dormant-fire-forget-unsupported",
		);
		ok("socketOnly ff+dormant: lock released", t.releaseCalls.length === 1);
		ok("socketOnly ff+dormant: no plan (no spawn)", !("plan" in d));
	}
	{
		// fire-and-forget + indeterminate → indeterminate-no-spawn, lock released.
		const t = mkDeps({
			resolution: socketOnly,
			lock: "ok",
			inspection: { kind: "indeterminate", socketPath: "/fake/ctl/s.sock", error: "EACCES" },
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "ping" }, t.deps);
		ok(
			"socketOnly ff+indeterminate: reject indeterminate-no-spawn",
			d.kind === "reject" && d.receipt.reason === "indeterminate-no-spawn",
		);
		ok("socketOnly ff+indeterminate: lock released", t.releaseCalls.length === 1);
	}

	// ── B2: a throw AFTER the lock is acquired RELEASES it before rethrowing ─────
	// inspectSocket / probeSocket / preflightForCwd are the three post-lock IO sites
	// that can throw. Each must leave NO held lock (else a long-lived MCP bridge pins
	// the gid forever). The decision still propagates the error (the decider does not
	// swallow it); only the lock is cleaned up.
	{
		const runThrowing = async (label: string, over: Partial<DispatchDeciderDeps>): Promise<void> => {
			const released: LockClaim[] = [];
			let threw = false;
			try {
				await decideDispatch(
					{ target: GID, intent: "owned-outcome", message: "x" },
					{
						resolveTarget: () => ({ identity: identity("pi"), preProbeAddressConflict: false }),
						acquireLock: () => ({ ok: true, claim: lockClaim(GID) }),
						releaseLock: (c: LockClaim) => {
							released.push(c);
						},
						inspectSocket: async () => ({ kind: "absent", socketPath: "/fake/ctl/s.sock" }),
						probeSocket: async () => "dead",
						preflightForCwd: () => APPROVE,
						mailboxDeliverabilityFor: () => ({ deliverable: false, reason: "in-domain pi: seam unused" }),
						nativePushProbe: () => {
							throw new Error("lock-leak: in-domain pi never consults the native-push seam");
						},
						...over,
					},
				);
			} catch {
				threw = true;
			}
			ok(`lock-leak(${label}): error rethrown`, threw);
			ok(`lock-leak(${label}): lock RELEASED before rethrow`, released.length === 1);
			ok(`lock-leak(${label}): released the held claim`, released[0]?.gardenId === GID);
		};

		await runThrowing("inspect throw", {
			inspectSocket: async () => {
				throw new Error("inspect boom");
			},
		});
		await runThrowing("probe throw", {
			inspectSocket: async () => ({ kind: "socket-file", socketPath: "/fake/ctl/s.sock" }),
			probeSocket: async () => {
				throw new Error("probe boom");
			},
		});
		await runThrowing("preflight throw", {
			// absent → dead → owned-outcome resume verdict → preflight is reached
			preflightForCwd: () => {
				throw new Error("preflight boom");
			},
		});
	}

	// ── B2 retry-pin (Fable 2차 권고): a reject-path releaseLock that THROWS is ──
	// retried by the catch. releaseLock can only throw when the unlink did NOT happen
	// (a successful unlink returns "released"), so at catch time the lock is still
	// ours → the 2nd attempt is a legitimate retry, not a double-free. The ORIGINAL
	// error (not the retry's) propagates, and releaseLock is called exactly twice.
	// This pins the retry so a future refactor cannot silently drop it.
	{
		const released: LockClaim[] = [];
		let caught: unknown = null;
		try {
			await decideDispatch(
				{ target: GID, intent: "owned-outcome", message: "x" },
				{
					resolveTarget: () => ({ identity: identity("pi"), preProbeAddressConflict: false }),
					acquireLock: () => ({ ok: true, claim: lockClaim(GID) }),
					releaseLock: (c: LockClaim) => {
						released.push(c);
						throw new Error(`release boom ${released.length}`);
					},
					// owned-outcome + LIVE → owned-live-no-autosend reject → rejectAfterRelease
					inspectSocket: async () => ({ kind: "socket-file", socketPath: "/fake/ctl/s.sock" }),
					probeSocket: async () => "alive",
					preflightForCwd: () => APPROVE,
					mailboxDeliverabilityFor: () => ({ deliverable: false, reason: "in-domain pi: seam unused" }),
					nativePushProbe: () => {
						throw new Error("reject-release-throw: in-domain pi never consults the native-push seam");
					},
				},
			);
		} catch (e) {
			caught = e;
		}
		ok(
			"reject-release-throw: ORIGINAL error propagates (not the retry's)",
			caught instanceof Error && caught.message === "release boom 1",
		);
		ok("reject-release-throw: releaseLock retried exactly twice", released.length === 2);
	}

	// ── 9: invalid garden id throws BEFORE resolveTarget (F2-P1) ─────────────────
	{
		let threw = false;
		let resolveCalled = false;
		const deps: DispatchDeciderDeps = {
			resolveTarget: () => {
				resolveCalled = true;
				return { identity: null, preProbeAddressConflict: false };
			},
			// Required IO seams: the throw at requireGardenId must precede every one of
			// them, so they are wired as "must not be reached" tripwires.
			acquireLock: () => {
				throw new Error("invalid-gid: acquireLock must not be reached");
			},
			releaseLock: () => {
				throw new Error("invalid-gid: releaseLock must not be reached");
			},
			inspectSocket: async () => {
				throw new Error("invalid-gid: inspectSocket must not be reached");
			},
			probeSocket: async () => {
				throw new Error("invalid-gid: probeSocket must not be reached");
			},
			preflightForCwd: () => APPROVE,
			mailboxDeliverabilityFor: () => {
				throw new Error("invalid-gid: mailboxDeliverabilityFor must not be reached");
			},
			nativePushProbe: () => {
				throw new Error("invalid-gid: nativePushProbe must not be reached");
			},
		};
		try {
			await decideDispatch({ target: "../etc/passwd", intent: "owned-outcome", message: "x" }, deps);
		} catch {
			threw = true;
		}
		ok("invalid-gid: throws", threw);
		ok("invalid-gid: throws BEFORE resolveTarget (no path/lookup built)", !resolveCalled);
	}

	// ── native-push rail (봉인 4): antigravity is intercepted BEFORE the unsupported ──
	// mailbox branch, routed by nativePushProbe + the NATIVE_PUSH table, LOCK-FREE.
	const npResolution = { identity: identity("antigravity"), preProbeAddressConflict: false };
	{
		// ff × alive → execute native-push send; plan carries route/backend/nativeSessionId; lock null.
		const t = mkDeps({
			resolution: npResolution,
			nativePush: { status: "alive", route: { lsAddress: "127.0.0.1:5599" } },
		});
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "yo" }, t.deps);
		ok("native-push ff+alive: execute", isExecute(d));
		ok("native-push ff+alive: transport native-push", isExecute(d) && d.plan.transport === "native-push");
		ok("native-push ff+alive: LOCK-FREE (decision lock null)", isExecute(d) && d.lock === null);
		ok("native-push ff+alive: acquireLock NOT called (lock-free rail)", t.acquireCalls.length === 0);
		ok("native-push ff+alive: nativePushProbe consulted once", t.nativePushCalls.length === 1);
		ok(
			"native-push ff+alive: mailbox seam NOT consulted (intercepts before unsupported branch)",
			t.mailboxCalls.length === 0,
		);
		if (isExecute(d) && d.plan.transport === "native-push") {
			ok("native-push ff+alive: plan route = probed route", d.plan.route.lsAddress === "127.0.0.1:5599");
			ok("native-push ff+alive: plan backend = antigravity", d.plan.backend === "antigravity");
			ok("native-push ff+alive: plan nativeSessionId from identity", d.plan.nativeSessionId === `native-${GID}`);
			ok(
				"native-push ff+alive: plan keyset exact",
				planKeys(d.plan).join(",") ===
					"action,backend,message,nativeSessionId,route,targetGardenId,transport,wantsReply",
			);
		}
		ok(
			"native-push ff+alive: receipt success transport native-push, observedLiveness alive",
			isExecute(d) && d.receipt.ok && d.receipt.transport === "native-push" && d.receipt.observedLiveness === "alive",
		);
	}
	{
		// ff × dead → reject native-push-target-dead (post-probe, dead), lock-free.
		const t = mkDeps({ resolution: npResolution, nativePush: { status: "dead", reason: "no host" } });
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "yo" }, t.deps);
		ok(
			"native-push ff+dead: reject native-push-target-dead",
			d.kind === "reject" && d.receipt.reason === "native-push-target-dead",
		);
		ok(
			"native-push ff+dead: observedLiveness dead (post-probe stamp)",
			d.kind === "reject" && d.receipt.observedLiveness === "dead",
		);
		ok("native-push ff+dead: acquireLock NOT called", t.acquireCalls.length === 0);
	}
	{
		// ff × indeterminate → reject native-push-probe-indeterminate.
		const t = mkDeps({ resolution: npResolution, nativePush: { status: "indeterminate", reason: "no port served" } });
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "yo" }, t.deps);
		ok(
			"native-push ff+indeterminate: reject native-push-probe-indeterminate",
			d.kind === "reject" && d.receipt.reason === "native-push-probe-indeterminate",
		);
	}
	{
		// owned × alive → reject native-push-no-resume-authority (state-independent), lock-free.
		const t = mkDeps({
			resolution: npResolution,
			nativePush: { status: "alive", route: { lsAddress: "127.0.0.1:5599" } },
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "yo" }, t.deps);
		ok(
			"native-push owned+alive: reject native-push-no-resume-authority",
			d.kind === "reject" && d.receipt.reason === "native-push-no-resume-authority",
		);
		ok("native-push owned+alive: acquireLock NOT called (lock-free)", t.acquireCalls.length === 0);
	}

	// The wake-mode capability HELPER stays gate-pinned (renamed; the decider no longer
	// calls it directly — deliverability flows through the required seam). It answers the
	// capability HALF only; the active-receiver half lives in the production seam.
	ok(
		"wakeMode-capability: claude-code (self-fetch) → capability-deliverable",
		resolveMailboxWakeModeCapability(identity("claude-code"), () => capability("self-fetch")),
	);
	ok(
		"wakeMode-capability: codex (direct-inject) → NOT capability-deliverable (fail-closed)",
		!resolveMailboxWakeModeCapability(identity("codex"), () => capability("direct-inject")),
	);
}

main()
	.then(() => {
		console.log(`\n[check-entwurf-v2-decider] ${passed} assertions ok`);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
