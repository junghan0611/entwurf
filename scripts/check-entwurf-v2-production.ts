/**
 * check-entwurf-v2-production — deterministic gate for the 5d-2b PRODUCTION deps assembly
 * (`makeProductionEntwurfV2Deps`). It proves the WIRING — which closure/instance/dir reaches
 * which hand — over fake leaf-IO spies, with NO real socket/lock/meta-record. Real
 * transport behaviour is each hand's own gate + the 5d-5 matrix; this gate's job is the
 * three production invariants the factory exists to guarantee:
 *
 *   A. decide wraps decideDispatch, and the decider ACQUIRES under the wired `lockDir`
 *      (a pi-alive citizen → control-socket execute; acquireLock spy saw {dir: lockDir}).
 *   B. control `sendOverSocket` builds the RpcSendCommand (type/message/mode/wants_reply/
 *      sender) and maps response.success→outcome; the hand releases under `lockDir`.
 *   D. the meta-mailbox hand enqueues onto the wired sessionsDir/mailboxDir.
 *   E. Q3 + Q5 — a dead control send re-resolves (claude-code citizen) to the mailbox and
 *      enqueues through the SAME sendViaMailbox instance (same enqueue spy) on the SAME dirs
 *      the direct hand used — direct send and fallback send never drift.
 *   E4. #101 — the deliverability seam reads BOTH markers: a live receiver marker whose
 *      owner's sender marker names ANOTHER garden is undeliverable. The SAME closure serves
 *      the direct send and the dead-control fallback, so neither can be fooled alone.
 *
 * No real IO — every seam is a spy; the factory's COMPOSITION is what is under test.
 */

import assert from "node:assert/strict";
import type { DispatchInput } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	makeProductionEntwurfV2Deps,
	type ProductionEntwurfV2Opts,
} from "../pi-extensions/lib/entwurf-v2-production.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import type { ControlSocketPlan, MetaMailboxPlan } from "../pi-extensions/lib/entwurf-v2-send.ts";
import type { MetaIdentity, MetaReceiverMarker, MetaSenderMarker } from "../pi-extensions/lib/meta-session.ts";
import type { NativePushAdapter, NativePushProbeResult } from "../pi-extensions/lib/native-push/adapter.ts";
import type { TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260613T100000-aaaaaa";
/** The garden a switched-away owner serves instead (#101). */
const OTHER_GID = "20260613T100000-bbbbbb";
const LOCK_DIR = "/fake/locks";
const SESSIONS_DIR = "/fake/sessions";
const MAILBOX_DIR = "/fake/mailbox";
const CONTROL_DIR = "/fake/ctl";

function identity(backend: MetaIdentity["backend"], gardenId = GID): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId,
		backend,
		nativeSessionId: "n",
		cwd: "/home/junghan/repos/gh/entwurf",
		model: null,
		transcriptPath: null,
		createdAt: "2026-06-13T01:00:00.000Z",
		recordUpdatedAt: "2026-06-13T01:00:00.000Z",
	};
}

/** A receiver presence marker. Matches the record identity (gardenId/backend/nativeSessionId)
 * unless `nativeSessionId` is overridden to simulate an identity-drifted/foreign marker.
 * The owner pid is a plausible one: the predicate never reads it, but a fixture carrying
 * `ownerPid: 1` would model a marker no writer can mint and no reader honors (#53 A). */
function receiverMarker(gid: string, backend: string, nativeSessionId = "n"): MetaReceiverMarker {
	return {
		gardenId: gid,
		backend: backend as MetaReceiverMarker["backend"],
		nativeSessionId,
		ownerPid: 4242,
		ownerStartKey: "x",
		ownerKind: "claude-code-cli",
		armProvenance: "session-start",
		updatedAt: "t",
	};
}

