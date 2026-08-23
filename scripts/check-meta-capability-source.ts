/**
 * check-meta-capability-source — deterministic gate for the capability seam:
 * metaCapabilityFor reads backend honesty metadata (wakeMode/deliveryLevel)
 * from the packaged capability registry (3C), NOT from META_BACKEND_DESCRIPTORS.
 * No backend, no network, no hook, no fs writes (the registry is the packaged
 * file). Safe in the `pnpm check` static floor.
 *
 * Live consumers of the seam: the v2 decider/production deliverability and the
 * mailbox guard (the V3 identity record carries no delivery aspect, so V3
 * mint/parse never source capability).
 *
 * Proves:
 *  - the lookup seam is registry-DRIVEN — fed a doctored registry,
 *    metaCapabilityFor follows it (so the value is read from the registry, not
 *    hardcoded off the const); the default still reads the shipped file.
 *  - the default load is not stale-able: in a temp package closure it follows an
 *    atomic on-disk replacement within one process, while a missing or corrupt
 *    registry still throws.
 *  - behaviour preserved: registry ≡ META_BACKEND_DESCRIPTORS for the 3 native
 *    backends (the const survives only as the drift-guard reference; the
 *    registry ≡ const drift guard proper is check-entwurf-capabilities).
 */

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	loadMetaCapabilityRegistry,
	META_BACKEND_DESCRIPTORS,
	META_BACKENDS,
	type MetaCapabilityRegistry,
	metaCapabilityFor,
} from "../pi-extensions/lib/meta-session.ts";

/** Repo root, from this gate's own location (`scripts/` -> `..`). */
const REPO = path.join(import.meta.dirname, "..");

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

// --- the default load is not stale-able (#82 RAIL 7) -----------------------
// This block replaces an assertion that the loader MEMOIZES. That memo was a real
// defect, not a design: the entwurf-bridge MCP child outlives many installs, so a
// grade or wakeMode moved on disk stayed invisible to every already-running
// dispatcher, with no symptom but a citizen answering out of last week's registry.
//
// The oracle has to be independent of the production module's own idea of freshness,
// so it does not poke at the shipped file — mutating the real checkout registry would
// make this gate a host-mutating test and could leave the tree dirty on a failure.
// Instead it builds a TEMP PACKAGE CLOSURE: the module resolves its registry by
// arithmetic on `import.meta.dirname` (see metaCapabilitiesFilePath), so a copy of
// meta-session.ts placed at `<tmp>/pi-extensions/lib/` reads `<tmp>/pi/…json` and
// nothing else. Two files are enough — meta-session imports only node builtins and
// its sibling session-id.js.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "entwurf-capability-source."));
try {
	const libDir = path.join(tmpRoot, "pi-extensions", "lib");
	const regDir = path.join(tmpRoot, "pi");
	mkdirSync(libDir, { recursive: true });
	mkdirSync(regDir, { recursive: true });
	const srcLib = path.join(REPO, "pi-extensions", "lib");
	copyFileSync(path.join(srcLib, "meta-session.ts"), path.join(libDir, "meta-session.ts"));
	copyFileSync(path.join(srcLib, "session-id.js"), path.join(libDir, "session-id.js"));

	const registryPath = path.join(regDir, "entwurf-capabilities.json");
	const withGrade = (level: string): string =>
		JSON.stringify({
			schemaVersion: shipped.schemaVersion,
			backends: Object.fromEntries(
				Object.entries(shipped.backends).map(([b, cap]) => [
					b,
					b === "copilot" ? { ...cap, deliveryLevel: level } : cap,
				]),
			),
		});

	writeFileSync(registryPath, withGrade("D0"));
	const mod = await import(pathToFileURL(path.join(libDir, "meta-session.ts")).href);
	const before = mod.metaCapabilityFor("copilot").deliveryLevel;

	// Replace the way an installer does — write a sibling and rename over the target —
	// so the old inode is gone rather than truncated. A stat-keyed cache can survive
	// this; only actually reading the file cannot.
	const swap = `${registryPath}.next`;
	writeFileSync(swap, withGrade("D6"));
	renameSync(swap, registryPath);
	const after = mod.metaCapabilityFor("copilot").deliveryLevel;

	ok(
		`[QK:CAPABILITY-REGISTRY-REREAD-SEES-REPLACEMENT] the default load follows an atomic on-disk replacement in the SAME process (${before} -> ${after})`,
		before === "D0" && after === "D6",
	);

	// Losing the registry must stay loud. A loader that "kept the last good copy" to
	// survive a replacement would pass the cell above and hide this one.
	rmSync(registryPath);
	let threwMissing = false;
	try {
		mod.loadMetaCapabilityRegistry();
	} catch {
		threwMissing = true;
	}
	ok("[QK:CAPABILITY-REGISTRY-MISSING-STILL-THROWS] a missing registry still throws on the default load", threwMissing);

	writeFileSync(registryPath, "{ not json");
	let threwCorrupt = false;
	try {
		mod.loadMetaCapabilityRegistry();
	} catch {
		threwCorrupt = true;
	}
	ok("[QK:CAPABILITY-REGISTRY-CORRUPT-STILL-THROWS] a corrupt registry still throws on the default load", threwCorrupt);
} finally {
	// Reap unconditionally: a gate that leaves fixtures behind on failure is how a
	// checkout accumulates temp roots nobody owns.
	rmSync(tmpRoot, { recursive: true, force: true });
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

console.log(`[check-meta-capability-source] ${passed} assertions ok`);
