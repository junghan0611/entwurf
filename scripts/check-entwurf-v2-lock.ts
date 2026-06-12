/**
 * check-entwurf-v2-lock — deterministic gate for 0.11 Stage 0 step 5a (버킷 B F2):
 * the per-gid dispatch lock primitive. The lockfile is the ONLY guard against a
 * double-spawn of the same dormant target (pi self-guards CREATE but not RESUME,
 * 검증원장 F2), so this gate pins every invariant the ledger froze.
 *
 * Real temp dir (not faked): the `openSync(lockPath,"wx")` OS-level atomicity is
 * the thing under test, so the directory is real; only the CONTENT-shaping deps
 * (clock / nonce / pid / hostname / kill) are injected for determinism.
 *
 * Proves:
 *   - acquire writes a well-formed claim; a second acquire (no release) is a
 *     target-locked conflict (mutual exclusion), carrying the holder evidence.
 *   - release unlinks ONLY when the on-disk nonce is still ours: a successor's
 *     re-acquire (different nonce) survives a late release (not-owned); a gone
 *     lock is absent.
 *   - stale reclaim ONLY for same host + ESRCH; EPERM (other user's live pid),
 *     a different hostname, and an alive pid all fail-closed to conflict (the
 *     ESRCH-only branch is easy to drop — F2-P2 pins EPERM explicitly).
 *   - an empty/corrupt lockfile surfaces as a conflict (holder=null), never
 *     auto-deleted.
 *   - F2-P1: a malformed gid throws before any path is built (no traversal sink).
 *   - no drift: LOCK_CONFLICT_REASON is exactly the contract's target-locked.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ENTWURF_V2_REJECT_REASONS } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import {
	acquireLock,
	classifyProcessLiveness,
	LOCK_CONFLICT_REASON,
	LOCK_OWNER,
	type LockClaim,
	lockPathFor,
	releaseLock,
} from "../pi-extensions/lib/entwurf-v2-lock.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function eq(label: string, actual: unknown, expected: unknown): void {
	assert.deepStrictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID_A = "20260612T101010-aaaaaa";
const GID_B = "20260612T101010-bbbbbb";
const HOST = "test-host";

// Injected kill(pid,0) surfaces — the holder pid in these tests is a FAKE number,
// so the default `process.kill` must NOT be used (a fake pid usually reads ESRCH
// on the real host → would silently reclaim). Every acquire injects one of these.
const killers = {
	alive: () => {
		/* returns normally */
	},
	esrch: () => {
		const e = new Error("no such process") as NodeJS.ErrnoException;
		e.code = "ESRCH";
		throw e;
	},
	eperm: () => {
		const e = new Error("operation not permitted") as NodeJS.ErrnoException;
		e.code = "EPERM";
		throw e;
	},
	unknown: () => {
		const e = new Error("???") as NodeJS.ErrnoException;
		e.code = "EWHAT";
		throw e;
	},
};

let seq = 0;
function fixedDeps(over: Partial<Parameters<typeof acquireLock>[1]> = {}) {
	// distinct nonce per acquire (vary by index — Date.now/Math.random unavailable),
	// fixed clock + pid + hostname for content determinism. Default killFn = alive
	// so an existing holder is NOT spuriously reclaimed (reclaim tests override).
	seq += 1;
	const n = seq;
	return {
		now: () => "2026-06-12T00:00:00.000Z",
		nonce: () => `nonce-${n}`,
		pid: 4242,
		hostname: HOST,
		killFn: killers.alive,
		...over,
	};
}

