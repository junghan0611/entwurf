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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type ActiveStoreEntry,
	certifyActiveStore,
	certifyActiveStoreDir,
	classifyRecordReadFailure,
	FRESH_CUT_COMMAND,
	listAllMetaIdentities,
	type MetaIdentity,
	MetaRecordError,
	makeStoreRecordReader,
	metaRecordExistsByGardenId,
	NOT_REGULAR_ENTRY_CODE,
	nativeSessionIdRivals,
	type RecordReadFailure,
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

// --- #52: rule 1 survives the RACE, not just the settled store ---------------
// The cells above hand the reader an entry that was already a symlink when the scan
// classified it. The defect this pins is the other order: the entry is a REGULAR FILE at
// classification time and a symlink by the time the bytes are read. `lstat`-then-
// `readFileSync(path)` classifies one entry and reads another, so it followed the swap
// into foreign bytes while every "is it a symlink" test on a settled store stayed green.
// A plain already-a-symlink read cannot fail that way, so it cannot prove this.
{
	const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-toctou-"));
	try {
		const dir = path.join(tmp, "store");
		const outside = path.join(tmp, "outside");
		fs.mkdirSync(dir);
		fs.mkdirSync(outside);
		const FOREIGN = serializeMetaIdentity(identity(GID_B, "native-foreign"));
		const foreign = path.join(outside, "foreign.json");
		fs.writeFileSync(foreign, FOREIGN);

		const filename = `${GID_B}.meta.json`;
		const target = path.join(dir, filename);
		record(dir, GID_B, "native-own");

		// The snapshot the production scan takes — and it says REGULAR, which is the whole
		// point: every kind-based guard downstream is now working from a true-but-stale fact.
		const snapshot = readActiveStoreEntries(dir).find((e) => e.filename === filename);
		ok("toctou: the entry is classified as a regular file BEFORE the swap", snapshot?.regularFile === true);

		// …now the swap, in the window the old code left open.
		fs.unlinkSync(target);
		fs.symlinkSync(foreign, target);

		let followed: string | null = null;
		let raced: unknown;
		try {
			followed = makeStoreRecordReader(dir)(filename);
		} catch (err) {
			raced = err;
		}
		ok("toctou: the shared reader refuses the swapped entry instead of returning bytes", followed === null);
		ok(
			"toctou: not one byte of the FOREIGN file is read (the refusal is the open, not a later parse)",
			followed !== FOREIGN,
		);
		ok(
			"toctou: the refusal keeps its errno (ELOOP), so callers can still tell it from ENOENT",
			(raced as { code?: unknown } | undefined)?.code === "ELOOP",
		);
		// LAYER 1 — the settled store, classified WITHOUT opening anything. These are not
		// the race mapping (that is pinned purely, further down): the `lstat` policy answers
		// first here, which is exactly what must keep happening. Deleting this layer in
		// favour of the fd looked like removing a duplicate and regressed every shape whose
		// `open` errno is not about regularity — a socket (ENXIO) and a mode-000 directory
		// (EACCES) both became "inspection failure" instead of the certification's own
		// sentence (2026-07-26 cross-review round 3, reproduced).
		throwsNaming(
			"settled: a symlinked record earns the not-a-regular-file refusal without being opened",
			() => readMetaIdentityByGardenId(GID_B, dir),
			"not a regular file",
		);
		throwsNaming(
			"settled: …and that refusal names the fresh-cut verb",
			() => readMetaIdentityByGardenId(GID_B, dir),
			FRESH_CUT_COMMAND,
		);

		// A fifo is why the open carries O_NONBLOCK: `open(fifo, O_RDONLY)` BLOCKS until a
		// writer appears, so deciding the kind ON THE FD would hang every scan on a host
		// where nobody is writing — a hazard classify-then-read did not have. The cell must
		// therefore be able to FAIL on a regression, and a blocking call in this process can
		// only hang: the gate would be killed by whatever timeout wraps it, which is not an
		// assertion (verified: dropping the flag made this gate hang until SIGTERM, rc=124).
		// So the read runs in a CHILD with a bounded timeout, and the timeout IS the failure.
		{
			const fifoDir = path.join(tmp, "fifo-store");
			fs.mkdirSync(fifoDir);
			const fifo = path.join(fifoDir, `${GID_A}.meta.json`);
			// No silent skip: Linux is the only certified axis, so a host without `mkfifo`
			// cannot quietly downgrade this proof — it fails here instead.
			execFileSync("mkfifo", [fifo], { stdio: "ignore" });
			const childSrc = path.join(tmp, "fifo-child.mjs");
			const lib = new URL("../pi-extensions/lib/meta-session.ts", import.meta.url).pathname;
			fs.writeFileSync(
				childSrc,
				`import { makeStoreRecordReader, NOT_REGULAR_ENTRY_CODE } from ${JSON.stringify(lib)};\n` +
					`try {\n` +
					`  makeStoreRecordReader(${JSON.stringify(fifoDir)})(${JSON.stringify(`${GID_A}.meta.json`)});\n` +
					`  console.log("RETURNED-BYTES");\n` +
					`} catch (err) {\n` +
					`  console.log(err?.code === NOT_REGULAR_ENTRY_CODE ? "REFUSED-NOT-REGULAR" : "OTHER:" + err?.code);\n` +
					`}\n`,
			);
			let verdict: string;
			try {
				verdict = execFileSync(process.execPath, [childSrc], { timeout: 10_000, encoding: "utf8" }).trim();
			} catch (err) {
				const e = err as { code?: unknown; killed?: boolean };
				const timedOut = e.code === "ETIMEDOUT" || e.killed === true;
				verdict = timedOut ? "BLOCKED-ON-OPEN (the open never returned — O_NONBLOCK is gone)" : `CHILD-FAILED: ${err}`;
			}
			ok(
				`a fifo is refused as not-a-regular-file and the open RETURNS (O_NONBLOCK) — child said ${verdict}`,
				verdict === "REFUSED-NOT-REGULAR",
			);
		}

		// Every refusal above runs through a `finally closeSync`. A reader that leaks the
		// description on the refusing paths would exhaust the process's fds on a store full
		// of them, which is a slow death rather than a loud one — so it gets counted.
		if (fs.existsSync("/proc/self/fd")) {
			const openFds = (): number => fs.readdirSync("/proc/self/fd").length;
			const goodDir = path.join(tmp, "good-store");
			fs.mkdirSync(goodDir);
			record(goodDir, GID_A, "native-a");
			const read = makeStoreRecordReader(goodDir);
			read(`${GID_A}.meta.json`); // warm any lazy fd the runtime opens on first read
			const before = openFds();
			for (let i = 0; i < 200; i++) {
				read(`${GID_A}.meta.json`);
				try {
					makeStoreRecordReader(dir)(filename); // the ELOOP path
				} catch {}
			}
			ok("the reader closes its fd on BOTH the returning and the refusing path", openFds() === before);
		}

		// LAYER 2 — the race mapping, pinned PURELY. With layer 1 in front of it, no settled
		// store can reach these branches, so a runtime cell cannot hold them: the previous
		// round's "targeted mapping" cells were vacuous for exactly that reason and passed
		// with the mapping deleted. A pure errno classifier is the seam that IS decidable,
		// and a synthetic errno takes the same branch a real one does.
		{
			const cases: [unknown, RecordReadFailure, string][] = [
				["ENOENT", "absent", "a record that vanished mid-read is absence, and absence alone"],
				["ELOOP", "irregular", "O_NOFOLLOW refusing a swapped-in symlink is the settled symlink verdict"],
				["ENXIO", "irregular", "a socket swapped in mid-read says what lstat would have said, not 'unreadable'"],
				[NOT_REGULAR_ENTRY_CODE, "irregular", "the fstat verdict (directory/fifo on the fd) is irregular too"],
				["EACCES", "unreadable", "an unreadable entry stays LOUD — never laundered into a clean negative"],
				["ENOTDIR", "unreadable", "a broken store shape is an inspection failure"],
				[undefined, "unreadable", "an errno-less failure is unreadable, never absence"],
			];
			for (const [code, expected, why] of cases) {
				ok(`race mapping: ${String(code)} → ${expected} — ${why}`, classifyRecordReadFailure(code) === expected);
			}
		}

		// A UNIX SOCKET wearing a record's name — the shape that exposed the regression. It
		// is pinned in BOTH layers: classified non-regular without being opened here, and
		// (if it were swapped in mid-read) mapped from ENXIO to the same sentence above. What
		// this cell holds is the CONTRACT — certification and the targeted read must say the
		// same thing about one entry — not layer 1's existence: with ENXIO mapped, an
		// fd-only build still answers correctly here. The cell that holds layer 1 is the
		// mode-000 directory below, whose errno (EACCES) is genuinely about permission and
		// so cannot stand in for a regularity verdict. Both are needed; neither replaces the
		// other. (Verified by mutation: removing layer 1 leaves this cell green and reds
		// that one.)
		{
			const sockStore = path.join(tmp, "socket-store");
			fs.mkdirSync(sockStore);
			const sockPath = path.join(sockStore, `${GID_A}.meta.json`);
			const binder = path.join(tmp, "bind-socket.mjs");
			fs.writeFileSync(
				binder,
				'import net from "node:net";\n' +
					"const srv = net.createServer();\n" +
					"srv.listen(process.argv[2], () => { srv.unref(); process.exit(0); });\n",
			);
			execFileSync(process.execPath, [binder, sockPath], { timeout: 10_000, stdio: "ignore" });
			ok("socket-shaped record: the entry really is a socket on disk", fs.lstatSync(sockPath).isSocket());
			throwsNaming(
				"socket-shaped record: the TARGETED read calls it not-a-regular-file (not 'inspection failure')",
				() => readMetaIdentityByGardenId(GID_A, sockStore),
				"not a regular file",
			);
			throwsNaming(
				"socket-shaped record: …naming the fresh-cut verb, like every other rule-1 defect",
				() => readMetaIdentityByGardenId(GID_A, sockStore),
				FRESH_CUT_COMMAND,
			);
			ok(
				"socket-shaped record: certification says the same thing (one contract, both directions)",
				certifyActiveStoreDir(sockStore).defects.some(
					(d) => d.filename === `${GID_A}.meta.json` && d.message.includes("not a regular file"),
				),
			);
			ok(
				"socket-shaped record: the listing reports it as a diagnostic, never as a citizen",
				(() => {
					const listed = listAllMetaIdentities(readActiveStoreEntries(sockStore), makeStoreRecordReader(sockStore));
					return listed.identities.length === 0 && (listed.errors[0]?.message ?? "").includes("not a regular file");
				})(),
			);
		}

		// The contract BOUNDARY, stated rather than assumed: a mode-000 directory is refused
		// as non-regular by the classification, and its EACCES-on-open is never consulted.
		// (If layer 1 were removed again, this cell reads "inspection failure" and goes red.)
		if (typeof process.getuid === "function" && process.getuid() !== 0) {
			const specialStore = path.join(tmp, "mode000-dir-store");
			const entry = path.join(specialStore, `${GID_A}.meta.json`);
			fs.mkdirSync(entry, { recursive: true });
			fs.chmodSync(entry, 0o000);
			try {
				throwsNaming(
					"a mode-000 DIRECTORY record is non-regular by classification — its open EACCES is never reached",
					() => readMetaIdentityByGardenId(GID_A, specialStore),
					"not a regular file",
				);
			} finally {
				fs.chmodSync(entry, 0o700);
			}
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

// --- #52: both production readers converge on the one fd reader --------------
// The runtime cells above can only prove the seam they are pointed at. This is the
// fence that keeps a third `readFileSync(<path>)` from growing back at either boundary —
// the same structural discipline `readActiveStoreEntries` holds for the entry kind, and
// the one `pi_settings_io` learned when a second settings writer was missed.
{
	const src = fs.readFileSync(new URL("../pi-extensions/lib/meta-session.ts", import.meta.url), "utf8");
	const bodyOf = (decl: string): string => {
		const start = src.indexOf(decl);
		assert.ok(start >= 0, `source fence: ${decl} not found`);
		const next = src.indexOf("\nexport ", start + decl.length);
		return src.slice(start, next < 0 ? undefined : next);
	};
	for (const decl of ["export function makeStoreRecordReader", "export function readMetaIdentityByGardenId"]) {
		const body = bodyOf(decl);
		ok(
			`source fence: ${decl.replace("export function ", "")} reads through readStoreRecordFile`,
			/readStoreRecordFile\(/.test(body),
		);
		ok(
			`source fence: ${decl.replace("export function ", "")} keeps no path-based readFileSync`,
			!/fs\.readFileSync\(/.test(body),
		);
	}
	const reader = bodyOf("export function readStoreRecordFile");
	ok("source fence: the fd reader opens with O_NOFOLLOW (a swapped symlink fails the open)", /O_NOFOLLOW/.test(reader));
	ok("source fence: …and with O_NONBLOCK, so a fifo cannot block the open", /O_NONBLOCK/.test(reader));
	ok("source fence: …decides the kind on the fd via fstat, not on the name", /fstatSync\(fd\)/.test(reader));
	ok("source fence: …and closes the description in a finally", /finally \{\n\t\tfs\.closeSync\(fd\);/.test(reader));
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
