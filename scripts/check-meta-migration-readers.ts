/**
 * check-meta-migration-readers — deterministic gate for the #50 schema hard cut:
 * the FROZEN migration surface (meta-migration.ts). Pure functions + a static
 * import scan; no backend, no API. Safe in the `pnpm check` static floor.
 *
 * Proves the FROZEN half of the cut:
 *   - the frozen v1 reader still parses a v1 record (delivery intact) and the
 *     frozen v2 reader still parses a v2 record — including `parentGardenId` /
 *     `isEntwurf`, the two fields the V3 parser rejects as stray (gate f's other
 *     half; the production half lives in check-meta-v3-record). A record is
 *     legible to exactly ONE schema.
 *   - version fences hold both ways (neither frozen reader accepts the other's
 *     version, and neither accepts a v3 body),
 *   - the frozen v2 keyset stays strict: stale v1 fields (`delivery`/`lastSeen`)
 *     and unknown keys fail fast (a half-migrated record is corrupt, not data),
 *   - IMPORT ALLOWLIST (gate e): meta-migration.ts is importable ONLY by the M1
 *     operator surface and this gate. A normal-routing import of the legacy
 *     readers is the exact regression the hard cut forbids — the static scan
 *     below makes adding one RED, not silent.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { META_IDENTITY_V2_KEYS, parseMetaRecordV1, parseMetaRecordV2 } from "../pi-extensions/lib/meta-migration.ts";
import { MetaRecordError } from "../pi-extensions/lib/meta-session.ts";

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
		lastDeliveredAt: "2026-01-02T03:00:00.000Z",
		lastReadAt: "2026-01-02T03:04:05.000Z",
	},
});

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

const V3_BODY = JSON.stringify({
	schemaVersion: 3,
	gardenId: "20260101T000000-0a1b2c",
	backend: "claude-code",
	nativeSessionId: "n-fixture-0001",
	cwd: "/synthetic/project",
	model: null,
	transcriptPath: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	recordUpdatedAt: "2026-01-02T03:04:05.000Z",
});

// --- frozen v1 reader -------------------------------------------------------
const v1 = parseMetaRecordV1(V1_FIXTURE_JSON);
ok(
	"frozen v1 reader: synthetic v1 fixture parses with delivery intact",
	v1.schemaVersion === 1 && v1.delivery.lastReadAt === "2026-01-02T03:04:05.000Z",
);
throws("frozen v1 reader rejects a corrupt wakeMode/backend contradiction", () =>
	parseMetaRecordV1(
		JSON.stringify({
			...JSON.parse(V1_FIXTURE_JSON),
			delivery: { ...JSON.parse(V1_FIXTURE_JSON).delivery, wakeMode: "direct-inject" },
		}),
	),
);

// --- frozen v2 reader — keeps ACCEPTING the fields v3 rejects ---------------
const v2 = parseMetaRecordV2(V2_PI_FIXTURE_JSON);
ok(
	"frozen v2 reader: pi backend + parentGardenId + isEntwurf parse (the v3-stray fields stay legible HERE)",
	v2.backend === "pi" && v2.parentGardenId === "20260301T115900-aaaaaa" && v2.isEntwurf === true,
);
ok(
	"frozen v2 keyset still names parentGardenId + isEntwurf",
	META_IDENTITY_V2_KEYS.includes("parentGardenId") && META_IDENTITY_V2_KEYS.includes("isEntwurf"),
);

// --- version fences (every pair) --------------------------------------------
throws("v1 reader rejects a schemaVersion-2 body", () => parseMetaRecordV1(V2_PI_FIXTURE_JSON));
throws("v1 reader rejects a schemaVersion-3 body", () => parseMetaRecordV1(V3_BODY));
throws("v2 reader rejects a schemaVersion-1 body", () => parseMetaRecordV2(V1_FIXTURE_JSON));
throws("v2 reader rejects a schemaVersion-3 body", () => parseMetaRecordV2(V3_BODY));

// --- frozen v2 strictness ---------------------------------------------------
throws("v2 reader rejects a stale v1 `delivery` field", () =>
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
throws("v2 reader rejects a stale v1 `lastSeen` field", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), lastSeen: "2026-03-01T12:30:00.000Z" })),
);
throws("v2 reader rejects an unknown/extra field", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), tmuxTarget: "psa:3.1" })),
);
throws("v2 reader rejects non-boolean isEntwurf", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), isEntwurf: "yes" })),
);
throws("v2 reader rejects a malformed parentGardenId", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), parentGardenId: "not-a-garden-id" })),
);
throws("v2 reader rejects an unknown backend", () =>
	parseMetaRecordV2(JSON.stringify({ ...JSON.parse(V2_PI_FIXTURE_JSON), backend: "gemini" })),
);

// --- import allowlist (gate e) ----------------------------------------------
// The legacy readers have ONE address. Only the M1 operator surface (H7 lane;
// reserved path below) and this gate may import it. Scanning the real source
// tree makes a new import RED at gate time, not at review time.
const REPO = path.resolve(import.meta.dirname, "..");
const ALLOWED_IMPORTERS = new Set([
	"scripts/check-meta-migration-readers.ts",
	// The M1 operator surface — the single door back into v3 production for a
	// pre-cut record. Its gate (check-meta-migrate-v3) drives it as a subprocess
	// with hand-written fixture JSON, so the gate needs no entry here.
	"scripts/meta-bridge-migrate-v3.ts",
]);
const SCAN_ROOTS = ["pi-extensions", "mcp/src", "scripts"];
const IMPORT_RE = /from\s+["'][^"']*meta-migration(\.ts)?["']/;
const offenders: string[] = [];
for (const root of SCAN_ROOTS) {
	const abs = path.join(REPO, root);
	if (!fs.existsSync(abs)) continue;
	const stack = [abs];
	while (stack.length > 0) {
		const dir = stack.pop() as string;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules") continue;
				stack.push(p);
				continue;
			}
			if (!entry.name.endsWith(".ts")) continue;
			const rel = path.relative(REPO, p);
			if (rel === path.join("pi-extensions", "lib", "meta-migration.ts")) continue;
			if (!IMPORT_RE.test(fs.readFileSync(p, "utf8"))) continue;
			if (!ALLOWED_IMPORTERS.has(rel.split(path.sep).join("/"))) offenders.push(rel);
		}
	}
}
ok(
	`import allowlist: meta-migration.ts is imported only by the M1 surface + this gate (offenders: ${offenders.length === 0 ? "none" : offenders.join(", ")})`,
	offenders.length === 0,
);

console.log(`[check-meta-migration-readers] ${passed} assertions ok`);
