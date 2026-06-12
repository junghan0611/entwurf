/**
 * entwurf-v2-lock — the per-gid dispatch lock primitive (0.11 Stage 0 step 5a,
 * 버킷 B F2). LOAD-BEARING: the guard against a double-spawn of the same dormant
 * target by two V2 dispatchers that share the substrate through different entry
 * points. SCOPE (honest): this protects v2/v2 only. The legacy `entwurf_resume`
 * is unchanged (동결결정 10 scope A) and does NOT take this lock, so v2/legacy
 * concurrent resume is a KNOWN residual gap (rare — single-orchestrator practice),
 * closed only at full cut-over. Do not read this header as "v2/legacy is guarded".
 *
 * ENVIRONMENT ASSUMPTION (stale reclaim): `hostname` equality is used as the
 * proxy for "same machine", so a holder pid is reclaim-probed with kill(0) only
 * when its hostname matches ours. This holds when `~/.pi` is NOT shared across
 * hosts. If two machines with the same hostname shared `~/.pi` over NFS, a remote
 * pid could be mis-judged ESRCH and a live remote lock wrongly reclaimed. GLG's
 * environment (laptop/nuc/oracle = distinct hostnames, non-shared homes) does not
 * hit this; documented so a future shared-home setup reopens the reclaim axis.
 *
 * Why a lockfile and not pi's own guard (검증원장 F2, source-verified): pi
 * `SessionManager._persist` only takes an `openSync(file,"wx")` on the FIRST
 * flush of a NEW session (session-manager.js:652/:1146 = a concurrent-CREATE
 * EEXIST guard). A v2 dispatch always RESUMES an existing citizen, and the
 * resume path (`setSessionFile` → flushed=true → plain `appendFileSync`, :664)
 * takes no lock — so pi does NOT self-guard concurrent resume. The per-gid
 * lockfile here is the only thing standing between two dispatchers and a
 * duplicated session.
 *
 * Invariants (source-verified, frozen — do NOT relax without reopening the
 * ledger):
 *  - acquire = `openSync(lockPath, "wx")` — an atomic, OS-level create-exclusive.
 *    The same primitive pi itself uses; no new direct dependency (proper-lockfile
 *    avoided — this is a short dispatch claim, not durable state).
 *  - acquire runs BEFORE any liveness probe (the decider's lock step precedes
 *    lstat/connect) — the probe must happen UNDER the lock or the TOCTOU it
 *    closes reopens.
 *  - release = unlink ONLY when the on-disk nonce is still ours. A reclaimed +
 *    re-acquired lock carries a different nonce, so a late release can never
 *    delete a successor's claim.
 *  - stale reclaim = SAME hostname AND `kill(pid,0) === ESRCH` ONLY. A TTL-only
 *    steal is forbidden (it would re-admit the double-spawn this primitive
 *    exists to prevent). EPERM (another user's LIVE pid) is fail-closed: NOT
 *    reclaimed (F2-P2 — the ESRCH-only branch is easy to drop, so the gate pins
 *    EPERM/unknown = not-reclaimed explicitly). A different hostname is never
 *    reclaimed (we cannot reason about a remote pid).
 *  - PID reuse → a permanently-held lock is the accepted cost of forbidding the
 *    TTL steal (workshop scale). It is made OBSERVABLE: a `target-locked`
 *    conflict carries the holder JSON (pid/host/createdAt/lockPath) so a human
 *    can clear it. An empty/corrupt lockfile (a crash between open-wx and write)
 *    surfaces through the SAME conflict path — never auto-deleted (it could be
 *    another acquirer mid-write).
 *
 * PURE of dispatch: this module knows nothing about transports, intents, or
 * liveness routing. It only claims/reclaims/releases a file and reports a
 * `target-locked` conflict. The decider (5b) decides WHETHER to lock (only for
 * an in-domain backend — ？7) and the watcher (5c) decides WHEN to release
 * (after an observable liveness transition — A2). Deps (clock / nonce / pid /
 * hostname / kill) are injectable so the gate drives content deterministically
 * over a real temp dir (the `openSync wx` atomicity is the thing under test, so
 * the dir is real, not faked).
 */

import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isValidSessionId } from "./session-id.js";

/** Canonical lock directory — a SEPARATE dir from the control sockets so the
 * socket scan (`*.sock`) never sees a `<gid>.lock` and so a lock is never
 * mistaken for a liveness signal. */
