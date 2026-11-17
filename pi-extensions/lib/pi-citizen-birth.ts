/**
 * pi-citizen-birth — the pi SessionStart ATTACH seam (#50 C2).
 *
 * The one place a pi session becomes a garden citizen. Before this cut, a pi
 * resident WAS its address: the launcher injected `--session-id <gardenId>`, the
 * garden guard hard-exited anything else, and the control socket was keyed on
 * pi's own session id. That made two authorities out of one address — pi owned the
 * id, entwurf owned the garden — and every rail (socket key, resume target, sender
 * envelope) silently depended on them being the same string.
 *
 * After C2 there is ONE authority: the meta-record. pi mints whatever session id it
 * likes (a uuidv7 is now NORMAL, not a failure), the record mints the gardenId, and
 * `(backend:"pi", nativeSessionId)` is the join. LOCKED PROTOCOL 1 + 2: the record is
 * the garden address; pi owns its own id / filename / header / name / `/new` / `/resume`.
 *
 * ATTACH, NOT MINT-PER-START. `upsertMetaSession` decides create-vs-attach on record
 * EXISTENCE keyed by `nativeSessionId`, so re-opening the same pi session re-attaches
 * to the SAME gardenId. A re-open that produced a second gardenId would be a bug (a
 * citizen whose address moves under its peers), and `smoke-pi-attach` pins exactly that.
 *
 * The socket path is DERIVED here rather than by the caller so the record and the
 * address can never be computed from different inputs — the whole point of ②. Grammar
 * still comes from the `.js` leaf both runtime lanes share (`control-socket-path.js`);
 * this module owns only the choice of KEY (record gardenId, never the native id).
 *
 * Directory SOURCE stays the caller's policy (same rule as control-socket-path.js):
 * the pi adapter passes its HOME-derived roots, a gate passes temp dirs. This module
 * never reads the environment, so an isolated gate cannot leak into the live store.
 *
 * RECORD-ARM LOCK (#151 b1). Every write to an EXISTING record happens under the per-garden
 * record-arm lock the Claude Code hook and the pi-durable birth already take (#147 L2 B1), so an
 * ordinary refresh and the /renew writer serialize on one point: the garden id is learned by a
 * READ-ONLY certified lookup, the lock is taken, and the upsert re-reads under it and refuses
 * unless the record is still that garden's. A record found absent is published create-only, as
 * the hook does. A lock this call cannot take is the one named outcome, `RecordArmLockBusyError`,
 * and nothing is written; any other failure — the lock primitive's own, a store defect, a renew
 * boundary — is thrown as itself.
 */

import { controlSocketPathIn } from "./control-socket-path.js";
import { acquireLock, type LockClaim, type ReleaseResult, releaseLock } from "./entwurf-v2-lock.ts";
import {
	findCertifiedIdentityByNativeSessionId,
	type MetaIdentity,
	type MetaIdentityMintInput,
	resolveRecordArmLocksDir,
	type UpsertAction,
	UpsertActionMismatchError,
	type UpsertMetaSessionResult,
	upsertMetaSession,
} from "./meta-session.ts";

export interface PiCitizenBirthInput {
	/** pi's OWN session id (`ctx.sessionManager.getSessionId()`) — a uuidv7 in the
	 * normal case. It is the join key, never the address. */
	nativeSessionId: string;
	/** The live session cwd (header authority for a later resume). */
	cwd: string;
	/** `<provider>/<model>` once resolved. `undefined` KEEPS a previously recorded
	 * value (3-value merge) — a pre-model-resolution start must not wipe it. */
	model?: string | null;
	/** pi's session JSONL (`ctx.sessionManager.getSessionFile()`), the resume target.
	 * `undefined` before pi has written it — again, keep-not-clear. */
	transcriptPath?: string | null;
	/** meta-record store dir. Caller policy; defaults to the real store. */
	sessionsDir?: string;
	/** record-arm lock dir. Caller policy, resolved by `resolveRecordArmLocksDir`: the real lock
	 * dir by default, and REQUIRED whenever `sessionsDir` is given. */
	recordArmLocksDir?: string;
	/** `"bounded"` polls up to {@link ARM_LOCK_WAIT_MS} (session_start: the address must be
	 * established); `"once"` makes one attempt (a refresh, which may skip). Default bounded. */
	armLockWait?: "bounded" | "once";
	/** TEST-ONLY seam (the lock primitive's `_test_*` precedent): called inside the lock, right
	 * before the record write and right after it returns, with the held lock's path. Never set
	 * outside a gate. */
	_test_lockedWrite?: { before?: (lockPath: string) => void; after?: (lockPath: string) => void };
	/** control-socket dir. Caller policy (pi side: HOME-derived `ENTWURF_DIR`). */
	controlSocketDir: string;
	now?: Date;
}

/** The same bounds the Claude Code hook uses for an arm-capable event. */
export const ARM_LOCK_WAIT_MS = 2_000;
const ARM_LOCK_POLL_MS = 25;

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

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Take the lock: one attempt or a bounded poll. A busy lock throws the named error; a throw
 * from the primitive (its claim could not be written) is NOT busy and propagates as itself. */
