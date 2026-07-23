/**
 * check-entwurf-v2-production — deterministic gate for the 5d-2b PRODUCTION deps assembly
 * (`makeProductionEntwurfV2Deps`). It proves the WIRING — which closure/instance/dir reaches
 * which hand — over fake leaf-IO spies, with NO real socket/lock/spawn/meta-record. Real
 * transport behaviour is each hand's own gate + the 5d-5 matrix; this gate's job is the
 * three production invariants the factory exists to guarantee:
 *
 *   A. decide wraps decideDispatch, and the decider ACQUIRES under the wired `lockDir`
 *      (a pi-alive citizen → control-socket execute; acquireLock spy saw {dir: lockDir}).
 *   B. control `sendOverSocket` builds the RpcSendCommand (type/message/mode/wants_reply/
 *      sender) and maps response.success→outcome; the hand releases under `lockDir`.
 *   C. QB3 split-brain — the spawn watcher releases via the SHARED lockDir-bound `release`,
 *      NOT the spawn factory's default releaseFn (which would hit the DEFAULT lock dir). A
 *      throwing spawnChild → spawn-start-failed (released) → releaseLock spy saw {dir:lockDir}.
 *   D. the meta-mailbox hand enqueues onto the wired sessionsDir/mailboxDir.
 *   E. Q3 + Q5 — a dead control send re-resolves (claude-code citizen) to the mailbox and
 *      enqueues through the SAME sendViaMailbox instance (same enqueue spy) on the SAME dirs
 *      the direct hand used — direct send and fallback send never drift.
 *
 * No real IO — every seam is a spy; the factory's COMPOSITION is what is under test.
 */