/** The receiver owner's sender marker — "which garden does this pid serve NOW?" (#101). */
function senderMarker(gardenId: string, backend: string, ownerPid: number): MetaSenderMarker {
	return {
		gardenId,
		backend: backend as MetaSenderMarker["backend"],
		nativeSessionId: "n",
		cwd: "/cwd",
		ownerPid,
		ownerStartKey: "x",
		updatedAt: "t",
	};
}

function lockClaim(gardenId = GID): LockClaim {
	return {
		gardenId,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-13T01:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `${LOCK_DIR}/${gardenId}.lock`,
	};
}

const CONTROL_PLAN: ControlSocketPlan = {
	transport: "control-socket",
	action: "send",
	targetGardenId: GID,
	socketPath: `${CONTROL_DIR}/${GID}.sock`,
	mode: "follow_up",
	wantsReply: true,
	message: "hello",
};
const MAILBOX_PLAN: MetaMailboxPlan = {
	transport: "meta-mailbox",
	action: "send",
	targetGardenId: GID,
	mailboxDir: MAILBOX_DIR,
	sessionsDir: SESSIONS_DIR,
	wantsReply: false,
	message: "m",
};

interface Spies {
	acquire: { gid: string; dir: string | undefined }[];
	release: { lockPath: string; dir: string | undefined }[];
	enqueue: { gardenId: string; sessionsDir?: string; mailboxDir?: string }[];
	rpc: { socketPath: string; command: Record<string, unknown> }[];
	inspectPath: { socketPath: string }[];
	/** which backend the native-push adapter resolver was asked for (decide + execute). */
	nativePushResolve: string[];
	nativePushProbe: { conv: string }[];
	nativePushSend: { lsAddress: string; conv: string; content: string }[];
}

/** Build a factory whose every leaf IO is a spy. `over` lets a case shape the decision
 * (resolveTarget identity / socket inspection / rpc behaviour). */
