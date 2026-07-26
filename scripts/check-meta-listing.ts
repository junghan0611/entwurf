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
 * #52 adds the store-WIDE half this listing can afford (it already holds every
 * record): two records claiming one `nativeSessionId` are not two citizens. NEITHER
 * is listed — a facts surface may not mint the ownership the certification refuses
 * to mint — both become errors naming each other, and every unrelated citizen keeps
 * listing. Before this, `entwurf_peers` reported a store the doctor calls
 * uncertifiable as clean, which is a wrong FACT, not merely a missing guard.
 *
 * Pure; entries/readRecord injected, no IO.
 */

import assert from "node:assert/strict";
import {
	type ActiveStoreEntry,
	listAllMetaIdentities,
	type MetaCitizenBackend,
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
	const backend: MetaCitizenBackend = "pi";
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

/** Store entries from a fixture map — every name a REGULAR file unless `irregular` says
 * otherwise. The listing takes kind, not bare names, so rule 1 (a symlinked record is
 * refused and never followed) is enforceable on this surface too. */
function entries(map: Record<string, string>, irregular: readonly string[] = []): ActiveStoreEntry[] {
	return Object.keys(map).map((filename) => ({ filename, regularFile: !irregular.includes(filename) }));
}

// ── valid records → identities, sorted ──────────────────────────────────────
{
	const map = { [`${GID_B}.meta.json`]: rec(GID_B), [`${GID_A}.meta.json`]: rec(GID_A) };
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("2 valid → 2 identities, 0 errors", identities.length === 2 && errors.length === 0);
	ok("identities sorted by gardenId", identities[0]?.gardenId === GID_A);
}

// ── corrupt record does NOT blind the listing ───────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), [`${GID_B}.meta.json`]: "{ broken json" };
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("corrupt 1 → valid still listed (not blinded)", identities.length === 1 && identities[0]?.gardenId === GID_A);
	ok("corrupt → exactly 1 error", errors.length === 1);
	ok("error names the corrupt file", errors[0]?.filename === `${GID_B}.meta.json`);
}

// ── body/filename drift → error, excluded ───────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_B) }; // filename A, body claims B
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("drift → excluded from identities", identities.length === 0);
	ok("drift → 1 error mentioning drift", errors.length === 1 && /drift/.test(errors[0]?.message ?? ""));
}

// ── throwing reader (file vanished) → error, not crash ──────────────────────
{
	const read = (f: string): string => {
		if (f === `${GID_B}.meta.json`) throw new Error("ENOENT mid-scan");
		return rec(GID_A);
	};
	const { identities, errors } = listAllMetaIdentities(
		[
			{ filename: `${GID_A}.meta.json`, regularFile: true },
			{ filename: `${GID_B}.meta.json`, regularFile: true },
		],
		read,
	);
	ok("reader throw → error, valid still listed", identities.length === 1 && errors.length === 1);
}

// ── non-.meta.json ignored ──────────────────────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), "README.txt": "x", "inbox.signal": "y" };
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("non-.meta.json entries ignored", identities.length === 1 && errors.length === 0);
}

// ── verbatim-or-nothing: error keyset = {filename, message} ─────────────────
{
	const map = { [`${GID_A}.meta.json`]: "{ broken" };
	const { errors } = listAllMetaIdentities(entries(map), reader(map));
	const keys = Object.keys(errors[0] ?? {}).sort();
	assert.deepStrictEqual(keys, ["filename", "message"], `error keyset drift: ${keys.join(",")}`);
	ok("error verbatim-or-nothing (filename + message only, no identity field)", true);
}

// ── strict vs collect ───────────────────────────────────────────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), [`${GID_B}.meta.json`]: "{ broken" };
	let threw = false;
	try {
		listAllMetaIdentities(entries(map), reader(map), { mode: "strict" });
	} catch {
		threw = true;
	}
	ok("mode strict → throw if any record unreadable", threw);
	const { identities } = listAllMetaIdentities(entries(map), reader(map), { mode: "collect" });
	ok("mode collect (default) → partial, no throw", identities.length === 1);
}

// ── errors sorted by filename ───────────────────────────────────────────────
{
	const map = { [`${GID_B}.meta.json`]: "{ x", [`${GID_A}.meta.json`]: "{ y" };
	const { errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("errors sorted by filename", errors[0]?.filename === `${GID_A}.meta.json`);
}

// ── #52: duplicate nativeSessionId is not two citizens ──────────────────────
{
	const shared = "n-shared-conversation";
	const map = {
		[`${GID_A}.meta.json`]: rec(GID_A, { nativeSessionId: shared }),
		[`${GID_B}.meta.json`]: rec(GID_B, { nativeSessionId: shared }),
	};
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("duplicate nativeSessionId → NEITHER record is listed as a citizen", identities.length === 0);
	ok("duplicate → one error per rival (both are told)", errors.length === 2);
	ok(
		"each error names the OTHER holder, so the pair is debuggable from either side",
		(errors[0]?.message ?? "").includes(`${GID_B}.meta.json`) &&
			(errors[1]?.message ?? "").includes(`${GID_A}.meta.json`),
	);
	ok(
		"the duplicate error names the fresh-cut verb (one prescription, as everywhere else)",
		errors.every((e) => e.message.includes("meta-bridge-fresh-cut")),
	);
}

// ── #52: a duplicate must not blind the citizens around it ──────────────────
{
	const shared = "n-shared-conversation";
	const GID_C = "20260611T333333-cccccc";
	const map = {
		[`${GID_A}.meta.json`]: rec(GID_A, { nativeSessionId: shared }),
		[`${GID_B}.meta.json`]: rec(GID_B, { nativeSessionId: shared }),
		[`${GID_C}.meta.json`]: rec(GID_C),
	};
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok(
		"an unrelated citizen still lists beside a duplicate pair (0.10 lesson holds)",
		identities.length === 1 && identities[0]?.gardenId === GID_C,
	);
	ok("only the two rivals become errors", errors.length === 2);
}

// ── #52: strict mode refuses a store with a duplicate ───────────────────────
{
	const shared = "n-shared-conversation";
	const map = {
		[`${GID_A}.meta.json`]: rec(GID_A, { nativeSessionId: shared }),
		[`${GID_B}.meta.json`]: rec(GID_B, { nativeSessionId: shared }),
	};
	let threw = false;
	try {
		listAllMetaIdentities(entries(map), reader(map), { mode: "strict" });
	} catch {
		threw = true;
	}
	ok("mode strict → a duplicate throws like any other unreadable store", threw);
}

// ── #52: one holder is not a duplicate (no false positive) ──────────────────
{
	const map = { [`${GID_A}.meta.json`]: rec(GID_A), [`${GID_B}.meta.json`]: rec(GID_B) };
	const { identities, errors } = listAllMetaIdentities(entries(map), reader(map));
	ok("distinct nativeSessionIds are untouched by the uniqueness pass", identities.length === 2 && errors.length === 0);
}

console.log(`\n[check-meta-listing] ${passed} assertions ok`);
