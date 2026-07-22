/**
 * check-meta-capability-source — deterministic gate for the capability seam:
 * metaCapabilityFor reads backend honesty metadata (wakeMode/deliveryLevel)
 * from the packaged capability registry (3C), NOT from META_BACKEND_DESCRIPTORS.
 * No backend, no network, no hook, no fs writes (the registry is the packaged
 * file). Safe in the `pnpm check` static floor.
 *
 * Live consumers of the seam: the v2 decider/production deliverability and the
 * mailbox guard, plus the frozen v1 reader's wakeMode drift guard (which lives
 * in meta-migration.ts and is gated by check-meta-migration-readers — the V3
 * identity record carries no delivery aspect, so V3 mint/parse never source
 * capability).
 *
 * Proves:
 *  - the lookup seam is registry-DRIVEN — fed a doctored registry,
 *    metaCapabilityFor follows it (so the value is read from the registry, not
 *    hardcoded off the const); the default still reads the shipped file and
 *    memoizes.
 *  - behaviour preserved: registry ≡ META_BACKEND_DESCRIPTORS for the 3 native
 *    backends (the const survives only as the drift-guard reference; the
 *    registry ≡ const drift guard proper is check-entwurf-capabilities).
 */

import assert from "node:assert/strict";
import {
	loadMetaCapabilityRegistry,
	META_BACKEND_DESCRIPTORS,
	META_BACKENDS,
	type MetaCapabilityRegistry,
	metaCapabilityFor,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

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

// --- cut-over preserves behaviour: registry ≡ const for the 3 backends ------
for (const backend of META_BACKENDS) {
	const cap = metaCapabilityFor(backend);
	const d = META_BACKEND_DESCRIPTORS[backend];
	ok(
		`cut-over preserves behaviour: registry ≡ const for ${backend} (wakeMode/deliveryLevel)`,
		cap.wakeMode === d.wakeMode && cap.deliveryLevel === d.deliveryLevel,
	);
}

console.log(`[check-meta-capability-source] ${passed} assertions ok`);
