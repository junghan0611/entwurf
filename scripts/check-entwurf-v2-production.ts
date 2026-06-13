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
import type { DispatchInput } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { AcquireLockResult, LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	makeProductionEntwurfV2Deps,
	type ProductionEntwurfV2Opts,
} from "../pi-extensions/lib/entwurf-v2-production.ts";
import type { ControlSocketPlan, MetaMailboxPlan } from "../pi-extensions/lib/entwurf-v2-send.ts";
import type { SpawnBgPlan } from "../pi-extensions/lib/entwurf-v2-spawn.ts";
import type { MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
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
		schemaVersion: 2,
		gardenId,
		backend,
		nativeSessionId: "n",
		cwd: "/home/junghan/repos/gh/pi-shell-acp",
		model: null,
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-06-13T01:00:00.000Z",
		recordUpdatedAt: "2026-06-13T01:00:00.000Z",
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
	cwd: "/home/junghan/repos/gh/pi-shell-acp",
	prompt: "p",
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
}) {
	const spies: Spies = { acquire: [], release: [], enqueue: [], rpc: [], inspectPath: [] };
	const opts: ProductionEntwurfV2Opts = {
		senderProvider: () => ({ sessionId: "self", agentId: "pi/x", cwd: "/cwd", timestamp: "2026-06-13T00:00:00.000Z" }),
		lockDir: LOCK_DIR,
		sessionsDir: SESSIONS_DIR,
		mailboxDir: MAILBOX_DIR,
		controlSocketDir: CONTROL_DIR,
		seams: {
			metaRecordExists: () => over.recordExists ?? true,
			readIdentity: (gid) => identity(over.backend ?? "pi", gid),
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
			spawnOverrides: {
				spawnChild: over.spawnChildThrows
					? () => {
							throw new Error("spawn boom");
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

	console.log(`\ncheck-entwurf-v2-production: ${passed} checks passed`);
}

await main();