function withTempDir(fn: (dir: string) => void): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-v2-lock-"));
	try {
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ── no drift: the conflict reason IS the contract's target-locked ──────────
eq("LOCK_CONFLICT_REASON === 'target-locked' (contract member)", LOCK_CONFLICT_REASON, "target-locked");
ok(
	"target-locked is in ENTWURF_V2_REJECT_REASONS (no drift)",
	(ENTWURF_V2_REJECT_REASONS as readonly string[]).includes(LOCK_CONFLICT_REASON),
);

// ── F2-P1: malformed gid throws before building a path ─────────────────────
for (const bad of ["", "../escape", "not-a-gid", "20260612T101010-AAAAAA", "20260612T101010-aaaaa"]) {
	assert.throws(() => lockPathFor(bad), /invalid garden id/, `lockPathFor('${bad}') throws`);
	console.log(`  ok    F2-P1: lockPathFor('${bad}') refuses to build a path`);
	passed++;
}
ok("F2-P1: a valid gid builds a <gid>.lock path", lockPathFor(GID_A, "/d").endsWith(`${GID_A}.lock`));

// ── classifyProcessLiveness: ESRCH=dead, EPERM=denied, ok=alive, unknown=alive ──
eq("classify: alive pid → alive", classifyProcessLiveness(1, killers.alive), "alive");
eq("classify: ESRCH → dead (reclaimable)", classifyProcessLiveness(1, killers.esrch), "dead");
eq("classify: EPERM → denied (NOT reclaimable, fail-closed)", classifyProcessLiveness(1, killers.eperm), "denied");
eq(
	"classify: unknown error → alive (fail-closed, never reclaim)",
	classifyProcessLiveness(1, killers.unknown),
	"alive",
);

// ── acquire writes a well-formed claim ─────────────────────────────────────
withTempDir((dir) => {
	const res = acquireLock(GID_A, fixedDeps({ dir }));
	ok("acquire: first acquire succeeds", res.ok === true);
	if (res.ok) {
		eq("acquire: claim.gardenId", res.claim.gardenId, GID_A);
		eq("acquire: claim.owner", res.claim.owner, LOCK_OWNER);
		eq("acquire: claim.pid", res.claim.pid, 4242);
		eq("acquire: claim.hostname", res.claim.hostname, HOST);
		ok("acquire: lockfile exists on disk", fs.existsSync(res.claim.lockPath));
		const onDisk = JSON.parse(fs.readFileSync(res.claim.lockPath, "utf8"));
		eq("acquire: on-disk nonce matches claim", onDisk.nonce, res.claim.nonce);
	}
});

// ── mutual exclusion: a second acquire without release = target-locked ─────
withTempDir((dir) => {
	const first = acquireLock(GID_A, fixedDeps({ dir }));
	ok("mutex: first acquire ok", first.ok === true);
	const second = acquireLock(GID_A, fixedDeps({ dir }));
	ok("mutex: second acquire (no release) = conflict", second.ok === false);
	if (!second.ok) {
		eq("mutex: conflict reason = target-locked", second.conflict.reason, "target-locked");
		ok("mutex: conflict carries holder evidence (F2-P2 human cleanup)", second.conflict.holder !== null);
		ok(
			"mutex: conflict.detail names pid + host",
			/pid 4242/.test(second.conflict.detail) && second.conflict.detail.includes(HOST),
		);
		if (first.ok && second.conflict.holder) {
			eq("mutex: holder nonce === first claim nonce", second.conflict.holder.nonce, first.claim.nonce);
		}
	}
	// a DIFFERENT gid is independent — no false conflict.
	const other = acquireLock(GID_B, fixedDeps({ dir }));
	ok("mutex: a different gid locks independently", other.ok === true);
});

// ── release: nonce-owned only ──────────────────────────────────────────────
withTempDir((dir) => {
	const a = acquireLock(GID_A, fixedDeps({ dir }));
	ok("release: acquired", a.ok === true);
	if (!a.ok) return;
	eq("release: nonce-owned unlink = released", releaseLock(a.claim), "released");
	ok("release: lockfile gone after release", !fs.existsSync(a.claim.lockPath));
	eq("release: releasing an already-gone lock = absent", releaseLock(a.claim), "absent");
	// after release the gid is free again.
	const b = acquireLock(GID_A, fixedDeps({ dir }));
	ok("release: gid re-acquirable after release", b.ok === true);
});

// ── release: a successor's claim (different nonce) survives a late release ──
withTempDir((dir) => {
	const stale = acquireLock(GID_A, fixedDeps({ dir }));
	ok("late-release: holder acquired", stale.ok === true);
	if (!stale.ok) return;
	// simulate the holder dying (same host) and a successor reclaiming:
	const successor = acquireLock(
		GID_A,
		fixedDeps({ dir, killFn: killers.esrch }), // the existing holder's pid reads ESRCH → reclaim
	);
	ok("late-release: successor reclaims a dead-pid lock", successor.ok === true);
	if (!successor.ok) return;
	ok("late-release: successor has a DIFFERENT nonce", successor.claim.nonce !== stale.claim.nonce);
	// the original holder's late release must NOT delete the successor's lock.
	eq("late-release: stale holder's release = not-owned (nonce mismatch)", releaseLock(stale.claim), "not-owned");
	ok("late-release: successor lock still present", fs.existsSync(successor.claim.lockPath));
	const onDisk: LockClaim | null = JSON.parse(fs.readFileSync(successor.claim.lockPath, "utf8"));
	eq("late-release: on-disk nonce is the successor's", onDisk?.nonce, successor.claim.nonce);
});

// ── stale reclaim policy: same host + ESRCH only ───────────────────────────
withTempDir((dir) => {
	// holder is on a DIFFERENT host → never reclaimed even if its pid looks dead.
	const remote = acquireLock(GID_A, fixedDeps({ dir, hostname: "other-host" }));
	ok("reclaim: remote-host holder acquired", remote.ok === true);
	const sameHostDeadPid = acquireLock(GID_A, fixedDeps({ dir, hostname: HOST, killFn: killers.esrch }));
	ok("reclaim: different hostname is NOT reclaimed (conflict) even with ESRCH", sameHostDeadPid.ok === false);
});
withTempDir((dir) => {
	// same host, but the holder pid is EPERM (another user's live pid) → fail-closed.
	const held = acquireLock(GID_A, fixedDeps({ dir }));
	ok("reclaim: holder acquired", held.ok === true);
	const epermContender = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.eperm }));
	ok("reclaim: EPERM holder is NOT reclaimed (fail-closed conflict)", epermContender.ok === false);
});
withTempDir((dir) => {
	// same host, holder pid still ALIVE → not reclaimed.
	const held = acquireLock(GID_A, fixedDeps({ dir }));
	ok("reclaim: holder acquired", held.ok === true);
	const aliveContender = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.alive }));
	ok("reclaim: live holder is NOT reclaimed (conflict)", aliveContender.ok === false);
});
withTempDir((dir) => {
	// same host + ESRCH → reclaimed.
	const dead = acquireLock(GID_A, fixedDeps({ dir }));
	ok("reclaim: dead holder acquired", dead.ok === true);
	const reclaimer = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch }));
	ok("reclaim: same host + ESRCH IS reclaimed (success)", reclaimer.ok === true);
});

