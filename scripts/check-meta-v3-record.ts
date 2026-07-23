/**
 * check-meta-v3-record — deterministic gate for the #50 schema hard cut: the V3
 * production record contract. Pure functions; no fs, no backend, no API. Safe in
 * the `pnpm check` static floor.
 *
 * Proves the PRODUCTION half of the cut:
 *   - serializeMetaIdentity is canonical (stable order, 2-space, trailing \n,
 *     schemaVersion 3 first) and carries neither the v1 delivery aspect nor the
 *     removed v2 fields (`parentGardenId`/`isEntwurf`),
 *   - serialize → parse round-trips byte-stably through parseMetaRecordV3 and
 *     parseMetaIdentity,
 *   - mintMetaIdentity mints schemaVersion-3 identities (pi backend included),
 *   - parseMetaRecordAny is V3-ONLY: a pre-cut (v1/v2) body throws an error that
 *     names the M1 operator command VERBATIM (gate h — the error text is the
 *     operator's road back in), unknown/missing versions crash,
 *   - strayness inversion, production half (gate f): a body carrying
 *     `parentGardenId`/`isEntwurf` is rejected by the V3 parser as stray. The
 *     frozen half (the migration readers still ACCEPTING them) lives in
 *     check-meta-migration-readers.
 */

import assert from "node:assert/strict";
import {
	M1_MIGRATE_COMMAND,
	type MetaIdentity,
	MetaRecordError,
	mintMetaIdentity,
	normalizeMetaIdentity,
	parseMetaIdentity,
	parseMetaRecordAny,
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

// --- parseMetaRecordAny is V3-only; pre-cut errors name the M1 command ------
throwsNaming(
	"parseMetaRecordAny(v1 body) throws naming the M1 migrate command",
	() => parseMetaRecordAny(V1_BODY),
	M1_MIGRATE_COMMAND,
);
throwsNaming(
	"parseMetaRecordAny(v2 body) throws naming the M1 migrate command",
	() => parseMetaRecordAny(V2_BODY),
	M1_MIGRATE_COMMAND,
);
// The rejection must show the VALUE, not just the type: `got number` cannot tell a
// v1 store from a v2 one, and the M1 runbook needs exactly that distinction (F9).
throwsNaming(
	"parseMetaRecordAny(v2 body) rejection shows the actual version value (got number 2)",
	() => parseMetaRecordAny(V2_BODY),
	"(got number 2)",
);
throwsNaming(
	"parseMetaRecordAny(v1 body) rejection shows the actual version value (got number 1)",
	() => parseMetaRecordAny(V1_BODY),
	"(got number 1)",
);
throws("parseMetaRecordAny: invalid JSON throws", () => parseMetaRecordAny("{nope"));
throws("parseMetaRecordAny: array (non-object) throws", () => parseMetaRecordAny("[]"));
throws("parseMetaRecordAny: unknown schemaVersion (4) throws", () =>
	parseMetaRecordAny(JSON.stringify({ ...V3_IDENTITY, schemaVersion: 4 })),
);
throws("parseMetaRecordAny: missing schemaVersion throws", () => parseMetaRecordAny(JSON.stringify({ gardenId: "x" })));

// --- strayness inversion, production half (gate f) --------------------------
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
