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
 *   8. unsupported + fire-and-forget + deliverable=false ⇒ reject only, no plan.
 *   9. an invalid garden id throws BEFORE any path/lock is built (F2-P1).
 *  10. no spawn-bg plan carries provider/model (D4: 5c-owned launch identity).
 *
 * No IO — the target lookup, lock, socket inspection/probe, preflight, and
 * capability registry are all injected; lock acquire/release calls are tracked so
 * "no-lock-retained" is proven, not assumed.
 */

import assert from "node:assert/strict";
import type { PreflightOutcome } from "../pi-extensions/lib/entwurf-preflight.ts";
import {
	type DispatchDeciderDeps,
	type DispatchDecision,
	decideDispatch,
	ENTWURF_V2_OBSERVE_TIMEOUT_MS,
	type ExecutionPlan,
	resolveMailboxDeliverability,
	type TargetResolution,
} from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { MetaBackendV2, MetaCapability, MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { controlSocketPath, type TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260612T100000-aaaaaa";
const CWD = "/home/junghan/repos/gh/pi-shell-acp";

function identity(backend: MetaBackendV2): MetaIdentity {
	return {
		schemaVersion: 2,
		gardenId: GID,
		backend,
		nativeSessionId: `native-${GID}`,
		cwd: CWD,
		model: null,
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
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
	wakeMode?: "self-fetch" | "direct-inject";
}

interface Tracked {
	deps: DispatchDeciderDeps;
	acquireCalls: string[];
	releaseCalls: LockClaim[];
	inspectCalls: string[];
}

// Build injected deps with call tracking. A lock "conflict" returns a failed
// acquire; "ok" returns a fresh claim. If the unsupported path is exercised the
// acquireLock fake STILL records its (non-)use so the no-lock invariant is provable.
function mkDeps(opts: ScenarioOpts): Tracked {
	const acquireCalls: string[] = [];
	const releaseCalls: LockClaim[] = [];
	const inspectCalls: string[] = [];
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
		capabilityFor: () => capability(opts.wakeMode ?? "direct-inject"),
		controlDir: "/fake/ctl",
		mailboxDir: "/fake/mailbox",
		sessionsDir: "/fake/sessions",
	};
	return { deps, acquireCalls, releaseCalls, inspectCalls };
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
	{
		const t = mkDeps({
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			wakeMode: "self-fetch",
		});
		const d = await decideDispatch(
			{ target: GID, intent: "fire-and-forget", mode: "steer", wantsReply: true, message: "mail" },
			t.deps,
		);
		ok("mailbox-execute: kind execute", isExecute(d));
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

	// ── 8: unsupported + ff + deliverable=false → reject, no plan, no lock ───────
	{
		const t = mkDeps({
			resolution: { identity: identity("codex"), preProbeAddressConflict: false },
			wakeMode: "direct-inject",
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

	// ── unsupported + owned-outcome → backend-liveness-unsupported, no lock ──────
	{
		const t = mkDeps({
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			wakeMode: "self-fetch",
		});
		const d = await decideDispatch({ target: GID, intent: "owned-outcome", message: "x" }, t.deps);
		ok(
			"unsupported-owned: reject backend-liveness-unsupported",
			d.kind === "reject" && d.receipt.reason === "backend-liveness-unsupported",
		);
		ok("unsupported-owned: acquireLock NOT called", t.acquireCalls.length === 0);
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
			preflightForCwd: () => APPROVE,
		};
		try {
			await decideDispatch({ target: "../etc/passwd", intent: "owned-outcome", message: "x" }, deps);
		} catch {
			threw = true;
		}
		ok("invalid-gid: throws", threw);
		ok("invalid-gid: throws BEFORE resolveTarget (no path/lookup built)", !resolveCalled);
	}
	ok(
		"deliverability: claude-code (self-fetch) → deliverable",
		resolveMailboxDeliverability(identity("claude-code"), () => capability("self-fetch")),
	);
	ok(
		"deliverability: codex (direct-inject) → NOT deliverable (fail-closed)",
		!resolveMailboxDeliverability(identity("codex"), () => capability("direct-inject")),
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