export const ENTWURF_V2_LOCK_DIR = path.join(os.homedir(), ".pi", "entwurf-v2-locks");
export const LOCK_SUFFIX = ".lock";
export const LOCK_OWNER = "entwurf_v2" as const;

/** The reject reason a lock conflict maps to. Kept as a literal here (the lock
 * primitive stays decoupled from the full contract); `check-entwurf-v2-lock`
 * cross-checks it against the contract's ENTWURF_V2_REJECT_REASONS so the two
 * cannot drift. */
export const LOCK_CONFLICT_REASON = "target-locked" as const;

/** The on-disk lock claim. `nonce` is the release authority (only the holder of
 * this exact nonce may unlink); `pid`+`hostname` are the stale-reclaim authority
 * (same host + ESRCH); `createdAt` is human-cleanup evidence only. */
export interface LockClaim {
	gardenId: string;
	pid: number;
	hostname: string;
	createdAt: string;
	nonce: string;
	owner: typeof LOCK_OWNER;
	lockPath: string;
}

/** A failed acquire: the target is already locked. `holder` is the parsed
 * existing claim (null when the lockfile is empty/corrupt — a crash window);
 * `detail` is the human-readable reason a person needs to clear it by hand. */
export interface LockConflict {
	reason: typeof LOCK_CONFLICT_REASON;
	lockPath: string;
	holder: LockClaim | null;
	detail: string;
}

export type AcquireLockResult = { ok: true; claim: LockClaim } | { ok: false; conflict: LockConflict };

export interface LockDeps {
	dir?: string;
	now?: () => string;
	nonce?: () => string;
	pid?: number;
	hostname?: string;
	/** `kill(pid, 0)` surface for stale reclaim — injected so the gate controls
	 * ESRCH / EPERM / alive without real processes. Default = `process.kill`. */
	killFn?: (pid: number, signal: 0) => void;
	/** TEST-ONLY seams to drive the reclaim critical section deterministically
	 * (simulate a competitor changing the lock under our reclaim mutex). Default
	 * undefined = noop in production; never set outside the gate. */
	_test_beforeReread?: () => void;
	_test_beforeRecreate?: () => void;
}

export type ProcessLiveness = "alive" | "dead" | "denied";

/**
 * Classify a holder pid for stale reclaim. ONLY `dead` (ESRCH) is reclaimable.
 * `denied` (EPERM = another user's live pid) and any unknown error fail-closed
 * to a non-reclaimable state — we never reclaim a lock we cannot prove is dead.
 */
export function classifyProcessLiveness(
	pid: number,
	killFn: (pid: number, signal: 0) => void = process.kill,
): ProcessLiveness {
	try {
		killFn(pid, 0);
		return "alive";
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return "dead";
		if (code === "EPERM") return "denied";
		// Unknown error: fail-closed — treat as not-dead so we never reclaim it.
		return "alive";
	}
}

export function lockPathFor(gardenId: string, dir: string = ENTWURF_V2_LOCK_DIR): string {
	// F2-P1 (defense in depth): never build a filesystem path from an unvalidated
	// gid. The decider validates first (its step 1), but the lock layer refuses to
	// be a path-traversal sink on its own — a bad gid throws, it does not write.
	if (!isValidSessionId(gardenId)) {
		throw new Error(
			`entwurf-v2-lock: refusing to build a lock path from an invalid garden id (${JSON.stringify(gardenId)}).`,
		);
	}
	return path.join(dir, `${gardenId}${LOCK_SUFFIX}`);
}

/**
 * Parse a lockfile's bytes into a claim, or null when empty/corrupt/wrong-gid.
 * When `expectedGardenId` is given, a well-formed claim whose `gardenId` does NOT
 * match is treated as null (→ conflict, never reclaimed): the path authority IS
 * the garden id (동결결정3), so a `<A>.lock` carrying `gardenId:B` is a corrupt
 * address, not a holder we may probe-and-reclaim by A's heuristic.
 */