function makeSpiedFactory(over: {
	backend?: MetaIdentity["backend"];
	recordExists?: boolean;
	inspectKind?: TargetSocketInspection["kind"];
	probe?: "alive" | "dead" | "indeterminate";
	rpc?: "success" | "dead-throw";
	classifyDead?: boolean;
	/** #50 C3 — a caller with no authoritative sender (senderProvider → undefined). */
	noSender?: boolean;
	/** the native-push adapter probe result (only reached on a native-push backend). */
	nativePushProbe?: NativePushProbeResult;
	/** SE-2 2d-3 — the target's receiver presence marker: "active" (matches identity,
	 * default), "absent" (terminated/never-armed), or "mismatch" (drifted native id). */
	receiverMarker?: "active" | "absent" | "mismatch";
	/** #101 — the receiver owner's SENDER marker, i.e. which garden that pid serves NOW:
	 * "same" (still this one, default), "other-garden" (the owner switched sessions in
	 * place — a live marker whose watch is retired), or "absent" (no sender marker at all).
	 * Injected rather than defaulted so this gate never stats the operator's real roots. */
	senderMarker?: "same" | "other-garden" | "absent";
}) {
	const spies: Spies = {
		acquire: [],
		release: [],
		enqueue: [],
		rpc: [],
		inspectPath: [],
		nativePushResolve: [],
		nativePushProbe: [],
		nativePushSend: [],
	};
	const opts: ProductionEntwurfV2Opts = {
		senderProvider: () =>
			over.noSender
				? undefined
				: { sessionId: "self", agentId: "pi/x", cwd: "/cwd", timestamp: "2026-06-13T00:00:00.000Z" },
		lockDir: LOCK_DIR,
		sessionsDir: SESSIONS_DIR,
		mailboxDir: MAILBOX_DIR,
		controlSocketDir: CONTROL_DIR,
		seams: {
			metaRecordExists: () => over.recordExists ?? true,
			readIdentity: (gid) => identity(over.backend ?? "pi", gid),
			readReceiverMarker: (gid) => {
				if (over.receiverMarker === "absent") return null;
				const nsid = over.receiverMarker === "mismatch" ? "DRIFT" : "n";
				return receiverMarker(gid, over.backend ?? "pi", nsid);
			},
			readSenderMarker: (backend, ownerPid) => {
				if (over.senderMarker === "absent") return null;
				return senderMarker(over.senderMarker === "other-garden" ? OTHER_GID : GID, backend, ownerPid);
			},
			inspectPath: async (socketPath) => {
				spies.inspectPath.push({ socketPath });
				if (over.inspectKind === "indeterminate") {
					return { kind: "indeterminate", socketPath, error: "EACCES" };
				}
				if (over.inspectKind === "address-conflict") {
					return { kind: "address-conflict", socketPath, reason: "symlink" };
				}
				return { kind: over.inspectKind === "socket-file" ? "socket-file" : "absent", socketPath };
			},
			acquireLock: (gid, deps): AcquireLockResult => {
				spies.acquire.push({ gid, dir: deps.dir });
				return { ok: true, claim: lockClaim(gid) };
			},
			releaseLock: (claim, deps) => {
				spies.release.push({ lockPath: claim.lockPath, dir: deps.dir });
			},
			inspectSocket: async (_gid, _dir) =>
				({
					kind: over.inspectKind ?? "socket-file",
					socketPath: `${CONTROL_DIR}/${GID}.sock`,
				}) as TargetSocketInspection,
			probeSocket: async () => over.probe ?? "alive",
			classifyConnect: () => (over.classifyDead ? "dead" : "indeterminate"),
			sendRpc: async (socketPath, command) => {
				spies.rpc.push({ socketPath, command: command as unknown as Record<string, unknown> });
				if (over.rpc === "dead-throw") {
					const e = new Error("refused") as NodeJS.ErrnoException;
					e.code = "ECONNREFUSED";
					throw e;
				}
				return { response: { type: "response", command: command.type, success: true } };
			},
			enqueue: (o) => {
				spies.enqueue.push({ gardenId: o.gardenId, sessionsDir: o.sessionsDir, mailboxDir: o.mailboxDir });
				return { gardenId: o.gardenId, recordPath: "r", messagePath: "m", signalPath: "s" };
			},
			// ONE native-push adapter resolver (봉인 4): the SAME injected fake feeds the
			// decider's nativePushProbe AND the executor's sendNativePush — so a single dispatch
			// records both a probe (decide) and a send (execute) on this one adapter, proving the
			// two hands never resolve different adapters.
			resolveNativePushAdapter: (backend: string): NativePushAdapter => {
				spies.nativePushResolve.push(backend);
				return {
					id: "antigravity",
					async probe(conv) {
						spies.nativePushProbe.push({ conv });
						return over.nativePushProbe ?? { status: "dead", reason: "fake: no native-push probe configured" };
					},
					async send(route, conv, content) {
						spies.nativePushSend.push({ lsAddress: route.lsAddress, conv, content });
					},
				};
			},
		},
	};
	return { deps: makeProductionEntwurfV2Deps(opts), spies };
}

