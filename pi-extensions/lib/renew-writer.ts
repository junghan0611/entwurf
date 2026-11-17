/**
 * renew-writer — the /renew transition writes on a pi record (#151 b2; contracts C1.4, C1.4a, C1.4b).
 *
 * Four conditional writes and one read. None is connected to the /renew command yet (b3 does that):
 *
 *   writeRenewStart   (step 1, K1)  open  → renewing { from, to: null, token, outlineSha, outline, owner, startedAt }
 *   reserveRenewTo    (step 3a)     renewing.to null → the next native id, before anything is appended
 *   clearRenewStart   (step 2)      renewing with to null → open again, for this token and owner only
 *   commitRenew       (step 5)      renewing with to reserved → current = to, chapters += from, outline replaced
 *   classifyRenewRecord             read only: open / renewing / renewing-other / committed / unknown
 *
 * What it keeps, in GLG's order: the same garden id (no write here mints one); the leaving chapter's
 * COORDINATES in the record (native id, original path, the model the record carried at close, the
 * original's first and last recorded times or null); and the agreed outline, byte for byte, as the
 * one latest edition. Coordinates are not memory: no original's content is copied into the record,
 * and of the original only its two end blocks are read — the header for its id and first time,
 * the last line for its last time — never the whole file and never a walk through its middle.
 *
 * Every write is ONE synchronous section under the garden's record-arm lock (record-arm-lock.ts,
 * one lock-namespace rule): re-read the certified store, compare every precondition, rename once. A
 * precondition that differs writes nothing and throws RenewWriteRefusal naming it. The owner is
 * compared with THIS process, recomputed (pid + processStartKey), so an old run cannot write over a
 * record another process now owns. What was written is the reader's own: the next record is parsed
 * by the V3 reader before it is renamed into place.
 *
 * Not here: no await, no retry, no rollback of a commit, and no reconstruction of an exclusion a
 * release could not prove — `release` is returned as the lock primitive answered. A re-read says
 * what is recorded; it does not restore a lost exclusion.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReleaseResult } from "./entwurf-v2-lock.ts";
import {
	activeStoreRefusal,
	atomicWriteIdentity,
	certifyActiveStoreDir,
	claimedNativeSessionIds,
	defaultMetaSessionsDir,
	isPlausibleOwnerPid,
	type MetaIdentity,
	MetaRecordError,
	metaRecordFilename,
	parseMetaRecordV3,
	processStartKey,
	type RenewChapter,
	type RenewingState,
	type RenewOwner,
	readAddressableMetaIdentity,
	renewOutlineSha,
	resolveRecordArmLocksDir,
	serializeMetaIdentity,
} from "./meta-session.ts";
import { type ArmLockWait, type LockedWriteSeam, withRecordArmLock } from "./record-arm-lock.ts";

export type RenewWriteRefusalCode =
	| "record-absent"
	| "not-pi"
	| "native-moved"
	| "already-renewing"
	| "not-renewing"
	| "from-mismatch"
	| "token-mismatch"
	| "owner-unprovable"
	| "owner-mismatch"
	| "precondition-failed"
	| "to-already-reserved"
	| "to-claimed"
	| "to-not-reserved"
	| "to-mismatch"
	| "outline-not-confirmed"
	| "outline-sha-mismatch"
	| "transcript-moved"
	| "original-unverified";

/** A /renew write whose precondition did not hold. Nothing was written. */
export class RenewWriteRefusal extends Error {
	readonly code: RenewWriteRefusalCode;
	readonly gardenId: string;
	constructor(code: RenewWriteRefusalCode, gardenId: string, detail: string) {
		super(`/renew write refused for garden ${gardenId} (${code}): ${detail}; nothing was written`);
		this.name = "RenewWriteRefusal";
		this.code = code;
		this.gardenId = gardenId;
	}
}

