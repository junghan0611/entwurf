/**
 * check-meta-dual-read — deterministic gate for 0.11 Stage 0 step 3D-1: the v2
 * write shape + the dual-read dispatcher. Pure functions; no fs, no backend, no
 * API. Safe in the `pnpm check` static floor.
 *
 * Proves:
 *   - serializeMetaIdentity is canonical (stable order, 2-space, trailing \n) and
 *     round-trips through parseMetaRecordV2,
 *   - parseMetaRecordAny peeks schemaVersion and routes to the right strict
 *     parser (v1 keeps delivery; v2 is identity), and refuses unknown versions,
 *   - parseMetaIdentity reads EITHER version straight to a normalized identity,
 *   - write → read identity is stable: parseMetaIdentity(serializeMetaIdentity).
 *
 * Scope is 3D-1 ONLY: pure serializer + dispatcher. NO fs upsert wiring, NO
 * readMetaInbox/enqueueMetaMessage change, NO record.delivery removal — those are
 * 3D-2/3/4. The v1 fixtures here are sanitized (never a real disk record).
 */

import assert from "node:assert/strict";
import {
	type MetaIdentity,
	MetaRecordError,
	parseMetaIdentity,
	parseMetaRecordAny,
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
function throws(label: string, fn: () => unknown): void {
	assert.throws(fn, MetaRecordError, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// Sanitized fixtures (synthetic paths; gardenId obeys the SSOT grammar).
const V1_FIXTURE_JSON = JSON.stringify({
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

// The v2 identity the v1 fixture normalizes to (= the 3A golden).
const GOLDEN_V2_IDENTITY: MetaIdentity = {
	schemaVersion: 2,
	gardenId: "20260101T000000-0a1b2c",
	backend: "claude-code",
	nativeSessionId: "n-fixture-0001",
	cwd: "/synthetic/project",
	model: null,
	transcriptPath: "/synthetic/project/.transcript.jsonl",
	parentGardenId: null,
	isEntwurf: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	recordUpdatedAt: "2026-01-02T03:04:05.000Z",
};

const V2_PI_IDENTITY: MetaIdentity = {
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
};

// --- serializeMetaIdentity (the v2 write shape) -----------------------------
ok(
	"serializeMetaIdentity: stable key order, 2-space indent, trailing newline, schemaVersion 2 first",
	serializeMetaIdentity(GOLDEN_V2_IDENTITY).startsWith(
		'{\n  "schemaVersion": 2,\n  "gardenId": "20260101T000000-0a1b2c",',
	) && serializeMetaIdentity(GOLDEN_V2_IDENTITY).endsWith("\n}\n"),
);
ok(
	"serializeMetaIdentity is deterministic (same identity → byte-identical)",
	serializeMetaIdentity(GOLDEN_V2_IDENTITY) === serializeMetaIdentity({ ...GOLDEN_V2_IDENTITY }),
);
ok(
	"serializeMetaIdentity output carries no v1 delivery/lastSeen keys",
	!serializeMetaIdentity(GOLDEN_V2_IDENTITY).includes("delivery") &&
		!serializeMetaIdentity(GOLDEN_V2_IDENTITY).includes("lastSeen"),
);
// write → read identity stability (serialize then dual-read back to identity).
golden(
	"serialize → parseMetaIdentity round-trips (v2 identity stable)",
	parseMetaIdentity(serializeMetaIdentity(GOLDEN_V2_IDENTITY)),
	GOLDEN_V2_IDENTITY,
);
golden(
	"serialize → parseMetaIdentity round-trips (pi identity stable)",
	parseMetaIdentity(serializeMetaIdentity(V2_PI_IDENTITY)),
	V2_PI_IDENTITY,
);

// --- parseMetaRecordAny (the dual-read dispatcher) --------------------------
const anyV1 = parseMetaRecordAny(V1_FIXTURE_JSON);
ok(
	"parseMetaRecordAny(v1) returns the v1 record in its OWN shape (delivery retained)",
	anyV1.schemaVersion === 1 && "delivery" in anyV1 && anyV1.delivery.lastReadAt === "2026-01-02T03:04:05.000Z",
);
const anyV2 = parseMetaRecordAny(serializeMetaIdentity(V2_PI_IDENTITY));
ok(
	"parseMetaRecordAny(v2) returns the v2 identity in its OWN shape",
	anyV2.schemaVersion === 2 && !("delivery" in anyV2),
);

// --- parseMetaIdentity (dual-read straight to identity) --------------------
golden(
	"parseMetaIdentity(v1 raw) → normalized v2 identity golden",
	parseMetaIdentity(V1_FIXTURE_JSON),
	GOLDEN_V2_IDENTITY,
);
golden(
	"parseMetaIdentity(v2 raw) → identity (idempotent)",
	parseMetaIdentity(serializeMetaIdentity(V2_PI_IDENTITY)),
	V2_PI_IDENTITY,
);

// --- crash, don't warn -----------------------------------------------------
throws("parseMetaRecordAny: invalid JSON throws", () => parseMetaRecordAny("{nope"));
throws("parseMetaRecordAny: array (non-object) throws", () => parseMetaRecordAny("[]"));
throws("parseMetaRecordAny: unknown schemaVersion (3) throws", () =>
	parseMetaRecordAny(JSON.stringify({ ...JSON.parse(V1_FIXTURE_JSON), schemaVersion: 3 })),
);
throws("parseMetaRecordAny: missing schemaVersion throws", () => parseMetaRecordAny(JSON.stringify({ gardenId: "x" })));
// the dispatcher delegates to the STRICT per-version parser — a corrupt v2 body
// (stale v1 delivery under schemaVersion 2) must still be rejected through Any.
throws("parseMetaRecordAny(v2 with stale delivery) is rejected by the strict v2 parser", () =>
	parseMetaRecordAny(JSON.stringify({ ...V2_PI_IDENTITY, delivery: {} })),
);

console.log(`[check-meta-dual-read] ${passed} assertions ok`);
