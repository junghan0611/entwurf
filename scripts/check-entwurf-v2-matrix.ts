/**
 * check-entwurf-v2-matrix — the 5d-5 (a) REACHABILITY + LOCK SSOT TABLE.
 *
 * GPT Q5 design: a deterministic gate (no API, no real pi) that fixes the 5d-5
 * operating claim — "target kind × resulting transport × lock acquire→release×1" —
 * as ONE readable table, so a release note can say "the matrix is closed" without a
 * reader grepping the 12 scattered check-entwurf-v2-* gates.
 *
 * This is a THIN coverage gate, NOT a re-implementation of the decider. It drives
 * the REAL `decideDispatch` over minimal injected fakes (the same shape
 * check-entwurf-v2-decider uses) and asserts, per row, the (transport, lock class,
 * reject reason) the decider actually produces. A final COVERAGE pass then FAILS if
 * any transport, lock class, or pre-probe reject is missing from the table — so a
 * future decider change that silently drops a reachability cell cannot pass.
 *
 * Sender-surface parity (MCP entwurf_v2 vs pi-native) is NOT re-run here: both ride
 * the same `runAndRenderEntwurfV2FromSurface` (proven once in check-entwurf-v2-surface),
 * and the matrix is keyed on the decider both surfaces share. Adding a second surface
 * sweep would duplicate that proof — Q-a: "전수 실행을 두 surface로 중복하지 말 것".
 *
 * Lock classes (the "acquire→release×1" axis made machine-checkable):
 *   none          — no lock acquired at all (pre-probe reject, or the lock-free
 *                   unsupported/meta-mailbox path): acquire 0, release 0.
 *   held          — in-domain execute keeps the claim for 5c re-resolve: acquire 1,
 *                   release 0, decision.lock non-null.
 *   mailbox-null  — unsupported execute → meta-mailbox, deliberately lock-free (？7):
 *                   acquire 0, release 0, decision.lock === null.
 *   released      — in-domain reject after the probe: the held lock is released
 *                   exactly once: acquire 1, release 1.
 *   acquire-fail  — target-locked: the acquire itself failed, nothing to release:
 *                   acquire 1, release 0.
 */

import assert from "node:assert/strict";
import type { PreflightOutcome } from "../pi-extensions/lib/entwurf-preflight.ts";
import {
	type EntwurfIntent,
	type EntwurfV2Transport,
	isLivenessSupported,
} from "../pi-extensions/lib/entwurf-v2-contract.ts";
import {
	type DispatchDeciderDeps,
	type DispatchDecision,
	decideDispatch,
	type ExecutionPlan,
	type TargetResolution,
} from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { MetaBackendV2, MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
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

// ── injected fakes with call tracking (decider-gate shape, minimal copy) ─────
interface ScenarioOpts {
	resolution: TargetResolution;
	lock?: "ok" | "conflict";
	inspection?: TargetSocketInspection;
	probe?: SocketLiveness;
	preflight?: PreflightOutcome;
	mailboxDeliverable?: boolean;
}
interface Tracked {
	deps: DispatchDeciderDeps;
	acquireCalls: string[];
	releaseCalls: LockClaim[];
	inspectCalls: string[];
	probeCalls: string[];
	mailboxCalls: MetaIdentity[];
}
function mkDeps(opts: ScenarioOpts): Tracked {
	const acquireCalls: string[] = [];
	const releaseCalls: LockClaim[] = [];
	const inspectCalls: string[] = [];
	const probeCalls: string[] = [];
	const mailboxCalls: MetaIdentity[] = [];
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
		probeSocket: async (socketPath: string): Promise<SocketLiveness> => {
			probeCalls.push(socketPath);
			return opts.probe ?? "dead";
		},
		preflightForCwd: () => opts.preflight ?? APPROVE,
		mailboxDeliverabilityFor: (id: MetaIdentity) => {
			mailboxCalls.push(id);
			return { deliverable: opts.mailboxDeliverable ?? false, reason: "fake-deliverability" };
		},
		// The matrix rows are pi / claude-code targets — the native-push branch (antigravity)
		// is NOT exercised here (it is a SEPARATE table, covered by check-entwurf-v2-contract's
		// NATIVE_PUSH round-trip + check-entwurf-v2-decider's branch scenarios). A tripwire so a
		// future antigravity row that forgets to wire this fails loud instead of misrouting.
		nativePushProbe: () => {
			throw new Error("matrix: native-push branch must not be reached (no antigravity row wired)");
		},
		mailboxDir: "/fake/mailbox",
		sessionsDir: "/fake/sessions",
	};
	return { deps, acquireCalls, releaseCalls, inspectCalls, probeCalls, mailboxCalls };
}

