/**
 * record-arm-lock — the one way a record writer holds its garden's record-arm lock (#151 b1/b2).
 *
 * The per-garden lock the Claude Code hook and the pi-durable birth already take (#147 L2 B1),
 * held by every write to an existing record: the pi birth's attach and each step of the /renew
 * writer. The lock dir comes from `resolveRecordArmLocksDir` (meta-session.ts), one rule for every
 * writer. A hold is ONE synchronous section — re-read, compare, rename — never across an await.
 *
 * Outcomes, each by name: a lock held by someone else is `RecordArmLockBusyError` and nothing is
 * written; the lock primitive's own throw propagates as itself (it is not busy); a write that
 * fails is thrown as itself, or — when the release then throws too — as one AggregateError whose
 * message carries both causes, the garden and the lock; a release that throws after a successful
 * write is `RecordArmLockReleaseError`, which keeps what was written. A release that finds the lock
 * `absent` or `not-owned` is returned as that outcome: it is NOT evidence this call's lock was
 * released normally, and nothing else is removed or retried.
 */
import { acquireLock, type LockClaim, type ReleaseResult, releaseLock } from "./entwurf-v2-lock.ts";

/** The same bounds the Claude Code hook uses for an arm-capable event. */
export const ARM_LOCK_WAIT_MS = 2_000;
const ARM_LOCK_POLL_MS = 25;

/** `"bounded"` polls up to {@link ARM_LOCK_WAIT_MS}; `"once"` makes one attempt. */
export type ArmLockWait = "bounded" | "once";

/** TEST-ONLY seam (the lock primitive's `_test_*` precedent): called inside the lock, right before
 * the write and right after it returns, with the held lock's path. Never set outside a gate. */
export interface LockedWriteSeam {
	before?: (lockPath: string) => void;
	after?: (lockPath: string) => void;
}

/** The record-arm lock for this garden was held by someone else; nothing was written. */
export class RecordArmLockBusyError extends Error {
	readonly code = "record-arm-lock-busy";
	readonly gardenId: string;
	readonly detail: string;
	constructor(gardenId: string, detail: string) {
		super(`record-arm lock busy for garden ${gardenId}; nothing was written (${detail})`);
		this.name = "RecordArmLockBusyError";
		this.gardenId = gardenId;
		this.detail = detail;
	}
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The record WAS written, and then its record-arm lock could not be released. The write stands
 * (`written`). The lock file names this live process, so a later writer of this garden sees it
 * held until this process exits (stale reclaim needs the holder gone).
 */
export class RecordArmLockReleaseError<T = unknown> extends Error {
	readonly code = "record-arm-lock-release-failed";
	readonly written: T;
	constructor(gardenId: string, lockPath: string, written: T, what: string, cause: unknown) {
		super(
			`the record for garden ${gardenId} was written (${what}), but its record-arm lock ${lockPath} was not ` +
				`released: ${messageOf(cause)}`,
			{ cause },
		);
		this.name = "RecordArmLockReleaseError";
		this.written = written;
	}
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Take the lock: one attempt or a bounded poll. A busy lock throws the named error; a throw
 * from the primitive (its claim could not be written) is NOT busy and propagates as itself. */
function takeArmLock(gardenId: string, dir: string, wait: ArmLockWait): LockClaim {
	const deadline = Date.now() + (wait === "bounded" ? ARM_LOCK_WAIT_MS : 0);
	for (;;) {
		const acquired = acquireLock(gardenId, { dir });
		if (acquired.ok) return acquired.claim;
		if (Date.now() >= deadline) throw new RecordArmLockBusyError(gardenId, acquired.conflict.detail);
		sleepSync(ARM_LOCK_POLL_MS);
	}
}

/**
 * Run one synchronous record write under this garden's record-arm lock. `write` must not return a
 * promise: the hold is one synchronous section, and a returned promise is a thrown error (the lock is
 * released), never a write this helper vouches for. Refusing it does not cancel that promise: an
 * async callback's own continuation is not stopped here — an unsupported return is reported, not
 * contained. `describeWritten` names what was written for the
 * one message that has to say so (a release that throws after the write).
 */
export function withRecordArmLock<T>(
	gardenId: string,
	dir: string,
	wait: ArmLockWait,
	write: () => T,
	opts: { describeWritten: (written: T) => string; seam?: LockedWriteSeam },
): { written: T; release: ReleaseResult } {
	const claim = takeArmLock(gardenId, dir, wait);
	let written: T;
	try {
		opts.seam?.before?.(claim.lockPath);
		written = write();
		if (typeof (written as { then?: unknown } | null | undefined)?.then === "function") {
			throw new Error(
				`a record-arm lock write must be synchronous; the write for garden ${gardenId} returned a promise`,
			);
		}
		opts.seam?.after?.(claim.lockPath);
	} catch (err) {
		try {
			releaseLock(claim, { dir });
		} catch (releaseErr) {
			throw new AggregateError(
				[err, releaseErr],
				`the record write for garden ${gardenId} did not complete (${messageOf(err)}), and its record-arm lock ` +
					`${claim.lockPath} was not released (${messageOf(releaseErr)})`,
			);
		}
		throw err;
	}
	let release: ReleaseResult;
	try {
		release = releaseLock(claim, { dir });
	} catch (releaseErr) {
		throw new RecordArmLockReleaseError(gardenId, claim.lockPath, written, opts.describeWritten(written), releaseErr);
	}
	return { written, release };
}
