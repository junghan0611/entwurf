/**
 * Callback-env — the launch-computed pair that lets a fresh sibling call home
 * without copying a garden id or nonce out of prose.
 *
 * WHY THIS FILE EXISTS. Until this seam, `composeFreshCallFraming` put
 * `target=<caller gid>` and `message=<nonce>` into the first-turn prompt, and
 * the sibling had to retype them into `entwurf_v2`. That is the one place in
 * the garden Hard Rule 2 (record is the sole address axis) was violated: the
 * transcript became the address carrier, and a model that dropped a `$` or a
 * hex nibble produced a refused dispatch that looked like a flaky backend.
 *
 * WHAT TRAVELS. Two process-env names, injected by the launcher next to the
 * identity scrub (`PI_SESSION_ID=` / `PI_AGENT_ID=`), never as a general env
 * carrier. The no-arg `entwurf_callback` verb reads BOTH from its own process
 * and refuses by name when they are absent, malformed, or this process is a
 * Codex-provenance bridge (window env never reaches that MCP child — measured).
 *
 * This module does not dispatch. It parses, validates, and formats. Launchers
 * and the verb share it so a drifted regex cannot inject what the verb rejects.
 */

import { SESSION_ID_RE } from "./session-id.js";

export const CALLBACK_TARGET_ENV = "ENTWURF_CALLBACK_TARGET";
export const CALLBACK_NONCE_ENV = "ENTWURF_CALLBACK_NONCE";

/** Production `mintNonce` writes `mux-fresh-call-` + 12 random bytes as hex. The herdr
 *  gate fixture uses the `herdr-fresh-call-` prefix of the same length; both are 24 hex. */
export const CALLBACK_NONCE_RE = /^(?:mux|herdr)-fresh-call-[0-9a-f]{24}$/;

export type CallbackEnvReject = "callback-env-absent" | "callback-env-malformed" | "codex-callback-env-unsupported";

export type CallbackEnvRead = { ok: true; target: string; nonce: string } | { ok: false; reason: CallbackEnvReject };

function parseCallbackPair(target: unknown, nonce: unknown): CallbackEnvRead {
	if (typeof target !== "string" || typeof nonce !== "string") {
		return { ok: false, reason: "callback-env-malformed" };
	}
	if (!SESSION_ID_RE.test(target) || !CALLBACK_NONCE_RE.test(nonce)) {
		return { ok: false, reason: "callback-env-malformed" };
	}
	return { ok: true, target, nonce };
}

/**
 * Format the two `KEY=value` assignments a launcher injects. Throws rather than
 * emitting a pair the verb would refuse — a launch that cannot name its caller
 * must not open a window whose first action is a guaranteed reject.
 */
export function callbackEnvAssignments(params: { target: string; nonce: string }): readonly [string, string] {
	const parsed = parseCallbackPair(params.target, params.nonce);
	if (!parsed.ok) {
		throw new Error(`callback-env: refusing to inject ${parsed.reason}`);
	}
	return [`${CALLBACK_TARGET_ENV}=${parsed.target}`, `${CALLBACK_NONCE_ENV}=${parsed.nonce}`];
}

/**
 * Read the pair from a process environment. Codex provenance is a named refuse
 * even when the pair is well-formed: that bridge is an app-server child, and a
 * pane-injected value would be the wrong citizen's (or last-launch-wins).
 *
 * Both names absent → `callback-env-absent`. One present, or either failing
 * grammar → `callback-env-malformed`. No fallback to a model-supplied target.
 */
export function readCallbackEnv(env: NodeJS.ProcessEnv = process.env): CallbackEnvRead {
	if (env.ENTWURF_BRIDGE_NATIVE_HOST?.trim() === "codex") {
		return { ok: false, reason: "codex-callback-env-unsupported" };
	}
	const target = env[CALLBACK_TARGET_ENV];
	const nonce = env[CALLBACK_NONCE_ENV];
	if (target === undefined && nonce === undefined) {
		return { ok: false, reason: "callback-env-absent" };
	}
	return parseCallbackPair(target, nonce);
}
