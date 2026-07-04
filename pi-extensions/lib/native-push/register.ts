/**
 * native-push/register — the pure-ish core of the `entwurf_register_native` MCP tool
 * (봉인 5). It REGISTERS an already-running native conversation (antigravity) as a garden
 * citizen; it does NOT spawn one (that is the deferred v2 fresh-mint capability — kept
 * distinct so a caller never confuses "bind an existing conversation" with "create a new
 * sibling").
 *
 * Flow (봉인 5):
 *   1. Resolve the native-push adapter for the backend and PROBE the conversation. Only a
 *      LIVE, verifiable conversation may be registered — a dead/indeterminate probe throws,
 *      so we never engrave a garden id onto a pointer that does not resolve to a real host.
 *   2. Reuse `upsertMetaSession` (scan-by-nativeId → create/attach). Re-registration attaches
 *      to the SAME garden id and refreshes the cwd; the meta-record authority rules (duplicate
 *      nativeSessionId / backend↔wakeMode contradiction) are inherited unchanged.
 *
 * Receiver-marker abstinence (보정①): this module NEVER writes a receiver marker. That marker
 * means "idle-wake mailbox watch armed" and is a MAILBOX-only atom; a native-push citizen has
 * no mailbox and no watch, so arming one would smuggle native-push liveness into the mailbox
 * deliverability semantics. `check-native-push-register` asserts this file references no
 * receiver-marker writer. (A dedicated register-provenance slot is a future concern.)
 *
 * LEAF-adjacent + pi-free: imports only the native-push adapter (pi-free) and the meta-session
 * upsert (pi-free), so the harness-neutral MCP bridge can reach it at boot.
 */

import type { NativePushBackend } from "../entwurf-v2-contract.ts";
import { type MetaBackendV2, type UpsertAction, upsertMetaSession } from "../meta-session.ts";
import { type NativePushAdapter, resolveNativePushAdapter } from "./adapter.ts";

export interface RegisterNativeConversationInput {
	/** The native backend hosting the conversation. Only antigravity is registerable on this
	 *  lane (codex is a separate lane). */
	backend: NativePushBackend;
	/** The backend's native conversation id (antigravity conversationId). */
	nativeSessionId: string;
	/** The cwd to record for this citizen — REQUIRED: a native conversation's metadata cannot
	 *  confirm it, so the caller must state it (봉인 5). */
	cwd: string;
}

export interface RegisterNativeConversationDeps {
	/** Adapter resolver (default: the real native-push registry). Injected so the gate drives
	 *  the probe with a fake adapter — no live agy. */
	resolveAdapter?: (backend: string) => NativePushAdapter;
	/** Meta-record store dir (default: the real one). Injected so the gate writes to a temp dir. */
	sessionsDir?: string;
	now?: Date;
}

export interface RegisterNativeConversationResult {
	action: UpsertAction;
	gardenId: string;
	backend: string;
	nativeSessionId: string;
	cwd: string;
}

/**
 * Register (or re-attach) a live native conversation as a garden citizen. Throws if the
 * conversation is not live (probe status !== "alive") — a non-live conversation cannot become
 * an addressable citizen. On success returns the garden id + the create/attach action.
 */
export async function registerNativeConversation(
	input: RegisterNativeConversationInput,
	deps: RegisterNativeConversationDeps = {},
): Promise<RegisterNativeConversationResult> {
	const resolveAdapter = deps.resolveAdapter ?? resolveNativePushAdapter;
	const adapter = resolveAdapter(input.backend);
	const probe = await adapter.probe(input.nativeSessionId);
	if (probe.status !== "alive") {
		throw new Error(
			`entwurf_register_native: refusing to register ${input.backend} conversation ${JSON.stringify(
				input.nativeSessionId,
			)} — it is not live (${probe.status}: ${probe.reason}). Only a live, verifiable conversation can be ` +
				`registered as a garden citizen; open/resume it, then retry.`,
		);
	}
	// Reuse the meta-record upsert authority (scan-by-nativeId → create/attach). model /
	// transcriptPath are null: a native app-server conversation exposes neither to us. cwd is
	// the caller-stated value (refreshed on attach). NO receiver marker is written here (보정①).
	const result = upsertMetaSession({
		input: {
			backend: input.backend satisfies MetaBackendV2,
			nativeSessionId: input.nativeSessionId,
			cwd: input.cwd,
			model: null,
			transcriptPath: null,
		},
		dir: deps.sessionsDir,
		now: deps.now,
	});
	return {
		action: result.action,
		gardenId: result.record.gardenId,
		backend: result.record.backend,
		nativeSessionId: result.record.nativeSessionId,
		cwd: result.record.cwd,
	};
}
