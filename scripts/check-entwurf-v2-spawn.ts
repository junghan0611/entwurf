/**
 * check-entwurf-v2-spawn — deterministic gate for the 5c-3a spawn-bg RESUME watcher hand
 * (`executeSpawnBgResume`). It proves the spawn→observe→release WIRING over injected fakes
 * with controlled promises — NO real child, socket, or timer — exactly as 5b/5c-2 proved
 * their hands. The load-bearing property under test is Fable 3: TIMEOUT IS NOT A RELEASE.
 *
 *   1. spawnChild throws → `spawn-start-failed`, release ×1, original error surfaced.
 *   2. socket-alive wins → `socket-alive`, release ×1; the exit loser settling later is a
 *      no-op (single release); killChild NOT called.
 *   3. child-exited wins (code 0 / 1 / null) → `child-exited`, release ×1; killChild NOT
 *      called; socket loser later no-op.
 *   4. timeout wins → release 0 AT KILL TIME (bare timeout never releases) AND killChild
 *      called ×1 — the timeout escalates to a kill, it does not release.
 *   5. timeout → kill → child-exited (null) observed in grace → `child-exited`, release ×1.
 *   6. timeout → kill → socket-alive observed in grace → `socket-alive`, release ×1.
 *   7. timeout → kill → grace elapses with NO observation → `lock-retained`
 *      (reason `kill-unconfirmed`), release 0, full diagnostic surfaced, bounded return.
 *   8. post-spawn dep throw (awaitChildExit rejects in the primary race) → best-effort kill,
 *      exit cannot be observed → `lock-retained` (reason `observe-failed`), release 0.
 *   9. post-spawn dep throw (awaitSocketAlive rejects in the primary race) → kill → exit
 *      observed in grace → `child-exited`, release ×1 (the working exit watcher still wins).
 *  10. releaseLock throw on a RELEASED (socket-alive) path PROPAGATES — the observation
 *      already happened, the caller must not re-spawn (release error surfaces honestly).
 *  11. lock invariants: null lock / mismatched-gid lock → throws (decideReleasePolicy),
 *      BEFORE any spawn (spawnChild NOT called).
 *  12. no direct-release hatch: across the retained paths (7,8) deps.releaseLock is never
 *      reached — the ONLY release path is reduceRelease on a real observation event.
 *
 * Each await dep is a deferred the gate resolves in a chosen order, flushing microtasks
 * between steps, so "release happens after the observation, exactly once" is asserted
 * structurally over every event order.
 */

import assert from "node:assert/strict";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	executeSpawnBgResume,
	type SpawnBgPlan,
	type SpawnBgResumeDeps,
	type SpawnedChild,
} from "../pi-extensions/lib/entwurf-v2-spawn.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260612T100000-aaaaaa";
const WRONG_GID = "20260612T999999-bbbbbb";
const SOCK = "/fake/entwurf-control/20260612T100000-aaaaaa.sock";
const LOCKPATH = `/fake/locks/${GID}.lock`;

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