export interface RenewWriterTarget {
	gardenId: string;
	/** This renew's correlation token (32 lowercase hex), held in the caller's memory. */
	token: string;
	/** Store dir; the real store by default. A named store must name its lock dir too. */
	sessionsDir?: string;
	recordArmLocksDir?: string;
	/** Default `"bounded"`. */
	armLockWait?: ArmLockWait;
	now?: Date;
	/** TEST-ONLY (record-arm-lock.ts `LockedWriteSeam`). */
	_test_lockedWrite?: LockedWriteSeam;
}

export interface RenewWriteResult {
	record: MetaIdentity;
	recordPath: string;
	/** How the record-arm lock was released; only `"released"` is evidence of this call's own release. */
	release: ReleaseResult;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function refuse(code: RenewWriteRefusalCode, gardenId: string, detail: string): never {
	throw new RenewWriteRefusal(code, gardenId, detail);
}

/** This process as an owner, or null when it cannot be stated (an empty start key is unknown). */
function thisOwner(): RenewOwner | null {
	const pid = process.pid;
	const startKey = processStartKey(pid);
	return isPlausibleOwnerPid(pid) && startKey !== "" ? { pid, startKey } : null;
}

function requireThisOwner(gardenId: string): RenewOwner {
	return thisOwner() ?? refuse("owner-unprovable", gardenId, `pid ${process.pid} has no plausible owner identity`);
}

interface Certified {
	identity: MetaIdentity;
	file: string;
	all: readonly MetaIdentity[];
}

/** Read the certified store and this garden's record. Throws on a store defect, as every writer does. */
function readCertified(t: RenewWriterTarget): Certified {
	const dir = path.resolve(t.sessionsDir ?? defaultMetaSessionsDir());
	const cert = certifyActiveStoreDir(dir);
	if (cert.defects.length > 0) throw new MetaRecordError(activeStoreRefusal(cert));
	const hit = cert.records.find((r) => r.identity.gardenId === t.gardenId);
	if (hit === undefined) refuse("record-absent", t.gardenId, `no record for it in ${dir}`);
	return {
		identity: hit.identity,
		file: path.join(dir, metaRecordFilename(hit.identity)),
		all: cert.records.map((r) => r.identity),
	};
}

/** The renewing state of THIS renew, run by THIS process, leaving `from` — or a named refusal. */
function requireOwnRenewing(
	t: RenewWriterTarget,
	identity: MetaIdentity,
	from: string,
	owner: RenewOwner,
): RenewingState {
	const r = identity.renewing ?? refuse("not-renewing", t.gardenId, "the record is not mid-/renew");
	if (identity.nativeSessionId !== from || r.from !== from) {
		refuse(
			"from-mismatch",
			t.gardenId,
			`current ${identity.nativeSessionId}, renewing.from ${r.from}, expected ${from}`,
		);
	}
	if (r.token !== t.token) refuse("token-mismatch", t.gardenId, "renewing.token is another renew's");
	if (r.owner.pid !== owner.pid || r.owner.startKey !== owner.startKey) {
		refuse("owner-mismatch", t.gardenId, `renewing.owner is pid ${r.owner.pid}, this process is pid ${owner.pid}`);
	}
	return r;
}

/** Write what the V3 reader accepts, or nothing: the next record is parsed before it is renamed in. */
function writeRecord(t: RenewWriterTarget, file: string, next: MetaIdentity): MetaIdentity {
	const stamped: MetaIdentity = { ...next, recordUpdatedAt: (t.now ?? new Date()).toISOString() };
	const checked = parseMetaRecordV3(serializeMetaIdentity(stamped));
	atomicWriteIdentity(file, checked);
	return checked;
}

function underLock<T extends { record: MetaIdentity; recordPath: string }>(
	t: RenewWriterTarget,
	what: string,
	step: () => T,
): T & { release: ReleaseResult } {
	const dir = resolveRecordArmLocksDir({ sessionsDir: t.sessionsDir, recordArmLocksDir: t.recordArmLocksDir });
	const { written, release } = withRecordArmLock(t.gardenId, dir, t.armLockWait ?? "bounded", step, {
		describeWritten: (w) => `${what}, ${w.recordPath}`,
		seam: t._test_lockedWrite,
	});
	return { ...written, release };
}

/**
 * Step 1 (K1): mark the open record as leaving its current chapter, carrying the agreed outline
 * verbatim. `precondition` is the front gate's re-check against the real current branch (C1.4b D4,
 * 0→1); it runs INSIDE this locked section, right before the rename — the target lock the caller
 * holds does not lock the conversation. A throw from it is `precondition-failed`. It must be
 * synchronous: its type returns `undefined` (an async function does not fit), and a returned
 * promise is refused as `precondition-failed` rather than read as a pass — the lock is never held
 * across an await.
 */
export function writeRenewStart(
	t: RenewWriterTarget & { expectedNative: string; outline: string; precondition: () => undefined },
): RenewWriteResult {
	const owner = requireThisOwner(t.gardenId);
	return underLock(t, "renew start", () => {
		const { identity, file } = readCertified(t);
		if (identity.backend !== "pi") refuse("not-pi", t.gardenId, `backend is ${identity.backend}`);
		if (identity.nativeSessionId !== t.expectedNative) {
			refuse("native-moved", t.gardenId, `current is ${identity.nativeSessionId}, expected ${t.expectedNative}`);
		}
		if (identity.renewing !== undefined)
			refuse("already-renewing", t.gardenId, `renewing from ${identity.renewing.from}`);
		try {
			const returned: unknown = t.precondition();
			if (typeof (returned as { then?: unknown } | null | undefined)?.then === "function") {
				throw new Error("the re-check returned a promise; it must be synchronous");
			}
		} catch (err) {
			refuse("precondition-failed", t.gardenId, messageOf(err));
		}
		const renewing: RenewingState = {
			from: identity.nativeSessionId,
			to: null,
			token: t.token,
			outlineSha: renewOutlineSha(t.outline),
			outline: t.outline,
			owner,
			startedAt: (t.now ?? new Date()).toISOString(),
		};
		return { record: writeRecord(t, file, { ...identity, renewing }), recordPath: file };
	});
}

/**
 * Step 3a: reserve the next native id, before anything is appended to it. Only from `to: null`:
 * an already reserved `to` — the same id or another — is never moved and never answered as success,
 * so a caller can never take "already reserved" as leave to append (C1.4b D4). The id must not be
 * claimed by any record (current, closed chapter or reservation).
 */
export function reserveRenewTo(t: RenewWriterTarget & { from: string; to: string }): RenewWriteResult {
	const owner = requireThisOwner(t.gardenId);
	return underLock(t, "renew reserve", () => {
		const { identity, file, all } = readCertified(t);
		const r = requireOwnRenewing(t, identity, t.from, owner);
		if (r.to !== null) refuse("to-already-reserved", t.gardenId, `renewing.to is already ${r.to}`);
		if (all.some((rec) => claimedNativeSessionIds(rec).includes(t.to))) {
			refuse("to-claimed", t.gardenId, `native ${t.to} is already claimed in the store`);
		}
		return { record: writeRecord(t, file, { ...identity, renewing: { ...r, to: t.to } }), recordPath: file };
	});
}

/**
 * Step 2, a cancelled switch: drop this renew's mark. Only while nothing is reserved, and only for
 * this token and this owner. The caller's own observations come first and stay its job — the switch
 * returned `cancelled: true` (no teardown), its ctx is still `from`, and the control listener's
 * no-turn identity names `from`; any of those unknown, the caller does not call this.
 */
export function clearRenewStart(t: RenewWriterTarget & { from: string }): RenewWriteResult {
	const owner = requireThisOwner(t.gardenId);
	return underLock(t, "renew clear", () => {
		const { identity, file } = readCertified(t);
		const r = requireOwnRenewing(t, identity, t.from, owner);
		if (r.to !== null) refuse("to-already-reserved", t.gardenId, `renewing.to is ${r.to}; the mark is not cleared`);
		const { renewing: _left, ...open } = identity;
		return { record: writeRecord(t, file, open), recordPath: file };
	});
}

/** W2 after the commit: the write bits came off the leaving original, or did not. */
export type ClosedChapterProtection =
	| { kind: "write-bits-removed"; from: number; to: number }
	| { kind: "closed-chapter-not-write-protected"; detail: string };

export interface RenewCommitResult extends RenewWriteResult {
	protection: ClosedChapterProtection;
}

interface OpenedOriginal {
	fd: number;
	mode: number;
	startedAt: string | null;
	endedAt: string | null;
}

function timestampOf(line: string | null): string | null {
	if (line === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null; // a torn or foreign line: its time is not known, not invented
	}
	const ts = (parsed as { timestamp?: unknown } | null)?.timestamp;
	return typeof ts === "string" && ts !== "" && !Number.isNaN(Date.parse(ts)) ? ts : null;
}

/** A session header is a few hundred bytes; a first line longer than this is not a verified header. */
const HEADER_READ_LIMIT = 64 * 1024;
const TAIL_CHUNK = 64 * 1024;
const isBlankByte = (b: number): boolean => b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09;

/** The first line, read from offset 0 up to its newline and never past HEADER_READ_LIMIT; null
 * when no newline (or end of file) bounds it within that limit. Returns the line and where the
 * next line starts. */
function readHeaderLine(fd: number, size: number): { line: string; next: number } | null {
	const want = Math.min(size, HEADER_READ_LIMIT);
	const buf = Buffer.alloc(want);
	const got = fs.readSync(fd, buf, 0, want, 0);
	const head = buf.subarray(0, got);
	const nl = head.indexOf(0x0a);
	if (nl !== -1) return { line: head.subarray(0, nl).toString("utf8"), next: nl + 1 };
	return got === size ? { line: head.toString("utf8"), next: size } : null;
}

/** The last non-blank line at or after `start`, read BACKWARDS from the end in chunks until its
 * start is found. The file is never read whole and its middle is never walked: only the final
 * blocks, which may reach a little past the line's start (the boundary chunk), are read, and only
 * that line is interpreted. Null when there is no such line. */
function readLastLine(fd: number, size: number, start: number): string | null {
	let tail = Buffer.alloc(0);
	let pos = size;
	while (pos > start) {
		const len = Math.min(TAIL_CHUNK, pos - start);
		pos -= len;
		const chunk = Buffer.alloc(len);
		fs.readSync(fd, chunk, 0, len, pos);
		tail = Buffer.concat([chunk, tail]);
		let end = tail.length;
		while (end > 0 && isBlankByte(tail[end - 1] as number)) end--;
		if (end === 0) continue; // only blank bytes so far: the last line is further back
		const nl = tail.lastIndexOf(0x0a, end - 1);
		if (nl !== -1) return tail.subarray(nl + 1, end).toString("utf8");
		if (pos === start) return tail.subarray(0, end).toString("utf8");
	}
	return null;
}

/**
 * Open the leaving chapter's original once and keep the fd: it is the file whose header was
 * checked AND the file W2 protects (C1.4b D2). What this leaf verifies, and only this: the final
 * path component is not a symlink (O_NOFOLLOW), the open does not wait on a FIFO (O_NONBLOCK — a
 * FIFO is refused at fstat instead of blocking the event loop; this is not a time bound on every
 * filesystem or device), the fd is a regular file, and its first line is a session header naming
 * `from`. It reads the two end blocks (the header's up to 64 KiB, the last line's backwards in
 * 64 KiB chunks), interprets only the header line and the last non-blank line, and does not
 * validate the JSONL in between. A time that cannot be read is null; a failed path, type or
 * identity check is a refusal, never a null.
 */
function openOriginal(gardenId: string, file: string, from: string): OpenedOriginal {
	let fd: number;
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
	} catch (err) {
		refuse("original-unverified", gardenId, `cannot open ${file} read-only without following links: ${messageOf(err)}`);
	}
	try {
		const st = fs.fstatSync(fd);
		if (!st.isFile()) refuse("original-unverified", gardenId, `${file} is not a regular file`);
		const head = readHeaderLine(fd, st.size);
		let header: { type?: unknown; id?: unknown } | null = null;
		try {
			header = head === null ? null : (JSON.parse(head.line) as { type?: unknown; id?: unknown } | null);
		} catch {
			header = null;
		}
		if (head === null || header?.type !== "session" || header.id !== from) {
			refuse("original-unverified", gardenId, `the first line of ${file} is not a session header naming ${from}`);
		}
		return {
			fd,
			mode: st.mode & 0o7777,
			startedAt: timestampOf(head.line),
			endedAt: timestampOf(readLastLine(fd, st.size, head.next)),
		};
	} catch (err) {
		fs.closeSync(fd);
		throw err;
	}
}

