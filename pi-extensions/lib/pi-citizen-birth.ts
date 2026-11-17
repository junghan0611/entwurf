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
import type { ReleaseResult } from "./entwurf-v2-lock.ts";
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
import { type LockedWriteSeam, withRecordArmLock } from "./record-arm-lock.ts";

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
	/** TEST-ONLY seam (record-arm-lock.ts `LockedWriteSeam`). Never set outside a gate. */
	_test_lockedWrite?: LockedWriteSeam;
	/** control-socket dir. Caller policy (pi side: HOME-derived `ENTWURF_DIR`). */
	controlSocketDir: string;
	now?: Date;
}

export { ARM_LOCK_WAIT_MS, RecordArmLockBusyError, RecordArmLockReleaseError } from "./record-arm-lock.ts";

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
		const locked = withRecordArmLock(
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
			{ describeWritten: (w) => `${w.action}, ${w.path}`, seam: input._test_lockedWrite },
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