function parseLockClaim(raw: string, lockPath: string, expectedGardenId?: string): LockClaim | null {
	let obj: unknown;
	try {
		obj = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof obj !== "object" || obj === null) return null;
	const o = obj as Record<string, unknown>;
	if (
		typeof o.gardenId !== "string" ||
		typeof o.pid !== "number" ||
		typeof o.hostname !== "string" ||
		typeof o.createdAt !== "string" ||
		typeof o.nonce !== "string" ||
		o.owner !== LOCK_OWNER
	) {
		return null;
	}
	if (expectedGardenId !== undefined && o.gardenId !== expectedGardenId) return null;
	return {
		gardenId: o.gardenId,
		pid: o.pid,
		hostname: o.hostname,
		createdAt: o.createdAt,
		nonce: o.nonce,
		owner: LOCK_OWNER,
		lockPath,
	};
}

/** Best-effort lockfile mtime (ISO) for human cleanup evidence — the ONLY age
 * signal when the body is empty/corrupt (createdAt is then unreadable). */
function lockMtimeIso(lockPath: string): string | null {
	try {
		return statSync(lockPath).mtime.toISOString();
	} catch {
		return null;
	}
}

function describeHolder(holder: LockClaim | null, lockPath: string): string {
	const mtime = lockMtimeIso(lockPath);
	const age = mtime ? ` (file mtime ${mtime})` : "";
	if (holder === null) {
		return `lockfile at ${lockPath} is empty, corrupt, or holds a different garden id${age}; clear it by hand after confirming no dispatcher is mid-spawn`;
	}
	return `held by pid ${holder.pid} on host ${holder.hostname} since ${holder.createdAt}${age} (${lockPath}); clear it by hand if that process is gone`;
}

/**
 * Acquire the per-gid dispatch lock. Returns the claim on success, or a
 * `target-locked` conflict (with the holder evidence) on contention. Stale reclaim
 * (same host + ESRCH) runs UNDER a `<gid>.lock.reclaim` wx mutex so two
 * dispatchers can never both reclaim the same dead lock (the F2 double-spawn race
 * GPT+Fable found). It never loops — a race lost on the re-acquire is an honest
 * conflict, not a spin.
 */
