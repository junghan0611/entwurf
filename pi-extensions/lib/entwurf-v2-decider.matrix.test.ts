/**
 * entwurf-v2-decider (matrix) — the 5d-5 (a) REACHABILITY + LOCK SSOT TABLE, proven beside
 * the decider it drives (#119 V3).
 *
 * MIGRATED from scripts/check-entwurf-v2-matrix.ts, row for row and axis for axis. It lives
 * beside entwurf-v2-decider.ts because that is the subject it drives — the decider's own
 * branch coverage is a separate file beside the same module.
 *
 * Every row builds its OWN deps inside its OWN test. The fakes count acquire/release and
 * inspect/probe/mailbox calls, and those counts ARE the lock-class and reach assertions —
 * a decision shared across tests would carry another test's calls and every one of them
 * would quietly stop meaning anything.
 *
 * GPT Q5 design: a deterministic gate (no API, no real pi) that fixes the 5d-5
 * operating claim — "target kind × resulting transport × lock acquire→release×1" —
 * as ONE readable table, so a release note can say "the matrix is closed" without a
 * reader grepping the 12 scattered check-entwurf-v2-* gates.
 *
 * This is a THIN coverage gate, NOT a re-implementation of the decider. It drives
 * the REAL `decideDispatch` over minimal injected fakes (the same shape
 * entwurf-v2-decider.test.ts uses) and asserts, per row, the (transport, lock class,
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

import { describe, expect, it } from "vitest";

import { type EntwurfIntent, type EntwurfV2Transport, isLivenessSupported } from "./entwurf-v2-contract.ts";
import {
	type DispatchDeciderDeps,
	type DispatchDecision,
	decideDispatch,
	type ExecutionPlan,
	type RejectDiagnostic,
	type TargetResolution,
} from "./entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "./entwurf-v2-lock.ts";
import type { MetaCitizenBackend, MetaIdentity } from "./meta-session.ts";
import { controlSocketPath, type TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

const GID = "20260612T100000-aaaaaa";
const CWD = "/home/junghan/repos/gh/entwurf";

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

// ── injected fakes with call tracking (decider-gate shape, minimal copy) ─────
interface ScenarioOpts {
	resolution: TargetResolution;
	lock?: "ok" | "conflict";
	inspection?: TargetSocketInspection;
	probe?: SocketLiveness;
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
		mailboxDeliverabilityFor: (id: MetaIdentity) => {
			mailboxCalls.push(id);
			return { deliverable: opts.mailboxDeliverable ?? false, reason: "fake-deliverability" };
		},
		// The matrix rows are pi / claude-code targets — the native-push branch (antigravity)
		// is NOT exercised here (it is a SEPARATE table, covered by check-entwurf-v2-contract's
		// NATIVE_PUSH round-trip + entwurf-v2-decider.test.ts's branch scenarios). A tripwire so a
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
	// `diagnostic` names the KIND a reject must carry, not a boolean: two reject cells now
	// carry machine-readable evidence, and the axis has to say which — a reject that carried
	// the wrong diagnostic would pass a yes/no cell (#101 갭 C).
	| { decision: "reject"; reason: string; lock: LockClass; diagnostic?: RejectDiagnostic["kind"] };

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
		intent: "fire-and-forget",
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
		expect: { decision: "reject", reason: "target-locked", lock: "acquire-fail", diagnostic: "target-locked" },
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
		// #101 갭 C: an undeliverable mailbox reject carries the receiver axis that failed.
		expect: { decision: "reject", reason: "mailbox-undeliverable", lock: "none", diagnostic: "mailbox-undeliverable" },
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
		intent: "fire-and-forget",
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

async function decide(row: Row) {
	const t = mkDeps(row.scenario);
	const d = await decideDispatch({ target: GID, intent: row.intent, message: "hi" }, t.deps);
	return { d, t };
}

for (const row of ROWS) {
	describe(`${row.name}  [${row.targetKind}]`, () => {
		// The reach axis (GPT D4-a): the decider must touch ONLY the seams this target kind
		// allows. reachOf is DERIVED from the scenario, never hand-set, so a new row cannot
		// drift from its declared target kind — the prose "no inspect" is machine-checked.
		it(`reach: ${reachOf(row.scenario)}`, async () => {
			const { t } = await decide(row);
			const [insp, prb, mbx] = [t.inspectCalls.length, t.probeCalls.length, t.mailboxCalls.length];
			if (reachOf(row.scenario) === "pre-probe") {
				expect([insp, prb, mbx]).toEqual([0, 0, 0]);
			} else if (reachOf(row.scenario) === "unsupported") {
				// lock-free mailbox branch: deliverability consulted exactly once, no socket work.
				expect([mbx, insp, prb]).toEqual([1, 0, 0]);
			} else {
				// probe count varies by inspection kind, so it is deliberately not asserted.
				expect(insp).toBeGreaterThanOrEqual(1);
				expect(mbx).toBe(0);
			}
		});

		if (row.expect.decision === "execute") {
			const want = row.expect;
			it(`execute → ${want.transport}`, async () => {
				const { d } = await decide(row);
				expect(d.kind).toBe("execute");
				expect(planTransport(d)).toBe(want.transport);
			});

			it(
				want.lock === "held"
					? "lock held (acquire 1, release 0, non-null)"
					: "lock-free meta-mailbox (acquire 0, lock null)",
				async () => {
					const { d, t } = await decide(row);
					const lockNull = d.kind === "execute" && d.lock === null;
					if (want.lock === "held") {
						expect([t.acquireCalls.length, t.releaseCalls.length]).toEqual([1, 0]);
						expect(lockNull).toBe(false);
					} else {
						expect([t.acquireCalls.length, t.releaseCalls.length]).toEqual([0, 0]);
						expect(lockNull).toBe(true);
					}
				},
			);
		} else {
			const want = row.expect;
			it(`reject → ${want.reason}, with no plan field`, async () => {
				const { d } = await decide(row);
				expect(d.kind).toBe("reject");
				expect(d.kind === "reject" && d.receipt.reason).toBe(want.reason);
				expect("plan" in d).toBe(false);
			});

			it(`lock class: ${want.lock}`, async () => {
				const { t } = await decide(row);
				const pair = [t.acquireCalls.length, t.releaseCalls.length];
				if (want.lock === "none") expect(pair).toEqual([0, 0]);
				else if (want.lock === "acquire-fail") expect(pair).toEqual([1, 0]);
				else if (want.lock === "released") expect(pair).toEqual([1, 1]);
				else throw new Error(`reject row cannot expect lock=${want.lock}`);
			});

			// #101 갭 C: `diagnostic` names the KIND a reject must carry, not a boolean. A reject
			// carrying the WRONG diagnostic would pass a yes/no cell.
			it(want.diagnostic ? `carries the ${want.diagnostic} diagnostic` : "carries no diagnostic", async () => {
				const { d } = await decide(row);
				expect(d.kind === "reject" && d.diagnostic?.kind).toBe(want.diagnostic);
			});
		}
	});
}

// The table must span every matrix-owned transport, lock class and pre-probe reject, or
// "the matrix is closed" is a lie. A dropped decider cell makes one of these sets shrink and
// this fails — it is not a silent green.
//
// native-push is NOT a matrix-owned transport: it is a SEPARATE NATIVE_PUSH_DISPATCH_TABLE
// (the contract round-trip + the decider's branch coverage), and it is deliberately absent
// here because an antigravity row would blur this table's lock-class semantics (GPT R8).
describe("coverage — the table is closed", () => {
	const transports = new Set<string>();
	const lockClasses = new Set<LockClass>();
	const rejectReasons = new Set<string>();
	for (const row of ROWS) {
		lockClasses.add(row.expect.lock);
		if (row.expect.decision === "execute") transports.add(row.expect.transport);
		else rejectReasons.add(row.expect.reason);
	}

	for (const tr of ["control-socket", "meta-mailbox"]) {
		it(`transport "${tr}" is exercised`, () => expect(transports.has(tr)).toBe(true));
	}
	for (const lc of ["none", "held", "mailbox-null", "released", "acquire-fail"] as LockClass[]) {
		it(`lock class "${lc}" is exercised`, () => expect(lockClasses.has(lc)).toBe(true));
	}
	for (const rr of [
		"bad-target",
		"target-address-conflict",
		"target-locked",
		"mailbox-undeliverable",
		"dormant-fire-forget-unsupported",
		"indeterminate-no-spawn",
	]) {
		it(`reject reason "${rr}" is in the table`, () => expect(rejectReasons.has(rr)).toBe(true));
	}
});
