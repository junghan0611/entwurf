/**
 * smoke-entwurf-v2-spawn-live — the 5c-3c LIVE phase gate (D5). Unlike the deterministic
 * gate (check-entwurf-v2-spawn-production, fakes only), this exercises the production
 * SpawnBgResumeDeps against REAL OS objects — a real unix socket, real child processes, real
 * timers, real abort teardown — to catch what fakes cannot: actual spawn/exit/error event
 * semantics, real lstat+connect liveness, real timer/abort cleanup, and the 5c-3a watcher's
 * timeout→kill→child-exited→release integration on a live process.
 *
 * It does NOT spawn a real `pi --entwurf-control` resume (that needs a saved session, model
 * auth, and backend state — flaky); proving the argv actually launches pi end-to-end is the
 * 5d surface matrix's job. `buildResumePiArgs` is already pinned by the deterministic gate.
 *
 * Kept OUT of `pnpm check` (it spawns processes / opens sockets); run it manually before 5d:
 *   LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live
 * and record the result in NEXT.md / the commit body (chain-outside, phase-gate-inside).
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import { executeSpawnBgResume, type SpawnBgPlan } from "../pi-extensions/lib/entwurf-v2-spawn.ts";
import { makeProductionSpawnBgResumeDeps } from "../pi-extensions/lib/entwurf-v2-spawn-production.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

// A resident child that survives until SIGTERM, then exits 0 — a stand-in for a pi child
// (we are proving the OS-level lifecycle wiring, not pi's resume behavior).
const RESIDENT_CHILD = "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1e9);";

function lockClaim(gardenId: string): LockClaim {
	return {
		gardenId,
		pid: process.pid,
		hostname: os.hostname(),
		createdAt: new Date(0).toISOString(),
		nonce: "live5c3csmoke00",
		owner: "entwurf_v2",
		lockPath: `/tmp/${gardenId}.lock`,
	};
}

function spawnBgPlan(over: Partial<SpawnBgPlan> = {}): SpawnBgPlan {
	const gid = "20260613T000000-aaaaaa";
	return {
		transport: "spawn-bg",
		action: "resume",
		targetGardenId: gid,
		sessionId: gid,
		cwd: process.cwd(),
		prompt: "continue",
		wantsReply: false,
		launchArgs: [],
		expectedSocketPath: "/nonexistent/never.sock",
		observeTimeoutMs: 30_000,
		releaseWhen: "socket-alive-or-child-exited",
		...over,
	};
}

async function main(): Promise<void> {
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "v2spawn-"));
	const children: ChildProcess[] = [];
	let server: net.Server | null = null;

	try {
		// ── S1: real unix-socket connectability (real fs.lstat + real probeSocketLiveness) ─
		{
			const sockPath = path.join(tmp, "live.sock");
			server = net.createServer();
			await new Promise<void>((resolve) => server?.listen(sockPath, resolve));
			const deps = makeProductionSpawnBgResumeDeps({ pollIntervalMs: 20 });
			await deps.awaitSocketAlive(sockPath, new AbortController().signal);
			ok("S1 a real listening unix socket → awaitSocketAlive resolves (connectable)", true);

			// symlink at the path → forged (real lstat catches it; never connected — P1).
			const symPath = path.join(tmp, "sym.sock");
			await fsp.symlink(sockPath, symPath);
			let forged = false;
			try {
				await deps.awaitSocketAlive(symPath, new AbortController().signal);
			} catch (e) {
				forged = e instanceof Error && e.message.includes("forged");
			}
			ok("S1 a symlink at the socket path → forged reject (real lstat P1)", forged);

			// absent path → dead → wait; abort settles it (real timer + abort cleanup).
			const ctrl = new AbortController();
			const absentP = deps.awaitSocketAlive(path.join(tmp, "absent.sock"), ctrl.signal);
			setTimeout(() => ctrl.abort(), 60);
			let aborted = false;
			try {
				await absentP;
			} catch {
				aborted = true;
			}
			ok("S1 an absent socket → waits, then abort settles it (no hang)", aborted);

			await new Promise<void>((resolve) => server?.close(() => resolve()));
			server = null;
		}

		// ── S2: real child lifecycle — spawn event, exit capture, SIGTERM kill ───────────
		{
			const deps = makeProductionSpawnBgResumeDeps({
				resolveIdentity: () => ({
					sessionFile: path.join(tmp, "smoke-session.jsonl"),
					cwd: tmp,
					explicitExtensionArgs: [],
					provider: null,
					model: "smoke",
				}),
				spawnChild: () => {
					const proc = spawn(process.execPath, ["-e", RESIDENT_CHILD], { stdio: "ignore" });
					children.push(proc);
					return proc;
				},
			});
			// spawnChild awaits the REAL 'spawn' event before resolving (B1).
			const child = await deps.spawnChild(spawnBgPlan());
			ok("S2 spawnChild resolves on the real 'spawn' event (B1)", typeof child.pid === "number" && child.pid > 0);

			// SIGTERM → the resident child terminates; awaitChildExit OBSERVES the exit via the
			// eager exitPromise (B2). The code is 0 if the child's SIGTERM handler ran, or null if
			// the signal landed before the handler was installed — both are a real, observed exit
			// (the watcher releases on child-exited for ANY code), which is what this proves.
			deps.killChild(child);
			const code = await deps.awaitChildExit(child, new AbortController().signal);
			ok("S2 killChild(SIGTERM) → awaitChildExit observes the exit (code 0 or null)", code === 0 || code === null);
		}

		// ── S3: watcher integration — real timeout → kill → child-exited → release ───────
		{
			let releases = 0;
			const deps = makeProductionSpawnBgResumeDeps({
				resolveIdentity: () => ({
					sessionFile: path.join(tmp, "smoke-session.jsonl"),
					cwd: tmp,
					explicitExtensionArgs: [],
					provider: null,
					model: "smoke",
				}),
				spawnChild: () => {
					const proc = spawn(process.execPath, ["-e", RESIDENT_CHILD], { stdio: "ignore" });
					children.push(proc);
					return proc;
				},
				releaseFn: () => {
					releases++;
				},
				pollIntervalMs: 20,
				killGraceMs: 2_000,
			});
			// A child that never stands a socket up + a short observe window → the watcher must
			// time out, NOT release on the timeout, kill, observe the real exit, then release once.
			const plan = spawnBgPlan({ observeTimeoutMs: 80, expectedSocketPath: path.join(tmp, "never-appears.sock") });
			const result = await executeSpawnBgResume(plan, lockClaim(plan.sessionId), deps);
			ok("S3 timeout→kill→child-exited (real timer + real child + 5c-3a watcher)", result.kind === "child-exited");
			ok("S3 lock released exactly once on the observed exit", result.released === true && releases === 1);
		}

		console.log(`\nsmoke-entwurf-v2-spawn-live: ${passed} checks passed (real OS primitives)`);
	} finally {
		for (const c of children) {
			try {
				c.kill("SIGKILL");
			} catch {
				// best-effort
			}
		}
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		await fsp.rm(tmp, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
