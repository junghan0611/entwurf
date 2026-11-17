/**
 * renew-writer — the /renew transition writes (#151 b2; C1.4, C1.4a, C1.4b).
 *
 * Production subject: the four conditional writes and the read in renew-writer.ts. Oracles are
 * independent of it: the record bytes on disk, the V3 reader's own reading of them, a sha256 taken
 * with node:crypto, the original's mode from stat, and the lock file seen on disk.
 *
 * GLG's order is the order of the cells that matter most: the same garden id; the leaving chapter's
 * coordinates in the record; the agreed outline byte for byte. Then the step preconditions (C1.4b
 * D4), W2, the read, and the lock.
 *
 * Isolation as in pi-citizen-birth.test.ts: every call names a throwaway store and lock dir, and
 * PI_CODING_AGENT_DIR points at a different throwaway root.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "./entwurf-v2-lock.ts";
import { processStartKey, readAddressableMetaIdentity } from "./meta-session.ts";
import { birthPiCitizen } from "./pi-citizen-birth.ts";
import { RecordArmLockBusyError } from "./record-arm-lock.ts";
import {
	adoptRenewOwner,
	classifyRenewRecord,
	clearRenewStart,
	commitRenew,
	RenewWriteRefusal,
	type RenewWriteRefusalCode,
	reserveRenewTo,
	writeRenewStart,
} from "./renew-writer.ts";

const SAVED = {
	agent: process.env.PI_CODING_AGENT_DIR,
	sessions: process.env.ENTWURF_META_SESSIONS_DIR,
	receivers: process.env.ENTWURF_META_RECEIVERS_DIR,
};
let root = "";
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "rw-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "env-agent");
	delete process.env.ENTWURF_META_SESSIONS_DIR;
	delete process.env.ENTWURF_META_RECEIVERS_DIR;
});
afterAll(() => {
	for (const [key, value] of [
		["PI_CODING_AGENT_DIR", SAVED.agent],
		["ENTWURF_META_SESSIONS_DIR", SAVED.sessions],
		["ENTWURF_META_RECEIVERS_DIR", SAVED.receivers],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(root, { recursive: true, force: true });
});

const N0 = "01900000-0000-7000-8000-0000000151c0";
const N1 = "01900000-0000-7000-8000-0000000151c1";
const N2 = "01900000-0000-7000-8000-0000000151c2";
const TOKEN = "c".repeat(32);
const OTHER_TOKEN = "d".repeat(32);
const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-01T01:00:00.000Z";
const T2 = "2026-11-01T02:00:00.000Z";
const K1_AT = new Date("2026-11-17T03:00:00.000Z");
const COMMIT_AT = new Date("2026-11-17T03:05:00.000Z");
/** The agreed body, with the guide sentence and non-ASCII bytes the record must carry exactly. */
const OUTLINE =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.\n" +
	`출발 장: ${N0}\n[1장] 함께 지나온 시간 — 끝 공백 없음, 줄 끝 그대로\n  들여쓴 줄\t탭`;
const FIFO_CHILD = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"test",
	"helpers",
	"renew-writer-fifo-child.mjs",
);
const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

let seq = 0;
interface Store {
	sessionsDir: string;
	locksDir: string;
	socketDir: string;
	base: string;
}
function store(): Store {
	const base = path.join(root, `s${++seq}`);
	fs.mkdirSync(base, { recursive: true });
	return {
		base,
		sessionsDir: path.join(base, "meta-sessions"),
		locksDir: path.join(base, "meta-record-arm-locks"),
		socketDir: path.join(base, "sockets"),
	};
}
function transcript(s: Store, name: string, lines: readonly string[]): string {
	const file = path.join(s.base, `${name}.jsonl`);
	fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
	return file;
}
const header = (id: string, ts: string | null = T0): string =>
	JSON.stringify({ type: "session", version: 3, id, ...(ts === null ? {} : { timestamp: ts }), cwd: "/tmp" });
