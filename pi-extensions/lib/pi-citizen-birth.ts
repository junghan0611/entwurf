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
 */

import { controlSocketPathIn } from "./control-socket-path.js";
import { type MetaIdentity, type UpsertAction, upsertMetaSession } from "./meta-session.ts";

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
	/** control-socket dir. Caller policy (pi side: HOME-derived `ENTWURF_DIR`). */
	controlSocketDir: string;
	now?: Date;
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
}

/**
 * Upsert this pi session's meta-record and derive its control-socket address.
 *
 * Throws (never warns) on a store the V3 reader refuses, a duplicate
 * `nativeSessionId`, or a backend drift — a pi resident whose address cannot be
 * established must not stand a socket up under a guessed id. The caller escalates:
 * refuse the control server, no `PI_SESSION_ID` leak, loud stderr.
 */
export function birthPiCitizen(input: PiCitizenBirthInput): PiCitizenBirth {
	const result = upsertMetaSession({
		input: {
			backend: "pi",
			nativeSessionId: input.nativeSessionId,
			cwd: input.cwd,
			model: input.model,
			transcriptPath: input.transcriptPath,
		},
		dir: input.sessionsDir,
		now: input.now,
	});
	return {
		gardenId: result.record.gardenId,
		action: result.action,
		record: result.record,
		recordPath: result.path,
		socketPath: controlSocketPathIn(input.controlSocketDir, result.record.gardenId),
	};
}
