// Shared bounded child-process teardown for the LIVE smokes (ACP + entwurf-v2).
//
// WHY THIS EXISTS (test-infra, not a Phase-1/Phase-2 feature):
// Every `smoke-acp-*-live.ts` carried its own copy of `terminateChild`, and
// each copy ended its SIGKILL path with an UNBOUNDED `await exited`. When the
// spawned child (or a grandchild ACP backend that still holds the stdio pipes)
// never emits an "exit" event, that await hangs FOREVER — *after* the smoke has
// already printed its PASS line. Individually the smokes pass; it is only this
// post-PASS cleanup that wedges, which is exactly what froze the aggregate
// `release-gate` runner (observed 2026-06-24: raw-turn PASS, then no further
// output for >25min while the runner sat in cleanup).
//
// Crash-don't-warn (AGENTS.md): every wait here is BOUNDED, and if the child is
// genuinely still alive after SIGKILL + a bounded grace we THROW. A leaked live
// backend is broken tool state, not a warning. The only swallowed errors are
// liveness PROBES (kill() / signal-0 / stdio destroy) — the one sanctioned use
// of `catch {}` (environment probing), never control flow we lie about.

import type { ChildProcess } from "node:child_process";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function destroyChildStdio(child: ChildProcess): void {
	for (const stream of [child.stdin, child.stdout, child.stderr]) {
		try {
			stream?.destroy();
		} catch {
			// best-effort teardown; never load-bearing
		}
	}
}

export interface TerminateOptions {
	/** Grace after SIGTERM before escalating to SIGKILL. */
	graceMs?: number;
	/** Bounded wait after SIGKILL before the signal-0 liveness probe. */
	killWaitMs?: number;
}

/**
 * Terminate a spawned smoke child with bounded waits and a loud failure.
 *
 * SIGTERM → grace → SIGKILL → bounded wait → signal-0 liveness probe.
 * Returns when the child is gone (or was never alive); throws only if the
 * child is provably STILL alive after SIGKILL + the bounded wait.
 */
export async function terminateChild(
	child: ChildProcess,
	{ graceMs = 2_000, killWaitMs = 2_000 }: TerminateOptions = {},
): Promise<void> {
	// Already reaped, but still close our side of the stdio pipes. With the SDK
	// fluent connection a smoke can otherwise print PASS and keep Node alive on
	// a retained pipe/read handle.
	if (child.exitCode !== null || child.signalCode !== null) {
		destroyChildStdio(child);
		return;
	}

	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

	try {
		child.kill("SIGTERM");
	} catch {
		// kill() throws ESRCH when the process is already gone — treat as exited.
		destroyChildStdio(child);
		return;
	}

	const afterTerm = await Promise.race([
		exited.then(() => "exited" as const),
		sleep(graceMs).then(() => "timeout" as const),
	]);
	if (afterTerm === "exited") {
		destroyChildStdio(child);
		return;
	}

	// Grace elapsed — escalate. (The old bug: the wait AFTER this kill was
	// unbounded `await exited`.)
	try {
		child.kill("SIGKILL");
	} catch {
		destroyChildStdio(child);
		return; // raced to death between the grace race and this kill
	}

	// Release any stdio the helper may be pinning, so a missed "exit" event does
	// not keep the event loop (and the pipes) alive. Probe-only — best effort.
	destroyChildStdio(child);

	const afterKill = await Promise.race([
		exited.then(() => "exited" as const),
		sleep(killWaitMs).then(() => "timeout" as const),
	]);
	if (afterKill === "exited") {
		destroyChildStdio(child);
		return;
	}

	// The "exit" event may simply have been missed even though the process is
	// dead. Probe with signal 0: a throw (ESRCH/EPERM on a reaped pid) means the
	// process is gone, so proceed; a clean return means it is genuinely alive.
	const pid = child.pid;
	if (pid === undefined) {
		destroyChildStdio(child);
		return; // never acquired a pid; nothing can leak
	}
	try {
		process.kill(pid, 0);
	} catch {
		destroyChildStdio(child);
		return; // gone — the exit event was just missed
	}

	throw new Error(`terminateChild: child pid=${pid} still alive after SIGKILL + ${killWaitMs}ms bounded wait`);
}