function takeArmLock(gardenId: string, dir: string, wait: "bounded" | "once"): LockClaim {
	const deadline = Date.now() + (wait === "bounded" ? ARM_LOCK_WAIT_MS : 0);
	for (;;) {
		const acquired = acquireLock(gardenId, { dir });
		if (acquired.ok) return acquired.claim;
		if (Date.now() >= deadline) throw new RecordArmLockBusyError(gardenId, acquired.conflict.detail);
		sleepSync(ARM_LOCK_POLL_MS);
	}
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The record WAS written, and then its record-arm lock could not be released. The write stands
 * (`written`). The lock file names this live process, so a later writer of this garden sees it
 * held until this process exits (stale reclaim needs the holder gone).
 */
export class RecordArmLockReleaseError extends Error {
	readonly code = "record-arm-lock-release-failed";
	readonly written: UpsertMetaSessionResult;
	constructor(gardenId: string, lockPath: string, written: UpsertMetaSessionResult, cause: unknown) {
		super(
			`the record for garden ${gardenId} was written (${written.action}, ${written.path}), but its record-arm lock ` +
				`${lockPath} was not released: ${messageOf(cause)}`,
			{ cause },
		);
		this.name = "RecordArmLockReleaseError";
		this.written = written;
	}
}

/**
 * Attach under the lock. A release that throws is reported, never swallowed: a lock this live
 * process failed to unlink would hold every later write to this garden until the process exits.
 * A release that finds the lock `absent` or `not-owned` is NOT evidence this call's lock was
 * released normally — it is returned as the outcome it is, and nothing else is removed or retried.
 */
function attachUnderLock(
	gardenId: string,
	dir: string,
	wait: "bounded" | "once",
	attach: () => UpsertMetaSessionResult,
	seam: PiCitizenBirthInput["_test_lockedWrite"],
): { written: UpsertMetaSessionResult; release: ReleaseResult } {
	const claim = takeArmLock(gardenId, dir, wait);
	let written: UpsertMetaSessionResult;
	try {
		seam?.before?.(claim.lockPath);
		written = attach();
		seam?.after?.(claim.lockPath);
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
		throw new RecordArmLockReleaseError(gardenId, claim.lockPath, written, releaseErr);
	}
	return { written, release };
}

export interface PiCitizenBirth {
	/** The garden address. Minted by the record, NOT by pi. */
	gardenId: string;
	action: UpsertAction;
	record: MetaIdentity;
	/** Absolute path of the written record. */
	recordPath: string;
	/** `<controlSocketDir>/<gardenId>.sock` — the ONE address the socket may carry. */
	socketPath: string;
	/** How this call's record-arm lock was released: null when no lock was taken (a create),
	 * `"released"` for this call's own claim, or `"absent"` / `"not-owned"` — the lock was gone
	 * or someone else's when this call came to release it, so its exclusion is not proven. */
	armLockRelease: ReleaseResult | null;
}

/**
 * Upsert this pi session's meta-record and derive its control-socket address.
 *
 * Throws (never warns) on a store the V3 reader refuses — an unreadable record
 * anywhere in the store fails the strict upsert naming the fresh-cut command —
 * on a duplicate `nativeSessionId`, or a backend drift. A pi resident whose
 * address cannot be established must not stand a socket up under a guessed id.
 * The caller escalates: refuse the control server, no `PI_SESSION_ID` leak,
 * loud stderr.
 */
export function birthPiCitizen(input: PiCitizenBirthInput): PiCitizenBirth {
	const mint: MetaIdentityMintInput = {
		backend: "pi",
		nativeSessionId: input.nativeSessionId,
		cwd: input.cwd,
		model: input.model,
		transcriptPath: input.transcriptPath,
	};
	const locksDir = resolveRecordArmLocksDir({
		sessionsDir: input.sessionsDir,
		recordArmLocksDir: input.recordArmLocksDir,
	});
	const wait = input.armLockWait ?? "bounded";
	let existing = findCertifiedIdentityByNativeSessionId(input.nativeSessionId, input.sessionsDir);
	let result: UpsertMetaSessionResult | null = null;
	let armLockRelease: ReleaseResult | null = null;
	if (existing === null) {
		try {
			result = upsertMetaSession({ input: mint, expectAction: "create", dir: input.sessionsDir, now: input.now });
		} catch (err) {
			// Another writer published this native id's record in between: attach to it, locked.
			if (!(err instanceof UpsertActionMismatchError)) throw err;
			existing = findCertifiedIdentityByNativeSessionId(input.nativeSessionId, input.sessionsDir);
			if (existing === null) throw err;
		}
	}
	if (result === null && existing !== null) {
		const gardenId = existing.gardenId;
		const locked = attachUnderLock(
			gardenId,
			locksDir,
			wait,
			() =>
				upsertMetaSession({
					input: mint,
					expectAction: "attach",
					expectGardenId: gardenId,
					dir: input.sessionsDir,
					now: input.now,
				}),
			input._test_lockedWrite,
		);
		result = locked.written;
		armLockRelease = locked.release;
	}
	if (result === null) throw new Error("unreachable: pi birth wrote no record");
	return {
		gardenId: result.record.gardenId,
		action: result.action,
		record: result.record,
		recordPath: result.path,
		socketPath: controlSocketPathIn(input.controlSocketDir, result.record.gardenId),
		armLockRelease,
	};
}
