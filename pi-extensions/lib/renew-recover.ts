/**
 * renew-recover — the explicit OFFLINE recovery of a /renew whose owner process is gone (#151;
 * GLG 2026-11-17 "박살나면 옆에 에이전트한테 고쳐달라고 하면된다. 허나 최소수습하는것을 넣자",
 * SOL design read 10:58Z, contract C1.4o). A human names the garden; nothing here runs on its own,
 * watches, retries or launches anything.
 *
 *   status    read only: what the record says and whether its owner is proven gone
 *   continue  `renewing.to` is reserved: the named file must be that chapter's session file, its
 *             header naming `to`, its first user message exactly the record's agreed body and no
 *             other copy. Then the mark is handed over (adoptRenewOwner) and the SAME commit runs.
 *             No append. The record now names `to`; Pi is NOT opened — the human opens that file
 *             with Pi, and the address and first input are checked there, separately.
 *   abort     `renewing.to` is null: the agreed body is first saved to a NEW file the human names
 *             and read back against the record's sha, and the leaving chapter's original must still
 *             read as that chapter; only then the mark is handed over and the SAME clear runs. The
 *             clear drops the record's only copy of the body, which is why the save comes first.
 *             A later /renew is a new show and confirm, never a reuse of the old one.
 *
 * A hand-over whose exclusion is not proven (release not `released`) stops before the commit or
 * the clear. After the commit or the clear the release is reported beside the write, as the
 * transition does. A refusal leaves the RECORD as it was; an abort's save file is a separate thing
 * — a refusal names it when one was written (`saved`, verified or not), and it is never deleted or
 * retried. A stop after the hand-over carries what the record says NOW (`record`, `ownerPid`, read
 * back), never an assumed result: it may already be committed or open.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	classifyMarkerOwner,
	defaultMetaSessionsDir,
	type MarkerOwnerFacts,
	type MetaIdentity,
	probePidExistence,
	processStartKey,
	type RenewOwner,
	readAddressableMetaIdentity,
} from "./meta-session.ts";
import { type LockedWriteSeam, RecordArmLockReleaseError } from "./record-arm-lock.ts";
import { checkNewChapterFile } from "./renew-transition.ts";
import {
	adoptRenewOwner,
	type ClosedChapterProtection,
	classifyRenewRecord,
	clearRenewStart,
	commitRenew,
	type RenewRecordState,
	RenewWriteRefusal,
	readSessionHeaderIdentity,
} from "./renew-writer.ts";

export type RecoverPlan =
	| { kind: "status" }
	| { kind: "continue"; file: string }
	| { kind: "abort"; saveOutline: string };

export interface RecoverInput {
	gardenId: string;
	plan: RecoverPlan;
	sessionsDir?: string;
	recordArmLocksDir?: string;
	/** TEST-ONLY seams, passed through to the writer. */
	_test_lockedWrite?: LockedWriteSeam;
	_test_ownerFacts?: (owner: RenewOwner) => MarkerOwnerFacts;
}

export type RecoverOutcome =
	| {
			kind: "status";
			from: string;
			to: string | null;
			token8: string;
			owner: { pid: number; verdict: string };
			outlineSha8: string;
			outlineBytes: number;
	  }
	| { kind: "refused"; code: string; detail: string; saved?: SavedOutline }
	| {
			kind: "stopped";
			code: string;
			detail: string;
			record: RenewRecordState;
			ownerPid: number | null;
			saved?: SavedOutline;
	  }
	| { kind: "continued"; to: string; file: string; protection: string; notes: string[] }
	| { kind: "aborted"; from: string; savedAt: string; notes: string[] };

