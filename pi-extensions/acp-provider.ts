// ACP plugin entry — provider registration (S0 fence, real backend since S2c).
//
// This is the pi-extension entry point that registers `entwurf` as a pi
// session provider/model. It is intentionally THIN: it stands up the provider
// surface (every registered adapter's curated rows + the no-auth sentinel) and
// wires streamSimple to the real ACP backend (lib/acp/backend.ts — a Claude
// ACP child whose lifetime follows pi's lifecycle). It does NOT build a
// socket/peers/citizen protocol or touch the v2 core — socket-citizenship is
// supplied by the host `--entwurf-control` pi session (AGENTS §ACP Plugin
// Boundary).
//
// The model set comes from `allCuratedModels()` — the union across the adapter
// registry (backend-adapter.ts), NOT a per-backend list spelled here. Adding a
// backend therefore never edits this file. check-acp-provider-surface pins that
// the compiled entry registers the exact supported set — the three Claude rows and the
// three `agy-` rows (#167), no retired Cortex row ([QK:ACP-PROVIDER-CLAUDE-ONLY]).
//
// Fence: this entry rides the emit-capable root tsconfig (it is not in the root
// `exclude` list); its lib modules are imported with `.js` suffixes (the root
// extension convention) so they live in the same root program — no new
// strip-types fence is introduced.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ACP_STEER_SEAM,
	closeRetainedAcpSession,
	streamShellAcp,
	takeAcpCompactionRecords,
} from "./lib/acp/backend.js";
import { allCuratedModels } from "./lib/acp/backend-adapter.js";
import { writeAcpCompactionRecords } from "./lib/acp/compaction-writer.js";
import { ENTWURF_ACP_NO_AUTH_SENTINEL, PROVIDER_ID } from "./lib/acp/models.js";
import { reportAcpHostMode, reportAcpSessionReader } from "./lib/acp-host-facts.js";
import { registerAcpSteerSeam } from "./lib/acp-steer-seam.js";

// Idempotent registration guard. pi may evaluate an extension entry more than
// once across a runtime; registering the provider twice would replace its model
// set redundantly. Symbol.for keeps the marker stable across module instances.
const REGISTERED_SYMBOL = Symbol.for("entwurf.acp-provider.registered");

// The session_shutdown reasons that replace the session in this process (#151). Pi 1.5.2's union is
// quit | reload | new | resume | fork (dist/core/extensions/types.d.ts:657-662).
const REPLACING_SHUTDOWN_REASONS: ReadonlySet<string> = new Set(["new", "resume", "fork"]);

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

	// #171 decision 18 (GLG 2026-11-21): ACP rows run under `entwurf pi`. The backend needs Pi's run mode to
	// tell a one-shot (Pi-reported `print` or `json`) from a bare interactive or RPC Pi, which stops.
	// Whether this Pi is a resident is the control extension's fact to report (lib/acp-host-facts). Pi binds the
	// mode before `session_start` (pi-coding-agent dist/core/agent-session.js:2756-2776), and a `/reload`
	// re-imports this module and fires `session_start` again, so the new instance is told too.
	pi.on("session_start", (_event, ctx) => {
		reportAcpHostMode(ctx.mode);
		// #171 step 8: the backend reads this session's branch to prove what a live ACP session last answered.
		reportAcpSessionReader(ctx.sessionManager);
	});

	// #163, GLG 2026-11-14: a successful compaction closes the Claude child of this Pi session at
	// once. The next turn opens a new child from the compacted transcript (backend.ts
	// `closeRetainedAcpSession`). A session that never used an ACP model has nothing to close.
	pi.on("session_compact", (_event, ctx) => {
		closeRetainedAcpSession(ctx.sessionManager.getSessionId());
	});

	// #151, GLG 2026-11-17: a session REPLACED inside this process — /new, /resume, /fork, and
	// /renew, which rides newSession — closes the retained ACP child (Claude or agy alike) of the
	// session it leaves. Until now only a compaction closed one (above), so every in-process
	// replacement kept the old child until the process exited. Pi settles the running turn before it emits this event, and the session
	// manager still names the leaving session (pi-coding-agent 1.5.2
	// dist/core/agent-session-runtime.js:102-113). A turn whose bookkeeping has not settled is left
	// alone by the same busy guard as compaction. "reload" keeps the same session, and "quit" is
	// reaped by the backend's exit hook, which SIGKILLs every retained group — both stay as they were.
	pi.on("session_shutdown", (event, ctx) => {
		// #171 decision 18: the mode report ends with the runner that made it; the next session_start reports again.
		reportAcpHostMode(undefined);
		reportAcpSessionReader(undefined);
		if (!REPLACING_SHUTDOWN_REASONS.has(event.reason)) return;
		const leaving = ctx.sessionManager.getSessionId();
		closeRetainedAcpSession(leaving);
	});

	// #163 S8: the ACP child's own compactions of the prompt that just ended become out-of-context
	// records in this session. Taken here, before Pi persists the assistant message (Pi emits the
	// extension message_end first — pi-coding-agent agent-session.js:810-826), so each entry sits
	// just before that message. The message itself carries nothing of them.
	pi.on("message_end", (event, ctx) => {
		const message = event.message as { role?: string; provider?: string };
		if (message.role !== "assistant" || message.provider !== PROVIDER_ID) return;
		writeAcpCompactionRecords(takeAcpCompactionRecords(ctx.sessionManager.getSessionId()), {
			appendEntry: (customType, data) => pi.appendEntry(customType, data),
			notify: ctx.hasUI ? (text) => ctx.ui.notify(text, "warning") : undefined,
			stderr: (line) => process.stderr.write(line),
			now: () => new Date().toISOString(),
		});
	});

	// #163 S7: offer the control socket a way to steer this process's busy ACP turns. Registered
	// after the provider. Another backend instance's seam is replaced only while it has no prompt in
	// flight; otherwise this throws by name (acp-steer-seam). The Pi /reload path is not measured.
	registerAcpSteerSeam(ACP_STEER_SEAM);

	// Mark only AFTER a successful registration. If allCuratedModels() (which
	// fail-fasts on an unowned/duplicate curated id, and whose claude rows carry a
	// fail-loud anchor check) or registerProvider throws, the runtime is not left
	// poisoned with a "registered" marker — a retry can register cleanly.
	markRegisteredOnRuntime(pi);
}