/** ENOENT / ENOTDIR: the path is simply not there. Everything else is an error, not an absence. */
export function isAbsence(err: unknown): boolean {
	const code = (err as { code?: unknown } | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * A switch target's identity for admission (#151 b3, C1.4c D2 / C1.4e D2), read the way the
 * original leaf reads: opened read-only without waiting (O_NONBLOCK, so a FIFO is not waited on),
 * required to be a regular file, and only its first line (within the header limit) parsed — never
 * opened as a session. It follows a symlink: a target is judged by the file it is. Null when the
 * target is absent or is not identified by value (not a regular file, no session header): unknown,
 * never "not a protected file". Any other I/O error is thrown, never folded into that null.
 */
export function readSessionHeaderIdentity(file: string): { dev: number; ino: number; id: string } | null {
	let fd: number;
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
	} catch (err) {
		// An expected absence (an import's destination before its copy) is "not identified"; any other
		// I/O error is thrown, so the caller's admission turns it into a cancel (C1.4c D3).
		if (isAbsence(err)) return null;
		throw err;
	}
	try {
		const st = fs.fstatSync(fd);
		if (!st.isFile()) return null;
		const head = readHeaderLine(fd, st.size);
		if (head === null) return null;
		let header: { type?: unknown; id?: unknown } | null;
		try {
			header = JSON.parse(head.line) as { type?: unknown; id?: unknown } | null;
		} catch {
			return null;
		}
		return header?.type === "session" && typeof header.id === "string" && header.id !== ""
			? { dev: st.dev, ino: st.ino, id: header.id }
			: null;
	} finally {
		fs.closeSync(fd);
	}
}

/**
 * Step 5: commit. Under the lock the record must still be this renew's — same from, the reserved
 * `to`, token, this process as owner — and carry exactly the outline the human confirmed: its
 * `outlineSha` must equal the caller's bound `expectedOutlineSha` (`outline-not-confirmed`), which
 * is a different check from the body hashing to its own sha (`outline-sha-mismatch`); a record that
 * now holds another valid edition is never committed. One rename moves the current pointer to `to`, adds the leaving chapter's
 * coordinates once, and replaces the latest outline with the agreed body; `renewing` goes. Then,
 * still in the locked section, the write bits come off the leaving original through the fd its
 * header was read from (W2) — read bits are never widened. A W2 failure keeps the commit and is
 * named; a kill between the rename and the chmod leaves "committed, write protection unobserved".
 */
export function commitRenew(
	t: RenewWriterTarget & {
		from: string;
		to: string;
		/** The full sha256 the human confirmed and the caller bound (C1.3a §1.4); compared under the lock. */
		expectedOutlineSha: string;
		newTranscriptPath: string;
		/** TEST-ONLY: stands in for `fs.fchmodSync`. Never set outside a gate. */
		_test_fchmod?: (fd: number, mode: number) => void;
	},
): RenewCommitResult {
	const owner = requireThisOwner(t.gardenId);
	const before = readCertified(t).identity;
	const originalPath =
		before.transcriptPath ??
		refuse("original-unverified", t.gardenId, "the leaving chapter has no recorded transcript");
	const original = openOriginal(t.gardenId, originalPath, t.from);
	try {
		return underLock(t, "renew commit", () => {
			const { identity, file } = readCertified(t);
			const r = requireOwnRenewing(t, identity, t.from, owner);
			if (r.to === null) refuse("to-not-reserved", t.gardenId, "no next chapter is reserved");
			if (r.to !== t.to) refuse("to-mismatch", t.gardenId, `renewing.to is ${r.to}, expected ${t.to}`);
			if (r.outlineSha !== t.expectedOutlineSha) {
				refuse(
					"outline-not-confirmed",
					t.gardenId,
					`renewing.outlineSha ${r.outlineSha} is not the confirmed ${t.expectedOutlineSha}`,
				);
			}
			if (renewOutlineSha(r.outline) !== r.outlineSha) {
				refuse("outline-sha-mismatch", t.gardenId, "renewing.outline does not hash to renewing.outlineSha");
			}
			if (identity.transcriptPath !== originalPath) {
				refuse(
					"transcript-moved",
					t.gardenId,
					`the record's transcript is ${identity.transcriptPath}, opened ${originalPath}`,
				);
			}
			const chapter: RenewChapter = {
				nativeSessionId: t.from,
				transcriptPath: originalPath,
				model: identity.model ?? null,
				startedAt: original.startedAt,
				endedAt: original.endedAt,
			};
			const { renewing: _closed, ...rest } = identity;
			const next: MetaIdentity = {
				...rest,
				nativeSessionId: t.to,
				transcriptPath: t.newTranscriptPath,
				chapters: [...(identity.chapters ?? []), chapter],
				outline: { body: r.outline, sha: r.outlineSha, forNativeSessionId: t.to, writtenAt: r.startedAt },
			};
			const record = writeRecord(t, file, next);
			const target = original.mode & ~0o222;
			let protection: ClosedChapterProtection;
			try {
				(t._test_fchmod ?? fs.fchmodSync)(original.fd, target);
				protection = { kind: "write-bits-removed", from: original.mode, to: target };
			} catch (err) {
				protection = { kind: "closed-chapter-not-write-protected", detail: messageOf(err) };
			}
			return { record, recordPath: file, protection };
		});
	} finally {
		fs.closeSync(original.fd);
	}
}

export type RenewRecordState =
	| { state: "open" }
	| { state: "renewing"; to: string | null }
	| { state: "renewing-other" }
	| { state: "committed"; current: string }
	| { state: "unknown"; detail: string };

/**
 * Read only: what the record says now about a renew leaving `from` with `outlineSha`. "committed"
 * means a commit closed `from` with that outline — after a commit the token is gone, so it does not
 * prove which run committed. Anything else is "unknown", never guessed into open.
 */
export function classifyRenewRecord(opts: {
	gardenId: string;
	token: string;
	from: string;
	outlineSha: string;
	sessionsDir?: string;
}): RenewRecordState {
	let identity: MetaIdentity;
	try {
		identity = readAddressableMetaIdentity(opts.gardenId, opts.sessionsDir ?? defaultMetaSessionsDir());
	} catch (err) {
		return { state: "unknown", detail: messageOf(err) };
	}
	if (identity.renewing !== undefined) {
		return identity.renewing.token === opts.token
			? { state: "renewing", to: identity.renewing.to }
			: { state: "renewing-other" };
	}
	if (identity.nativeSessionId === opts.from) return { state: "open" };
	const last = identity.chapters?.at(-1);
	if (last?.nativeSessionId === opts.from && identity.outline?.sha === opts.outlineSha) {
		return { state: "committed", current: identity.nativeSessionId };
	}
	return {
		state: "unknown",
		detail: `current ${identity.nativeSessionId}, last chapter ${last?.nativeSessionId ?? "none"}`,
	};
}
