/**
 * check-meta-capability-source — deterministic gate for 0.11 Stage 0 step 3D-3:
 * the capability-source cut-over. mint/parse now read backend honesty metadata
 * (wakeMode/deliveryLevel) from the capability registry (3C) via metaCapabilityFor,
 * NOT from META_BACKEND_DESCRIPTORS. No backend, no network, no hook, no fs writes
 * (the registry is the packaged file). Safe in the `pnpm check` static floor.
 *
 * Proves the cut-over without changing observable behaviour:
 *  - the lookup seam is registry-DRIVEN — fed a doctored registry, metaCapabilityFor
 *    follows it (so the value is read from the registry, not hardcoded off the const);
 *    the default still reads the shipped file.
 *  - mintMetaRecord sources delivery.wakeMode/deliveryLevel through that seam.
 *  - parseMetaRecord's drift guard is now registry-sourced: a stored wakeMode that
 *    contradicts the registry canonical is rejected; a consistent one round-trips.
 *  - behaviour preserved: registry ≡ META_BACKEND_DESCRIPTORS for the 3 existing
 *    backends (the const survives only as the drift-guard reference, 3C → 3D-3).
 *
 * Scope is 3D-3: the SOURCE moves. NOTE (post-3D-4): the consumers proven here are
 * mintMetaRecord / parseMetaRecord — the V1 (legacy / dual-read) path, which is the
 * only place wakeMode/deliveryLevel still flow from. The live v2 mint
 * (mintMetaIdentity) carries NO delivery, so it never sources capability — the v2
 * record has no wakeMode at all. check-entwurf-capabilities still owns the
 * registry ≡ const drift guard.
 */

import assert from "node:assert/strict";
import {
	loadMetaCapabilityRegistry,
	META_BACKEND_DESCRIPTORS,
	META_BACKENDS,
	type MetaCapabilityRegistry,
	MetaRecordError,
	metaCapabilityFor,
	mintMetaRecord,
	parseMetaRecord,
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

const MINT = { nativeSessionId: "n-capsrc", transcriptPath: "/tmp/t.jsonl", cwd: "/tmp" };

// --- the seam is registry-driven, not const-hardcoded ----------------------
// Doctor the shipped registry (flip claude-code's wakeMode) and feed it in: if the
// lookup follows the doctored value, it is reading from the registry, not the const.
const shipped = loadMetaCapabilityRegistry();
const flip = (w: "self-fetch" | "direct-inject") => (w === "self-fetch" ? "direct-inject" : "self-fetch");
const doctored: MetaCapabilityRegistry = {
	schemaVersion: shipped.schemaVersion,
	backends: {
		...shipped.backends,
		"claude-code": { ...shipped.backends["claude-code"], wakeMode: flip(shipped.backends["claude-code"].wakeMode) },
	},
};
const doctoredWake = doctored.backends["claude-code"].wakeMode;
ok(
	"seam is registry-driven: metaCapabilityFor follows an injected (doctored) registry",
	metaCapabilityFor("claude-code", doctored).wakeMode === doctoredWake &&
		doctoredWake !== shipped.backends["claude-code"].wakeMode,
);
ok(
	"seam default reads the shipped registry, not the doctored copy",
	metaCapabilityFor("claude-code").wakeMode === shipped.backends["claude-code"].wakeMode,
);
const load1 = loadMetaCapabilityRegistry();
const load2 = loadMetaCapabilityRegistry();
ok("loadMetaCapabilityRegistry memoizes (same object on repeat load)", load1 === load2);

// --- mint sources delivery metadata through the seam -----------------------
for (const backend of META_BACKENDS) {
	const cap = metaCapabilityFor(backend);
	const r = mintMetaRecord({ backend, ...MINT });
	ok(`mint(${backend}): delivery.wakeMode sourced from the registry`, r.delivery.wakeMode === cap.wakeMode);
	ok(
		`mint(${backend}): delivery.deliveryLevel sourced from the registry`,
		r.delivery.deliveryLevel === cap.deliveryLevel,
	);
}

// --- cut-over preserves behaviour: registry ≡ const for the 3 backends ------
for (const backend of META_BACKENDS) {
	const cap = metaCapabilityFor(backend);
	const d = META_BACKEND_DESCRIPTORS[backend];
	ok(
		`cut-over preserves behaviour: registry ≡ const for ${backend} (wakeMode/deliveryLevel)`,
		cap.wakeMode === d.wakeMode && cap.deliveryLevel === d.deliveryLevel,
	);
}

// --- parse drift guard is now registry-sourced -----------------------------
const good = mintMetaRecord({ backend: "claude-code", ...MINT });
const tampered = JSON.parse(serializeMetaRecord(good)) as { delivery: { wakeMode: string } };
tampered.delivery.wakeMode = flip(metaCapabilityFor("claude-code").wakeMode); // contradicts the registry canonical
throws("parse: a wakeMode contradicting the registry canonical throws (drift guard registry-sourced)", () =>
	parseMetaRecord(JSON.stringify(tampered)),
);
ok(
	"parse: a registry-consistent record round-trips",
	parseMetaRecord(serializeMetaRecord(good)).delivery.wakeMode === metaCapabilityFor("claude-code").wakeMode,
);

console.log(`[check-meta-capability-source] ${passed} assertions ok`);