type LockClass = "none" | "held" | "mailbox-null" | "released" | "acquire-fail";

type Expect =
	| { decision: "execute"; transport: EntwurfV2Transport; lock: LockClass }
	| { decision: "reject"; reason: string; lock: LockClass; diagnostic?: boolean };

/**
 * Which IO seams the decider is ALLOWED to touch — the "어느 축을 만지면 안 되는지"
 * axis (GPT D4-a review). A row name says "no inspect"; reachOf() + runRow make the
 * machine enforce it instead of trusting the prose. DERIVED from the scenario, never
 * hand-set, so a new row cannot drift from its declared target kind:
 *   pre-probe   — rejected before any socket work: inspect 0, probe 0, mailbox 0
 *                 (bad-target, pre-probe conflict, target-locked = lock fails first).
 *   unsupported — lock-free mailbox branch: the deliverability seam is consulted
 *                 exactly once, NO socket inspect/probe: inspect 0, probe 0, mailbox 1.
 *   in-domain   — locked socket branch: inspect ≥1, mailbox 0 (probe count varies by
 *                 inspection kind, so it is not asserted here).
 */
type Reaches = "pre-probe" | "unsupported" | "in-domain";

function reachOf(s: ScenarioOpts): Reaches {
	const id = s.resolution.identity;
	if (!id) return "pre-probe"; // bad-target — no citizen
	if (s.resolution.preProbeAddressConflict) return "pre-probe";
	if (s.lock === "conflict") return "pre-probe"; // target-locked: lock fails before the socket
	return isLivenessSupported(id.backend) ? "in-domain" : "unsupported";
}

interface Row {
	name: string;
	targetKind: string;
	intent: EntwurfIntent;
	scenario: ScenarioOpts;
	expect: Expect;
}

const present = (i: TargetSocketInspection) => i;

