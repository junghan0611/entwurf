/**
 * check-socket-probe — deterministic gate for 0.11 Stage 0 (F3 fix): the
 * three-valued control-socket liveness probe and its GC/listing policies.
 *
 * Proves:
 *   - classifyConnectError is a pure boundary: ECONNREFUSED/ENOENT → dead;
 *     timeout/EACCES/unknown/undefined → indeterminate (default = don't destroy),
 *   - shouldUnlinkOnGc reclaims ONLY dead (the F3 invariant: indeterminate and
 *     alive both survive the sweep),
 *   - probeSocketLiveness end-to-end on the two REPRODUCIBLE cases:
 *       (a) a real listening socket  → "alive"  → survives GC,
 *       (b) a nonexistent path       → "dead"   → eligible for GC.
 *
 * Why no timeout fixture: a connect that neither connects nor errors cannot be
 * forged deterministically at the wire level (a dead unix socket gives
 * ECONNREFUSED; Node's listener auto-accepts). The timeout→indeterminate edge
 * is held by the pure classifier (ETIMEDOUT) + the probe's timer branch, not by
 * a flaky wire test. (Per GLG: don't burn time on a wire timeout fixture.)
 *
 * Pure + two-socket integration; no backend, no API.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { classifyConnectError, probeSocketLiveness, shouldUnlinkOnGc } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
	assert.strictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// ── Pure classifier: only the two positive-absence codes are dead ──────────
eq("classify ECONNREFUSED → dead", classifyConnectError("ECONNREFUSED"), "dead");
eq("classify ENOENT → dead", classifyConnectError("ENOENT"), "dead");
eq("classify ETIMEDOUT → indeterminate", classifyConnectError("ETIMEDOUT"), "indeterminate");
eq("classify EACCES → indeterminate (unknown ≠ dead)", classifyConnectError("EACCES"), "indeterminate");
eq("classify EPIPE → indeterminate", classifyConnectError("EPIPE"), "indeterminate");
eq("classify undefined code → indeterminate", classifyConnectError(undefined), "indeterminate");

// ── GC policy: reclaim ONLY dead — the F3 invariant ────────────────────────
eq("GC unlinks dead", shouldUnlinkOnGc("dead"), true);
eq("GC keeps indeterminate (F3: load-stalled live socket survives)", shouldUnlinkOnGc("indeterminate"), false);
eq("GC keeps alive", shouldUnlinkOnGc("alive"), false);

// ── Integration: two reproducible cases on real paths ──────────────────────
async function integration(): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "socket-probe-"));
	const liveSock = path.join(dir, "live.sock");
	const goneSock = path.join(dir, "absent.sock");

	// (a) real listener → alive → survives GC
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(liveSock, resolve);
	});
	try {
		const live = await probeSocketLiveness(liveSock);
		eq("integration: listening socket → alive", live, "alive");
		eq("integration: alive socket survives GC", shouldUnlinkOnGc(live), false);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	// (b) nonexistent path → dead → eligible for GC
	const dead = await probeSocketLiveness(goneSock);
	eq("integration: nonexistent path → dead", dead, "dead");
	eq("integration: dead path is GC-eligible", shouldUnlinkOnGc(dead), true);

	await fs.rm(dir, { recursive: true, force: true });
}

await integration();

console.log(`\ncheck-socket-probe: ${passed} assertions passed`);
