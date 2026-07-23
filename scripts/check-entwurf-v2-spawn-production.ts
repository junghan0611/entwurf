/**
 * check-entwurf-v2-spawn-production — DETERMINISTic gate for the 5c-3c production
 * SpawnBgResumeDeps factory. It proves every injectable seam WITHOUT a real pi spawn,
 * socket, or timer (the heavy live path is a separate opt-in smoke,
 * smoke-entwurf-v2-spawn-live, kept OUT of pnpm check — D5):
 *
 *   1. socketWatchVerdict (the R2 watch policy, pure): address-conflict → forged (reject,
 *      never wait); alive → alive (resolve); dead / indeterminate → wait (keep polling).
 *   2. spawnChild: resolves identity (injected) → buildResumePiArgs(v2-control) → spawnFn.
 *      The captured argv carries --entwurf-control, NO --no-extensions, -p + prompt final,
 *      plan.launchArgs (--approve), the ext args, provider/model, and the header cwd.
 *   3. awaitSocketAlive: connectable → resolve; forged (symlink) → reject WITHOUT connecting
 *      (probe never called); dead → wait one interval, re-poll → alive resolves; abort
 *      during the wait → reject.
 *   4. awaitChildExit: a child 'exit' resolves the code (null on signal); abort rejects and
 *      removes the exit listener (no leak).
 *   5. awaitTimeout: schedules via the injected timer; abort clears it and rejects.
 *   6. killChild: SIGTERM on the shared proc.
 *   7. releaseLock: delegates to the injected release fn.
 *   8. mis-wire: a child with no `proc` (not one we spawned) fails loud in killChild /
 *      awaitChildExit.
 *
 * All IO is injected; a controllable scheduler makes the timer/poll paths deterministic.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { SpawnBgPlan, SpawnBgResumeDeps, SpawnedChild } from "../pi-extensions/lib/entwurf-v2-spawn.ts";
import {
	type LaunchIdentity,
	makeProductionSpawnBgResumeDeps,
	type ProductionSpawnOpts,
	resolveResumeLaunchIdentity,
	type SpawnedProcHandle,
	socketWatchVerdict,
} from "../pi-extensions/lib/entwurf-v2-spawn-production.ts";
import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import type { LstatLike } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260613T091000-98363c";
const SOCK = `/fake/entwurf-control/${GID}.sock`;
const flush = (): Promise<void> => new Promise((res) => setImmediate(res));

const SESSION_FILE = "/home/test/.pi/agent/sessions/-home-test-repo/2026-06-13T09-10-00-000Z_019e8faa-04ea.jsonl";

const IDENTITY: LaunchIdentity = {
	sessionFile: SESSION_FILE,
	cwd: "/home/test/repo",
	explicitExtensionArgs: ["-e", "/path/to/entwurf/index.ts"],
	provider: "entwurf",
	model: "claude-opus-4-8",
};

// True if `p` has NOT settled after a macrotask tick (all pending microtasks drained).
// Attaches a settled-handler (so a later rejection is never unhandled), then checks.
async function notSettled(p: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void p.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	await flush();
	return !settled;
}

function spawnBgPlan(): SpawnBgPlan {
	return {
		transport: "spawn-bg",
		action: "resume",
		targetGardenId: GID,
		sessionId: GID,
		cwd: "/home/test/repo",
		prompt: "continue the task",
		launchArgs: ["--approve"],
		expectedSocketPath: SOCK,
		observeTimeoutMs: 30_000,
		releaseWhen: "socket-alive-or-child-exited",
	};
}

function lockClaim(): LockClaim {
	return {
		gardenId: GID,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-13T00:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${GID}.lock`,
	};
}

// A controllable scheduler: setTimeoutFn captures callbacks; the gate fires them by hand.
function makeScheduler() {
	let nextId = 1;
	const timers = new Map<number, () => void>();
	return {
		setTimeoutFn: ((cb: () => void, _ms: number) => {
			const id = nextId++;
			timers.set(id, cb);
			return id as unknown as ReturnType<typeof setTimeout>;
		}) as (cb: () => void, ms: number) => ReturnType<typeof setTimeout>,
		clearTimeoutFn: ((t: ReturnType<typeof setTimeout>) => {
			timers.delete(t as unknown as number);
		}) as (t: ReturnType<typeof setTimeout>) => void,
		fireNext: (): void => {
			const first = [...timers.entries()][0];
			if (first) {
				timers.delete(first[0]);
				first[1]();
			}
		},
		pending: (): number => timers.size,
	};
}

// A fake proc handle (EventEmitter-lite) recording kills and listener churn.
function fakeProc() {
	const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
	const calls = { kills: [] as string[] };
	const proc: SpawnedProcHandle = {
		pid: 9191,
		kill: (sig) => {
			calls.kills.push(String(sig));
			return true;
		},
		on: (ev, l) => {
			let set = listeners.get(ev);
			if (!set) {
				set = new Set();
				listeners.set(ev, set);
			}
			set.add(l);
			return proc;
		},
		removeListener: (ev, l) => {
			listeners.get(ev)?.delete(l);
			return proc;
		},
	};
	return {
		proc,
		calls,
		emit: (ev: string, ...args: unknown[]): void => {
			for (const l of [...(listeners.get(ev) ?? [])]) l(...args);
		},
		listenerCount: (ev: string): number => listeners.get(ev)?.size ?? 0,
	};
}

function statLike(kind: "socket" | "symlink" | "other"): LstatLike {
	return {
		isSymbolicLink: () => kind === "symlink",
		isSocket: () => kind === "socket",
	};
}

// Spawn a child through the factory (so it carries the eager exitPromise), driving the
// 'spawn' event so spawnChild resolves. Returns the deps + the started child.
async function spawnedChild(
	fp: ReturnType<typeof fakeProc>,
	opts: ProductionSpawnOpts = {},
): Promise<{ deps: SpawnBgResumeDeps; child: SpawnedChild }> {
	const deps = makeProductionSpawnBgResumeDeps({ resolveIdentity: () => IDENTITY, spawnChild: () => fp.proc, ...opts });
	const p = deps.spawnChild(spawnBgPlan());
	await flush();
	fp.emit("spawn");
	const child = await p;
	return { deps, child };
}

async function main(): Promise<void> {
	// ── 1. socketWatchVerdict (pure R2 policy) ───────────────────────────────────────
	ok("1 verdict: address-conflict → forged", socketWatchVerdict({ addressConflict: true }) === "forged");
	ok("1 verdict: alive → alive", socketWatchVerdict({ liveness: "alive", socketPath: SOCK }) === "alive");
	ok("1 verdict: dead → wait", socketWatchVerdict({ liveness: "dead", socketPath: SOCK }) === "wait");
	ok("1 verdict: indeterminate → wait", socketWatchVerdict({ liveness: "indeterminate", socketPath: SOCK }) === "wait");

	// ── 2. spawnChild builds the v2-control argv, then WAITS for the 'spawn' event (B1) ─
	{
		// A holder (not a closure-assigned `let`) so flow analysis sees the capture.
		const cap: { value: { cmd: string; args: readonly string[]; cwd: string } | null } = {
			value: null,
		};
		const fp = fakeProc();
		const deps = makeProductionSpawnBgResumeDeps({
			resolveIdentity: () => IDENTITY,
			spawnChild: (cmd, args, cwd) => {
				cap.value = { cmd, args, cwd };
				return fp.proc;
			},
		});
		const childP = deps.spawnChild(spawnBgPlan());
		await flush(); // spawnChild has installed exit+spawn+error listeners and is awaiting 'spawn'
		ok("2 spawnChild does NOT resolve before the 'spawn' event (B1)", await notSettled(childP));
		fp.emit("spawn"); // a real start is confirmed → spawnChild resolves
		const child = await childP;
		ok("2 child carries pid from proc", child.pid === 9191);
		const captured = cap.value;
		assert.ok(captured, "spawnChild invoked the injected spawnFn");
		const args = captured.args;
		ok("2 spawns the pi binary", captured.cmd === "pi");
		ok("2 cwd = header authority", captured.cwd === "/home/test/repo");
		ok("2 argv has --entwurf-control", args.includes("--entwurf-control"));
		ok("2 argv has NO --no-extensions", !args.includes("--no-extensions"));
		ok("2 argv keeps -p", args.includes("-p"));
		ok("2 argv prompt is final positional", args[args.length - 1] === "continue the task");
		ok("2 argv carries plan.launchArgs (--approve)", args.includes("--approve"));
		ok("2 argv carries the ext args", args.includes("-e"));
		ok("2 argv carries provider", args[args.indexOf("--provider") + 1] === "entwurf");
		ok("2 argv carries model", args[args.indexOf("--model") + 1] === "claude-opus-4-8");
		// #50 C2: argv names the exact transcript FILE, never a garden id. `--session-id`
		// would CREATE a session at that id when it is missing — post-cut the garden id is
		// never a pi session id, so the old flag would have minted an empty session and
		// called it a resume.
		ok("2 argv resumes by exact file", args[args.indexOf("--session") + 1] === SESSION_FILE);
		ok("2 argv carries NO --session-id", !args.includes("--session-id"));
		// #50 C3: the sessionId-bound resume-marker env is GONE — the name-mirror guard it
		// authorized died in C2, so the seam no longer takes an env at all (the child
		// inherits process.env). The compiler enforces the narrowed signature; what remains
		// to assert is that authorization now lives in the RECORD (section 9 below).
	}

	// ── 2b. B1: an 'error' before 'spawn' (ENOENT pi / exec failure) → spawnChild REJECTS ─
	// so the watcher turns it into spawn-start-failed (release), not a stalled spawn-started.
	{
		const fp = fakeProc();
		const deps = makeProductionSpawnBgResumeDeps({ resolveIdentity: () => IDENTITY, spawnChild: () => fp.proc });
		const childP = deps.spawnChild(spawnBgPlan());
		await flush();
		fp.emit("error", new Error("ENOENT: pi not found"));
		let threw = false;
		try {
			await childP;
		} catch (e) {
			threw = e instanceof Error && e.message.includes("ENOENT");
		}
		ok("2b spawn-time 'error' before 'spawn' → spawnChild rejects", threw);
	}

	// ── 3. awaitSocketAlive: connectable resolves; forged rejects without connecting ──
	{
		// connectable: socket-file + probe alive → resolve, probe called once.
		let probes = 0;
		const deps = makeProductionSpawnBgResumeDeps({
			lstatFn: async () => statLike("socket"),
			probeFn: async () => {
				probes++;
				return "alive";
			},
		});
		await deps.awaitSocketAlive(SOCK, new AbortController().signal);
		ok("3 connectable socket resolves", true);
		ok("3 connectable probed once", probes === 1);
	}
	{
		// forged: a symlink is an address-conflict — reject WITHOUT ever connecting.
		let probes = 0;
		const deps = makeProductionSpawnBgResumeDeps({
			lstatFn: async () => statLike("symlink"),
			probeFn: async () => {
				probes++;
				return "alive";
			},
		});
		let threw = false;
		try {
			await deps.awaitSocketAlive(SOCK, new AbortController().signal);
		} catch (e) {
			threw = e instanceof Error && e.message.includes("forged");
		}
		ok("3 forged (symlink) rejects", threw);
		ok("3 forged never connects (probe not called)", probes === 0);
	}
	{
		// dead → wait one interval → re-poll alive resolves. The scheduler fires the sleep.
		const sched = makeScheduler();
		const seq: SocketLiveness[] = ["dead", "alive"];
		let i = 0;
		const deps = makeProductionSpawnBgResumeDeps({
			lstatFn: async () => statLike("socket"),
			probeFn: async () => seq[i++] ?? "alive",
			setTimeoutFn: sched.setTimeoutFn,
			clearTimeoutFn: sched.clearTimeoutFn,
		});
		const p = deps.awaitSocketAlive(SOCK, new AbortController().signal);
		await flush(); // poll 1 (dead) → schedules the inter-poll sleep
		ok("3 dead → waits (a sleep is scheduled)", sched.pending() === 1);
		sched.fireNext(); // sleep elapses → poll 2 (alive)
		await p;
		ok("3 dead → wait → alive resolves", true);
	}
	{
		// abort during the wait → reject, scheduled sleep cleared.
		const sched = makeScheduler();
		const ctrl = new AbortController();
		const deps = makeProductionSpawnBgResumeDeps({
			lstatFn: async () => statLike("socket"),
			probeFn: async () => "dead",
			setTimeoutFn: sched.setTimeoutFn,
			clearTimeoutFn: sched.clearTimeoutFn,
		});
		const p = deps.awaitSocketAlive(SOCK, ctrl.signal);
		await flush(); // poll 1 (dead) → sleeping
		ctrl.abort();
		let threw = false;
		try {
			await p;
		} catch {
			threw = true;
		}
		ok("3 abort during wait → rejects", threw);
		ok("3 abort clears the scheduled sleep", sched.pending() === 0);
	}

	// ── 4. awaitChildExit reads the EAGER exitPromise (installed at spawn) ────────────
	{
		// 4a: exit AFTER awaitChildExit is waiting → resolves the code.
		const fp = fakeProc();
		const { deps, child } = await spawnedChild(fp);
		const p = deps.awaitChildExit(child, new AbortController().signal);
		fp.emit("exit", 137);
		ok("4 exit resolves the code", (await p) === 137);
	}
	{
		// 4b: abort → rejects.
		const fp = fakeProc();
		const { deps, child } = await spawnedChild(fp);
		const ctrl = new AbortController();
		const p = deps.awaitChildExit(child, ctrl.signal);
		await flush();
		ctrl.abort();
		let threw = false;
		try {
			await p;
		} catch {
			threw = true;
		}
		ok("4 abort → rejects", threw);
	}
	{
		// 4c: a signal kill (null code) → null.
		const fp = fakeProc();
		const { deps, child } = await spawnedChild(fp);
		const p = deps.awaitChildExit(child, new AbortController().signal);
		fp.emit("exit", null);
		ok("4 signal exit → null code", (await p) === null);
	}
	{
		// 4d (B2): the child exits BEFORE awaitChildExit is even called. The eager exitPromise
		// captured it at spawn, so awaitChildExit resolves immediately — it does NOT hang into a
		// timeout→kill→wrongful-retained.
		const fp = fakeProc();
		const { deps, child } = await spawnedChild(fp);
		fp.emit("exit", 0); // exit in the gap, before awaitChildExit
		const code = await deps.awaitChildExit(child, new AbortController().signal);
		ok("4d B2: fast exit before awaitChildExit is NOT missed", code === 0);
	}

	// ── 5. awaitTimeout: schedules; abort clears + rejects ───────────────────────────
	{
		const sched = makeScheduler();
		const ctrl = new AbortController();
		const deps = makeProductionSpawnBgResumeDeps({
			setTimeoutFn: sched.setTimeoutFn,
			clearTimeoutFn: sched.clearTimeoutFn,
		});
		const p = deps.awaitTimeout(30_000, ctrl.signal);
		await flush();
		ok("5 awaitTimeout schedules a timer", sched.pending() === 1);
		// fire it → resolves
		sched.fireNext();
		await p;
		ok("5 awaitTimeout resolves when fired", true);

		// abort path clears the timer.
		const sched2 = makeScheduler();
		const ctrl2 = new AbortController();
		const deps2 = makeProductionSpawnBgResumeDeps({
			setTimeoutFn: sched2.setTimeoutFn,
			clearTimeoutFn: sched2.clearTimeoutFn,
		});
		const q = deps2.awaitTimeout(30_000, ctrl2.signal);
		await flush();
		ctrl2.abort();
		let threw = false;
		try {
			await q;
		} catch {
			threw = true;
		}
		ok("5 abort → awaitTimeout rejects", threw);
		ok("5 abort clears the timer", sched2.pending() === 0);
	}

	// ── 6 & 7. killChild SIGTERM; releaseLock delegates ──────────────────────────────
	{
		const fp = fakeProc();
		const holder: { released: LockClaim | null } = { released: null };
		const { deps, child } = await spawnedChild(fp, { releaseFn: (lock) => (holder.released = lock) });
		deps.killChild(child);
		ok("6 killChild sends SIGTERM", fp.calls.kills.length === 1 && fp.calls.kills[0] === "SIGTERM");
		const lock = lockClaim();
		deps.releaseLock(lock);
		ok("7 releaseLock delegates to the injected release fn", holder.released === lock);
	}

	// ── 8. mis-wire: a child with no proc fails loud ─────────────────────────────────
	{
		const deps = makeProductionSpawnBgResumeDeps({});
		let killThrew = false;
		try {
			deps.killChild({ pid: 1 });
		} catch (e) {
			killThrew = e instanceof Error && e.message.includes("no proc");
		}
		ok("8 killChild on a proc-less child fails loud", killThrew);

		let exitThrew = false;
		try {
			await deps.awaitChildExit({ pid: 1 }, new AbortController().signal);
		} catch (e) {
			exitThrew = e instanceof Error && e.message.includes("no proc");
		}
		ok("8 awaitChildExit on a proc-less child fails loud", exitThrew);
	}
	// ── 9. resolveResumeLaunchIdentity — the RECORD is the resume authority (#50 C2/C3) ──
	// Fixture-driven through a temp ENTWURF_META_SESSIONS_DIR: the record names the
	// transcript (gardenId → record.transcriptPath), and the transcript must prove it is
	// the citizen's own (header id === record.nativeSessionId — the C3 integrity check
	// that replaced the marker/name-tag authorization).
	{
		const world = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-prod-resolve-"));
		const storeDir = path.join(world, "meta-sessions");
		fs.mkdirSync(storeDir, { recursive: true });
		const prevStore = process.env.ENTWURF_META_SESSIONS_DIR;
		process.env.ENTWURF_META_SESSIONS_DIR = storeDir;
		try {
			const cwd = path.join(world, "repo");
			fs.mkdirSync(cwd, { recursive: true });
			const sessionLine = (id: string) => `${JSON.stringify({ type: "session", id, cwd })}\n`;
			const modelLine = `${JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-5.4" })}\n`;
			const writeTranscript = (name: string, content: string): string => {
				const p = path.join(world, name);
				fs.writeFileSync(p, content);
				return p;
			};
			const mintRecord = (nativeSessionId: string, transcriptPath: string | null, backend = "pi"): string =>
				upsertMetaSession({
					input: { backend: backend as "pi", nativeSessionId, cwd, model: "gpt-5.4", transcriptPath },
					dir: storeDir,
				}).record.gardenId;
			const planFor = (gid: string): SpawnBgPlan => ({ ...spawnBgPlan(), targetGardenId: gid, sessionId: gid });
			const rejects = (gid: string, needle: string, label: string): void => {
				let msg = "";
				try {
					resolveResumeLaunchIdentity(planFor(gid));
				} catch (e) {
					msg = e instanceof Error ? e.message : String(e);
				}
				ok(label, msg.includes(needle));
			};

			// happy: record → transcriptPath → header id matches nativeSessionId → LaunchIdentity.
			const nativeOk = "0199aaaa-1111-4222-8333-444455556666";
			const fileOk = writeTranscript("own.jsonl", sessionLine(nativeOk) + modelLine);
			const gidOk = mintRecord(nativeOk, fileOk);
			const launch = resolveResumeLaunchIdentity(planFor(gidOk));
			ok("9 record-backed resume resolves the recorded transcript", launch.sessionFile === fileOk);
			ok("9 resume cwd = header authority", launch.cwd === cwd);
			ok("9 resume model = first model_change", launch.model === "gpt-5.4" && launch.provider === "openai-codex");

			// C3 integrity: a transcript whose header id is NOT the citizen's nativeSessionId
			// (stale/foreign transcriptPath) must be refused, never resumed.
			const nativeMine = "0199bbbb-1111-4222-8333-444455556666";
			const foreignFile = writeTranscript(
				"foreign.jsonl",
				sessionLine("0199cccc-9999-4999-8999-999999999999") + modelLine,
			);
			const gidForeign = mintRecord(nativeMine, foreignFile);
			rejects(gidForeign, "does not match the record's nativeSessionId", "9 header ≠ nativeSessionId → refused (C3)");

			// missing record → not a garden citizen (readMetaIdentityByGardenId fail-fast).
			rejects("20260101T000000-facade", "not a garden citizen", "9 recordless gid → not a citizen");

			// non-pi citizen → spawn-bg resume is the pi rail.
			const gidClaude = mintRecord("claude-native-1", null, "claude-code");
			rejects(gidClaude, "the pi rail", "9 non-pi citizen → refused (pi rail)");

			// pi citizen with no recorded transcript (no turn yet) → nothing to resume.
			const gidNoFile = mintRecord("0199dddd-1111-4222-8333-444455556666", null);
			rejects(gidNoFile, "no recorded transcriptPath", "9 transcriptPath null → nothing to resume");

			// transcript with no model_change → no recorded model.
			const nativeNoModel = "0199eeee-1111-4222-8333-444455556666";
			const fileNoModel = writeTranscript("no-model.jsonl", sessionLine(nativeNoModel));
			const gidNoModel = mintRecord(nativeNoModel, fileNoModel);
			rejects(gidNoModel, "no recorded model", "9 no model_change → refused");

			// transcript with a model_change but NO session header line: the header id is
			// undefined, which can never equal the record's nativeSessionId — the C3
			// integrity check refuses it as "(none)" rather than resuming a headerless file.
			const nativeNoHeader = "0199ffff-1111-4222-8333-444455556666";
			const fileNoHeader = writeTranscript("no-header.jsonl", modelLine);
			const gidNoHeader = mintRecord(nativeNoHeader, fileNoHeader);
			rejects(gidNoHeader, '"(none)"', "9 headerless transcript → refused as (none), never resumed");
		} finally {
			if (prevStore === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
			else process.env.ENTWURF_META_SESSIONS_DIR = prevStore;
			fs.rmSync(world, { recursive: true, force: true });
		}
	}

	console.log(`\ncheck-entwurf-v2-spawn-production: ${passed} checks passed`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
