/**
 * check-meta-identity-consumers — deterministic gate for the V3-only identity
 * consumer seam. A real temp dir; no backend, no network, no hook. Safe in the
 * `pnpm check` static floor.
 *
 * Proves the consumers every live path stands on (MCP sender-marker check, prune,
 * store-doctor, the identity writers):
 *   - readMetaIdentityByGardenId reads a V3 file to identity; body/filename
 *     gardenId drift fails fast (body is SSOT); a previous-generation (v2) file
 *     throws the error that names the fresh-cut command; a missing record throws
 *     the "not a garden citizen" error,
 *   - certifyActiveStore — THE ONE active-store contract, shared verbatim by the
 *     install doctor and every writer. Four rules, each proven on its own store:
 *     regular files only, live schema only, no body/filename drift, globally
 *     unique nativeSessionId. Certification is store-WIDE on purpose: the narrow
 *     "is there a record for MY native id" question let a writer land beside a
 *     drifted / duplicated / symlinked neighbour the doctor refuses — one store
 *     certified by two different contracts, with the weaker one holding at runtime.
 *   - birthPiCitizen REFUSES on every one of those defects, naming fresh-cut,
 *     BEFORE any write — including defects that have nothing to do with the
 *     session being born.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type ActiveStoreEntry,
	certifyActiveStore,
	certifyActiveStoreDir,
	FRESH_CUT_COMMAND,
	type MetaIdentity,
	MetaRecordError,
	readMetaIdentityByGardenId,
	serializeMetaIdentity,
} from "../pi-extensions/lib/meta-session.ts";
import { birthPiCitizen } from "../pi-extensions/lib/pi-citizen-birth.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throwsNaming(label: string, fn: () => unknown, needle: string): void {
	assert.throws(fn, (err: unknown) => err instanceof MetaRecordError && err.message.includes(needle), label);
	console.log(`  ok    ${label}`);
	passed++;
}

const identity = (gardenId: string, nativeSessionId: string): MetaIdentity => ({
	schemaVersion: 3,
	gardenId,
	backend: "pi",
	nativeSessionId,
	cwd: "/synthetic/proj",
	model: null,
	transcriptPath: null,
	createdAt: "2026-03-01T12:00:00.000Z",
	recordUpdatedAt: "2026-03-01T12:30:00.000Z",
});

const GID_A = "20260301T120000-aaaaaa";
const GID_B = "20260301T120001-bbbbbb";
const GID_V2 = "20260301T120002-cccccc";
const GID_C = "20260301T120006-cccc06";
const GID_D = "20260301T120007-dddd07";

const v2Body = `${JSON.stringify(
	{
		schemaVersion: 2,
		gardenId: GID_V2,
		backend: "pi",
		nativeSessionId: "native-v2",
		cwd: "/synthetic/proj",
		model: null,
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-03-01T12:00:00.000Z",
		recordUpdatedAt: "2026-03-01T12:30:00.000Z",
	},
	null,
	2,
)}\n`;

/** Run `body` against a store dir seeded by `seed`, then remove it. */
function withStore(seed: (dir: string) => void, body: (dir: string) => void): void {
	const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-case-"));
	try {
		seed(dir);
		body(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** A birth into `dir` — the seam all four identity writers funnel through. */
function birthInto(dir: string, nativeSessionId: string): () => unknown {
	return () =>
		birthPiCitizen({
			nativeSessionId,
			cwd: "/synthetic/proj",
			sessionsDir: dir,
			controlSocketDir: path.join(dir, "sockets"),
		});
}

const write = (dir: string, filename: string, contents: string): void =>
	fs.writeFileSync(path.join(dir, filename), contents);
const record = (dir: string, gardenId: string, nativeSessionId: string): void =>
	write(dir, `${gardenId}.meta.json`, serializeMetaIdentity(identity(gardenId, nativeSessionId)));
const recordCount = (dir: string): number => fs.readdirSync(dir).filter((f) => f.endsWith(".meta.json")).length;

const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-"));
try {
	record(dir, GID_A, "native-a");
	record(dir, GID_B, "native-b");
	// A previous-generation v2 record, raw JSON on purpose (production has no v2 writer).
	write(dir, `${GID_V2}.meta.json`, v2Body);
	write(dir, "not-a-record.txt", "ignore me\n");
	write(dir, "malformed.meta.json", "{nope\n");

	// --- readMetaIdentityByGardenId --------------------------------------------
	ok(
		"readMetaIdentityByGardenId reads a V3 record to identity",
		readMetaIdentityByGardenId(GID_A, dir).nativeSessionId === "native-a",
	);
	throwsNaming(
		"readMetaIdentityByGardenId on a previous-generation v2 file names the fresh-cut command",
		() => readMetaIdentityByGardenId(GID_V2, dir),
		FRESH_CUT_COMMAND,
	);
	throwsNaming(
		"readMetaIdentityByGardenId on a missing record: not a garden citizen",
		() => readMetaIdentityByGardenId("20260301T120009-ffffff", dir),
		"not a garden citizen",
	);
	// Body/filename drift: a file named D whose body claims A is corrupt.
	const driftFile = path.join(dir, `${GID_D}.meta.json`);
	fs.writeFileSync(driftFile, serializeMetaIdentity(identity(GID_A, "native-drift")));
	throwsNaming(
		"readMetaIdentityByGardenId fails fast on body/filename gardenId drift (body is SSOT)",
		() => readMetaIdentityByGardenId(GID_D, dir),
		"drift",
	);
	fs.rmSync(driftFile);

	// --- certifyActiveStore: the mixed store this dir already is ---------------
	{
		const cert = certifyActiveStoreDir(dir);
		const defectFiles = cert.defects.map((d) => d.filename);
		ok(
			"certification reports BOTH a malformed and a previous-generation record as defects",
			defectFiles.includes("malformed.meta.json") && defectFiles.includes(`${GID_V2}.meta.json`),
		);
		ok("certification ignores non-.meta.json entries", !defectFiles.includes("not-a-record.txt"));
		ok(
			"a previous-generation defect names the fresh-cut command (one prescription, per entry)",
			cert.defects.some((d) => d.filename === `${GID_V2}.meta.json` && d.message.includes(FRESH_CUT_COMMAND)),
		);
		ok(
			"the certifiable records are still parsed alongside the defects (A and B)",
			cert.records.length === 2 &&
				cert.records.every((r) => r.identity.gardenId === GID_A || r.identity.gardenId === GID_B),
		);
	}

	// --- a writer REFUSES that store, before any write -------------------------
	// Writing a fresh V3 citizen beside a record the live schema cannot read is how
	// a mixed store forms with nobody told (observed live 2026-07-23).
	const before = recordCount(dir);
	throwsNaming(
		"birth on a store holding an unreadable record REFUSES naming the fresh-cut command",
		birthInto(dir, "pi-fresh-on-prevgen-store"),
		FRESH_CUT_COMMAND,
	);
	ok("the refused birth wrote nothing (record count unchanged)", recordCount(dir) === before);
} finally {
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- rule 1: a `.meta.json` that is not a regular file ------------------------
// Pure first (the injected view the certification actually reasons over)…
{
	const entries: ActiveStoreEntry[] = [{ filename: `${GID_A}.meta.json`, regularFile: false }];
	const cert = certifyActiveStore(entries, () => {
		throw new Error("a non-regular entry must never be READ");
	});
	ok(
		"rule 1 (pure): a non-regular `.meta.json` is a defect and its bytes are never read",
		cert.defects.length === 1 && cert.defects[0]?.message.includes("not a regular file"),
	);
}
// …then for real: a symlink pointing at a perfectly valid V3 record outside the
// store. The bytes parse; the ENTRY still fails, because the store does not own
// where they live and a probe of this directory cannot certify them.
withStore(
	(dir) => {
		const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-outside-"));
		fs.writeFileSync(path.join(outside, "real.json"), serializeMetaIdentity(identity(GID_C, "native-symlinked")));
		fs.symlinkSync(path.join(outside, "real.json"), path.join(dir, `${GID_C}.meta.json`));
	},
	(dir) => {
		const cert = certifyActiveStoreDir(dir);
		ok(
			"rule 1: a symlinked record (valid bytes, foreign home) is a defect, never followed",
			cert.defects.length === 1 && cert.defects[0]?.message.includes("not a regular file"),
		);
		throwsNaming(
			"a writer REFUSES a store holding a symlinked record",
			birthInto(dir, "native-new"),
			FRESH_CUT_COMMAND,
		);
		ok("the refused birth minted nothing beside the symlink", recordCount(dir) === 1);
	},
);

// --- rule 3: body/filename drift is corruption of the ACTIVE store ------------
// The body stays the authority (readMetaIdentityByGardenId proves that above),
// but a record parked under the wrong name is unreachable by garden id, so the
// active store is not certifiable — and a writer with an unrelated native id must
// not step over it.
withStore(
	(dir) => {
		record(dir, GID_A, "native-a");
		fs.writeFileSync(path.join(dir, `${GID_D}.meta.json`), serializeMetaIdentity(identity(GID_B, "native-drift")));
	},
	(dir) => {
		const cert = certifyActiveStoreDir(dir);
		ok(
			"rule 3: body/filename drift is a defect (a garden-id lookup would never find it)",
			cert.defects.length === 1 && cert.defects[0]?.message.includes("drift"),
		);
		throwsNaming(
			"a writer with an UNRELATED native id REFUSES a store holding a drifted record",
			birthInto(dir, "native-unrelated"),
			FRESH_CUT_COMMAND,
		);
		ok("the refused birth minted nothing (2 records, no third)", recordCount(dir) === 2);
	},
);

// --- rule 4: duplicate nativeSessionId = authority ambiguity (G1) -------------
// The duplicate is between two OTHER records: the writer's own native id is
// nowhere in this store, and it must still refuse. This is the exact hole the
// narrow scan left — it only ever compared against its own id.
withStore(
	(dir) => {
		record(dir, GID_A, "dup");
		record(dir, GID_B, "dup");
	},
	(dir) => {
		const cert = certifyActiveStoreDir(dir);
		ok(
			"rule 4: a nativeSessionId held by two records is a defect naming both files",
			cert.defects.length === 1 &&
				cert.defects[0]?.message.includes("duplicate nativeSessionId") &&
				cert.defects[0]?.message.includes(`${GID_A}.meta.json`) &&
				cert.defects[0]?.message.includes(`${GID_B}.meta.json`),
		);
		throwsNaming(
			"G1: a writer REFUSES a store whose duplicate involves neither of its own ids",
			birthInto(dir, "native-brand-new"),
			FRESH_CUT_COMMAND,
		);
		ok("the refused birth minted nothing (2 records, no third)", recordCount(dir) === 2);
	},
);

// --- the certified store: lookup by native id, and birth writes ---------------
withStore(
	(dir) => {
		record(dir, GID_A, "native-a");
		record(dir, GID_B, "native-b");
	},
	(dir) => {
		const cert = certifyActiveStoreDir(dir);
		ok("a clean store certifies with zero defects", cert.defects.length === 0 && cert.scanned === 2);
		ok(
			"the writer's existence check reads the certified records (native id → garden id)",
			cert.records.find((r) => r.identity.nativeSessionId === "native-b")?.identity.gardenId === GID_B,
		);
		ok(
			"no match is no match (a fresh session has no record yet)",
			cert.records.find((r) => r.identity.nativeSessionId === "native-none") === undefined,
		);
		const birth = birthPiCitizen({
			nativeSessionId: "pi-fresh-on-clean-store",
			cwd: "/synthetic/proj",
			sessionsDir: dir,
			controlSocketDir: path.join(dir, "sockets"),
		});
		ok("birth on a certified store succeeds (create)", birth.action === "create");
		const again = birthPiCitizen({
			nativeSessionId: "pi-fresh-on-clean-store",
			cwd: "/synthetic/proj",
			sessionsDir: dir,
			controlSocketDir: path.join(dir, "sockets"),
		});
		ok(
			"re-birth of the same native session ATTACHES to the same garden id (address never moves)",
			again.action === "attach" && again.gardenId === birth.gardenId,
		);
	},
);

// --- an empty / absent store is certified, not broken ------------------------
{
	const absent = path.join(fs.realpathSync(os.tmpdir()), `psa-idcons-absent-${process.pid}`);
	const cert = certifyActiveStoreDir(absent);
	ok(
		"an absent store certifies as empty (a host with no generation is not broken)",
		cert.defects.length === 0 && cert.scanned === 0,
	);
}

console.log(`[check-meta-identity-consumers] ${passed} assertions ok`);
