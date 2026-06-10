/**
 * check-meta-dual-consumers — deterministic gate for 0.11 Stage 0 step 3D-4 commit1
 * (green checkpoint). The delivery-agnostic dual-read seam: readMetaIdentityByGardenId
 * + scanIdentityByNativeId read v1 AND v2 records and return normalized identity, so
 * the consumers that move onto them (MCP sender-marker check, prune, store-doctor, and
 * the v2 upsert's existence scan in commit2) survive the v2 cut. Pure + a real temp
 * dir; no backend, no network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the dual-read identity seam (the live path + scanIdentityByNativeId now read
 * v1 AND v2; the v1-only raw readers remain for v1-fixture gates):
 *  - readMetaIdentityByGardenId normalizes a v1 file (lastSeen→recordUpdatedAt,
 *    transcriptPath carried, model/parentGardenId null, isEntwurf false) and reads a v2
 *    file as-is; body/filename gardenId drift fails-fast.
 *  - scanIdentityByNativeId matches by nativeSessionId across BOTH schemas, returns null
 *    on no match, skips non-.meta.json, surfaces malformed via onSkip, and — THE G1
 *    invariant — flags a nativeSessionId duplicated across a v1 AND a v2 file as
 *    authority ambiguity (throw), so the v2 upsert never mints a duplicate id for an
 *    existing citizen.
 *
 * Scope is commit1 ONLY: dual-read capability, additive. The cut (enqueue/read
 * record-stamp stop + v2 upsert/migration) is commit2 = 끊을 지점 ②.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type MetaIdentity,
	MetaRecordError,
	mintMetaRecord,
	readMetaIdentityByGardenId,
	scanIdentityByNativeId,
	serializeMetaIdentity,
	serializeMetaRecord,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throws(label: string, fn: () => unknown): void {
	assert.throws(fn, MetaRecordError, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const T0 = new Date("2026-03-01T12:00:00.000Z");

// A v1 record (mint → serialize) and a v2 identity (hand-built → serialize). The v2
// id is a pi citizen with a null transcriptPath (nullable-at-birth), exercising the
// shape v1 never had.
const v1 = mintMetaRecord(
	{ backend: "claude-code", nativeSessionId: "n-v1", transcriptPath: "/tmp/t.jsonl", cwd: "/tmp/v1" },
	T0,
);
const v1Json = serializeMetaRecord(v1);
const V2_GID = "20260301T120000-aaaaaa";
const v2: MetaIdentity = {
	schemaVersion: 2,
	gardenId: V2_GID,
	backend: "pi",
	nativeSessionId: "n-v2",
	cwd: "/tmp/v2",
	model: null,
	transcriptPath: null,
	parentGardenId: null,
	isEntwurf: false,
	createdAt: T0.toISOString(),
	recordUpdatedAt: T0.toISOString(),
};
const v2Json = serializeMetaIdentity(v2);

// --- scanIdentityByNativeId: dual-schema in-memory scan --------------------
const reader = (f: string): string => {
	if (f === `${v1.gardenId}.meta.json`) return v1Json;
	if (f === `${V2_GID}.meta.json`) return v2Json;
	throw new Error(`no fixture for ${f}`);
};
const entries = [`${v1.gardenId}.meta.json`, `${V2_GID}.meta.json`, "README.md"];

const foundV1 = scanIdentityByNativeId(entries, "n-v1", reader);
ok(
	"scanIdentityByNativeId: matches a v1 record (normalized identity)",
	foundV1?.gardenId === v1.gardenId && foundV1?.backend === "claude-code",
);
const foundV2 = scanIdentityByNativeId(entries, "n-v2", reader);
ok(
	"scanIdentityByNativeId: matches a v2 record (pi, null transcriptPath)",
	foundV2?.gardenId === V2_GID && foundV2?.transcriptPath === null,
);
ok(
	"scanIdentityByNativeId: returns null when no body matches",
	scanIdentityByNativeId(entries, "n-absent", reader) === null,
);
ok(
	"scanIdentityByNativeId: ignores non-.meta.json entries (README.md not read)",
	scanIdentityByNativeId(["README.md"], "n-v1", reader) === null,
);

// THE G1 invariant: the same nativeSessionId in a v1 AND a v2 file is an authority
// ambiguity across schemas — fail-fast, so the v2 upsert never duplicate-mints.
const dupReader = (f: string): string =>
	f === "a.meta.json" ? v1Json : f === "b.meta.json" ? v2Json.replace(`"n-v2"`, `"n-v1"`) : "";
throws("scanIdentityByNativeId: nativeSessionId duplicated across v1 AND v2 → ambiguity throw (G1)", () =>
	scanIdentityByNativeId(["a.meta.json", "b.meta.json"], "n-v1", dupReader),
);

// malformed entry surfaces via onSkip, scan continues to find the good one
const skipped: string[] = [];
const mixedReader = (f: string): string => (f === "bad.meta.json" ? "{not json" : v1Json);
const survived = scanIdentityByNativeId(["bad.meta.json", `${v1.gardenId}.meta.json`], "n-v1", mixedReader, (f) =>
	skipped.push(f),
);
ok(
	"scanIdentityByNativeId: malformed entry skipped via onSkip, scan continues",
	survived?.gardenId === v1.gardenId && skipped.length === 1,
);

// --- readMetaIdentityByGardenId: dual-schema read-by-gardenId on disk ------
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-dualcons-")));
try {
	fs.writeFileSync(path.join(tmpRoot, `${v1.gardenId}.meta.json`), v1Json);
	fs.writeFileSync(path.join(tmpRoot, `${V2_GID}.meta.json`), v2Json);

	const idV1 = readMetaIdentityByGardenId(v1.gardenId, tmpRoot);
	ok(
		"readMetaIdentityByGardenId: v1 file normalizes (lastSeen→recordUpdatedAt, transcript carried, model/parent null, not entwurf)",
		idV1.schemaVersion === 2 &&
			idV1.recordUpdatedAt === v1.lastSeen &&
			idV1.transcriptPath === "/tmp/t.jsonl" &&
			idV1.model === null &&
			idV1.parentGardenId === null &&
			idV1.isEntwurf === false,
	);
	const idV2 = readMetaIdentityByGardenId(V2_GID, tmpRoot);
	ok(
		"readMetaIdentityByGardenId: v2 file reads as-is (pi, null transcriptPath)",
		idV2.backend === "pi" && idV2.transcriptPath === null,
	);

	// body/filename gardenId drift is corruption — fail-fast (body is SSOT).
	const OTHER = "20260301T120000-bbbbbb";
	fs.writeFileSync(path.join(tmpRoot, `${OTHER}.meta.json`), v2Json); // body says V2_GID, filename says OTHER
	throws("readMetaIdentityByGardenId: body/filename gardenId drift is corruption", () =>
		readMetaIdentityByGardenId(OTHER, tmpRoot),
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-meta-dual-consumers] ${passed} assertions ok`);