import assert from "node:assert/strict";
import { formatSenderInfoBlock } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import type { DispatchInput } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	makeProductionEntwurfV2Deps,
	type ProductionEntwurfV2Opts,
} from "../pi-extensions/lib/entwurf-v2-production.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import type { ControlSocketPlan, MetaMailboxPlan } from "../pi-extensions/lib/entwurf-v2-send.ts";
import type { SpawnBgPlan } from "../pi-extensions/lib/entwurf-v2-spawn.ts";
import type { MetaIdentity, MetaReceiverMarker } from "../pi-extensions/lib/meta-session.ts";
import type { NativePushAdapter, NativePushProbeResult } from "../pi-extensions/lib/native-push/adapter.ts";
import type { TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260613T100000-aaaaaa";
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
 * unless `nativeSessionId` is overridden to simulate an identity-drifted/foreign marker. */
function receiverMarker(gid: string, backend: string, nativeSessionId = "n"): MetaReceiverMarker {
	return {
		gardenId: gid,
		backend: backend as MetaReceiverMarker["backend"],
		nativeSessionId,
		ownerPid: 1,
		ownerStartKey: "x",
		ownerKind: "claude-code-cli",
		armProvenance: "session-start",
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
const SPAWN_PLAN: SpawnBgPlan = {
	transport: "spawn-bg",
	action: "resume",
	targetGardenId: GID,
	sessionId: GID,
	cwd: "/home/junghan/repos/gh/entwurf",
	prompt: "p",
	wantsReply: true,
	launchArgs: [],
	expectedSocketPath: `${CONTROL_DIR}/${GID}.sock`,
	observeTimeoutMs: 30_000,
	releaseWhen: "socket-alive-or-child-exited",
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
	spawnChildThrows?: boolean;
	/** #50 C3 — capture the plan reaching the spawn factory's resolveIdentity, then
	 * stop the resume (throw → spawn-start-failed) so the prompt is observable
	 * without a watcher. */
	spawnResolveCapture?: (plan: SpawnBgPlan) => void;
	/** #50 C3 — a caller with no authoritative sender (senderProvider → undefined). */
	noSender?: boolean;
	/** the native-push adapter probe result (only reached on a native-push backend). */
	nativePushProbe?: NativePushProbeResult;
	/** SE-2 2d-3 — the target's receiver presence marker: "active" (matches identity,
	 * default), "absent" (terminated/never-armed), or "mismatch" (drifted native id). */
	receiverMarker?: "active" | "absent" | "mismatch";
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
			preflight: () => ({ kind: "approve" }) as never,
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
			spawnOverrides: {
				spawnChild: over.spawnChildThrows
					? () => {
							throw new Error("spawn boom");
						}
					: undefined,
				resolveIdentity: over.spawnResolveCapture
					? (plan) => {
							over.spawnResolveCapture?.(plan);
							throw new Error("capture stop");
						}
					: undefined,
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

	// ── A2: B1 — a NON-pi target DOES record-side lstat the conflict (pre-lock) ─
	{
		// claude-code (unsupported) + a symlink at the canonical path → record-side conflict →
		// the decider rejects target-address-conflict BEFORE acquiring (no lock for a quarantined
		// address). The lstat-only inspectPath ran exactly once; acquire never did.
		const { deps, spies } = makeSpiedFactory({ backend: "claude-code", inspectKind: "address-conflict" });
		const decision = await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		ok("A2: non-pi conflict → reject", decision.kind === "reject");
		ok("A2: non-pi target lstat'd the conflict exactly once", spies.inspectPath.length === 1);
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

	// ── A3: QB2 — a non-pi indeterminate lstat FAILS LOUD (never "no conflict") ─
	{
		const { deps } = makeSpiedFactory({ backend: "claude-code", inspectKind: "indeterminate" });
		let threw = false;
		try {
			await deps.decide({ target: GID, intent: "fire-and-forget", message: "m" });
		} catch {
			threw = true;
		}
		ok("A3: non-pi indeterminate lstat → decide throws (QB2 fail-loud)", threw);
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

	// ── C: QB3 — spawn release uses the SHARED lockDir release, not the default ─
	{
		const { deps, spies } = makeSpiedFactory({ spawnChildThrows: true });
		const res = await deps.executor.resumeSpawnBg(SPAWN_PLAN, lockClaim());
		ok(
			"C: throwing spawnChild → spawn-start-failed (released)",
			res.kind === "spawn-start-failed" && res.released === true,
		);
		ok(
			"C: QB3 — spawn watcher released under the wired lockDir (not the default)",
			spies.release.length === 1 && spies.release[0].dir === LOCK_DIR,
		);
	}

	// ── C2: #50 C3 — the dormant rail carries the caller edge (<sender_info>) ──
	{
		// The spawn-bg prompt reaching the factory is the plan prompt PLUS the same
		// <sender_info> block the live socket rail's receiver synthesizes — one
		// formatter, one shape, so a resumed citizen never wakes to an anonymous task.
		const cap: { prompt: string | null } = { prompt: null };
		const { deps } = makeSpiedFactory({
			spawnResolveCapture: (plan) => {
				cap.prompt = plan.prompt;
			},
		});
		const res = await deps.executor.resumeSpawnBg(SPAWN_PLAN, lockClaim());
		ok("C2: capture-stop surfaced as spawn-start-failed (released)", res.kind === "spawn-start-failed");
		// #50 F2: the plan's wantsReply threads into the SAME formatter call the live
		// rail's receiver makes, so wants_reply:true survives the dormant rail.
		const expected =
			SPAWN_PLAN.prompt +
			formatSenderInfoBlock(
				{ sessionId: "self", agentId: "pi/x", cwd: "/cwd", timestamp: "2026-06-13T00:00:00.000Z" },
				SPAWN_PLAN.wantsReply,
			);
		ok("C2: spawn-bg prompt = task + the SHARED <sender_info> block", cap.prompt === expected);
		ok("C2: wants_reply rides the dormant <sender_info> (#50 F2)", cap.prompt?.includes('"wants_reply":true') === true);
		ok("C2: the plan object handed to the executor is NOT mutated", SPAWN_PLAN.prompt === "p");
	}
	{
		// No authoritative sender → the prompt goes out untouched (never a half-empty
		// or fabricated envelope).
		const cap: { prompt: string | null } = { prompt: null };
		const { deps } = makeSpiedFactory({
			noSender: true,
			spawnResolveCapture: (plan) => {
				cap.prompt = plan.prompt;
			},
		});
		await deps.executor.resumeSpawnBg(SPAWN_PLAN, lockClaim());
		ok("C2b: no sender → raw prompt (no fabricated envelope)", cap.prompt === "p");
	}

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

	// ── F: #50 C4 — record-LESS control socket → pre-probe record-less-socket reject ──
	// resolveTarget finds no meta-record, does ONE record-side lstat (inspectPath), sees a
	// non-symlink socket → recordLessSocket. EVERY intent then rejects pre-probe as
	// `record-less-socket` (migration/diagnostic state): no lock, no under-lock probe, no
	// plan — the record is the sole address authority. The same presence hint with a
	// symlink / absent socket stays plain bad-target (never trust a symlink).
	for (const intent of ["fire-and-forget", "owned-outcome"] as const) {
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
