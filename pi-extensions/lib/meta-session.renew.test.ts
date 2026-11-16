/**
 * #151 /renew R-1 (contract C1.2, reader first): the V3 reader understands the optional `pi`-only
 * renew keys, a record that never renewed stays byte-identical, every claimed native id is unique
 * store-wide, and an ordinary upsert refuses by name at the renew boundary — before any write.
 * The production subject is `meta-session.ts`; the oracle is the raw store bytes on disk.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	certifyActiveStore,
	claimedNativeSessionIds,
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

const RENEWING = {
	from: "native-n2",
	to: "native-n3",
	token: "c".repeat(32),
	outlineSha: "a".repeat(64),
	outline: "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.",
	owner: { pid: 4242, startKey: "linux:123456" },
	startedAt: "2026-11-16T11:00:00.000Z",
};

const CHAPTERS = [
	{
		nativeSessionId: "native-n1",
		transcriptPath: "/tmp/w/n1.jsonl",
		startedAt: "2026-10-03T07:44:01.905Z",
		endedAt: "2026-11-01T00:00:00.000Z",
	},
];

const tmpDirs: string[] = [];
function store(...records: MetaIdentity[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renew-r1-"));
	tmpDirs.push(dir);
	for (const r of records) fs.writeFileSync(path.join(dir, `${r.gardenId}.meta.json`), serializeMetaIdentity(r));
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
		const rec: MetaIdentity = { ...BASE, renewing: RENEWING, chapters: CHAPTERS };
		const text = serializeMetaIdentity(rec);
		const back = parseMetaIdentity(text);
		expect(back.renewing).toEqual(RENEWING);
		expect(back.chapters).toEqual(CHAPTERS);
		expect(serializeMetaIdentity(back)).toBe(text);
		expect(claimedNativeSessionIds(back)).toEqual(["native-n2", "native-n1", "native-n3"]);
	});

	it("[QK:RENEW-R1-PI-ONLY] renew state on a non-pi record is refused", () => {
		const text = serializeMetaIdentity({ ...BASE, backend: "claude-code", chapters: CHAPTERS });
		expect(() => parseMetaIdentity(text)).toThrow(/exists only on "pi" records/);
	});

	it("[QK:RENEW-R1-FROM-IS-CURRENT] renewing.from must equal the current nativeSessionId", () => {
		const text = serializeMetaIdentity({ ...BASE, renewing: { ...RENEWING, from: "native-other" } });
		expect(() => parseMetaIdentity(text)).toThrow(/renewing\.from/);
	});

	it("[QK:RENEW-R1-NO-SELF-DUP] one record may not claim the same native id twice", () => {
		const text = serializeMetaIdentity({
			...BASE,
			chapters: [{ ...CHAPTERS[0], nativeSessionId: "native-n2" }] as MetaIdentity["chapters"],
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
		const owner: MetaIdentity = { ...BASE, chapters: CHAPTERS };
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
