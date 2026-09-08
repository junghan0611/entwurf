// Reclaim a gate's OWN process resources when that gate exits — however it exits.
//
// WHY THIS EXISTS (test-infra, not a product capability):
// A gate ends red by THROWING (`ok()` is `assert.ok`), and ^C or a runner's SIGTERM
// ends it with no statement running at all. Teardown written as the last line of the
// file is therefore skipped on every path except the green one, and the mutant runner
// makes that the COMMON path: qualification runs each committed mutant expecting the
// gate to go red. Measured on `oracle` 2026-09-08, before this leaf existed: ~9,200
// stale temp roots and 3.8G under `/tmp`, plus 360 reparented fixture Node processes
// from `check-copilot-receive-arm` alone. `pnpm check` was still minting a fresh one
// per run at that point.
//
// WHAT IT IS NOT. It is not error handling and it does not soften a failure: the exit
// code is untouched (a red gate stays red, a signal still ends as 128+n), nothing is
// logged, and no failure is converted into a warning (Hard Rule 15). It reclaims
// process resources only — never a record, transcript or operator artifact (Hard Rule
// 8). A SIGKILL of the gate still runs nothing here, by construction; that residue is
// the release protocol's `P9. Reclaim the host` step, and a fixture child that must
// outlive nothing needs its own parent-death watchdog.

import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

const roots: string[] = [];
const children: ChildProcess[] = [];
let wired = false;
let done = false;

/** Sync-only, idempotent: an `exit` handler may not await anything. */
function reclaim(): void {
	if (done) return;
	done = true;
	for (const c of children) {
		try {
			c.kill("SIGKILL");
		} catch {
			// kill() throws ESRCH on an already-reaped pid — gone either way
		}
	}
	for (const dir of roots) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Best-effort teardown must never become the reason a GREEN gate exits
			// non-zero: a throw inside an `exit` handler would flip the verdict of a
			// run that had already passed every assertion it makes.
		}
	}
}

function wire(): void {
	if (wired) return;
	wired = true;
	process.on("exit", reclaim);
	// A signal is not an exit: without these, `exit` never fires. Re-raising as
	// 128+n keeps the shell's own convention rather than inventing a code.
	for (const [signal, n] of [
		["SIGINT", 2],
		["SIGTERM", 15],
		["SIGHUP", 1],
	] as const) {
		process.on(signal, () => {
			reclaim();
			process.exit(128 + n);
		});
	}
}

/** Register a temp root to remove on exit. Returns it, so it wraps `mkdtempSync`. */
export function reclaimOnExit(dir: string): string {
	wire();
	roots.push(dir);
	return dir;
}

/** Register a spawned child to SIGKILL on exit. Returns it, so it wraps `spawn`. */
export function killOnExit<T extends ChildProcess>(child: T): T {
	wire();
	children.push(child);
	return child;
}

/** Run the registered teardown now (the green tail); later exits become no-ops. */
export function reclaimNow(): void {
	reclaim();
}