// ── THE TABLE — every reachability + lock cell the 5d-5 claim covers ─────────
const ROWS: Row[] = [
	{
		name: "bad-target",
		targetKind: "no citizen",
		intent: "owned-outcome",
		scenario: { resolution: { identity: null, preProbeAddressConflict: false } },
		expect: { decision: "reject", reason: "bad-target", lock: "none" },
	},
	{
		name: "address-conflict (pre-probe)",
		targetKind: "quarantined gid/socket",
		intent: "fire-and-forget",
		scenario: { resolution: { identity: identity("claude-code"), preProbeAddressConflict: true } },
		expect: { decision: "reject", reason: "target-address-conflict", lock: "none" },
	},
	{
		name: "target-locked",
		targetKind: "pi, lock held by another",
		intent: "fire-and-forget",
		scenario: { resolution: { identity: identity("pi"), preProbeAddressConflict: false }, lock: "conflict" },
		expect: { decision: "reject", reason: "target-locked", lock: "acquire-fail", diagnostic: true },
	},
	{
		name: "unsupported self-fetch active → meta-mailbox",
		targetKind: "claude-code, active receiver",
		intent: "fire-and-forget",
		scenario: {
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: true,
		},
		expect: { decision: "execute", transport: "meta-mailbox", lock: "mailbox-null" },
	},
	{
		name: "unsupported self-fetch inactive → reject",
		targetKind: "claude-code, inactive receiver",
		intent: "fire-and-forget",
		scenario: {
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: false,
		},
		expect: { decision: "reject", reason: "mailbox-undeliverable", lock: "none" },
	},
	{
		name: "unsupported owned-outcome → reject",
		targetKind: "claude-code, owned intent",
		intent: "owned-outcome",
		scenario: {
			resolution: { identity: identity("claude-code"), preProbeAddressConflict: false },
			mailboxDeliverable: true,
		},
		expect: { decision: "reject", reason: "backend-liveness-unsupported", lock: "none" },
	},
	{
		name: "in-domain live ff → control-socket",
		targetKind: "pi, socket alive",
		intent: "fire-and-forget",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "socket-file", socketPath: "/fake/ctl/s.sock" }),
			probe: "alive",
		},
		expect: { decision: "execute", transport: "control-socket", lock: "held" },
	},
	{
		name: "in-domain dormant owned → spawn-bg",
		targetKind: "pi, socket absent (dormant)",
		intent: "owned-outcome",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "absent", socketPath: "/fake/ctl/expected.sock" }),
			probe: "dead",
			preflight: APPROVE,
		},
		expect: { decision: "execute", transport: "spawn-bg", lock: "held" },
	},
	{
		name: "in-domain live owned → reject (no autosend)",
		targetKind: "pi, socket alive, owned intent",
		intent: "owned-outcome",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "socket-file", socketPath: "/fake/ctl/s.sock" }),
			probe: "alive",
		},
		expect: { decision: "reject", reason: "owned-live-no-autosend", lock: "released" },
	},
	{
		name: "in-domain ff dormant → reject",
		targetKind: "pi, confirmed dormant, ff intent",
		intent: "fire-and-forget",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "absent", socketPath: "/fake/ctl/s.sock" }),
			probe: "dead",
		},
		expect: { decision: "reject", reason: "dormant-fire-forget-unsupported", lock: "released" },
	},
	{
		name: "in-domain indeterminate → reject",
		targetKind: "pi, socket indeterminate (EACCES)",
		intent: "owned-outcome",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "indeterminate", socketPath: "/fake/ctl/s.sock", error: "EACCES" }),
		},
		expect: { decision: "reject", reason: "indeterminate-no-spawn", lock: "released" },
	},
	{
		name: "in-domain address-conflict under lock → reject (released)",
		targetKind: "pi, socket symlink address-conflict",
		intent: "fire-and-forget",
		scenario: {
			resolution: { identity: identity("pi"), preProbeAddressConflict: false },
			lock: "ok",
			inspection: present({ kind: "address-conflict", socketPath: "/fake/ctl/s.sock", reason: "symlink" }),
		},
		expect: { decision: "reject", reason: "target-address-conflict", lock: "released" },
	},
];

function planTransport(d: DispatchDecision): EntwurfV2Transport | null {
	return d.kind === "execute" ? (d.plan as ExecutionPlan).transport : null;
}

