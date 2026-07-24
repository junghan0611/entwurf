/**
 * check-entwurf-capabilities — deterministic gate for 0.11 Stage 0 step 3C:
 * the backend capability source. Pure parse over the packaged registry data
 * file; no backend, no network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the capability registry (`pi/entwurf-capabilities.json`) — the sole home
 * of wakeMode/deliveryLevel/nativeIdLabel now that no identity record carries
 * them (3D-4 dropped `delivery{}`; v3 never had it):
 *   - the shipped file parses + COVERS exactly META_BACKENDS_V2 (pi included),
 *   - it AGREES with `META_BACKEND_DESCRIPTORS` for the three existing backends.
 *     3D-3 cut mint/parse over to the registry via the `metaCapabilityFor` seam,
 *     so the registry is the LIVE authority and the const survives ONLY as this
 *     drift-guard reference (frozen "META_BACKEND_DESCRIPTORS 소비처 유지"),
 *   - strict keyset / coverage / field validation all crash, not warn.
 *
 * Scope is the registry DATA + its parser. The consumer seam it feeds is gated
 * elsewhere (check-meta-capability-source); this file never asserts routing.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import {
	META_BACKEND_DESCRIPTORS,
	META_BACKENDS_V2,
	MetaRecordError,
	metaCapabilitiesFilePath,
	parseMetaCapabilityRegistry,
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

// The shipped registry, read from disk and parsed.
const SHIPPED = fs.readFileSync(metaCapabilitiesFilePath(), "utf8");
const reg = parseMetaCapabilityRegistry(SHIPPED);

// 1. coverage — the shipped file covers exactly META_BACKENDS_V2, pi included.
ok(
	"shipped registry covers exactly META_BACKENDS_V2 (pi included)",
	[...META_BACKENDS_V2].sort().join(",") === Object.keys(reg.backends).sort().join(","),
);
ok("shipped registry includes the pi backend", reg.backends.pi !== undefined);

// 2. drift guard — the JSON must agree field-for-field with the const for the
//    three backends it still describes. 3D-3 already cut the live consumer over
//    to the registry, so this is no longer a pre-cut-over guard: the const now
//    exists ONLY as this reference, and the assertion is what keeps the live
//    source from silently diverging from the shape it was cut over from.
for (const backend of ["claude-code", "antigravity", "codex"] as const) {
	const live = META_BACKEND_DESCRIPTORS[backend];
	const cap = reg.backends[backend];
	ok(
		`capability for ${backend} agrees with live META_BACKEND_DESCRIPTORS (wakeMode/deliveryLevel/nativeIdLabel)`,
		cap.wakeMode === live.wakeMode &&
			cap.deliveryLevel === live.deliveryLevel &&
			cap.nativeIdLabel === live.nativeIdLabel,
	);
}

// 3. pi capability is well-formed (its values are NEW — no live const to compare).
//    pi = direct-inject: pi's live wake path is the control socket
//    (pi.sendMessage triggerTurn) which injects the body straight into the
//    model-visible turn — that is direct-inject, not Claude's mailbox self-fetch.
ok(
	"pi capability is well-formed (direct-inject / D6 / sessionId)",
	reg.backends.pi.wakeMode === "direct-inject" &&
		reg.backends.pi.deliveryLevel === "D6" &&
		reg.backends.pi.nativeIdLabel === "sessionId",
);

// 4. crash, don't warn — schema/coverage/keyset/field validation.
const base = JSON.parse(SHIPPED) as Record<string, unknown>;
throws("parse: invalid JSON throws", () => parseMetaCapabilityRegistry("{nope"));
throws("parse: array (non-object) throws", () => parseMetaCapabilityRegistry("[]"));
throws("parse: wrong schemaVersion throws", () =>
	parseMetaCapabilityRegistry(JSON.stringify({ ...base, schemaVersion: 2 })),
);
throws("parse: unexpected top-level key throws", () =>
	parseMetaCapabilityRegistry(JSON.stringify({ ...base, extra: 1 })),
);
throws("parse: missing a backend (coverage short) throws", () => {
	const backends = { ...(base.backends as Record<string, unknown>) };
	delete backends.pi;
	return parseMetaCapabilityRegistry(JSON.stringify({ ...base, backends }));
});
throws("parse: unknown extra backend (coverage over) throws", () =>
	parseMetaCapabilityRegistry(
		JSON.stringify({ ...base, backends: { ...(base.backends as Record<string, unknown>), gemini: reg.backends.pi } }),
	),
);
throws("parse: bad wakeMode value throws", () =>
	parseMetaCapabilityRegistry(
		JSON.stringify({
			...base,
			backends: { ...(base.backends as Record<string, unknown>), pi: { ...reg.backends.pi, wakeMode: "telepathy" } },
		}),
	),
);
throws("parse: unexpected key inside a capability entry throws", () =>
	parseMetaCapabilityRegistry(
		JSON.stringify({
			...base,
			backends: { ...(base.backends as Record<string, unknown>), pi: { ...reg.backends.pi, tmuxTarget: "psa:3.1" } },
		}),
	),
);
throws("parse: empty deliveryLevel throws", () =>
	parseMetaCapabilityRegistry(
		JSON.stringify({
			...base,
			backends: { ...(base.backends as Record<string, unknown>), pi: { ...reg.backends.pi, deliveryLevel: "" } },
		}),
	),
);

console.log(`[check-entwurf-capabilities] ${passed} assertions ok`);
