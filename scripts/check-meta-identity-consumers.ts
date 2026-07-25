/**
 * check-meta-identity-consumers — deterministic gate for the V3-only identity
 * consumer seam. A real temp dir; no backend, no network, no hook. Safe in the
 * `pnpm check` static floor.
 *
 * Proves the consumers every live path stands on (MCP sender-marker check,
 * prune, store-doctor, the upsert existence scan):
 *   - readMetaIdentityByGardenId reads a V3 file to identity; body/filename
 *     gardenId drift fails fast (body is SSOT); a previous-generation (v2)
 *     file throws the error that names the fresh-cut command; a missing record
 *     throws the "not a garden citizen" error,
 *   - scanIdentityByNativeId matches a V3 record by nativeSessionId, returns
 *     null on no match, ignores non-`.meta.json` entries, surfaces malformed
 *     AND previous-generation records via `onSkip` (the pure scan reports;
 *     policy lives in the writer), and — THE G1 invariant — throws on a
 *     nativeSessionId duplicated across two records (authority ambiguity:
 *     upsert must never mint a duplicate id for an existing citizen),
 *   - birthPiCitizen REFUSES a store holding any unreadable record (the strict
 *     upsert: writing beside a record the live schema cannot read is how a
 *     mixed store forms — the refusal names fresh-cut, before any write).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	FRESH_CUT_COMMAND,
	type MetaIdentity,
	MetaRecordError,
	readMetaIdentityByGardenId,
	scanIdentityByNativeId,
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

const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-"));
try {
	fs.writeFileSync(path.join(dir, `${GID_A}.meta.json`), serializeMetaIdentity(identity(GID_A, "native-a")));
	fs.writeFileSync(path.join(dir, `${GID_B}.meta.json`), serializeMetaIdentity(identity(GID_B, "native-b")));
	// A previous-generation v2 record, raw JSON on purpose (production has no v2 writer).
	fs.writeFileSync(
		path.join(dir, `${GID_V2}.meta.json`),
		`${JSON.stringify(
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
		)}\n`,
	);
	fs.writeFileSync(path.join(dir, "not-a-record.txt"), "ignore me\n");
	fs.writeFileSync(path.join(dir, "malformed.meta.json"), "{nope\n");

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
	// Body/filename drift: a file named B whose body claims A is corrupt.
	const driftFile = path.join(dir, "20260301T120003-dddddd.meta.json");
	fs.writeFileSync(driftFile, serializeMetaIdentity(identity(GID_A, "native-drift")));
	throwsNaming(
		"readMetaIdentityByGardenId fails fast on body/filename gardenId drift (body is SSOT)",
		() => readMetaIdentityByGardenId("20260301T120003-dddddd", dir),
		"drift",
	);
	fs.rmSync(driftFile);

	// --- scanIdentityByNativeId -------------------------------------------------
	const entries = fs.readdirSync(dir);
	const readRaw = (f: string): string => fs.readFileSync(path.join(dir, f), "utf8");
	const skipped: string[] = [];
	const onSkip = (f: string): void => {
		skipped.push(f);
	};

	const hit = scanIdentityByNativeId(entries, "native-b", readRaw, onSkip);
	ok("scanIdentityByNativeId matches a V3 record by nativeSessionId", hit?.gardenId === GID_B);
	// Authority is the record BODY, never the filename: a record parked under a
	// decoy filename is still found by its body nativeSessionId.
	const GID_DECOY = "20260301T120005-abcdef";
	fs.writeFileSync(
		path.join(dir, "19990101T000000-deadbe.meta.json"),
		serializeMetaIdentity(identity(GID_DECOY, "native-decoy")),
	);
	ok(
		"scan authority is the BODY, not the filename (decoy filename still found)",
		scanIdentityByNativeId(fs.readdirSync(dir), "native-decoy", readRaw)?.gardenId === GID_DECOY,
	);
	fs.rmSync(path.join(dir, "19990101T000000-deadbe.meta.json"));
	ok(
		"scan surfaces malformed AND previous-generation records via onSkip (the pure scan reports)",
		skipped.includes("malformed.meta.json") && skipped.includes(`${GID_V2}.meta.json`),
	);
	ok("scan ignores non-.meta.json entries", !skipped.includes("not-a-record.txt"));
	ok("scan returns null on no match", scanIdentityByNativeId(entries, "native-none", readRaw) === null);

	// --- pi birth REFUSES a store it cannot fully read (the strict upsert) ------
	// Writing a fresh V3 citizen beside a record the live schema cannot read is
	// how a mixed store forms with nobody told (observed live 2026-07-23). The
	// strict upsert refuses BEFORE any write and names the generation cut.
	throwsNaming(
		"birth on a store holding an unreadable record REFUSES naming the fresh-cut command",
		() =>
			birthPiCitizen({
				nativeSessionId: "pi-fresh-on-prevgen-store",
				cwd: "/synthetic/proj",
				sessionsDir: dir,
				controlSocketDir: path.join(dir, "sockets"),
			}),
		FRESH_CUT_COMMAND,
	);
	ok(
		"the refused birth wrote nothing (no record minted for the new native id)",
		scanIdentityByNativeId(fs.readdirSync(dir), "pi-fresh-on-prevgen-store", readRaw) === null,
	);

	// --- birth SUCCEEDS once the store is clean (the same seam, post-cut) -------
	{
		const cleanDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "psa-idcons-clean-"));
		try {
			const birth = birthPiCitizen({
				nativeSessionId: "pi-fresh-on-clean-store",
				cwd: "/synthetic/proj",
				sessionsDir: cleanDir,
				controlSocketDir: path.join(cleanDir, "sockets"),
			});
			ok("birth on a clean store succeeds (create)", birth.action === "create");
		} finally {
			fs.rmSync(cleanDir, { recursive: true, force: true });
		}
	}

	// --- G1: duplicate nativeSessionId = authority ambiguity --------------------
	const GID_DUP = "20260301T120004-eeeeee";
	fs.writeFileSync(path.join(dir, `${GID_DUP}.meta.json`), serializeMetaIdentity(identity(GID_DUP, "native-a")));
	throwsNaming(
		"G1: a nativeSessionId matching two records is an authority ambiguity (throw, never pick one)",
		() => scanIdentityByNativeId(fs.readdirSync(dir), "native-a", readRaw),
		"ambiguous",
	);
} finally {
	fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`[check-meta-identity-consumers] ${passed} assertions ok`);