const entry = (id: string, ts: string): string =>
	JSON.stringify({ type: "message", id, parentId: null, timestamp: ts });

/** A pi citizen on N0 whose record names an original with a header and two entries. */
function born(s: Store, lines?: readonly string[]): { gardenId: string; recordPath: string; original: string } {
	const original = transcript(s, "n0", lines ?? [header(N0), entry("e1", T1), entry("e2", T2)]);
	const b = birthPiCitizen({
		nativeSessionId: N0,
		cwd: "/tmp",
		model: "prov/model-a",
		transcriptPath: original,
		sessionsDir: s.sessionsDir,
		recordArmLocksDir: s.locksDir,
		controlSocketDir: s.socketDir,
	});
	return { gardenId: b.gardenId, recordPath: b.recordPath, original };
}
const at = (s: Store, gardenId: string, token = TOKEN) => ({
	gardenId,
	token,
	sessionsDir: s.sessionsDir,
	recordArmLocksDir: s.locksDir,
});
function start(s: Store, gardenId: string, precondition: () => undefined = () => undefined) {
	return writeRenewStart({ ...at(s, gardenId), now: K1_AT, expectedNative: N0, outline: OUTLINE, precondition });
}
function refusal(code: RenewWriteRefusalCode, fn: () => unknown): void {
	let caught: unknown = null;
	try {
		fn();
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(RenewWriteRefusal);
	expect((caught as RenewWriteRefusal).code).toBe(code);
}
const bytes = (file: string): Buffer => fs.readFileSync(file);

describe("/renew writer (#151 b2)", () => {
	it("[QK:RENEW-B2-START-WRITES-K1] step 1 marks the open record with this renew, this process and the agreed bytes, and keeps the garden", () => {
		const s = store();
		const { gardenId } = born(s);
		const out = start(s, gardenId);
		const onDisk = readAddressableMetaIdentity(gardenId, s.sessionsDir);
		expect(onDisk.gardenId).toBe(gardenId);
		expect(onDisk.nativeSessionId).toBe(N0);
		expect(onDisk.renewing).toEqual({
			from: N0,
			to: null,
			token: TOKEN,
			outlineSha: sha256(OUTLINE),
			outline: OUTLINE,
			owner: { pid: process.pid, startKey: processStartKey(process.pid) },
			startedAt: K1_AT.toISOString(),
		});
		expect(out.release).toBe("released");
	});

	it("[QK:RENEW-B2-START-PRECONDITION-IN-SECTION] the front gate's re-check runs inside the locked section, and its failure writes nothing", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const lockPath = path.join(s.locksDir, `${gardenId}.lock`);
		const seen: Array<number | null> = [];
		start(s, gardenId, () => {
			seen.push(
				fs.existsSync(lockPath) ? (JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid: number }).pid : null,
			);
		});
		expect(seen).toEqual([process.pid]);
		const s2 = store();
		const two = born(s2);
		const before = bytes(two.recordPath);
		refusal("precondition-failed", () =>
			start(s2, two.gardenId, () => {
				throw new Error("a newer reply replaced the candidate");
			}),
		);
		expect(bytes(two.recordPath).equals(before)).toBe(true);
		expect(fs.existsSync(recordPath)).toBe(true);
	});

	it("[QK:RENEW-B2-START-REFUSES-MOVED-OR-RENEWING] step 1 refuses a moved current chapter and a record already mid-/renew, writing nothing", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const before = bytes(recordPath);
		refusal("native-moved", () =>
			writeRenewStart({ ...at(s, gardenId), expectedNative: N1, outline: OUTLINE, precondition: () => {} }),
		);
		expect(bytes(recordPath).equals(before)).toBe(true);
		start(s, gardenId);
		const marked = bytes(recordPath);
		refusal("already-renewing", () => start(s, gardenId));
		expect(bytes(recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-B2-RESERVE-ONLY-FROM-NULL] step 3a reserves once; an already reserved next chapter is never moved or answered as success", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		expect(readAddressableMetaIdentity(gardenId, s.sessionsDir).renewing?.to).toBe(N1);
		const reserved = bytes(recordPath);
		refusal("to-already-reserved", () => reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 }));
		refusal("to-already-reserved", () => reserveRenewTo({ ...at(s, gardenId), from: N0, to: N2 }));
		expect(bytes(recordPath).equals(reserved)).toBe(true);
	});

	it("[QK:RENEW-B2-RESERVE-UNCLAIMED] step 3a refuses a next chapter id any record already claims", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		birthPiCitizen({
			nativeSessionId: N2,
			cwd: "/tmp",
			sessionsDir: s.sessionsDir,
			recordArmLocksDir: s.locksDir,
			controlSocketDir: s.socketDir,
		});
		start(s, gardenId);
		const marked = bytes(recordPath);
		refusal("to-claimed", () => reserveRenewTo({ ...at(s, gardenId), from: N0, to: N2 }));
		refusal("to-claimed", () => reserveRenewTo({ ...at(s, gardenId), from: N0, to: N0 }));
		expect(bytes(recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-B2-OWNER-IS-THIS-PROCESS] a mark whose owner is not this process, by start key, is not written over", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { renewing: { owner: { startKey: string } } };
		raw.renewing.owner.startKey = "another-process-start";
		fs.writeFileSync(recordPath, JSON.stringify(raw, null, 2));
		const tampered = bytes(recordPath);
		refusal("owner-mismatch", () => reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 }));
		expect(bytes(recordPath).equals(tampered)).toBe(true);
	});

	it("[QK:RENEW-B2-TOKEN-IS-THIS-RENEW] a mark of another renew's token is not written over", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		const marked = bytes(recordPath);
		refusal("token-mismatch", () => reserveRenewTo({ ...at(s, gardenId, OTHER_TOKEN), from: N0, to: N1 }));
		expect(bytes(recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-B2-CLEAR-ONLY-UNRESERVED] step 2 drops only an unreserved mark of this renew; a reserved one stays", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		clearRenewStart({ ...at(s, gardenId), from: N0 });
		const open = readAddressableMetaIdentity(gardenId, s.sessionsDir);
		expect(open.renewing).toBeUndefined();
		expect(open.nativeSessionId).toBe(N0);
		expect(open.chapters).toBeUndefined();
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const reserved = bytes(recordPath);
		refusal("to-already-reserved", () => clearRenewStart({ ...at(s, gardenId), from: N0 }));
		expect(bytes(recordPath).equals(reserved)).toBe(true);
	});

	function committed(s: Store, gardenId: string, extra: Partial<Parameters<typeof commitRenew>[0]> = {}) {
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const next = transcript(s, "n1", [header(N1, T2), JSON.stringify({ type: "message", timestamp: T2 })]);
		return commitRenew({
			expectedOutlineSha: sha256(OUTLINE),
			...at(s, gardenId),
			now: COMMIT_AT,
			from: N0,
			to: N1,
			newTranscriptPath: next,
			...extra,
		});
	}

	it("[QK:RENEW-B2-COMMIT-COORDINATES] the commit keeps the garden, moves the current pointer and records the leaving chapter's coordinates once", () => {
		const s = store();
		const { gardenId, original } = born(s);
		committed(s, gardenId);
		const r = readAddressableMetaIdentity(gardenId, s.sessionsDir);
		expect(r.gardenId).toBe(gardenId);
		expect(r.nativeSessionId).toBe(N1);
		expect(r.transcriptPath).toBe(path.join(s.base, "n1.jsonl"));
		expect(r.renewing).toBeUndefined();
		expect(r.chapters).toEqual([
			{ nativeSessionId: N0, transcriptPath: original, model: "prov/model-a", startedAt: T0, endedAt: T2 },
		]);
		expect(r.chapters?.some((c) => c.nativeSessionId === r.nativeSessionId)).toBe(false);
	});

	it("[QK:RENEW-B2-COMMIT-OUTLINE-EXACT] the latest outline is the agreed body byte for byte, its sha, the new chapter and the K1 time", () => {
		const s = store();
		const { gardenId } = born(s);
		committed(s, gardenId);
		const r = readAddressableMetaIdentity(gardenId, s.sessionsDir);
		expect(Buffer.from(r.outline?.body ?? "", "utf8").equals(Buffer.from(OUTLINE, "utf8"))).toBe(true);
		expect(r.outline?.sha).toBe(sha256(OUTLINE));
		expect(r.outline?.forNativeSessionId).toBe(N1);
		expect(r.outline?.writtenAt).toBe(K1_AT.toISOString());
	});

	it("[QK:RENEW-B2-COMMIT-TIMES] the chapter's times are the original's header and LAST entry, and null when they cannot be read", () => {
		const s = store();
		const { gardenId } = born(s, [header(N0), entry("e1", T1), entry("e1b", T1), entry("e2", T2)]);
		committed(s, gardenId);
		expect(readAddressableMetaIdentity(gardenId, s.sessionsDir).chapters?.[0]).toMatchObject({
			startedAt: T0,
			endedAt: T2,
		});
		// A last entry longer than one read chunk: read backwards across chunks, still only that line.
		const sl = store();
		const longLast = JSON.stringify({ type: "message", id: "e-long", timestamp: T2, pad: "x".repeat(200 * 1024) });
		const lg = born(sl, [header(N0), entry("e1", T1), longLast]);
		committed(sl, lg.gardenId);
		expect(readAddressableMetaIdentity(lg.gardenId, sl.sessionsDir).chapters?.[0]).toMatchObject({
			startedAt: T0,
			endedAt: T2,
		});
		const s2 = store();
		const torn = born(s2, [header(N0, null), entry("e1", T1), '{"type":"message","timest']);
		committed(s2, torn.gardenId);
		expect(readAddressableMetaIdentity(torn.gardenId, s2.sessionsDir).chapters?.[0]).toMatchObject({
			startedAt: null,
			endedAt: null,
		});
		const s3 = store();
		const bare = born(s3, [header(N0)]);
		committed(s3, bare.gardenId);
		expect(readAddressableMetaIdentity(bare.gardenId, s3.sessionsDir).chapters?.[0]).toMatchObject({
			startedAt: T0,
			endedAt: null,
		});
	});

	it("[QK:RENEW-B2-COMMIT-ORIGINAL-NAMES-FROM] an original whose header does not name the leaving chapter is a refusal, not a null time", () => {
		const s = store();
		const { gardenId, recordPath } = born(s, [header(N2), entry("e1", T1)]);
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const reserved = bytes(recordPath);
		refusal("original-unverified", () =>
			commitRenew({
				expectedOutlineSha: sha256(OUTLINE),
				...at(s, gardenId),
				from: N0,
				to: N1,
				newTranscriptPath: path.join(s.base, "n1.jsonl"),
			}),
		);
		expect(bytes(recordPath).equals(reserved)).toBe(true);
	});

	it("[QK:RENEW-B2-COMMIT-ORIGINAL-NO-LINK] an original reached through a symlink is a refusal", () => {
		const s = store();
		const real = transcript(s, "real", [header(N0), entry("e1", T1)]);
		const link = path.join(s.base, "n0-link.jsonl");
		fs.symlinkSync(real, link);
		const b = birthPiCitizen({
			nativeSessionId: N0,
			cwd: "/tmp",
			transcriptPath: link,
			sessionsDir: s.sessionsDir,
			recordArmLocksDir: s.locksDir,
			controlSocketDir: s.socketDir,
		});
		start(s, b.gardenId);
		reserveRenewTo({ ...at(s, b.gardenId), from: N0, to: N1 });
		const reserved = bytes(b.recordPath);
		refusal("original-unverified", () =>
			commitRenew({
				expectedOutlineSha: sha256(OUTLINE),
				...at(s, b.gardenId),
				from: N0,
				to: N1,
				newTranscriptPath: path.join(s.base, "n1.jsonl"),
			}),
		);
		expect(bytes(b.recordPath).equals(reserved)).toBe(true);
	});

	it("[QK:RENEW-B2-COMMIT-NEEDS-RESERVED-TO] the commit needs this renew's reserved next chapter", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		const marked = bytes(recordPath);
		refusal("to-not-reserved", () =>
			commitRenew({
				expectedOutlineSha: sha256(OUTLINE),
				...at(s, gardenId),
				from: N0,
				to: N1,
				newTranscriptPath: path.join(s.base, "n1.jsonl"),
			}),
		);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const reserved = bytes(recordPath);
		refusal("to-mismatch", () =>
			commitRenew({
				expectedOutlineSha: sha256(OUTLINE),
				...at(s, gardenId),
				from: N0,
				to: N2,
				newTranscriptPath: path.join(s.base, "n2.jsonl"),
			}),
		);
		expect(bytes(recordPath).equals(reserved)).toBe(true);
		expect(marked.equals(reserved)).toBe(false);
	});

	it("[QK:RENEW-B2-W2-WRITE-BITS-ONLY] W2 takes only the write bits off the leaving original — read access is never widened", () => {
		for (const [mode, expected] of [
			[0o640, 0o440],
			[0o600, 0o400],
		] as const) {
			const s = store();
			const { gardenId, original } = born(s);
			fs.chmodSync(original, mode);
			const out = committed(s, gardenId);
			expect(fs.statSync(original).mode & 0o7777).toBe(expected);
			expect(out.protection).toEqual({ kind: "write-bits-removed", from: mode, to: expected });
		}
	});

	it("[QK:RENEW-B2-W2-FAILURE-KEEPS-COMMIT] a W2 failure keeps the commit and is named", () => {
		const s = store();
		const { gardenId, original } = born(s);
		const out = committed(s, gardenId, {
			_test_fchmod: () => {
				throw new Error("EPERM: operation not permitted");
			},
		});
		expect(out.protection).toEqual({
			kind: "closed-chapter-not-write-protected",
			detail: "EPERM: operation not permitted",
		});
		expect(readAddressableMetaIdentity(gardenId, s.sessionsDir).nativeSessionId).toBe(N1);
		expect(fs.statSync(original).mode & 0o200).toBe(0o200);
	});

	it("[QK:RENEW-B2-CLASSIFY] the read says open, renewing, another renew, committed — and unknown rather than a guess", () => {
		const s = store();
		const { gardenId } = born(s);
		const q = { gardenId, token: TOKEN, from: N0, outlineSha: sha256(OUTLINE), sessionsDir: s.sessionsDir };
		expect(classifyRenewRecord(q)).toEqual({ state: "open" });
		start(s, gardenId);
		expect(classifyRenewRecord(q)).toEqual({ state: "renewing", to: null });
		expect(classifyRenewRecord({ ...q, token: OTHER_TOKEN })).toEqual({ state: "renewing-other" });
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		expect(classifyRenewRecord(q)).toEqual({ state: "renewing", to: N1 });
		commitRenew({
			expectedOutlineSha: sha256(OUTLINE),
			...at(s, gardenId),
			from: N0,
			to: N1,
			newTranscriptPath: transcript(s, "n1", [header(N1)]),
		});
		expect(classifyRenewRecord(q)).toEqual({ state: "committed", current: N1 });
		expect(classifyRenewRecord({ ...q, outlineSha: sha256("another edition") }).state).toBe("unknown");
		expect(classifyRenewRecord({ ...q, gardenId: "20261117T000000-abcdef" }).state).toBe("unknown");
	});

	it("[QK:RENEW-B2-COMMIT-OUTLINE-CONFIRMED] a record now carrying another VALID edition is not committed against the confirmed sha", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const other = `${OUTLINE}\n[덧붙인 다른 판]`;
		const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as {
			renewing: { outline: string; outlineSha: string };
		};
		raw.renewing.outline = other;
		raw.renewing.outlineSha = sha256(other);
		fs.writeFileSync(recordPath, JSON.stringify(raw, null, 2));
		expect(readAddressableMetaIdentity(gardenId, s.sessionsDir).renewing?.outlineSha).toBe(sha256(other));
		const swapped = bytes(recordPath);
		refusal("outline-not-confirmed", () =>
			commitRenew({
				...at(s, gardenId),
				expectedOutlineSha: sha256(OUTLINE),
				from: N0,
				to: N1,
				newTranscriptPath: transcript(s, "n1", [header(N1)]),
			}),
		);
		expect(bytes(recordPath).equals(swapped)).toBe(true);
	});

	it("[QK:RENEW-B2-ORIGINAL-READS-ENDS-ONLY] the original's header and last entry are read; its 3 GiB middle is not", () => {
		const s = store();
		const file = path.join(s.base, "n0.jsonl");
		const head = `${header(N0)}\n`;
		const last = `\n${entry("e-last", T2)}\n`;
		const size = 3 * 1024 ** 3;
		fs.writeFileSync(file, head, { mode: 0o600 });
		fs.truncateSync(file, size);
		const fd = fs.openSync(file, "r+");
		fs.writeSync(fd, last, size - Buffer.byteLength(last));
		fs.closeSync(fd);
		const b = birthPiCitizen({
			nativeSessionId: N0,
			cwd: "/tmp",
			transcriptPath: file,
			sessionsDir: s.sessionsDir,
			recordArmLocksDir: s.locksDir,
			controlSocketDir: s.socketDir,
		});
		start(s, b.gardenId);
		reserveRenewTo({ ...at(s, b.gardenId), from: N0, to: N1 });
		commitRenew({
			...at(s, b.gardenId),
			expectedOutlineSha: sha256(OUTLINE),
			from: N0,
			to: N1,
			newTranscriptPath: transcript(s, "n1", [header(N1)]),
		});
		expect(readAddressableMetaIdentity(b.gardenId, s.sessionsDir).chapters?.[0]).toMatchObject({
			startedAt: T0,
			endedAt: T2,
		});
		fs.rmSync(file, { force: true });
	});

	it("[QK:RENEW-B2-ORIGINAL-FIFO-NO-WAIT] an original that is a FIFO is refused at once, never waited on", () => {
		const s = store();
		const r = spawnSync(process.execPath, [FIFO_CHILD, s.base], {
			encoding: "utf8",
			timeout: 15_000,
			env: { PATH: process.env.PATH, HOME: s.base, PI_CODING_AGENT_DIR: path.join(s.base, "agent") },
		});
		expect(r.error?.message ?? null).toBeNull();
		expect(r.status).toBe(0);
		expect(JSON.parse(r.stdout.trim().split("\n").at(-1) as string)).toMatchObject({ code: "original-unverified" });
	});

	it("[QK:RENEW-B2-PRECONDITION-SYNC] a re-check that returns a promise is a refusal, never a pass", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const before = bytes(recordPath);
		const asyncRecheck = (async () => undefined) as unknown as () => undefined;
		refusal("precondition-failed", () => start(s, gardenId, asyncRecheck));
		expect(bytes(recordPath).equals(before)).toBe(true);
	});

	it("[QK:RENEW-B2-WRITES-UNDER-LOCK] every write meets the garden's record-arm lock: held by another, nothing moves", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const held = acquireLock(gardenId, { dir: s.locksDir, nonce: () => "f".repeat(32) });
		if (!held.ok) throw new Error(held.conflict.detail);
		try {
			const before = bytes(recordPath);
			expect(() =>
				writeRenewStart({
					...at(s, gardenId),
					armLockWait: "once",
					expectedNative: N0,
					outline: OUTLINE,
					precondition: () => {},
				}),
			).toThrow(RecordArmLockBusyError);
			expect(bytes(recordPath).equals(before)).toBe(true);
		} finally {
			releaseLock(held.claim, { dir: s.locksDir });
		}
	});
});

