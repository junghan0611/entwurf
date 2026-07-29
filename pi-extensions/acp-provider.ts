// ACP plugin entry — provider registration (S0 fence, real backend since S2c).
//
// This is the pi-extension entry point that registers `entwurf` as a pi
// session provider/model. It is intentionally THIN: it stands up the provider
// surface (every registered adapter's curated rows + the no-auth sentinel) and
// wires streamSimple to the real ACP backend (lib/acp/backend.ts — a
// spawn-per-turn ACP child, `claude-agent-acp` or `cortex acp serve` depending
// on which adapter the model id routes to). It does NOT build a
// socket/peers/citizen protocol or touch the v2 core — socket-citizenship is
// supplied by the host `--entwurf-control` pi session (AGENTS §ACP Plugin
// Boundary).
//
// The model set comes from `allCuratedModels()` — the union across the adapter
// registry (backend-adapter.ts), NOT a per-backend list spelled here. Adding a
// backend therefore never edits this file. check-acp-provider-surface pins that
// the compiled entry really registers the EXACT union
// ([QK:CORTEX-PROVIDER-SIX-ROW-SURFACE]).
//
// Fence: this entry rides the emit-capable root tsconfig (it is not in the root
// `exclude` list); its lib modules are imported with `.js` suffixes (the root
// extension convention) so they live in the same root program — no new
// strip-types fence is introduced.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { streamShellAcp } from "./lib/acp/backend.js";
import { allCuratedModels } from "./lib/acp/backend-adapter.js";
import { ENTWURF_ACP_NO_AUTH_SENTINEL, PROVIDER_ID } from "./lib/acp/models.js";

// Idempotent registration guard. pi may evaluate an extension entry more than
// once across a runtime; registering the provider twice would replace its model
// set redundantly. Symbol.for keeps the marker stable across module instances.
const REGISTERED_SYMBOL = Symbol.for("entwurf.acp-provider.registered");

function isRegisteredOnRuntime(pi: ExtensionAPI): boolean {
	return Boolean((pi as unknown as Record<PropertyKey, unknown>)[REGISTERED_SYMBOL]);
}

function markRegisteredOnRuntime(pi: ExtensionAPI): void {
	Object.defineProperty(pi as object, REGISTERED_SYMBOL, {
		value: true,
		configurable: false,
		enumerable: false,
		writable: false,
	});
}

export default function (pi: ExtensionAPI) {
	if (isRegisteredOnRuntime(pi)) {
		return;
	}

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: "entwurf",
		// No-auth sentinel, not a credential. See lib/acp/models.ts + the
		// check-auth-boundary gate. The ACP plugin never provides, resells, or
		// bypasses backend credentials.
		apiKey: ENTWURF_ACP_NO_AUTH_SENTINEL,
		api: "entwurf",
		models: allCuratedModels(),
		// S2c: real ACP backend. Spawn-per-turn ACP child + event mapping
		// (lib/acp/backend.ts); the routed adapter decides WHICH child. The S0
		// fail-loud stub is gone — the provider path is open. Backend auth still
		// belongs to the operator's own backend CLI child (no-auth sentinel above);
		// this plugin only orchestrates.
		streamSimple: streamShellAcp,
	});

	// Mark only AFTER a successful registration. If allCuratedModels() (which
	// fail-fasts on an unowned/duplicate curated id, and whose claude rows carry a
	// fail-loud anchor check) or registerProvider throws, the runtime is not left
	// poisoned with a "registered" marker — a retry can register cleanly.
	markRegisteredOnRuntime(pi);
}
