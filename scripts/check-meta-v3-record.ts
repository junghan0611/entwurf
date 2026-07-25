/**
 * check-meta-v3-record — deterministic gate for the ONE live record schema (v3).
 * Pure functions; no fs, no backend, no API. Safe in the `pnpm check` static
 * floor.
 *
 * Proves the record contract:
 *   - serializeMetaIdentity is canonical (stable order, 2-space, trailing \n,
 *     schemaVersion 3 first) and carries no retired-field residue
 *     (`delivery`/`lastSeen`/`parentGardenId`/`isEntwurf`),
 *   - serialize → parse round-trips byte-stably through parseMetaRecordV3 and
 *     parseMetaIdentity,
 *   - mintMetaIdentity mints schemaVersion-3 identities (pi backend included),
 *   - the reader is V3-ONLY with no legacy reader anywhere: any other
 *     schemaVersion throws an error that names the fresh-cut command VERBATIM
 *     (the error text is the operator's one road back in — the generation cut),
 *     showing the actual rejected version value, and unknown/missing versions
 *     crash,
 *   - strict keyset: a body carrying any retired or unknown field is rejected
 *     as stray, never coerced.
 */

import assert from "node:assert/strict";
import {
	FRESH_CUT_COMMAND,
	type MetaIdentity,
	MetaRecordError,
	mintMetaIdentity,
	normalizeMetaIdentity,
	parseMetaIdentity,
	parseMetaRecordV3,
	serializeMetaIdentity,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function golden(label: string, actual: unknown, expected: unknown): void {
	assert.deepStrictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throwsNaming(label: string, fn: () => unknown, needle: string): void {
	assert.throws(fn, (err: unknown) => err instanceof MetaRecordError && err.message.includes(needle), label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throws(label: string, fn: () => unknown): void {
	assert.throws(fn, MetaRecordError, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// Sanitized fixtures (synthetic paths; gardenId obeys the SSOT grammar).
const V3_IDENTITY: MetaIdentity = {
	schemaVersion: 3,
	gardenId: "20260101T000000-0a1b2c",
	backend: "claude-code",
	nativeSessionId: "n-fixture-0001",
	cwd: "/synthetic/project",
	model: null,
	transcriptPath: "/synthetic/project/.transcript.jsonl",
	createdAt: "2026-01-01T00:00:00.000Z",
	recordUpdatedAt: "2026-01-02T03:04:05.000Z",
};

const V3_PI_IDENTITY: MetaIdentity = {
	schemaVersion: 3,
	gardenId: "20260301T120000-abc123",
	backend: "pi",
	nativeSessionId: "pi-sess-xyz",
	cwd: "/synthetic/pi-proj",
	model: null,
	transcriptPath: null,
	createdAt: "2026-03-01T12:00:00.000Z",
	recordUpdatedAt: "2026-03-01T12:30:00.000Z",
};

const V1_BODY = JSON.stringify({
	schemaVersion: 1,
	gardenId: "20260101T000000-0a1b2c",
	backend: "claude-code",
	nativeSessionId: "n-fixture-0001",
	transcriptPath: "/synthetic/project/.transcript.jsonl",
	cwd: "/synthetic/project",
	createdAt: "2026-01-01T00:00:00.000Z",
	lastSeen: "2026-01-02T03:04:05.000Z",
	delivery: {
		wakeMode: "self-fetch",
		deliveryLevel: "D6",
		lastEnqueuedAt: null,
		lastDeliveredAt: null,
		lastReadAt: "2026-01-02T03:04:05.000Z",
	},
});

const V2_BODY = JSON.stringify({
	schemaVersion: 2,
	gardenId: "20260301T120000-abc123",
	backend: "pi",
	nativeSessionId: "pi-sess-xyz",
	cwd: "/synthetic/pi-proj",
	model: null,
	transcriptPath: null,
	parentGardenId: "20260301T115900-aaaaaa",
	isEntwurf: true,
	createdAt: "2026-03-01T12:00:00.000Z",
	recordUpdatedAt: "2026-03-01T12:30:00.000Z",
});

// --- serializeMetaIdentity (the v3 write shape) -----------------------------
ok(
	"serializeMetaIdentity: stable key order, 2-space indent, trailing newline, schemaVersion 3 first",
	serializeMetaIdentity(V3_IDENTITY).startsWith('{\n  "schemaVersion": 3,\n  "gardenId": "20260101T000000-0a1b2c",') &&
		serializeMetaIdentity(V3_IDENTITY).endsWith("\n}\n"),
);
ok(
	"serializeMetaIdentity is deterministic (same identity → byte-identical)",
	serializeMetaIdentity(V3_IDENTITY) === serializeMetaIdentity({ ...V3_IDENTITY }),
);
ok(
	"serializeMetaIdentity output carries no v1/v2 residue keys",
	["delivery", "lastSeen", "parentGardenId", "isEntwurf"].every((k) => !serializeMetaIdentity(V3_IDENTITY).includes(k)),
);
golden(
	"serialize → parseMetaRecordV3 round-trips (v3 identity stable)",
	parseMetaRecordV3(serializeMetaIdentity(V3_IDENTITY)),
	V3_IDENTITY,
);
golden(
	"serialize → parseMetaIdentity round-trips (pi identity stable)",
	parseMetaIdentity(serializeMetaIdentity(V3_PI_IDENTITY)),
	V3_PI_IDENTITY,
);

// --- mintMetaIdentity mints v3 ----------------------------------------------
const minted = mintMetaIdentity({ backend: "pi", nativeSessionId: "pi-native-1", cwd: "/synthetic/mint" });
ok(
	"mintMetaIdentity mints schemaVersion 3 with defaults (model/transcriptPath null)",
	minted.schemaVersion === 3 && minted.backend === "pi" && minted.model === null && minted.transcriptPath === null,
);
golden("normalizeMetaIdentity is a stable copy (idempotent)", normalizeMetaIdentity(minted), minted);

// --- the reader is V3-only; foreign-generation errors name fresh-cut --------
throwsNaming(
	"parseMetaIdentity(v1 body) throws naming the fresh-cut command",
	() => parseMetaIdentity(V1_BODY),
	FRESH_CUT_COMMAND,
);
throwsNaming(
	"parseMetaIdentity(v2 body) throws naming the fresh-cut command",
	() => parseMetaIdentity(V2_BODY),
	FRESH_CUT_COMMAND,
);
// The rejection must show the VALUE, not just the type: `got number` cannot say
// WHICH foreign generation a store carries, and the operator deciding on a cut
// deserves the actual number (F9).
throwsNaming(
	"parseMetaIdentity(v2 body) rejection shows the actual version value (got number 2)",
	() => parseMetaIdentity(V2_BODY),
	"(got number 2)",
);
throwsNaming(
	"parseMetaIdentity(v1 body) rejection shows the actual version value (got number 1)",
	() => parseMetaIdentity(V1_BODY),
	"(got number 1)",
);
throws("parseMetaIdentity: invalid JSON throws", () => parseMetaIdentity("{nope"));
throws("parseMetaIdentity: array (non-object) throws", () => parseMetaIdentity("[]"));
throws("parseMetaIdentity: unknown schemaVersion (4) throws", () =>
	parseMetaIdentity(JSON.stringify({ ...V3_IDENTITY, schemaVersion: 4 })),
);
throws("parseMetaIdentity: missing schemaVersion throws", () => parseMetaIdentity(JSON.stringify({ gardenId: "x" })));

// --- strict keyset: retired/unknown fields are stray, never coerced ----------
throws("parseMetaRecordV3 rejects a body carrying parentGardenId (stray key)", () =>
	parseMetaRecordV3(JSON.stringify({ ...V3_PI_IDENTITY, parentGardenId: null })),
);
throws("parseMetaRecordV3 rejects a body carrying isEntwurf (stray key)", () =>
	parseMetaRecordV3(JSON.stringify({ ...V3_PI_IDENTITY, isEntwurf: false })),
);
throws("parseMetaRecordV3 rejects a stale v1 delivery field", () =>
	parseMetaRecordV3(JSON.stringify({ ...V3_IDENTITY, delivery: {} })),
);
throws("parseMetaRecordV3 rejects an unknown/extra field", () =>
	parseMetaRecordV3(JSON.stringify({ ...V3_IDENTITY, tmuxTarget: "psa:3.1" })),
);
throws("parseMetaRecordV3 rejects an unknown backend", () =>
	parseMetaRecordV3(JSON.stringify({ ...V3_IDENTITY, backend: "gemini" })),
);

console.log(`[check-meta-v3-record] ${passed} assertions ok`);