/** A real process that ran and is gone: its pid and the start key it had while it ran. */
async function deadOwner(): Promise<{ pid: number; startKey: string }> {
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 150));
	const pid = child.pid as number;
	const startKey = processStartKey(pid);
	const exited = new Promise((r) => child.once("exit", r));
	child.kill("SIGKILL");
	await exited;
	return { pid, startKey };
}
function setOwner(recordPath: string, owner: { pid: number; startKey: string }): void {
	const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { renewing: { owner: unknown } };
	raw.renewing.owner = owner;
	fs.writeFileSync(recordPath, JSON.stringify(raw, null, 2));
}

describe("/renew offline recovery hand-over (#151 C1.4o)", () => {
	it("[QK:RENEW-REC-ADOPT-DEAD-ONLY-OWNER] a mark whose recorded owner is proven gone is handed to this process, and nothing but the owner changes", async () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		reserveRenewTo({ ...at(s, gardenId), from: N0, to: N1 });
		const dead = await deadOwner();
		expect(dead.startKey).not.toBe("");
		setOwner(recordPath, dead);
		const before = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
		const a = adoptRenewOwner({ ...at(s, gardenId), from: N0, to: N1 });
		expect(a.release).toBe("released");
		const after = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
		expect((after.renewing as { owner: unknown }).owner).toEqual({
			pid: process.pid,
			startKey: processStartKey(process.pid),
		});
		const strip = (r: Record<string, unknown>) => ({
			...r,
			recordUpdatedAt: null,
			renewing: { ...(r.renewing as object), owner: null },
		});
		expect(strip(after)).toEqual(strip(before));
	});

	it("[QK:RENEW-REC-ADOPT-LIVE-OR-UNCERTAIN-REFUSED] a live or an uncertain recorded owner is never taken over; nothing is written", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId); // the owner is this process: live
		const marked = bytes(recordPath);
		refusal("owner-not-dead", () => adoptRenewOwner({ ...at(s, gardenId), from: N0, to: null }));
		expect(bytes(recordPath).equals(marked)).toBe(true);
		setOwner(recordPath, { pid: 2147483646, startKey: "not-a-start-key" }); // unrecognized key: uncertain
		const uncertain = bytes(recordPath);
		refusal("owner-not-dead", () => adoptRenewOwner({ ...at(s, gardenId), from: N0, to: null }));
		expect(bytes(recordPath).equals(uncertain)).toBe(true);
	});

	it("[QK:RENEW-REC-ADOPT-TUPLE-DRIFT] the hand-over takes only the attempt that was named: another from, token or to refuses, writing nothing", async () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		setOwner(recordPath, await deadOwner());
		const marked = bytes(recordPath);
		refusal("to-mismatch", () => adoptRenewOwner({ ...at(s, gardenId), from: N0, to: N1 }));
		refusal("token-mismatch", () => adoptRenewOwner({ ...at(s, gardenId, OTHER_TOKEN), from: N0, to: null }));
		refusal("from-mismatch", () => adoptRenewOwner({ ...at(s, gardenId), from: N2, to: null }));
		expect(bytes(recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-REC-ADOPT-EXCLUSIVE] of two hand-overs of the same gone owner only the first takes it: the second meets a live owner", async () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		start(s, gardenId);
		setOwner(recordPath, await deadOwner());
		expect(adoptRenewOwner({ ...at(s, gardenId), from: N0, to: null }).release).toBe("released");
		const taken = bytes(recordPath);
		refusal("owner-not-dead", () => adoptRenewOwner({ ...at(s, gardenId), from: N0, to: null }));
		expect(bytes(recordPath).equals(taken)).toBe(true);
	});
});