/** An abort's save file, once one exists: read back and matched, or not (left as it is). */
export interface SavedOutline {
	path: string;
	state: "verified" | "unverified";
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The reserved chapter's file, checked strictly: regular, header `to`, body first and once. */
function checkReservedFile(file: string, to: string, body: string): string | null {
	if (!path.isAbsolute(file)) return `${file} is not an absolute path`;
	try {
		const header = readSessionHeaderIdentity(file); // regular file only, never waits on a FIFO
		if (header?.id !== to) return `${file} does not carry the session header of ${to}`;
		const checked = checkNewChapterFile(file, to, body);
		return checked.ok ? null : checked.reason;
	} catch (err) {
		return `${file} could not be read: ${messageOf(err)}`; // an I/O error is a failed check, never a throw
	}
}

export function recoverRenew(o: RecoverInput): RecoverOutcome {
	const sessionsDir = o.sessionsDir ?? defaultMetaSessionsDir();
	let identity: MetaIdentity;
	try {
		identity = readAddressableMetaIdentity(o.gardenId, sessionsDir);
	} catch (err) {
		return { kind: "refused", code: "record-unreadable", detail: messageOf(err) };
	}
	const r = identity.renewing;
	if (r === undefined) return { kind: "refused", code: "not-renewing", detail: "the record is not mid-/renew" };
	const facts = o._test_ownerFacts?.(r.owner) ?? {
		currentStartKey: processStartKey(r.owner.pid),
		pidExists: probePidExistence(r.owner.pid),
	};
	const verdict = classifyMarkerOwner(r.owner.startKey, facts);
	if (o.plan.kind === "status") {
		return {
			kind: "status",
			from: r.from,
			to: r.to,
			token8: r.token.slice(0, 8),
			owner: { pid: r.owner.pid, verdict },
			outlineSha8: r.outlineSha.slice(0, 8),
			outlineBytes: Buffer.byteLength(r.outline, "utf8"),
		};
	}
	if (verdict !== "dead") {
		return { kind: "refused", code: "owner-not-dead", detail: `the recorded owner pid ${r.owner.pid} is ${verdict}` };
	}
	const writer = {
		gardenId: o.gardenId,
		token: r.token,
		sessionsDir: o.sessionsDir,
		recordArmLocksDir: o.recordArmLocksDir,
		_test_lockedWrite: o._test_lockedWrite,
	};
	const plan = o.plan;
	let saved: SavedOutline | undefined;
	/** A stop after the hand-over: what the record says now, read back. */
	const stopped = (code: string, detail: string): RecoverOutcome => {
		let ownerPid: number | null = null;
		try {
			ownerPid = readAddressableMetaIdentity(o.gardenId, sessionsDir).renewing?.owner.pid ?? null;
		} catch {
			ownerPid = null;
		}
		const record = classifyRenewRecord({
			gardenId: o.gardenId,
			token: r.token,
			from: r.from,
			outlineSha: r.outlineSha,
			sessionsDir: o.sessionsDir,
		});
		return { kind: "stopped", code, detail, record, ownerPid, ...(saved === undefined ? {} : { saved }) };
	};

	if (plan.kind === "continue") {
		if (r.to === null) {
			return { kind: "refused", code: "unreserved", detail: "nothing is reserved; this attempt can only be aborted" };
		}
		const to = r.to;
		const before = checkReservedFile(plan.file, to, r.outline);
		if (before !== null) return { kind: "refused", code: "file-unverified", detail: before };
		const taken = handOver(r.from, to);
		if (taken !== null) return taken;
		// The file once more, right before the commit (the commit does not read the new file's body).
		const again = checkReservedFile(plan.file, to, r.outline);
		if (again !== null) return stopped("file-changed", `after the hand-over: ${again}`);
		const notes: string[] = [];
		try {
			const c = commitRenew({
				...writer,
				from: r.from,
				to,
				expectedOutlineSha: r.outlineSha,
				newTranscriptPath: plan.file,
			});
			if (c.release !== "released") notes.push(`the commit's record-arm lock was ${c.release} at release`);
			return { kind: "continued", to, file: plan.file, protection: describe(c.protection), notes };
		} catch (err) {
			if (err instanceof RecordArmLockReleaseError) {
				notes.push(`the commit was written, but releasing its record-arm lock threw: ${messageOf(err.cause)}`);
				const w = err.written as { protection?: ClosedChapterProtection } | undefined;
				const protection = w?.protection === undefined ? "not observed by the caller" : describe(w.protection);
				return { kind: "continued", to, file: plan.file, protection, notes };
			}
			return stopped("commit-failed", `after the hand-over: ${messageOf(err)}`);
		}
	}

	// abort
	if (r.to !== null) {
		return {
			kind: "refused",
			code: "reserved",
			detail: `${r.to} is reserved; continue it with its file, never abort it`,
		};
	}
	if (!path.isAbsolute(plan.saveOutline)) {
		return { kind: "refused", code: "save-path-not-absolute", detail: plan.saveOutline };
	}
	const original = identity.transcriptPath;
	let originalReads: boolean;
	try {
		originalReads = original !== null && readSessionHeaderIdentity(original)?.id === r.from;
	} catch {
		originalReads = false;
	}
	if (!originalReads) {
		return {
			kind: "refused",
			code: "original-unverified",
			detail: `the leaving chapter's original ${original} does not read as ${r.from}`,
		};
	}
	try {
		fs.writeFileSync(plan.saveOutline, r.outline, { flag: "wx", mode: 0o600 });
		saved = { path: plan.saveOutline, state: "unverified" };
		const back = createHash("sha256").update(fs.readFileSync(plan.saveOutline, "utf8"), "utf8").digest("hex");
		if (back !== r.outlineSha)
			throw new Error(`the saved body reads back as ${back.slice(0, 8)}, not ${r.outlineSha.slice(0, 8)}`);
		saved = { path: plan.saveOutline, state: "verified" };
	} catch (err) {
		// A write that failed after creating the file may leave some bytes; EEXIST created nothing of ours.
		if (saved === undefined && (err as NodeJS.ErrnoException).code !== "EEXIST" && fs.existsSync(plan.saveOutline)) {
			saved = { path: plan.saveOutline, state: "unverified" };
		}
		return {
			kind: "refused",
			code: "outline-not-saved",
			detail: messageOf(err),
			...(saved === undefined ? {} : { saved }),
		};
	}
	const taken = handOver(r.from, null);
	if (taken !== null) return taken;
	const notes: string[] = [];
	try {
		const c = clearRenewStart({ ...writer, from: r.from });
		if (c.release !== "released") notes.push(`the clear's record-arm lock was ${c.release} at release`);
	} catch (err) {
		if (!(err instanceof RecordArmLockReleaseError)) {
			return stopped("clear-failed", `after the hand-over: ${messageOf(err)}`);
		}
		notes.push(`the clear was written, but releasing its record-arm lock threw: ${messageOf(err.cause)}`);
	}
	return { kind: "aborted", from: r.from, savedAt: plan.saveOutline, notes };

	/** The hand-over; null when it is proven, otherwise the outcome to stop on. */
	function handOver(from: string, to: string | null): RecoverOutcome | null {
		try {
			const a = adoptRenewOwner({ ...writer, from, to, _test_ownerFacts: o._test_ownerFacts });
			if (a.release === "released") return null;
			return stopped(
				"hand-over-exclusion-unproven",
				`the owner was handed over, but its record-arm lock was ${a.release} at release`,
			);
		} catch (err) {
			if (err instanceof RenewWriteRefusal) {
				return { kind: "refused", code: err.code, detail: err.message, ...(saved === undefined ? {} : { saved }) };
			}
			if (err instanceof RecordArmLockReleaseError) return stopped("hand-over-release-failed", err.message);
			return stopped("hand-over-error", messageOf(err)); // the write may or may not have landed: read back
		}
	}
}

function describe(p: ClosedChapterProtection): string {
	return p.kind === "write-bits-removed"
		? `write bits removed (${p.from.toString(8)} → ${p.to.toString(8)})`
		: `closed-chapter-not-write-protected: ${p.detail}`;
}
