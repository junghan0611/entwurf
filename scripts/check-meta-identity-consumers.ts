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
 *   - readAddressableMetaIdentity (#52) — the read a DISPATCH does: the targeted
 *     contract PLUS store-wide `nativeSessionId` uniqueness. The two reads are
 *     deliberately different functions, so this gate pins BOTH halves of that
 *     split: the addressable read refuses a duplicate, and the plain targeted read
 *     still does NOT scan (the README promise that a call-relay does not re-scan
 *     the store per message is a contract, not an oversight).
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
	listAllMetaIdentities,
	type MetaIdentity,
	MetaRecordError,
	makeStoreRecordReader,
	metaRecordExistsByGardenId,
	nativeSessionIdRivals,
	readActiveStoreEntries,
	readAddressableMetaIdentity,
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

// --- #52: the ADDRESSABLE read holds the store-wide uniqueness rule ----------
// A duplicate `nativeSessionId` needs no corruption to appear: `upsertMetaSession`
// certifies and then writes, which is not a transaction, so two concurrent births can
// both read one clean snapshot and mint different garden ids for one native session.
// Dispatching at either id then reaches the SAME conversation/transcript twice.
withStore(
	(dir) => {
		record(dir, GID_A, "native-shared");
		record(dir, GID_B, "native-shared");
		record(dir, GID_C, "native-c");
	},
	(dir) => {
		throwsNaming(
			"the addressable read REFUSES a garden id that does not hold its nativeSessionId alone",
			() => readAddressableMetaIdentity(GID_A, dir),
			"must be unique",
		);
		throwsNaming(
			"…from EITHER side of the pair (neither rival is silently preferred)",
			() => readAddressableMetaIdentity(GID_B, dir),
			"must be unique",
		);
		throwsNaming(
			"the duplicate refusal names the fresh-cut command, like every other store defect",
			() => readAddressableMetaIdentity(GID_A, dir),
			FRESH_CUT_COMMAND,
		);
		ok(
			"the refusal NAMES the rival file, so the operator can see both records",
			(() => {
				try {
					readAddressableMetaIdentity(GID_A, dir);
					return false;
				} catch (err) {
					return err instanceof MetaRecordError && err.message.includes(`${GID_B}.meta.json`);
				}
			})(),
		);
		ok(
			"an unrelated citizen in the SAME store still reads addressably (no store-wide contagion)",
			readAddressableMetaIdentity(GID_C, dir).nativeSessionId === "native-c",
		);
		// The other half of the split, stated as a REQUIREMENT rather than a leftover: the
		// plain targeted read is what the mailbox poke / sender-marker trust / entwurf_self
		// use, and turning it store-wide is the design README explicitly does not have.
		ok(
			"the plain targeted read still answers on a duplicated store (it does NOT scan — README scope)",
			readMetaIdentityByGardenId(GID_A, dir).gardenId === GID_A,
		);
	},
);

// --- #52: the rival scan itself (pure) — a RIVAL is an ADDRESSABLE record -----
// The blind spots are claims about REACHABILITY, and each has to be pinned separately
// from "the scan works", because getting any of them wrong quarantines a healthy
// citizen. GPT's cross-review found two of them open in the first cut of this: a
// symlinked neighbour was FOLLOWED and counted, and a drifted one was counted too.
{
	const own = identity(GID_A, "native-shared");
	const map: Record<string, string> = {
		[`${GID_A}.meta.json`]: serializeMetaIdentity(own),
		[`${GID_B}.meta.json`]: serializeMetaIdentity(identity(GID_B, "native-shared")),
		[`${GID_C}.meta.json`]: serializeMetaIdentity(identity(GID_C, "native-c")),
		"malformed.meta.json": "{nope\n",
		"not-a-record.txt": "ignore me\n",
	};
	const touched: string[] = [];
	const read = (f: string): string => {
		touched.push(f);
		const v = map[f];
		if (v === undefined) throw new Error(`ENOENT: ${f}`);
		return v;
	};
	const all = (irregular: readonly string[] = []): ActiveStoreEntry[] =>
		Object.keys(map).map((filename) => ({ filename, regularFile: !irregular.includes(filename) }));

	const rivals = nativeSessionIdRivals(own, all(), read);
	ok("rival scan finds the other holder", rivals.length === 1 && rivals[0] === `${GID_B}.meta.json`);
	ok("the record's OWN file is never its own rival", !rivals.includes(`${GID_A}.meta.json`));
	ok(
		"an unparseable neighbour is skipped, not thrown on (one corrupt file must not break addressing)",
		nativeSessionIdRivals(identity(GID_C, "native-c"), all(), read).length === 0,
	);

	// Rule 1 at the rival scan: a non-regular entry is not a candidate AND its bytes are
	// never touched. Reading it "just to check" would break the rule in the act of
	// enforcing it — the callback log is what makes that assertion real rather than
	// inferred from the verdict.
	touched.length = 0;
	const withSymlink = nativeSessionIdRivals(own, all([`${GID_B}.meta.json`]), read);
	ok("a NON-REGULAR neighbour is not a rival (symlinked bytes cannot claim an address)", withSymlink.length === 0);
	ok(
		"…and its bytes were NEVER read — the reader was not called for it (rule 1: never followed)",
		!touched.includes(`${GID_B}.meta.json`),
	);

	// A drifted neighbour is unreachable by garden-id lookup from either name, so it
	// cannot compete for an address — the certification and the listing still call it a
	// defect, but it must not blind a healthy citizen.
	{
		const driftMap: Record<string, string> = {
			[`${GID_A}.meta.json`]: serializeMetaIdentity(own),
			// filename B, body claims C, and C shares A's native id
			[`${GID_B}.meta.json`]: serializeMetaIdentity(identity(GID_C, "native-shared")),
		};
		const driftRead = (f: string): string => driftMap[f] ?? "";
		const driftEntries: ActiveStoreEntry[] = Object.keys(driftMap).map((filename) => ({
			filename,
			regularFile: true,
		}));
		ok(
			"a DRIFTED neighbour is not a rival (no garden id can reach it, so it addresses nothing)",
			nativeSessionIdRivals(own, driftEntries, driftRead).length === 0,
		);
	}

	// The other direction: a candidate we could not READ is an unanswered question, not
	// a clean scan. Parse failure and read failure are different facts and must not
	// share one catch.
	{
		const failRead = (f: string): string => {
			if (f === `${GID_B}.meta.json`) {
				const err = new Error("EACCES: permission denied") as Error & { code?: string };
				err.code = "EACCES";
				throw err;
			}
			return map[f] ?? "";
		};
		let threw = false;
		try {
			nativeSessionIdRivals(own, all(), failRead);
		} catch (err) {
			threw = err instanceof MetaRecordError && err.message.includes("unanswered question");
		}
		ok("an UNREADABLE regular candidate THROWS — it may be the duplicate (never skipped)", threw);

		// ENOENT is the one exception, and the one this repo already recognises: a file
		// that vanished between the readdir and the read is not in the store.
		const goneRead = (f: string): string => {
			if (f === `${GID_B}.meta.json`) {
				const err = new Error("ENOENT: no such file") as Error & { code?: string };
				err.code = "ENOENT";
				throw err;
			}
			return map[f] ?? "";
		};
		ok(
			"a neighbour that RACED AWAY (ENOENT) is skipped — it is not in the store, so it holds nothing",
			nativeSessionIdRivals(own, all(), goneRead).length === 0,
		);
	}
}

// --- #52: the same three shapes, driven through the REAL fs binding ----------
// The pure cells above pin the rule; these pin that the production binding hands it
// entries with the right kind. A pure-only proof would have passed while the fs path
// still did a bare-name readdir and followed symlinks — which is exactly what shipped.
{
	const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-addr-"));
	try {
		// A symlink whose target lives OUTSIDE the store and holds the same native id.
		const dir = path.join(tmp, "symlink-store");
		const outside = path.join(tmp, "outside");
		fs.mkdirSync(dir);
		fs.mkdirSync(outside);
		record(dir, GID_A, "native-shared");
		const foreign = path.join(outside, "foreign.json");
		fs.writeFileSync(foreign, serializeMetaIdentity(identity(GID_B, "native-shared")));
		fs.symlinkSync(foreign, path.join(dir, `${GID_B}.meta.json`));
		ok(
			"fs: a SYMLINKED duplicate does not quarantine the healthy regular record",
			readAddressableMetaIdentity(GID_A, dir).gardenId === GID_A,
		);
		ok(
			"fs: the listing reports that symlink as a diagnostic and lists the healthy citizen",
			(() => {
				const listed = listAllMetaIdentities(readActiveStoreEntries(dir), makeStoreRecordReader(dir));
				return (
					listed.identities.length === 1 &&
					listed.identities[0]?.gardenId === GID_A &&
					listed.errors.length === 1 &&
					listed.errors[0]?.filename === `${GID_B}.meta.json` &&
					listed.errors[0]?.message.includes("not a regular file")
				);
			})(),
		);

		// A drifted duplicate through the real binding.
		const driftDir = path.join(tmp, "drift-store");
		fs.mkdirSync(driftDir);
		record(driftDir, GID_A, "native-shared");
		fs.writeFileSync(
			path.join(driftDir, `${GID_B}.meta.json`),
			serializeMetaIdentity(identity(GID_C, "native-shared")),
		);
		ok(
			"fs: a DRIFTED duplicate does not quarantine the healthy record either",
			readAddressableMetaIdentity(GID_A, driftDir).gardenId === GID_A,
		);

		if (typeof process.getuid === "function" && process.getuid() !== 0) {
			// A regular, valid, genuine duplicate this process cannot read.
			const blindDir = path.join(tmp, "unreadable-rival");
			fs.mkdirSync(blindDir);
			record(blindDir, GID_A, "native-shared");
			const rival = path.join(blindDir, `${GID_B}.meta.json`);
			fs.writeFileSync(rival, serializeMetaIdentity(identity(GID_B, "native-shared")));
			fs.chmodSync(rival, 0o000);
			try {
				throwsNaming(
					"fs: an UNREADABLE rival makes the addressable read REFUSE (it may be the duplicate)",
					() => readAddressableMetaIdentity(GID_A, blindDir),
					"unanswered question",
				);
			} finally {
				fs.chmodSync(rival, 0o600);
			}

			// The store-level vacuity guard: if the readdir itself fails, the question was
			// never asked, and answering it anyway is the same fail-open shape.
			const unlistable = path.join(tmp, "store");
			fs.mkdirSync(unlistable);
			record(unlistable, GID_A, "native-a");
			fs.chmodSync(unlistable, 0o100); // --x: the targeted read still works, readdir does not
			try {
				throwsNaming(
					"fs: an unlistable store makes the addressable read REFUSE, never answer 'unique'",
					() => readAddressableMetaIdentity(GID_A, unlistable),
					"failure to inspect the store",
				);
			} finally {
				fs.chmodSync(unlistable, 0o700);
			}
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
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

// --- ONE contract in BOTH directions: the targeted READ holds rule 1 too ----
// Certification refuses a symlinked record on write; the targeted read used to
// FOLLOW it (existsSync + readFileSync resolve the link), so the contract held
// only where nobody was being addressed — the doctor refused an entry that v2
// dispatch, `entwurf_self` and the sender-marker trust all resolved, from bytes
// the store does not own. Found by the 2026-07-25 fresh-eyes review; both
// directions now hold the same rule.
withStore(
	(dir) => {
		record(dir, GID_A, "native-a");
		const outside = path.join(dir, "..", `psa-idcons-outside-${process.pid}`);
		fs.mkdirSync(outside, { recursive: true });
		const forged = path.join(outside, "forged.json");
		// Impeccable v3 bytes — the point is WHERE they live, not whether they parse.
		fs.writeFileSync(forged, serializeMetaIdentity(identity(GID_B, "native-forged")));
		fs.symlinkSync(forged, path.join(dir, `${GID_B}.meta.json`));
	},
	(dir) => {
		const cert = certifyActiveStoreDir(dir);
		ok(
			"certification refuses the symlinked record (rule 1)",
			cert.defects.some((d) => d.filename === `${GID_B}.meta.json` && d.message.includes("not a regular file")),
		);
		throwsNaming(
			"the TARGETED read refuses the same entry instead of following it (one contract, both directions)",
			() => readMetaIdentityByGardenId(GID_B, dir),
			"not a regular file",
		);
		throwsNaming(
			"that refusal names the fresh-cut verb (the one prescription every defect collapses to)",
			() => readMetaIdentityByGardenId(GID_B, dir),
			FRESH_CUT_COMMAND,
		);
		ok(
			"a regular-file neighbour in the same store still reads (the refusal is per-entry, not a store-wide read block)",
			readMetaIdentityByGardenId(GID_A, dir).nativeSessionId === "native-a",
		);
		fs.rmSync(path.join(dir, "..", `psa-idcons-outside-${process.pid}`), { recursive: true, force: true });
	},
);

// --- every refusal names the verb, including the drift diagnostics -----------
// A record whose body disagrees with its name is unreachable by garden id, so it
// earns the SAME prescription as any other defect. The drift paths used to say
// "Remove or fix it" and name no verb, which contradicted the promise that the
// read surfaces fail loud naming fresh-cut in both invocation forms.
withStore(
	(dir) => {
		write(dir, `${GID_A}.meta.json`, serializeMetaIdentity(identity(GID_B, "native-drift")));
	},
	(dir) => {
		throwsNaming(
			"body/filename drift on a targeted read names the fresh-cut verb",
			() => readMetaIdentityByGardenId(GID_A, dir),
			FRESH_CUT_COMMAND,
		);
		const listed = listAllMetaIdentities(readActiveStoreEntries(dir), makeStoreRecordReader(dir));
		ok(
			"the listing's drift diagnostic names the verb too (a facts surface still says what to do)",
			listed.errors.length === 1 && (listed.errors[0]?.message ?? "").includes(FRESH_CUT_COMMAND),
		);
	},
);

// --- an inspection FAILURE is never reported as an absent citizen ------------
// `entwurf_v2` splits soft from hard on exactly this question: a MISSING record is a
// soft `bad-target`, a present-but-corrupt one must fail loud. `existsSync` answered
// `false` for an entry it merely could not stat, so an unreadable store looked like a
// clean "no such citizen" — the fail-open shape (2026-07-25 fresh-eyes review). ENOENT
// alone is absence; a broken store SHAPE (ENOTDIR here) is a failure to inspect.
{
	const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-shape-"));
	try {
		const brokenStore = path.join(tmp, "store-is-actually-a-file");
		fs.writeFileSync(brokenStore, "not a store\n");
		throwsNaming(
			"the existence check THROWS on a broken store shape instead of answering false",
			() => metaRecordExistsByGardenId(GID_A, brokenStore),
			"inspection failure",
		);
		throwsNaming(
			"the targeted read refuses the same way (one inspect seam, both surfaces)",
			() => readMetaIdentityByGardenId(GID_A, brokenStore),
			"inspection failure",
		);
		ok(
			"a genuine absence still answers false — ENOENT alone is absence",
			metaRecordExistsByGardenId(GID_A, path.join(tmp, "no-such-store")) === false,
		);
		ok(
			"a symlinked record answers PRESENT so the refusal comes from the loud read, not a silent negative",
			(() => {
				const dir = path.join(tmp, "store");
				fs.mkdirSync(dir);
				fs.symlinkSync(path.join(tmp, "elsewhere.json"), path.join(dir, `${GID_A}.meta.json`));
				return metaRecordExistsByGardenId(GID_A, dir) === true;
			})(),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

// --- an unreadable STORE is not an empty store -------------------------------
// The store-wide half of the same rule. `existsSync` answers false for a directory it
// merely cannot search, so an ancestor-EACCES store certified as "0 records, no defects"
// — the doctor and the install preflight would call an unreadable host clean. ENOENT
// alone is an absent store (a host that never had a generation is not broken).
{
	const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-unreadable-"));
	try {
		ok(
			"an absent store still certifies as empty (ENOENT alone)",
			certifyActiveStoreDir(path.join(tmp, "never-existed")).defects.length === 0,
		);
		// ENOTDIR — deterministic, and it takes the same errno branch EACCES does (only
		// ENOENT is special-cased), so it pins the classifier without needing a permission
		// bit that root would ignore.
		const notADir = path.join(tmp, "store-is-a-file");
		fs.writeFileSync(notADir, "not a store\n");
		assert.throws(
			() => certifyActiveStoreDir(notADir),
			(err: unknown) => err instanceof MetaRecordError && /failure to inspect the store/.test(err.message),
			"a non-directory store path must not certify as empty",
		);
		console.log("  ok    a store path that is not a directory THROWS instead of certifying empty");
		passed++;
		// The permission form of the same failure, where the platform allows proving it.
		if (typeof process.getuid === "function" && process.getuid() !== 0) {
			const blocked = path.join(tmp, "blocked");
			fs.mkdirSync(path.join(blocked, "store"), { recursive: true });
			fs.chmodSync(blocked, 0o000);
			try {
				assert.throws(
					() => certifyActiveStoreDir(path.join(blocked, "store")),
					(err: unknown) => err instanceof MetaRecordError && /failure to inspect the store/.test(err.message),
					"a store behind an unsearchable ancestor must not certify as empty",
				);
				console.log("  ok    a store whose ancestor cannot be searched THROWS instead of certifying empty");
				passed++;
			} finally {
				fs.chmodSync(blocked, 0o700);
			}
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

console.log(`[check-meta-identity-consumers] ${passed} assertions ok`);