export function acquireLock(gardenId: string, deps: LockDeps = {}): AcquireLockResult {
	const dir = deps.dir ?? ENTWURF_V2_LOCK_DIR;
	const lockPath = lockPathFor(gardenId, dir); // validates gid (F2-P1)
	const reclaimMarkerPath = `${lockPath}.reclaim`;
	const pid = deps.pid ?? process.pid;
	const hostname = deps.hostname ?? os.hostname();
	const now = deps.now ?? (() => new Date().toISOString());
	const nonce = deps.nonce ?? (() => randomBytes(8).toString("hex"));
	const killFn = deps.killFn ?? process.kill;

	mkdirSync(dir, { recursive: true });

	const claim: LockClaim = {
		gardenId,
		pid,
		hostname,
		createdAt: now(),
		nonce: nonce(),
		owner: LOCK_OWNER,
		lockPath,
	};

	const conflict = (holder: LockClaim | null, detail?: string): AcquireLockResult => ({
		ok: false,
		conflict: { reason: LOCK_CONFLICT_REASON, lockPath, holder, detail: detail ?? describeHolder(holder, lockPath) },
	});

	const readHolder = (): LockClaim | null => {
		try {
			return parseLockClaim(readFileSync(lockPath, "utf8"), lockPath, gardenId);
		} catch {
			return null;
		}
	};

	// Create the lock and write the claim. On a write/close failure AFTER the wx
	// create, best-effort unlink our OWN fresh file before rethrowing — otherwise a
	// transient ENOSPC leaves an empty lockfile that permanently corrupt-conflicts
	// the gid (Fable 2 self-harm). The unlink is safe: we hold the file exclusively.
	const tryCreate = (): { ok: true } | { ok: false; code: string | undefined } => {
		let fd: number;
		try {
			fd = openSync(lockPath, "wx");
		} catch (err) {
			return { ok: false, code: (err as NodeJS.ErrnoException).code };
		}
		try {
			writeSync(fd, `${JSON.stringify(claim)}\n`);
		} catch (err) {
			try {
				closeSync(fd);
			} catch {
				/* fd may already be unusable */
			}
			try {
				unlinkSync(lockPath);
			} catch {
				/* best-effort; nothing else holds it */
			}
			throw new Error(
				`entwurf-v2-lock: failed to write claim to ${lockPath}: ${(err as NodeJS.ErrnoException).code ?? "unknown error"}`,
			);
		}
		closeSync(fd);
		return { ok: true };
	};

	const first = tryCreate();
	if (first.ok) return { ok: true, claim };
	if (first.code !== "EEXIST") {
		// A non-EEXIST failure (EACCES, ENOSPC, …) is not a lock conflict — it is a
		// real IO failure the caller must see, not a silent "locked".
		throw new Error(`entwurf-v2-lock: failed to acquire ${lockPath}: ${first.code ?? "unknown error"}`);
	}

	// EEXIST: a lock already exists. Read it and decide reclaim vs conflict.
	let holder: LockClaim | null;
	try {
		holder = parseLockClaim(readFileSync(lockPath, "utf8"), lockPath, gardenId);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// The holder released between our open-wx and our read — retry once.
			const retry = tryCreate();
			if (retry.ok) return { ok: true, claim };
			// Someone else re-grabbed it; report the actual winner (not "corrupt").
			return conflict(readHolder());
		}
		throw err;
	}

	// Empty/corrupt/wrong-gid lockfile → conflict (NEVER auto-deleted: could be
	// mid-write, and there is no dead pid to reclaim by).
	if (holder === null) return conflict(null);

	// Stale reclaim is allowed ONLY for our own host + a provably-dead pid (ESRCH).
	const reclaimable = holder.hostname === hostname && classifyProcessLiveness(holder.pid, killFn) === "dead";
	if (!reclaimable) return conflict(holder);

	// ── Reclaim under a wx mutex (closes the F2 two-reclaimer race) ────────────
	// The blind unlink this replaced could delete a SUCCESSOR's fresh lock: two
	// dispatchers read the same dead holder, the first reclaimed+recreated, the
	// second's unlink then deleted the first's new lock → both spawned. The mutex
	// serializes ALL would-be reclaimers (a fresh acquirer EEXISTs on the lock and
	// re-enters this same branch), so under it the stale lock cannot change; an
	// EEXIST on the marker is a fail-closed conflict (a permanent conflict is the
	// accepted worst case — same grade as a corrupt lockfile — never a double-spawn).
	let markerFd: number;
	try {
		markerFd = openSync(reclaimMarkerPath, "wx");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			return conflict(
				holder,
				`reclaim already in progress (or a stale reclaim marker at ${reclaimMarkerPath}); confirm no dispatcher is mid-reclaim, then clear it by hand`,
			);
		}
		throw err;
	}
	try {
		deps._test_beforeReread?.();
		// Re-read UNDER the mutex: the lock must still be the exact dead claim we
		// judged (Fable's nonce re-compare). If it changed (a normal release +
		// recreate — impossible for a dead holder, but cheap insurance) abort.
		const current = readHolder();
		if (current === null || current.nonce !== holder.nonce) return conflict(current);
		try {
			unlinkSync(lockPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
		deps._test_beforeRecreate?.();
		const reacquired = tryCreate();
		if (reacquired.ok) return { ok: true, claim };
		// A fresh acquirer slipped into the unlink→create gap — honest conflict.
		return conflict(readHolder());
	} finally {
		try {
			closeSync(markerFd);
		} catch {
			/* fd may already be unusable */
		}
		try {
			unlinkSync(reclaimMarkerPath);
		} catch {
			/* best-effort; a leftover marker just fail-closes the next reclaim */
		}
	}
}

export type ReleaseResult = "released" | "not-owned" | "absent";

/**
 * Release the lock — unlink ONLY when the on-disk nonce is still ours. A lock
 * that was reclaimed and re-acquired by a successor carries a different nonce, so
 * a late release returns `not-owned` and leaves the successor's claim intact. An
 * already-gone lock returns `absent`. This is the second half of the F2 guard:
 * without the nonce check a recycled pid or a stale watcher could delete a live
 * successor's lock.
 */
export function releaseLock(claim: LockClaim, deps: { dir?: string } = {}): ReleaseResult {
	const lockPath = claim.lockPath ?? lockPathFor(claim.gardenId, deps.dir);
	let onDisk: LockClaim | null;
	try {
		onDisk = parseLockClaim(readFileSync(lockPath, "utf8"), lockPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw err;
	}
	if (onDisk === null || onDisk.nonce !== claim.nonce) return "not-owned";
	try {
		unlinkSync(lockPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw err;
	}
	return "released";
}