function spawnBgPlan(): SpawnBgPlan {
	return {
		transport: "spawn-bg",
		action: "resume",
		targetGardenId: GID,
		sessionId: GID,
		cwd: "/home/test/repo",
		prompt: "continue",
		wantsReply: false,
		launchArgs: ["--approve"],
		expectedSocketPath: SOCK,
		observeTimeoutMs: 30_000,
		releaseWhen: "socket-alive-or-child-exited",
	};
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((res) => setImmediate(res));

interface Calls {
	spawn: number;
	socket: number;
	exit: number;
	timeout: number;
	kill: number;
	release: number;
}

interface Harness {
	deps: SpawnBgResumeDeps;
	calls: Calls;
	socket: Deferred<void>;
	exit: Deferred<number | null>;
	observe: Deferred<void>; // 1st awaitTimeout call (observeTimeoutMs)
	grace: Deferred<void>; // 2nd awaitTimeout call (killGraceMs)
}

interface HarnessOpts {
	spawnThrows?: string;
	killThrows?: boolean;
	releaseThrows?: boolean;
	socketSyncThrows?: string; // awaitSocketAlive throws SYNCHRONOUSLY (buggy dep)
	exitSyncThrows?: string; // awaitChildExit throws SYNCHRONOUSLY (buggy dep)
	child?: SpawnedChild;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
	const calls: Calls = { spawn: 0, socket: 0, exit: 0, timeout: 0, kill: 0, release: 0 };
	const socket = deferred<void>();
	const exit = deferred<number | null>();
	const observe = deferred<void>();
	const grace = deferred<void>();
	const child: SpawnedChild = opts.child ?? { pid: 9191 };

	const deps: SpawnBgResumeDeps = {
		spawnChild: async () => {
			calls.spawn++;
			if (opts.spawnThrows) throw new Error(opts.spawnThrows);
			return child;
		},
		awaitSocketAlive: (_socketPath, _signal) => {
			calls.socket++;
			if (opts.socketSyncThrows) throw new Error(opts.socketSyncThrows);
			return socket.promise;
		},
		awaitChildExit: (_c, _signal) => {
			calls.exit++;
			if (opts.exitSyncThrows) throw new Error(opts.exitSyncThrows);
			return exit.promise;
		},
		awaitTimeout: (_ms, _signal) => {
			calls.timeout++;
			return calls.timeout === 1 ? observe.promise : grace.promise;
		},
		killChild: (_c) => {
			calls.kill++;
			if (opts.killThrows) throw new Error("kill failed");
		},
		releaseLock: (_lock) => {
			calls.release++;
			if (opts.releaseThrows) throw new Error("release failed");
		},
		killGraceMs: 5_000,
	};
	return { deps, calls, socket, exit, observe, grace };
}

async function main(): Promise<void> {
	// ── 1. spawnChild throws → spawn-start-failed, release ×1, error surfaced ────────
	{
		const h = makeHarness({ spawnThrows: "ENOENT pi binary" });
		const r = await executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		ok("1 spawn-start-failed kind", r.kind === "spawn-start-failed");
		ok("1 released true", r.released === true);
		ok("1 error surfaced", r.kind === "spawn-start-failed" && r.error.includes("ENOENT pi binary"));
		ok("1 release ×1", h.calls.release === 1);
		ok("1 no socket/exit/timeout watch", h.calls.socket === 0 && h.calls.exit === 0 && h.calls.timeout === 0);
		ok("1 no kill", h.calls.kill === 0);
	}

	// ── 2. socket-alive wins → socket-alive, release ×1, no kill; exit loser no-op ───
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.socket.resolve();
		await flush();
		// the exit loser settles AFTER the win — must not double release.
		h.exit.resolve(0);
		const r = await p;
		ok("2 socket-alive kind", r.kind === "socket-alive");
		ok("2 released true", r.released === true);
		ok("2 pid surfaced", r.kind === "socket-alive" && r.pid === 9191);
		ok("2 release exactly once", h.calls.release === 1);
		ok("2 no kill (no timeout)", h.calls.kill === 0);
	}

	// ── 3. child-exited wins (code 0 / 1 / null) → child-exited, release ×1, no kill ──
	for (const code of [0, 1, null] as const) {
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.exit.resolve(code);
		await flush();
		h.socket.resolve(); // loser
		const r = await p;
		ok(`3 child-exited kind (code=${code})`, r.kind === "child-exited");
		ok(`3 exitCode=${code}`, r.kind === "child-exited" && r.exitCode === code);
		ok(`3 release exactly once (code=${code})`, h.calls.release === 1);
		ok(`3 no kill (code=${code})`, h.calls.kill === 0);
	}

	// ── 4. timeout wins → release 0 at kill time, killChild ×1 (bare timeout ≠ release) ─
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.observe.resolve(); // observe timeout fires first
		await flush();
		// At this point the hand has killed and is awaiting the grace observation.
		ok("4 release 0 after bare timeout", h.calls.release === 0);
		ok("4 killChild ×1 on timeout", h.calls.kill === 1);
		// drain: let the kill produce an exit so the promise settles.
		h.exit.resolve(null);
		const r = await p;
		ok("4 settles as child-exited after kill", r.kind === "child-exited");
	}

	// ── 5. timeout → kill → child-exited(null) in grace → child-exited, release ×1 ───
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.observe.resolve();
		await flush();
		h.exit.resolve(null); // the kill's exit observed within grace
		const r = await p;
		ok("5 child-exited after kill", r.kind === "child-exited");
		ok("5 exitCode null (signal)", r.kind === "child-exited" && r.exitCode === null);
		ok("5 release exactly once", h.calls.release === 1);
		ok("5 kill ×1", h.calls.kill === 1);
	}

	// ── 6. timeout → kill → socket-alive in grace → socket-alive, release ×1 ─────────
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.observe.resolve();
		await flush();
		h.socket.resolve(); // child raced its socket up just as we killed
		const r = await p;
		ok("6 socket-alive after kill", r.kind === "socket-alive");
		ok("6 release exactly once", h.calls.release === 1);
	}

	// ── 7. timeout → kill → grace elapses, no observation → lock-retained, release 0 ──
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.observe.resolve();
		await flush();
		h.grace.resolve(); // grace elapses with no socket/exit
		const r = await p;
		ok("7 lock-retained kind", r.kind === "lock-retained");
		ok("7 released false", r.released === false);
		ok("7 reason kill-unconfirmed", r.kind === "lock-retained" && r.reason === "kill-unconfirmed");
		ok("7 release NEVER (no blind release)", h.calls.release === 0);
		const diag = r.kind === "lock-retained" ? r.diagnostic : null;
		ok("7 diagnostic targetGardenId", diag?.targetGardenId === GID);
		ok("7 diagnostic socketPath", diag?.expectedSocketPath === SOCK);
		ok("7 diagnostic lockPath", diag?.lockPath === LOCKPATH);
		ok("7 diagnostic pid", diag?.pid === 9191);
		ok("7 diagnostic observeTimeoutMs", diag?.observeTimeoutMs === 30_000);
		ok("7 diagnostic killGraceMs", diag?.killGraceMs === 5_000);
	}

	// ── 8. post-spawn dep throw (awaitChildExit rejects) → kill, no exit → retained ──
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		// the exit watcher itself fails — its rejection both triggers the backstop AND means
		// the exit can never be observed → fail-closed to lock-retained.
		h.exit.reject(new Error("exit watcher EBADF"));
		const r = await p;
		ok("8 lock-retained kind", r.kind === "lock-retained");
		ok("8 reason observe-failed", r.kind === "lock-retained" && r.reason === "observe-failed");
		ok("8 original error surfaced", r.kind === "lock-retained" && (r.error ?? "").includes("exit watcher EBADF"));
		ok("8 best-effort kill called", h.calls.kill === 1);
		ok("8 release NEVER", h.calls.release === 0);
	}

	// ── 9. post-spawn dep throw (awaitSocketAlive rejects) → kill → exit in grace ────
	{
		const h = makeHarness();
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.socket.reject(new Error("socket watcher EACCES")); // primary race rejects → backstop
		await flush();
		// the exit watcher is healthy → the kill's exit is observed within grace.
		h.exit.resolve(137);
		const r = await p;
		ok("9 child-exited after backstop kill", r.kind === "child-exited");
		ok("9 exitCode 137", r.kind === "child-exited" && r.exitCode === 137);
		ok("9 release exactly once", h.calls.release === 1);
		ok("9 kill ×1", h.calls.kill === 1);
	}

	// ── 10. releaseLock throw on a released path PROPAGATES (caller must not re-spawn) ─
	{
		const h = makeHarness({ releaseThrows: true });
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.socket.resolve();
		let threw: unknown;
		try {
			await p;
		} catch (e) {
			threw = e;
		}
		ok("10 release error propagates", threw instanceof Error && threw.message === "release failed");
		ok("10 release was attempted once", h.calls.release === 1);
	}

	// ── 11. lock invariants → decideReleasePolicy throws BEFORE any spawn ────────────
	{
		const h = makeHarness();
		let threw = false;
		try {
			await executeSpawnBgResume(spawnBgPlan(), null, h.deps);
		} catch {
			threw = true;
		}
		ok("11 null lock throws", threw);
		ok("11 null lock: no spawn attempted", h.calls.spawn === 0);

		const h2 = makeHarness();
		let threw2 = false;
		try {
			await executeSpawnBgResume(spawnBgPlan(), lockClaim(WRONG_GID), h2.deps);
		} catch {
			threw2 = true;
		}
		ok("11 mismatched-gid lock throws", threw2);
		ok("11 mismatched-gid: no spawn attempted", h2.calls.spawn === 0);
	}

	// ── 12. kill grace where kill itself throws but exit still observed → released ───
	// (proves killChild throwing is best-effort: the observation still drives release.)
	{
		const h = makeHarness({ killThrows: true });
		const p = executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		await flush();
		h.observe.resolve();
		await flush();
		h.exit.resolve(0); // exit observed despite the kill throw
		const r = await p;
		ok("12 child-exited despite kill throw", r.kind === "child-exited");
		ok("12 release exactly once", h.calls.release === 1);
		ok("12 kill attempted once", h.calls.kill === 1);
	}

	// ── 13. S1 (Fable 2차): awaitSocketAlive throws SYNCHRONOUSLY at creation (a buggy dep
	//        that throws where it must return a Promise). The child exists → no blind release;
	//        best-effort kill + lock-retained fail-closed. The async race (cases 8/9) never
	//        runs, so this would be a silent leak without the dedicated creation try. ────────
	{
		const h = makeHarness({ socketSyncThrows: "awaitSocketAlive EFAULT (sync)" });
		const r = await executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		ok("13 lock-retained on sync socket throw", r.kind === "lock-retained");
		ok("13 reason observe-failed", r.kind === "lock-retained" && r.reason === "observe-failed");
		ok("13 sync error surfaced", r.kind === "lock-retained" && (r.error ?? "").includes("awaitSocketAlive EFAULT"));
		ok("13 best-effort kill ×1", h.calls.kill === 1);
		ok("13 release NEVER (no blind release)", h.calls.release === 0);
		ok("13 diagnostic lockPath surfaced", r.kind === "lock-retained" && r.diagnostic.lockPath === LOCKPATH);
	}

	// ── 14. S1 sibling: awaitChildExit throws SYNCHRONOUSLY at creation (socket watcher DID
	//        start, then exit creation throws). Same fail-closed retained; the started socket
	//        watcher is defused so it cannot surface as an unhandled rejection. ──────────────
	{
		const h = makeHarness({ exitSyncThrows: "awaitChildExit EFAULT (sync)" });
		const r = await executeSpawnBgResume(spawnBgPlan(), lockClaim(), h.deps);
		ok("14 lock-retained on sync exit throw", r.kind === "lock-retained");
		ok("14 reason observe-failed", r.kind === "lock-retained" && r.reason === "observe-failed");
		ok("14 best-effort kill ×1", h.calls.kill === 1);
		ok("14 release NEVER", h.calls.release === 0);
		ok("14 socket watcher had started", h.calls.socket === 1);
	}

	console.log(`\ncheck-entwurf-v2-spawn: ${passed} checks passed`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