// ── empty/corrupt lockfile → conflict, never auto-deleted ──────────────────
withTempDir((dir) => {
	const lockPath = lockPathFor(GID_A, dir);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(lockPath, ""); // crash between open-wx and write
	const res = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch }));
	ok("corrupt: empty lockfile → conflict (not reclaimed by pid heuristic)", res.ok === false);
	if (!res.ok) {
		eq("corrupt: holder is null (unparseable)", res.conflict.holder, null);
		ok("corrupt: detail flags empty/corrupt", /empty, corrupt/.test(res.conflict.detail));
		ok("corrupt: detail carries file mtime (only age signal when body unreadable)", /mtime/.test(res.conflict.detail));
	}
	ok("corrupt: lockfile NOT auto-deleted (could be mid-write)", fs.existsSync(lockPath));
});
withTempDir((dir) => {
	const lockPath = lockPathFor(GID_A, dir);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(lockPath, "{ not json"); // garbage
	const res = acquireLock(GID_A, fixedDeps({ dir }));
	ok("corrupt: garbage lockfile → conflict", res.ok === false);
	ok("corrupt: garbage lockfile preserved", fs.existsSync(lockPath));
});

// ── L3: gardenId mismatch (path authority = gid) → conflict, not reclaimed ──
withTempDir((dir) => {
	const lockPath = lockPathFor(GID_A, dir);
	fs.mkdirSync(dir, { recursive: true });
	// a <GID_A>.lock whose body claims gardenId GID_B — a corrupt address.
	const wrong = {
		gardenId: GID_B,
		pid: 4242,
		hostname: HOST,
		createdAt: "x",
		nonce: "n",
		owner: "entwurf_v2",
		lockPath,
	};
	fs.writeFileSync(lockPath, JSON.stringify(wrong));
	// even with a dead-pid heuristic, a mismatched gid must NOT be reclaimed.
	const res = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch }));
	ok("gid-mismatch: <A>.lock holding gardenId B → conflict", res.ok === false);
	if (!res.ok) eq("gid-mismatch: treated as corrupt (holder null)", res.conflict.holder, null);
	ok("gid-mismatch: lockfile preserved (not reclaimed)", fs.existsSync(lockPath));
});

