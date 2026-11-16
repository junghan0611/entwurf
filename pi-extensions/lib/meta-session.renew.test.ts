/**
 * #151 /renew R-1 (contract C1.2, reader first): the V3 reader understands the optional `pi`-only
 * renew keys, a record that never renewed stays byte-identical, every claimed native id is unique
 * store-wide, and an ordinary upsert refuses by name at the renew boundary — before any write.
 * The production subject is `meta-session.ts`; the oracle is the raw store bytes on disk.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	certifyActiveStore,
	claimedNativeSessionIds,
	FRESH_CUT_COMMAND,
	listAllMetaIdentitiesDir,
	type MetaIdentity,
	parseMetaIdentity,
	RenewBoundaryError,
	readAddressableMetaIdentity,
	serializeMetaIdentity,
	upsertMetaSession,
} from "./meta-session.ts";

const BASE: MetaIdentity = {
	schemaVersion: 3,
	gardenId: "20261003T164401-a30dda",
	backend: "pi",
	nativeSessionId: "native-n2",
	cwd: "/tmp/w",
	model: "stub/stub-1",
	transcriptPath: "/tmp/w/n2.jsonl",
	createdAt: "2026-10-03T07:44:01.905Z",
	recordUpdatedAt: "2026-11-16T05:30:58.520Z",
	attachIncarnation: null,
};

/** Independent oracle: sha256 straight from node:crypto, not the subject's helper. */
const sha = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

const CANDIDATE = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.\n[1장] …\n[2장] …";
const RENEWING = {
	from: "native-n2",
	to: "native-n3",
	token: "c".repeat(32),
	outlineSha: sha(CANDIDATE),
	outline: CANDIDATE,
	owner: { pid: 4242, startKey: "linux:123456" },
	startedAt: "2026-11-16T11:00:00.000Z",
};

const CHAPTERS = [
	{
		nativeSessionId: "native-n1",
		transcriptPath: "/tmp/w/n1.jsonl",
		model: "entwurf/claude-opus-5-5" as string | null,
		startedAt: "2026-10-03T07:44:01.905Z",
		endedAt: "2026-11-01T00:00:00.000Z",
	},
];

const EDITION = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.\n[1장] …";
/** The latest outline a record that has lived through chapters carries for its current chapter. */
function outlineFor(native: string): NonNullable<MetaIdentity["outline"]> {
	return { body: EDITION, sha: sha(EDITION), forNativeSessionId: native, writtenAt: "2026-11-01T00:00:00.000Z" };
}
/** A record with closed chapters always carries the latest outline (R-1b coherence). */
function lived(rec: MetaIdentity): MetaIdentity {
	return rec.chapters && !rec.outline ? { ...rec, outline: outlineFor(rec.nativeSessionId) } : rec;
}