async function main(): Promise<void> {
	// ── A: decide wraps decideDispatch + acquires under lockDir ───────────────
	{
		const { deps, spies } = makeSpiedFactory({ backend: "pi", inspectKind: "socket-file", probe: "alive" });
		const input: DispatchInput = { target: GID, intent: "fire-and-forget", message: "m" };
		const decision = await deps.decide(input);
		ok(
			"A: decide → an alive pi citizen routes to control-socket execute",
			decision.kind === "execute" && decision.plan.transport === "control-socket",
		);
		ok("A: decider ACQUIRED under the wired lockDir", spies.acquire.length === 1 && spies.acquire[0].dir === LOCK_DIR);
		ok("A: B1 — a pi target does NO pre-lock lstat (inspectPath unused)", spies.inspectPath.length === 0);
	}

	// ── A2: out-of-socket-domain target checks record-side conflict pre-lock ──
	{
		// claude-code (unsupported) + a symlink at the canonical path → record-side conflict →
		// the decider rejects target-address-conflict BEFORE acquiring (no lock for a quarantined
		// address). The lstat-only inspectPath ran exactly once; acquire never did.
		const { deps, spies } = makeSpiedFactory({ backend: "claude-code", inspectKind: "address-conflict" });
		const decision = await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		ok("A2: out-of-socket-domain conflict → reject", decision.kind === "reject");
		ok("A2: out-of-domain target lstat'd the conflict exactly once", spies.inspectPath.length === 1);
		ok("A2: a quarantined target is never lock-acquired", spies.acquire.length === 0);
	}

	// ── A3: native-push wiring — ONE injected adapter feeds BOTH decider + executor ─
	{
		const { deps, spies } = makeSpiedFactory({
			backend: "antigravity",
			nativePushProbe: { status: "alive", route: { lsAddress: "127.0.0.1:5599" } },
		});
		const result = await runEntwurfV2({ target: GID, intent: "fire-and-forget", message: "hi agy" }, deps);
		ok("A3: antigravity ff → native-push delivered", result.kind === "executed" && result.transport === "native-push");
		ok("A3: decider probed the native-push adapter once (decide side)", spies.nativePushProbe.length === 1);
		ok("A3: executor sent via the native-push adapter once (execute side)", spies.nativePushSend.length === 1);
		ok("A3: send used the DECIDER-probed route", spies.nativePushSend[0]?.lsAddress === "127.0.0.1:5599");
		ok("A3: send carried the dispatch message", spies.nativePushSend[0]?.content === "hi agy");
		ok(
			"A3: BOTH hands resolved the SAME adapter (for 'antigravity')",
			spies.nativePushResolve.length === 2 && spies.nativePushResolve.every((b) => b === "antigravity"),
		);
		ok("A3: native-push is LOCK-FREE (no acquire)", spies.acquire.length === 0);
		ok("A3: native-push did NOT enqueue a mailbox (not the unsupported path)", spies.enqueue.length === 0);
	}
	{
		// antigravity + dead probe → reject native-push-target-dead, NO send.
		const { deps, spies } = makeSpiedFactory({
			backend: "antigravity",
			nativePushProbe: { status: "dead", reason: "no host" },
		});
		const result = await runEntwurfV2({ target: GID, intent: "fire-and-forget", message: "x" }, deps);
		ok(
			"A3b: antigravity ff + dead → rejected native-push-target-dead",
			result.kind === "rejected" && result.receipt.reason === "native-push-target-dead",
		);
		ok("A3b: no send attempted on a dead target", spies.nativePushSend.length === 0);
	}

	// ── A3: out-of-domain indeterminate lstat fails loud ─────────────────────
	{
		const { deps } = makeSpiedFactory({ backend: "claude-code", inspectKind: "indeterminate" });
		let threw = false;
		try {
			await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		} catch {
			threw = true;
		}
		ok("A3: out-of-domain indeterminate lstat → decide throws (QB2 fail-loud)", threw);
	}

	// ── B: control sendOverSocket builds RpcSendCommand + maps + lockDir release ─
	{
		const { deps, spies } = makeSpiedFactory({ rpc: "success" });
		const res = await deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok("B: sendOverSocket called once", spies.rpc.length === 1);
		const cmd = spies.rpc[0]?.command;
		ok(
			"B: RpcSendCommand carries type/message/mode/wants_reply/sender",
			cmd?.type === "send" &&
				cmd?.message === "hello" &&
				cmd?.mode === "follow_up" &&
				cmd?.wants_reply === true &&
				typeof cmd?.sender === "object",
		);
		ok("B: response.success → outcome 'sent'", res.outcome === "sent");
		ok(
			"B: control hand released under the wired lockDir",
			spies.release.length === 1 && spies.release[0].dir === LOCK_DIR,
		);
	}

	// ── C2: #50 C3 — the dormant rail carries the caller edge (<sender_info>) ──
	// ── D: meta-mailbox hand enqueues onto the wired dirs ─────────────────────
	{
		const { deps, spies } = makeSpiedFactory({});
		const res = await deps.executor.sendMailbox(MAILBOX_PLAN, null);
		ok("D: mailbox send → success", res.success === true);
		ok(
			"D: enqueue onto the wired sessionsDir/mailboxDir",
			spies.enqueue.length === 1 &&
				spies.enqueue[0].sessionsDir === SESSIONS_DIR &&
				spies.enqueue[0].mailboxDir === MAILBOX_DIR &&
				spies.enqueue[0].gardenId === GID,
		);
	}

	// ── E: Q3/Q5 — dead control send re-resolves to the SAME mailbox instance ──
	{
		// claude-code citizen (unsupported liveness, self-fetch deliverable) + a dead connect
		// → the dead-fallback resolver routes to meta-mailbox → the control hand enqueues via
		// the SAME sendViaMailbox instance the direct hand uses, on the SAME dirs.
		const { deps, spies } = makeSpiedFactory({ backend: "claude-code", rpc: "dead-throw", classifyDead: true });
		const res = await deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok("E: dead control send → fallback-sent via mailbox", res.outcome === "fallback-sent");
		ok(
			"E: shared sendViaMailbox — fallback enqueued through the SAME spy on the SAME dirs",
			spies.enqueue.length === 1 &&
				spies.enqueue[0].sessionsDir === SESSIONS_DIR &&
				spies.enqueue[0].mailboxDir === MAILBOX_DIR &&
				spies.enqueue[0].gardenId === GID,
		);
		ok(
			"E: dead-path control hand released under the wired lockDir",
			spies.release.length === 1 && spies.release[0].dir === LOCK_DIR,
		);
	}

	// ── E2: SE-2 2d-3 — dead control send to a claude-code citizen whose receiver is
	// INACTIVE (no presence marker) → the fallback re-resolves to mailbox-undeliverable,
	// so the SHARED sendViaMailbox enqueue is NEVER called: no garbage in a terminated
	// session's mailbox. The lock is still released under the wired lockDir. This is the v2
	// closure of SE-2 — production's mailboxDeliverabilityFor seam gates the fallback the
	// same way slice 2d-2 gates the v1 path. ───────────────────────────────────────────
	{
		const { deps, spies } = makeSpiedFactory({
			backend: "claude-code",
			rpc: "dead-throw",
			classifyDead: true,
			receiverMarker: "absent",
		});
		const res = await deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok(
			"E2: inactive citizen → rejected (mailbox-undeliverable), not fallback-sent",
			res.outcome === "rejected" && res.rejectReason === "mailbox-undeliverable",
		);
		ok("E2: SE-2 — shared enqueue NEVER called (no mailbox garbage)", spies.enqueue.length === 0);
		ok(
			"E2: lock still released under the wired lockDir",
			spies.release.length === 1 && spies.release[0].dir === LOCK_DIR,
		);
	}

	// ── E3: same gate via an identity-MISMATCHED marker (drifted native id) — a present
	// marker that is not THIS receiver must not raise it to active. Proves the seam checks
	// identity match, not mere marker presence. ─────────────────────────────────────────
	{
		const { deps, spies } = makeSpiedFactory({
			backend: "claude-code",
			rpc: "dead-throw",
			classifyDead: true,
			receiverMarker: "mismatch",
		});
		const res = await deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok("E3: drifted marker → rejected (not active)", res.outcome === "rejected");
		ok("E3: drifted marker → enqueue NEVER called (presence ≠ identity match)", spies.enqueue.length === 0);
	}

	// ── E4: #101 — a LIVE receiver marker whose owner switched gardens. Every axis the
	// pre-#101 seam looked at says "active": the marker exists, its owner is live, and it
	// matches this identity exactly. Only the owner's sender marker — which garden that pid
	// serves NOW — says the watch is retired. This is the cell where a real message was
	// enqueued into a mailbox nobody was draining (oracle, 2026-09-04). ─────────────────
	{
		const { deps, spies } = makeSpiedFactory({
			backend: "claude-code",
			rpc: "dead-throw",
			classifyDead: true,
			receiverMarker: "active",
			senderMarker: "other-garden",
		});
		const res = await deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok(
			"E4: owner switched gardens → rejected (mailbox-undeliverable), never fallback-sent",
			res.outcome === "rejected" && res.rejectReason === "mailbox-undeliverable",
		);
		ok("E4: nothing enqueued into the retired garden's mailbox", spies.enqueue.length === 0);
		// …and the same wiring still DELIVERS when that owner is serving this garden, so the
		// join is a measurement and not a blanket refusal.
		const served = makeSpiedFactory({
			backend: "claude-code",
			rpc: "dead-throw",
			classifyDead: true,
			receiverMarker: "active",
			senderMarker: "same",
		});
		const ok2 = await served.deps.executor.sendControl(CONTROL_PLAN, lockClaim());
		ok("E4: the served garden still falls back to a real mailbox enqueue", ok2.outcome === "fallback-sent");
		ok(
			"E4: a MISSING sender marker is fail-closed, not optimistic",
			(
				await makeSpiedFactory({
					backend: "claude-code",
					rpc: "dead-throw",
					classifyDead: true,
					receiverMarker: "active",
					senderMarker: "absent",
				}).deps.executor.sendControl(CONTROL_PLAN, lockClaim())
			).outcome === "rejected",
		);
	}

	// ── F: #50 C4 — record-LESS control socket → pre-probe record-less-socket reject ──
	// resolveTarget finds no meta-record, does ONE record-side lstat (inspectPath), sees a
	// non-symlink socket → recordLessSocket. EVERY intent then rejects pre-probe as
	// `record-less-socket` (a diagnostic state): no lock, no under-lock probe, no
	// plan — the record is the sole address authority. The same presence hint with a
	// symlink / absent socket stays plain bad-target (never trust a symlink).
	for (const intent of ["fire-and-forget"] as const) {
		const { deps, spies } = makeSpiedFactory({ recordExists: false, inspectKind: "socket-file", probe: "alive" });
		const decision = await deps.decide({ target: GID, intent, message: "m" });
		ok(
			`F: recordless + live socket + ${intent} → reject record-less-socket (pre-probe)`,
			decision.kind === "reject" &&
				decision.receipt.reason === "record-less-socket" &&
				decision.receipt.observedLiveness === null,
		);
		ok(`F: resolveTarget did ONE record-side lstat (presence hint, ${intent})`, spies.inspectPath.length === 1);
		ok(`F: record-less socket is never lock-acquired (${intent})`, spies.acquire.length === 0);
	}
	{
		// record absent + a SYMLINKED socket → NOT counted (never trust a symlink) → bad-target.
		const { deps, spies } = makeSpiedFactory({ recordExists: false, inspectKind: "address-conflict" });
		const decision = await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		ok(
			"F: recordless + symlinked socket → reject bad-target",
			decision.kind === "reject" && decision.receipt.reason === "bad-target",
		);
		ok("F: symlinked record-less socket is never lock-acquired", spies.acquire.length === 0);
	}
	{
		// record absent + NO socket at all → plain bad-target.
		const { deps, spies } = makeSpiedFactory({ recordExists: false, inspectKind: "absent" });
		const decision = await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		ok(
			"F: recordless + no socket → reject bad-target",
			decision.kind === "reject" && decision.receipt.reason === "bad-target",
		);
		ok("F: no-socket target is never lock-acquired", spies.acquire.length === 0);
	}

	console.log(`\ncheck-entwurf-v2-production: ${passed} checks passed`);
}

await main();