// ── L1: reclaim under a wx mutex — closes the F2 two-reclaimer race ─────────
// (A) a pre-existing reclaim marker = a concurrent reclaimer mid-reclaim (or a
// stale marker) → the second reclaimer is excluded, fail-closed to conflict.
withTempDir((dir) => {
	const lockPath = lockPathFor(GID_A, dir);
	const held = acquireLock(GID_A, fixedDeps({ dir }));
	ok("reclaim-mutex: holder acquired", held.ok === true);
	fs.writeFileSync(`${lockPath}.reclaim`, ""); // a reclaimer already holds the mutex
	const second = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch }));
	ok("reclaim-mutex: marker present → second reclaimer excluded (conflict)", second.ok === false);
	if (!second.ok)
		ok("reclaim-mutex: detail flags reclaim-in-progress", /reclaim already in progress/.test(second.conflict.detail));
});
// (B) the dead lock CHANGES under the mutex (re-read nonce mismatch) → abort.
withTempDir((dir) => {
	const stale = acquireLock(GID_A, fixedDeps({ dir }));
	if (!stale.ok) return;
	const lockPath = stale.claim.lockPath;
	const competitor = { ...stale.claim, nonce: "competitor-nonce" };
	const swap = () => fs.writeFileSync(lockPath, JSON.stringify(competitor));
	const res = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch, _test_beforeReread: swap }));
	ok("reclaim-mutex: lock changed under mutex (re-read nonce mismatch) → abort conflict", res.ok === false);
});
// (C) a FRESH acquirer wins the unlink→create gap → we conflict, never clobber.
withTempDir((dir) => {
	const stale = acquireLock(GID_A, fixedDeps({ dir }));
	if (!stale.ok) return;
	const lockPath = stale.claim.lockPath;
	const fresh = {
		gardenId: GID_A,
		pid: 9,
		hostname: HOST,
		createdAt: "x",
		nonce: "fresh-F",
		owner: "entwurf_v2",
		lockPath,
	};
	const winGap = () => fs.writeFileSync(lockPath, JSON.stringify(fresh)); // F creates after our unlink
	const res = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch, _test_beforeRecreate: winGap }));
	ok("reclaim-mutex: gap-winner present → we conflict (no double-hold)", res.ok === false);
	const onDisk = JSON.parse(fs.readFileSync(lockPath, "utf8"));
	eq("reclaim-mutex: on-disk is the gap-winner's lock, never overwritten", onDisk.nonce, "fresh-F");
});
// (D) a clean reclaim leaves NO leftover marker (finally cleanup).
withTempDir((dir) => {
	const lockPath = lockPathFor(GID_A, dir);
	const stale = acquireLock(GID_A, fixedDeps({ dir }));
	ok("reclaim-mutex: stale holder acquired", stale.ok === true);
	const reclaimer = acquireLock(GID_A, fixedDeps({ dir, killFn: killers.esrch }));
	ok("reclaim-mutex: clean reclaim succeeds (same host + ESRCH)", reclaimer.ok === true);
	ok("reclaim-mutex: no leftover .reclaim marker after success", !fs.existsSync(`${lockPath}.reclaim`));
});

console.log(`\ncheck-entwurf-v2-lock: ${passed} assertions passed`);
