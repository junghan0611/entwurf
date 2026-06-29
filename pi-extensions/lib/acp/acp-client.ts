// ACP client adapter — the ONE place that touches the @agentclientprotocol/sdk
// 0.29 fluent surface (`client({ name }).connect(stream)`).
//
// The wire SDK deprecated the `new ClientSideConnection(toClient, stream)`
// constructor in favour of the fluent `client()` builder. The two have
// different shapes: the deprecated class implemented `Agent` directly (so
// `.initialize()`/`.newSession()`/`.prompt()` were methods on the returned
// object), while `client(...).connect(stream)` returns a persistent
// `ClientConnection` whose `.agent` is a `ClientContext` driven by
// `request(<method>, params)`.
//
// `connect()` (NOT `connectWith()`) is the right primitive here: the backend
// retains the connection on a BridgeSession and reuses it across turns
// (backend.ts), so the op-scoped close semantics of `connectWith` do not fit.
//
// This module owns the `AcpConnectionLike` seam so the backend and the live
// smokes both drive ONE adapter — the SDK method-name mapping lives here only,
// and the backend's orchestration + the gate fakes stay untouched.

import { AGENT_METHODS, CLIENT_METHODS, client, type Stream } from "@agentclientprotocol/sdk";
import type { AcpTextBlock } from "./context.js";

/** The subset of the ACP agent connection the backend drives (real or fake). */
export interface AcpConnectionLike {
	initialize(params: unknown): Promise<unknown>;
	newSession(params: unknown): Promise<{ sessionId?: string }>;
	prompt(params: { sessionId: string; prompt: AcpTextBlock[] }): Promise<{ stopReason?: string }>;
	setSessionConfigOption?(params: unknown): Promise<unknown>;
	/**
	 * Closes the underlying SDK connection before child process teardown. With
	 * the fluent SDK connection this is load-bearing: otherwise a successful
	 * live turn can print PASS but keep Node's event loop alive.
	 *
	 * Implementations MUST be best-effort (never throw): callers invoke it on
	 * success, error, and reuse-error teardown paths, so a close failure must not
	 * mask the turn's real outcome nor skip the child teardown that follows it.
	 */
	close?(error?: unknown): void;
}

/** The ACP client-side callbacks. They delegate to the session's mutable handler. */
export interface AcpClientHandlers {
	sessionUpdate(notification: { update?: Record<string, unknown>; sessionId?: string }): Promise<void>;
	requestPermission(request: { options?: Array<{ optionId: string; kind?: string }> }): Promise<{
		outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
	}>;
	readTextFile(request: { path: string }): Promise<{ content: string }>;
	// `void` (not `never`): the backend's handler denies by throwing, but the
	// shared smokes legitimately return a write response ({}); both satisfy the
	// SDK's `WriteTextFileResponse | void` handler contract.
	writeTextFile(request: unknown): Promise<void>;
}

/**
 * Production factory — wrap the SDK 0.29 fluent `client()` into the
 * `AcpConnectionLike` seam the backend (and the live smokes) drive.
 *
 * Client-side handlers register by ACP method name; agent-side calls go through
 * the persistent connection's `ClientContext` (`conn.agent`). Both the params a
 * handler receives (`ctx.params`) and the throw-to-JSON-RPC-error behaviour
 * match the deprecated `ClientSideConnection`, so this is behaviour-preserving.
 */
export function connectAcpClient(stream: Stream, handlers: AcpClientHandlers): AcpConnectionLike {
	const conn = client({ name: "entwurf" })
		.onNotification(CLIENT_METHODS.session_update, (ctx) => handlers.sessionUpdate(ctx.params as never))
		.onRequest(CLIENT_METHODS.session_request_permission, (ctx) => handlers.requestPermission(ctx.params as never))
		.onRequest(CLIENT_METHODS.fs_read_text_file, (ctx) => handlers.readTextFile(ctx.params as never))
		.onRequest(CLIENT_METHODS.fs_write_text_file, (ctx) => handlers.writeTextFile(ctx.params as never))
		.connect(stream);

	const agent = conn.agent;
	return {
		initialize: (params) => agent.request(AGENT_METHODS.initialize, params as never),
		newSession: (params) =>
			agent.request(AGENT_METHODS.session_new, params as never) as Promise<{ sessionId?: string }>,
		prompt: (params) =>
			agent.request(AGENT_METHODS.session_prompt, params as never) as Promise<{ stopReason?: string }>,
		setSessionConfigOption: (params) => agent.request(AGENT_METHODS.session_set_config_option, params as never),
		close: (error) => {
			// Best-effort by contract (see AcpConnectionLike.close): a teardown-path
			// close that threw would mask the turn's real error and skip the child
			// teardown that runs after it.
			try {
				conn.close(error);
			} catch {
				// connection already closed / SDK teardown race — nothing to recover.
			}
		},
	};
}