const tmpDirs: string[] = [];
function store(...records: MetaIdentity[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renew-r1-"));
	tmpDirs.push(dir);
	for (const r of records) fs.writeFileSync(path.join(dir, `${r.gardenId}.meta.json`), serializeMetaIdentity(lived(r)));
	return dir;
}
function snapshot(dir: string): Record<string, string> {
	return Object.fromEntries(fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n), "utf8")]));
}
afterEach(() => {
	for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("#151 R-1 reader: renew keys", () => {
	it("[QK:RENEW-R1-ABSENT-BYTES-STABLE] a record that never renewed serializes to exactly the pre-#151 bytes (an independent hand-written golden, not a serializer round trip)", () => {
		// Golden written by hand from the pre-#151 serializer's documented shape (frozen key
		// order, 2-space indent, trailing newline) — the oracle does not call the subject.
		const GOLDEN =
			'{\n  "schemaVersion": 3,\n  "gardenId": "20261003T164401-a30dda",\n  "backend": "pi",\n' +
			'  "nativeSessionId": "native-n2",\n  "cwd": "/tmp/w",\n  "model": "stub/stub-1",\n' +
			'  "transcriptPath": "/tmp/w/n2.jsonl",\n  "createdAt": "2026-10-03T07:44:01.905Z",\n' +
			'  "recordUpdatedAt": "2026-11-16T05:30:58.520Z",\n  "attachIncarnation": null\n}\n';
		expect(serializeMetaIdentity(BASE)).toBe(GOLDEN);
		expect(serializeMetaIdentity(parseMetaIdentity(GOLDEN))).toBe(GOLDEN);
	});

	it("[QK:RENEW-R1-ROUND-TRIP] a pi record with renewing + chapters round-trips byte-identically", () => {
		const rec: MetaIdentity = lived({ ...BASE, renewing: RENEWING, chapters: CHAPTERS });
		const text = serializeMetaIdentity(rec);
		const back = parseMetaIdentity(text);
		expect(back.renewing).toEqual(RENEWING);
		expect(back.chapters).toEqual(CHAPTERS);
		expect(serializeMetaIdentity(back)).toBe(text);
		expect(claimedNativeSessionIds(back)).toEqual(["native-n2", "native-n1", "native-n3"]);
		// forNativeSessionId is a reference, not a claim: it adds no id of its own.
		expect(back.outline?.forNativeSessionId).toBe("native-n2");
	});

	it("[QK:RENEW-R1-PI-ONLY] renew state on a non-pi record is refused", () => {
		const text = serializeMetaIdentity({ ...BASE, backend: "claude-code", chapters: CHAPTERS });
		expect(() => parseMetaIdentity(text)).toThrow(/exists only on "pi" records/);
		const outlineOnly = serializeMetaIdentity({ ...BASE, backend: "claude-code", outline: outlineFor("native-n2") });
		expect(() => parseMetaIdentity(outlineOnly)).toThrow(/exists only on "pi" records/);
	});

	it("[QK:RENEW-R1-FROM-IS-CURRENT] renewing.from must equal the current nativeSessionId", () => {
		const text = serializeMetaIdentity({ ...BASE, renewing: { ...RENEWING, from: "native-other" } });
		expect(() => parseMetaIdentity(text)).toThrow(/renewing\.from/);
	});

	it("[QK:RENEW-R1-NO-SELF-DUP] one record may not claim the same native id twice", () => {
		const text = serializeMetaIdentity({
			...BASE,
			chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-n2" }] as MetaIdentity["chapters"],
			outline: outlineFor("native-n2"),
		});
		expect(() => parseMetaIdentity(text)).toThrow(/more than once/);
	});

	it("[QK:RENEW-R1-STRICT-SUBKEYS] a stray key inside renewing, an empty chapters array and a malformed token are refused, never coerced", () => {
		const raw = JSON.parse(serializeMetaIdentity({ ...BASE, renewing: RENEWING }));
		expect(() => parseMetaIdentity(JSON.stringify({ ...raw, renewing: { ...raw.renewing, extra: 1 } }))).toThrow(
			/unexpected key/,
		);
		expect(() => parseMetaIdentity(JSON.stringify({ ...raw, chapters: [] }))).toThrow(/non-empty array/);
		expect(() => parseMetaIdentity(JSON.stringify({ ...raw, renewing: { ...raw.renewing, token: "XYZ" } }))).toThrow(
			/renewing\.token/,
		);
	});
});

describe("#151 R-1 store: claimed ids are unique store-wide", () => {
	it("[QK:RENEW-R1-CERTIFY-CHAPTER-UNIQUE] another record holding a closed chapter id as its current id is a store defect", () => {
		const other: MetaIdentity = { ...BASE, gardenId: "20261116T090748-6a8b34", nativeSessionId: "native-n1" };
		const owner: MetaIdentity = lived({ ...BASE, chapters: CHAPTERS });
		const files = new Map([
			[`${owner.gardenId}.meta.json`, serializeMetaIdentity(owner)],
			[`${other.gardenId}.meta.json`, serializeMetaIdentity(other)],
		]);
		const cert = certifyActiveStore(
			[...files.keys()].map((filename) => ({ filename, regularFile: true })),
			(f) => files.get(f) as string,
		);
		expect(cert.defects.some((d) => d.message.includes('duplicate nativeSessionId "native-n1"'))).toBe(true);
	});
});

describe("#151 R-1 upsert boundary: refuse by name, write nothing", () => {
	it("[QK:RENEW-R1-ATTACH-REFUSED-WHILE-RENEWING] an ordinary attach to a record mid-/renew is refused as renew-in-progress", () => {
		const dir = store({ ...BASE, renewing: RENEWING });
		const before = snapshot(dir);
		let err: unknown;
		try {
			upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-n2", cwd: "/tmp/w" } });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(RenewBoundaryError);
		expect((err as RenewBoundaryError).code).toBe("renew-in-progress");
		expect(snapshot(dir)).toEqual(before);
	});

	it("[QK:RENEW-R1-CLOSED-CHAPTER-NOT-REBORN] a create for a closed chapter's native id is refused; no new birthday appears", () => {
		const dir = store({ ...BASE, chapters: CHAPTERS });
		const before = snapshot(dir);
		expect(() =>
			upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-n1", cwd: "/tmp/w" } }),
		).toThrow(/native-id-is-closed-chapter/);
		expect(snapshot(dir)).toEqual(before);
	});

	it("[QK:RENEW-R1-RESERVED-NOT-BORN] a create for the reserved next native id is refused; no new birthday appears (G2)", () => {
		const dir = store({ ...BASE, renewing: RENEWING });
		const before = snapshot(dir);
		expect(() =>
			upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-n3", cwd: "/tmp/w" } }),
		).toThrow(/native-id-reserved-by-renew/);
		expect(snapshot(dir)).toEqual(before);
	});

	it("[QK:RENEW-R1-ORDINARY-UNCHANGED] a record with closed chapters and no transition still attaches normally and keeps its chapters", () => {
		const dir = store({ ...BASE, chapters: CHAPTERS });
		const res = upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-n2", cwd: "/tmp/w2" } });
		expect(res.action).toBe("attach");
		const onDisk = parseMetaIdentity(fs.readFileSync(res.path, "utf8"));
		expect(onDisk.cwd).toBe("/tmp/w2");
		expect(onDisk.chapters).toEqual(CHAPTERS);
	});
});

describe("#151 R-1 review D1/O1: the addressable reader and the listing use the same claimed-id axis", () => {
	const A: MetaIdentity = { ...BASE, gardenId: "20261003T164401-a30dda", nativeSessionId: "native-a" };
	const B: MetaIdentity = { ...BASE, gardenId: "20261116T090748-6a8b34", nativeSessionId: "native-b" };
	const cases: [string, MetaIdentity, MetaIdentity][] = [
		["current↔closed", A, { ...B, chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-a" }] }],
		["current↔reserved", A, { ...B, renewing: { ...RENEWING, from: "native-b", to: "native-a" } }],
		[
			"closed↔closed",
			{ ...A, chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-x" }] },
			{ ...B, chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-x" }] },
		],
	];
	for (const [i, [name, a, b]] of cases.entries()) {
		const qk = i === 0 ? "[QK:RENEW-R1-ADDRESSABLE-CLAIMED-RIVAL] " : "";
		it(`${qk}${name}: neither garden id is addressable when two records claim one native id`, () => {
			const dir = store(a, b);
			expect(() => readAddressableMetaIdentity(a.gardenId, dir)).toThrow(/shares a claimed native session id/);
			expect(() => readAddressableMetaIdentity(b.gardenId, dir)).toThrow(/shares a claimed native session id/);
		});
	}

	it("[QK:RENEW-R1-LISTING-ONE-ERROR-PER-RECORD] two records crossing on two claimed ids are each reported once, and neither is listed", () => {
		const a: MetaIdentity = { ...A, chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-b" }] };
		const b: MetaIdentity = { ...B, chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-a" }] };
		const res = listAllMetaIdentitiesDir(store(a, b));
		expect(res.identities).toEqual([]);
		expect(res.errors.map((e) => e.filename).sort()).toEqual([`${a.gardenId}.meta.json`, `${b.gardenId}.meta.json`]);
	});
});

describe("#151 R-1b: the latest outline slot and the chapter model", () => {
	it("[QK:RENEW-R1B-OUTLINE-ROUND-TRIP] a lived record keeps its latest outline and each chapter's model byte-identically", () => {
		const rec = lived({ ...BASE, chapters: [{ ...CHAPTERS[0], model: null }] });
		const text = serializeMetaIdentity(rec);
		const back = parseMetaIdentity(text);
		expect(back.outline).toEqual(outlineFor("native-n2"));
		expect(back.chapters?.[0].model).toBeNull();
		expect(serializeMetaIdentity(back)).toBe(text);
	});

	it("[QK:RENEW-R1B-OUTLINE-SHA-VERIFIED] an outline whose body no longer matches its sha is refused, never coerced", () => {
		const raw = JSON.parse(serializeMetaIdentity(lived({ ...BASE, chapters: CHAPTERS })));
		raw.outline.body = `${raw.outline.body} (edited)`;
		expect(() => parseMetaIdentity(JSON.stringify(raw))).toThrow(/outline\.sha" does not match/);
	});

	it("[QK:RENEW-R1B-CANDIDATE-SHA-VERIFIED] a renewing candidate whose body no longer matches outlineSha is refused", () => {
		const raw = JSON.parse(serializeMetaIdentity({ ...BASE, renewing: RENEWING }));
		raw.renewing.outline = `${raw.renewing.outline}!`;
		expect(() => parseMetaIdentity(JSON.stringify(raw))).toThrow(/renewing\.outlineSha" does not match/);
	});

	it("[QK:RENEW-R1B-OUTLINE-FOR-CURRENT] the latest outline must belong to the current chapter, during a renew too", () => {
		const closed = serializeMetaIdentity({ ...BASE, chapters: CHAPTERS, outline: outlineFor("native-n1") });
		expect(() => parseMetaIdentity(closed)).toThrow(/outline\.forNativeSessionId/);
		const reserved = serializeMetaIdentity({
			...BASE,
			renewing: RENEWING,
			chapters: CHAPTERS,
			outline: outlineFor("native-n3"),
		});
		expect(() => parseMetaIdentity(reserved)).toThrow(/outline\.forNativeSessionId/);
	});

	it("[QK:RENEW-R1B-CHAPTERS-IFF-OUTLINE] chapters without an outline, or an outline without chapters, is refused", () => {
		expect(() => parseMetaIdentity(serializeMetaIdentity({ ...BASE, chapters: CHAPTERS }))).toThrow(
			/chapters without an outline/,
		);
		expect(() => parseMetaIdentity(serializeMetaIdentity({ ...BASE, outline: outlineFor("native-n2") }))).toThrow(
			/an outline without chapters/,
		);
	});

	it("[QK:RENEW-R1B-FIRST-RENEW-NO-OUTLINE] a first renew (no closed chapter yet) carries a candidate and no outline", () => {
		const back = parseMetaIdentity(serializeMetaIdentity({ ...BASE, renewing: RENEWING }));
		expect(back.outline).toBeUndefined();
		expect(back.renewing?.outline).toBe(CANDIDATE);
	});
});

describe("#151 R-1c: chapter times are the original's own, and an unknown key is not a generation by itself", () => {
	it("[QK:RENEW-R1C-CHAPTER-TIME-NULLABLE] a chapter whose original times could not be read keeps null, round-trips, and an empty string is still refused", () => {
		// Each time is undetermined on its own: both, the start only, the end only.
		for (const [startedAt, endedAt] of [
			[null, null],
			[null, CHAPTERS[0].endedAt],
			[CHAPTERS[0].startedAt, null],
		] as const) {
			const one = serializeMetaIdentity(lived({ ...BASE, chapters: [{ ...CHAPTERS[0], startedAt, endedAt }] }));
			const parsed = parseMetaIdentity(one);
			expect(parsed.chapters?.[0].startedAt).toBe(startedAt);
			expect(parsed.chapters?.[0].endedAt).toBe(endedAt);
			expect(serializeMetaIdentity(parsed)).toBe(one);
		}
		const text = serializeMetaIdentity(
			lived({ ...BASE, chapters: [{ ...CHAPTERS[0], startedAt: null, endedAt: null }] }),
		);
		for (const key of ["startedAt", "endedAt"] as const) {
			const raw = JSON.parse(text);
			raw.chapters[0][key] = "";
			expect(() => parseMetaIdentity(JSON.stringify(raw))).toThrow(new RegExp(`chapters\\[0\\]\\.${key}`));
		}
	});

	it("[QK:RENEW-R1C-UNKNOWN-KEY-STALE-READER-FIRST] an unexpected V3 key is refused with the stale-reader check named before the generation cut", () => {
		const raw = JSON.parse(serializeMetaIdentity(BASE));
		raw.futureKey = { anything: true };
		let message = "";
		try {
			parseMetaIdentity(JSON.stringify(raw));
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain('unexpected key(s) "futureKey"');
		expect(message).toContain("reader-version skew");
		expect(message).toContain("damaged or foreign data");
		expect(message).toContain("keep the identity");
		expect(message).toContain("never by itself a reason to archive");
		expect(message.indexOf("matching reader")).toBeGreaterThan(-1);
		expect(message.indexOf("matching reader")).toBeLessThan(message.indexOf(FRESH_CUT_COMMAND));
	});

	it("[QK:RENEW-R1C-STORE-REFUSAL-NAMES-KEY-SKEW] a store holding a newer reader's key refuses writes and says the reader may be stale", () => {
		const raw = JSON.parse(serializeMetaIdentity(BASE));
		raw.futureKey = 1;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renew-r1c-"));
		tmpDirs.push(dir);
		fs.writeFileSync(path.join(dir, `${BASE.gardenId}.meta.json`), `${JSON.stringify(raw)}\n`);
		const before = snapshot(dir);
		expect(() =>
			upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-other", cwd: "/tmp/w" } }),
		).toThrow(
			/An unexpected key may be the same skew, an older schema or damaged data: .*do not archive for the key alone/,
		);
		expect(snapshot(dir)).toEqual(before);
	});

	it("[QK:RENEW-R1C-STORE-REFUSAL-CHECK-BEFORE-ARCHIVE] the store refusal names the cause check before any archive, and archives only what is confirmed rotten", () => {
		const raw = JSON.parse(serializeMetaIdentity(BASE));
		raw.futureKey = 1;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renew-r1c-"));
		tmpDirs.push(dir);
		fs.writeFileSync(path.join(dir, `${BASE.gardenId}.meta.json`), `${JSON.stringify(raw)}\n`);
		let message = "";
		try {
			upsertMetaSession({ dir, input: { backend: "pi", nativeSessionId: "native-other", cwd: "/tmp/w" } });
		} catch (e) {
			message = (e as Error).message;
		}
		const check = message.indexOf("Find the cause in the listed defects first");
		const archive = message.indexOf("archiving the generation");
		expect(check).toBeGreaterThan(-1);
		expect(archive).toBeGreaterThan(check);
		expect(message).toContain("Only entries confirmed to be a previous or unusable generation");
		expect(message.indexOf(FRESH_CUT_COMMAND)).toBeGreaterThan(check);
	});
});
