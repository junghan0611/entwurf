/**
 * check-meta-record-v2 — deterministic golden gate for 0.11 Stage 0 step 3A:
 * the v1→v2 identity normalize seam. Pure functions; no fs, no backend, no API.
 * Safe in the `pnpm check` static floor.
 *
 * THE golden: a synthetic, SANITIZED v1 fixture (no real cwd/transcriptPath —
 * never commit a real disk meta-record to a public repo) normalizes to a
 * hand-written v2 identity literal. The golden is a literal, NOT derived from
 * the same mapping under test, so a drift in `normalizeMetaIdentity` fails here.
 *
 * This gate is kept SEPARATE from check-meta-session (the v1 record-authority
 * gate) on purpose (NEXT.md "dual-read 경로엔 v1 fixture 게이트를 별도 유지"):
 * when step 3D rewrites the v1 mint/write gates, this v1→v2 compat golden must
 * survive untouched as the back-compat proof for the 10+ disk v1 records.
 *
 * Scope is 3A ONLY: readers (parseMetaRecordV1/V2) + normalizer. There is no v2
 * writer yet by design — do not add serialize/upsert assertions here until the
 * golden + its GPT review have landed (NEXT.md 끊을 지점 ①).
 */

import assert from "node:assert/strict";
import {
	MetaRecordError,
	normalizeMetaIdentity,
	parseMetaRecordV1,
	parseMetaRecordV2,
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

// --- Synthetic, sanitized v1 fixture (golden source) ------------------------
// gardenId obeys the SSOT grammar YYYYMMDDTHHMMSS-[0-9a-f]{6}. Paths are
// synthetic. delivery carries non-null receipts to prove they are DROPPED (not
// silently carried) by identity normalize.
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
		lastDeliveredAt: "2026-01-02T03:00:00.000Z",
		lastReadAt: "2026-01-02T03:04:05.000Z",
	},
});

// THE golden — hand-written v2 identity (not derived from the mapping).
const GOLDEN_V2_IDENTITY = {
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
	recordUpdatedAt: "2026-01-02T03:04:05.000Z", // = v1 lastSeen (renamed)
};

// A v2 fixture exercising the deltas: pi backend, null transcriptPath/model,
// a parent garden id, isEntwurf=true.
const V2_PI_FIXTURE_JSON = JSON.stringify({
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

// 1. v1 fixture parses (round-trips to a v1 record carrying delivery).
const v1 = parseMetaRecordV1(V1_FIXTURE_JSON);
ok(
	"parseMetaRecordV1: synthetic v1 fixture parses with delivery intact",
	v1.schemaVersion === 1 && v1.delivery.lastReadAt === "2026-01-02T03:04:05.000Z",
);

// 2. THE golden — v1 normalizes to the hand-written v2 identity, byte-for-byte.
golden(
	"normalizeMetaIdentity(v1) === golden v2 identity (lastSeen→recordUpdatedAt, delivery dropped)",
	normalizeMetaIdentity(v1),
	GOLDEN_V2_IDENTITY,
);

// 3. v1 identity is LOSSLESS: every identity field survives; only delivery is
//    intentionally absent (proven by the golden having no delivery key).
const norm = normalizeMetaIdentity(v1);
ok(
	"v1 identity lossless: gardenId/backend/nativeSessionId/cwd/createdAt preserved, transcriptPath carried",
	norm.gardenId === v1.gardenId &&
		norm.backend === v1.backend &&
		norm.nativeSessionId === v1.nativeSessionId &&
		norm.cwd === v1.cwd &&
		norm.createdAt === v1.createdAt &&
		norm.transcriptPath === v1.transcriptPath,
);
ok(
	"v1 recordUpdatedAt is the renamed lastSeen (not createdAt)",
	norm.recordUpdatedAt === v1.lastSeen && norm.recordUpdatedAt !== norm.createdAt,
);
ok("normalized identity carries no delivery aspect", !("delivery" in norm) && !("lastSeen" in norm));
ok(
	"new v2 identity fields default at v1→v2 birth",
	norm.model === null && norm.parentGardenId === null && norm.isEntwurf === false,
);

// 4. normalize is idempotent: normalize(normalize(v1)) === normalize(v1).
golden("normalize is idempotent (normalize∘normalize == normalize)", normalizeMetaIdentity(norm), norm);

// 5. v2 fixture parses (the +=pi, nullable transcriptPath/model, parentGardenId,
//    isEntwurf deltas all accepted).
const v2 = parseMetaRecordV2(V2_PI_FIXTURE_JSON);
ok(
	"parseMetaRecordV2: pi backend + null transcriptPath/model + parent + isEntwurf parses",
	v2.backend === "pi" &&
		v2.transcriptPath === null &&
		v2.model === null &&
		v2.parentGardenId === "20260301T115900-aaaaaa" &&
		v2.isEntwurf === true,
);

// 6. normalize on an already-v2 record is identity (fresh copy, same values).
golden("normalizeMetaIdentity(v2) === v2 (already identity, returned as stable copy)", normalizeMetaIdentity(v2), v2);

// 7. version fences hold both ways — neither parser accepts the other's version.
throws("parseMetaRecordV1 rejects a schemaVersion-2 body", () => parseMetaRecordV1(V2_PI_FIXTURE_JSON));
throws("parseMetaRecordV2 rejects a schemaVersion-1 body", () => parseMetaRecordV2(V1_FIXTURE_JSON));

// 8. v2 validation crashes (not warns) on the new-field contracts.
throws("parseMetaRecordV2 rejects non-boolean isEntwurf", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), isEntwurf: "yes" })),
);
throws("parseMetaRecordV2 rejects an unknown backend", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), backend: "gemini" })),
);
throws("parseMetaRecordV2 rejects a malformed parentGardenId (non-null, bad grammar)", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), parentGardenId: "not-a-garden-id" })),
);

// 9. strict keyset — a v2 body carrying stale v1 fields is half-migrated/corrupt
//    and must fail-fast, NOT be silently normalized away (GPT review blocker).
throws("parseMetaRecordV2 rejects a stale v1 `delivery` field", () =>
	parseMetaRecordV2(
		JSON.stringify({
			...JSON.parse(V2_PI_FIXTURE_JSON),
			delivery: {
				wakeMode: "self-fetch",
				deliveryLevel: "D6",
				lastEnqueuedAt: null,
				lastDeliveredAt: null,
				lastReadAt: null,
			},
		}),
	),
);
throws("parseMetaRecordV2 rejects a stale v1 `lastSeen` field", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), lastSeen: "2026-03-01T12:30:00.000Z" })),
);
throws("parseMetaRecordV2 rejects an unknown/extra field", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), tmuxTarget: "psa:3.1" })),
);

console.log(`[check-meta-record-v2] ${passed} assertions ok`);
