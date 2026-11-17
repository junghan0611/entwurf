/**
 * renew-admission — what a session switch target is to the /renew lineage (#151 b3; C1.4c D2,
 * C1.4e D2, C1.4j).
 *
 * Read only. Given the target of a `session_before_switch` (resume / import), decide from the
 * certified store whether switching there would reopen a protected chapter:
 *   - its header names a CLOSED chapter's native id, or a RESERVED `renewing.to` (a copy under
 *     another inode is caught here);
 *   - it is the very file (dev/ino) of a closed chapter's original (a path alias or hard link);
 *   - it cannot be identified (absent — an import's destination before the copy —, not regular,
 *     no session header) while the store holds any closed or reserved claim: unknown is never read
 *     as "not protected".
 * With no closed or reserved claim anywhere, an unidentified target cannot be a copy of one, and
 * passes; a store that does not exist certifies as empty, so a Pi that never used Entwurf passes.
 * An absent target or original (ENOENT/ENOTDIR) is an expected absence; every other I/O error is
 * thrown, never read as "no match" — the caller's admission turns it into a cancel. The caller turns every refusal — and every error, including a store defect — into a
 * `{ cancel: true }` (C1.4c D3): Pi carries on after a throwing before-handler.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	activeStoreRefusal,
	certifyActiveStoreDir,
	defaultMetaSessionsDir,
	MetaRecordError,
	readAddressableMetaIdentity,
} from "./meta-session.ts";
import { isAbsence, readSessionHeaderIdentity } from "./renew-writer.ts";

export type SwitchTargetVerdict =
	| { kind: "pass" }
	| {
			kind: "cancel";
			code:
				| "renew-admission-closed-chapter"
				| "renew-admission-reserved-to"
				| "renew-admission-closed-original"
				| "renew-admission-target-unidentifiable";
			detail: string;
	  };

export function classifySwitchTarget(targetFile: string, sessionsDir?: string): SwitchTargetVerdict {
	const dir = path.resolve(sessionsDir ?? defaultMetaSessionsDir());
	const cert = certifyActiveStoreDir(dir);
	if (cert.defects.length > 0) throw new MetaRecordError(activeStoreRefusal(cert));
	const closed = new Map<string, string>(); // closed native id → garden
	const reserved = new Map<string, string>(); // reserved next native id → garden
	const originals: { garden: string; file: string }[] = [];
	for (const { identity } of cert.records) {
		for (const c of identity.chapters ?? []) {
			closed.set(c.nativeSessionId, identity.gardenId);
			if (c.transcriptPath !== null) originals.push({ garden: identity.gardenId, file: c.transcriptPath });
		}
		if (identity.renewing?.to) reserved.set(identity.renewing.to, identity.gardenId);
	}
	const target = readSessionHeaderIdentity(targetFile);
	if (target !== null) {
		const closedOf = closed.get(target.id);
		if (closedOf !== undefined) {
			return {
				kind: "cancel",
				code: "renew-admission-closed-chapter",
				detail: `${targetFile} is a session of ${target.id}, a closed chapter of garden ${closedOf}`,
			};
		}
		const reservedOf = reserved.get(target.id);
		if (reservedOf !== undefined) {
			return {
				kind: "cancel",
				code: "renew-admission-reserved-to",
				detail: `${targetFile} is a session of ${target.id}, reserved as the next chapter of garden ${reservedOf}`,
			};
		}
	}
	const targetInode = target ?? statIdentity(targetFile);
	for (const o of originals) {
		let st: fs.Stats;
		try {
			st = fs.statSync(o.file);
		} catch (err) {
			if (isAbsence(err)) continue; // a closed original that is gone has no inode to match
			throw err; // any other stat error is not a non-match: the caller cancels on it
		}
		if (targetInode !== null && targetInode.dev === st.dev && targetInode.ino === st.ino) {
			return {
				kind: "cancel",
				code: "renew-admission-closed-original",
				detail: `${targetFile} is the original of a closed chapter of garden ${o.garden}`,
			};
		}
	}
	if (target === null && closed.size + reserved.size > 0) {
		return {
			kind: "cancel",
			code: "renew-admission-target-unidentifiable",
			detail: `${targetFile} cannot be identified, and this store holds closed or reserved chapters it could be a copy of`,
		};
	}
	return { kind: "pass" };
}

/** dev/ino of an existing target whose header could not be read; null when it does not exist.
 * Any other stat error is thrown. */
function statIdentity(file: string): { dev: number; ino: number } | null {
	try {
		const st = fs.statSync(file);
		return { dev: st.dev, ino: st.ino };
	} catch (err) {
		if (isAbsence(err)) return null;
		throw err;
	}
}

/** Is this garden's record mid-/renew? Read through the addressable reader; it throws on a store
 * defect, which the caller turns into a cancel like every other admission error. */
export function isRenewing(gardenId: string, sessionsDir?: string): boolean {
	return readAddressableMetaIdentity(gardenId, sessionsDir ?? defaultMetaSessionsDir()).renewing !== undefined;
}
