/**
 * check-meta-listing — deterministic gate for `listAllMetaIdentities` (0.11
 * Stage 0 step 4, slice 4a). The meta-store axis the fact-provider consumes.
 *
 * Proves the explicit-partial contract (Fable Q2 / GPT힣):
 *   - valid records → identities, sorted by gardenId,
 *   - a parse failure does NOT blind the listing — valid records still surface,
 *     and the corrupt one becomes an explicit error (the 0.10 "corrupt blocks
 *     registration forever" lesson),
 *   - body/filename drift (body gardenId ≠ filename) → error, excluded from
 *     identities (same authority check as readMetaIdentityByGardenId),
 *   - a throwing reader (file vanished) → error, not a crash,
 *   - non-`.meta.json` entries ignored,
 *   - verbatim-or-nothing: an error carries ONLY {filename, message} — never a
 *     half-parsed identity field (a salvaged gid string as a fact = synthetic),
 *   - mode "strict" throws on any error; "collect" (default) returns partial,
 *   - errors sorted by filename.
 *
 * Pure; entries/readRecord injected, no IO.
 */

import assert from "node:assert/strict";
import {
	listAllMetaIdentities,
	type MetaBackendV2,
	type MetaIdentity,
	serializeMetaIdentity,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID_A = "20260611T111111-aaaaaa";
const GID_B = "20260611T222222-bbbbbb";

function rec(gardenId: string, over: Partial<MetaIdentity> = {}): string {
	const backend: MetaBackendV2 = "pi";
	return serializeMetaIdentity({
		schemaVersion: 3,
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: null,
		transcriptPath: null,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		...over,
	});
}

function reader(map: Record<string, string>): (filename: string) => string {
	return (filename: string) => {
		const v = map[filename];
		if (v === undefined) throw new Error(`ENOENT: ${filename}`);
		return v;
	};
}

// ── valid records → identities, sorted ──────────────────────────────────────
{
	const map = { [`${GID_B}.meta.json`]: rec(GID_B), [`${GID_A}.meta.json`]: rec(GID_A) };
	const { identities, errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	ok("2 valid → 2 identities, 0 errors", identities.length === 2 && errors.length === 0);
	ok("identities sorted by gardenId", identities[0]?.gardenId === GID_A);
}

// ── corrupt record does NOT blind the listing ───────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), [`${GID_B}.meta.json`]: "{ broken json" };
	const { identities, errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	ok("corrupt 1 → valid still listed (not blinded)", identities.length === 1 && identities[0]?.gardenId === GID_A);
	ok("corrupt → exactly 1 error", errors.length === 1);
	ok("error names the corrupt file", errors[0]?.filename === `${GID_B}.meta.json`);
}

// ── body/filename drift → error, excluded ───────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_B) }; // filename A, body claims B
	const { identities, errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	ok("drift → excluded from identities", identities.length === 0);
	ok("drift → 1 error mentioning drift", errors.length === 1 && /drift/.test(errors[0]?.message ?? ""));
}

// ── throwing reader (file vanished) → error, not crash ──────────────────────
{
	const read = (f: string): string => {
		if (f === `${GID_B}.meta.json`) throw new Error("ENOENT mid-scan");
		return rec(GID_A);
	};
	const { identities, errors } = listAllMetaIdentities([`${GID_A}.meta.json`, `${GID_B}.meta.json`], read);
	ok("reader throw → error, valid still listed", identities.length === 1 && errors.length === 1);
}

// ── non-.meta.json ignored ──────────────────────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), "README.txt": "x", "inbox.signal": "y" };
	const { identities, errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	ok("non-.meta.json entries ignored", identities.length === 1 && errors.length === 0);
}

// ── verbatim-or-nothing: error keyset = {filename, message} ─────────────────
{
	const map = { [`${GID_A}.meta.json`]: "{ broken" };
	const { errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	const keys = Object.keys(errors[0] ?? {}).sort();
	assert.deepStrictEqual(keys, ["filename", "message"], `error keyset drift: ${keys.join(",")}`);
	ok("error verbatim-or-nothing (filename + message only, no identity field)", true);
}

// ── strict vs collect ───────────────────────────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), [`${GID_B}.meta.json`]: "{ broken" };
	let threw = false;
	try {
		listAllMetaIdentities(Object.keys(map), reader(map), { mode: "strict" });
	} catch {
		threw = true;
	}
	ok("mode strict → throw if any record unreadable", threw);
	const { identities } = listAllMetaIdentities(Object.keys(map), reader(map), { mode: "collect" });
	ok("mode collect (default) → partial, no throw", identities.length === 1);
}

// ── errors sorted by filename ───────────────────────────────────────────────
{
	const map = { [`${GID_B}.meta.json`]: "{ x", [`${GID_A}.meta.json`]: "{ y" };
	const { errors } = listAllMetaIdentities(Object.keys(map), reader(map));
	ok("errors sorted by filename", errors[0]?.filename === `${GID_A}.meta.json`);
}

console.log(`\n[check-meta-listing] ${passed} assertions ok`);