// Verify a row against the REAL decideDispatch + the tracked lock calls.
async function runRow(row: Row): Promise<void> {
	const t = mkDeps(row.scenario);
	const d = await decideDispatch({ target: GID, intent: row.intent, message: "hi" }, t.deps);
	const acq = t.acquireCalls.length;
	const rel = t.releaseCalls.length;

	// reach axis (GPT D4-a): the decider must touch ONLY the seams this target kind
	// allows — make the "no inspect / no mailbox" prose machine-checked.
	const reaches = reachOf(row.scenario);
	const insp = t.inspectCalls.length;
	const prb = t.probeCalls.length;
	const mbx = t.mailboxCalls.length;
	if (reaches === "pre-probe") {
		ok(`${row.name}: pre-probe reach — no inspect, no probe, no mailbox`, insp === 0 && prb === 0 && mbx === 0);
	} else if (reaches === "unsupported") {
		ok(
			`${row.name}: unsupported reach — deliverability seam ×1, no socket inspect/probe`,
			mbx === 1 && insp === 0 && prb === 0,
		);
	} else {
		ok(`${row.name}: in-domain reach — socket inspected, deliverability seam untouched`, insp >= 1 && mbx === 0);
	}

	if (row.expect.decision === "execute") {
		ok(`${row.name}: execute`, d.kind === "execute");
		ok(`${row.name}: transport=${row.expect.transport}`, planTransport(d) === row.expect.transport);
		const lockNull = d.kind === "execute" && d.lock === null;
		if (row.expect.lock === "held") {
			ok(`${row.name}: lock held (acquire 1, release 0, non-null)`, acq === 1 && rel === 0 && !lockNull);
		} else {
			// mailbox-null
			ok(`${row.name}: lock-free meta-mailbox (acquire 0, lock null)`, acq === 0 && rel === 0 && lockNull);
		}
	} else {
		ok(`${row.name}: reject`, d.kind === "reject");
		ok(`${row.name}: reason=${row.expect.reason}`, d.kind === "reject" && d.receipt.reason === row.expect.reason);
		ok(`${row.name}: no plan field`, !("plan" in d));
		switch (row.expect.lock) {
			case "none":
				ok(`${row.name}: no lock (acquire 0, release 0)`, acq === 0 && rel === 0);
				break;
			case "acquire-fail":
				ok(`${row.name}: acquire failed (acquire 1, release 0)`, acq === 1 && rel === 0);
				break;
			case "released":
				ok(`${row.name}: lock acquired then released ×1 (acquire 1, release 1)`, acq === 1 && rel === 1);
				break;
			default:
				assert.fail(`${row.name}: reject row cannot expect lock=${row.expect.lock}`);
		}
		if (row.expect.diagnostic) {
			ok(
				`${row.name}: carries target-locked diagnostic`,
				d.kind === "reject" && d.diagnostic?.kind === "target-locked",
			);
		} else {
			ok(`${row.name}: no diagnostic`, d.kind === "reject" && d.diagnostic === undefined);
		}
	}
}

async function main(): Promise<void> {
	console.log("[check-entwurf-v2-matrix] 5d-5 (a) reachability + lock SSOT table\n");
	for (const row of ROWS) {
		console.log(`── ${row.name}  [${row.targetKind}]`);
		await runRow(row);
	}

	// ── COVERAGE: the table must span every transport + lock class + pre-probe ──
	// reject, or the "matrix is closed" claim is a lie. A dropped decider cell makes
	// one of these sets shrink → fail (not a silent green).
	console.log("\n── coverage (table completeness)");
	const transports = new Set<string>();
	const lockClasses = new Set<LockClass>();
	const rejectReasons = new Set<string>();
	for (const row of ROWS) {
		lockClasses.add(row.expect.lock);
		if (row.expect.decision === "execute") transports.add(row.expect.transport);
		else rejectReasons.add(row.expect.reason);
	}
	for (const tr of ["control-socket", "meta-mailbox", "spawn-bg"]) {
		ok(`coverage: transport "${tr}" exercised`, transports.has(tr));
	}
	for (const lc of ["none", "held", "mailbox-null", "released", "acquire-fail"] as LockClass[]) {
		ok(`coverage: lock class "${lc}" exercised`, lockClasses.has(lc));
	}
	for (const rr of [
		"bad-target",
		"target-address-conflict",
		"target-locked",
		"mailbox-undeliverable",
		"backend-liveness-unsupported",
		"owned-live-no-autosend",
		"dormant-fire-forget-unsupported",
		"indeterminate-no-spawn",
	]) {
		ok(`coverage: reject reason "${rr}" in table`, rejectReasons.has(rr));
	}

	console.log(`\n[check-entwurf-v2-matrix] ${passed} assertions ok`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
