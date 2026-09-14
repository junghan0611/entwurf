/**
 * entwurf-control-rpc — the `--entwurf-control` socket protocol SSOT: the wire types
 * (`SenderEnvelope`, `RpcResponse`, the `Rpc*Command` union) AND the newline-delimited-JSON
 * client `sendRpcCommand`, extracted VERBATIM from `entwurf-control.ts` (no logic change).
 *
 * Why a ctx-free lib: the 5d entwurf_v2 production `sendOverSocket` dep needs the same RPC
 * client the legacy control-send + session commands use, but the v2 production assembly
 * lives in `lib/` (ctx-free, gate-/smoke-testable) and must NOT import the surface file's
 * `ExtensionContext`/`ExtensionAPI` world. Keeping ONE wire-protocol definition here means
 * the legacy callers and the v2 producer share one SSOT — the types and the framing never
 * fork. `entwurf-control.ts` re-exports `SenderEnvelope` so its public surface is unchanged.
 *
 * This module performs NO IO of its own beyond the single `net` client connection it is
 * asked to open, and touches nothing pi-specific — it is a pure transport over a path.
 */

import * as net from "node:net";

// `sender` carries the transparency envelope (agentId / sessionId / cwd /
// timestamp). All four fields are mandatory whenever `sender` is present —
// see handleCommand("send") for the reject path. `wants_reply` is a separate
// etiquette marker (NOT part of the envelope), default false — see
// handleCommand("send") + parseSenderInfo and the SenderInfo block below for
// the full semantics: human-conversation hint only, no wait, no polling, no
// delivery tracking. `<sender_info>` JSON synthesis happens at the receiver
// side so callers never have to mangle the message body; entwurf-bridge
// passes the envelope through and the receiving pi prepends the canonical
// XML-style payload before handing the customMessage to pi.sendMessage.
export interface SenderEnvelope {
	sessionId: string;
	agentId: string;
	cwd: string;
	timestamp: string; // ISO 8601 UTC
	origin?: "pi-session" | "external-mcp" | "meta-session";
	replyable?: boolean;
}

/**
 * THE `<sender_info>` synthesis — the one place the sender envelope becomes
 * message text. ONE consumer since the visible-first cut (#50 C3):
 *   - the live socket rail's RECEIVER (entwurf-control handleCommand("send")
 *     appends it to the delivered customMessage).
 *
 * The second consumer was the dormant spawn-resume rail's SENDER, which appended
 * the same shape to a resume prompt so a resumed citizen woke knowing who called.
 * That rail is gone. The shape stays single-sourced here so a future VISIBLE
 * resume renders an identical envelope rather than inventing a second one.
 * `wants_reply` is emitted only when explicitly true — an unset/false marker
 * renders nothing (etiquette marker, not transport contract).
 */
export function formatSenderInfoBlock(sender: SenderEnvelope, wantsReply = false): string {
	return `\n\n<sender_info>${JSON.stringify({
		sessionId: sender.sessionId,
		agentId: sender.agentId,
		cwd: sender.cwd,
		timestamp: sender.timestamp,
		...(sender.origin ? { origin: sender.origin } : {}),
		...(typeof sender.replyable === "boolean" ? { replyable: sender.replyable } : {}),
		...(wantsReply ? { wants_reply: true } : {}),
	})}</sender_info>`;
}

export interface RpcResponse {
	type: "response";
	command: string;
	success: boolean;
	error?: string;
	data?: unknown;
	id?: string;
}

// Unified command structure
export interface RpcSendCommand {
	type: "send";
	message: string;
	mode?: "steer" | "follow_up";
	sender?: SenderEnvelope;
	wants_reply?: boolean;
	id?: string;
}

export interface RpcGetMessageCommand {
	type: "get_message";
	id?: string;
}

export interface RpcClearCommand {
	type: "clear";
	summarize?: boolean;
	id?: string;
}

export interface RpcAbortCommand {
	type: "abort";
	id?: string;
}

export interface RpcGetInfoCommand {
	type: "get_info";
	id?: string;
}

export type RpcCommand = RpcSendCommand | RpcGetMessageCommand | RpcClearCommand | RpcAbortCommand | RpcGetInfoCommand;

// ============================================================================
// Accepted-connection disconnect policy (server half of the same wire)
// ============================================================================

/** The two codes that mean THE PEER WENT AWAY, and nothing else. `EPIPE` is a write to a pipe the
 * far side already closed; `ECONNRESET` is the far side resetting it. Both describe the client, not
 * this process's state, which is why they are absorbed rather than diagnosed. */
const PEER_DISCONNECT_CODES = new Set(["EPIPE", "ECONNRESET"]);

export function isPeerDisconnect(error: NodeJS.ErrnoException): boolean {
	return typeof error.code === "string" && PEER_DISCONNECT_CODES.has(error.code);
}

/**
 * Install the disconnect policy on a connection this process ACCEPTED. Must run before any data
 * handler and before any response can be written back.
 *
 * `[측정 2026-09-14, .agent-reports/116-c4-live-blocker-20260914.md]` a resident pi DIED without
 * this. A sibling's control-socket send timed out while the receiving session was mid-turn, the
 * sender closed its end, and the server then wrote its late response to a socket whose peer was
 * gone. That EPIPE does NOT arrive as a throw — `writeResponse`'s synchronous try/catch cannot see
 * it — it arrives asynchronously as an `error` event, and an `error` event with no listener is an
 * uncaught exception, so Node terminated the whole session. The citizen then simply read as `dead`
 * and the stale socket it left behind was the only trace.
 *
 * A client that went away is a BOUNDED environment condition, not invalid state: Rule 15's "crash,
 * don't warn" governs states we cannot reason about, and losing an entire resident session because
 * someone hung up is itself the silent failure. Same policy the MCP probe already carries for an
 * async EPIPE on a child's stdin (`scripts/probe-bridge-command.ts:88-97`).
 *
 * Anything that is NOT a peer hanging up is diagnosed exactly once with its code and message and
 * then served on. Swallowing every error would hide the class this listener is not here to absorb;
 * rethrowing from an event callback would be the crash this whole function exists to prevent.
 *
 * `diagnose` is injected so a gate can count diagnostics without capturing global stderr.
 */
export function attachAcceptedSocketDisconnectPolicy(
	socket: net.Socket,
	diagnose: (line: string) => void = (line) => console.error(line),
): void {
	socket.on("error", (error: NodeJS.ErrnoException) => {
		if (isPeerDisconnect(error)) return;
		diagnose(`[entwurf-control] control socket error (${error.code ?? "no code"}): ${error.message}`);
	});
}

export interface RpcClientOptions {
	timeout?: number;
}

export interface ControlSocketRuntimeInfo {
	cwd?: string;
	modelId?: string;
	modelProvider?: string;
	idle?: boolean;
}

export function parseGetInfoResponseData(data: unknown): ControlSocketRuntimeInfo {
	const value = data as
		| {
				cwd?: unknown;
				model?: { id?: unknown; provider?: unknown } | null;
				idle?: unknown;
		  }
		| undefined;
	return {
		cwd: typeof value?.cwd === "string" ? value.cwd : undefined,
		modelId: typeof value?.model?.id === "string" ? value.model.id : undefined,
		modelProvider: typeof value?.model?.provider === "string" ? value.model.provider : undefined,
		idle: typeof value?.idle === "boolean" ? value.idle : undefined,
	};
}

export function formatRuntimeModel(
	info: Pick<ControlSocketRuntimeInfo, "modelId" | "modelProvider">,
): string | undefined {
	if (info.modelProvider && info.modelId) return `${info.modelProvider}/${info.modelId}`;
	return info.modelId;
}

export async function fetchControlSocketRuntimeInfo(
	socketPath: string,
	options: RpcClientOptions = {},
): Promise<ControlSocketRuntimeInfo> {
	const result = await sendRpcCommand(socketPath, { type: "get_info" }, { timeout: options.timeout ?? 1500 });
	if (!result.response.success) {
		throw new Error(result.response.error ?? "get_info failed");
	}
	return parseGetInfoResponseData(result.response.data);
}

export async function sendRpcCommand(
	socketPath: string,
	command: RpcCommand,
	options: RpcClientOptions = {},
): Promise<{ response: RpcResponse }> {
	const { timeout = 5000 } = options;

	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");

		const timeoutHandle = setTimeout(() => {
			socket.destroy(new Error("timeout"));
		}, timeout);

		let buffer = "";
		// settled guard: a single Promise can only be resolved or rejected
		// once. close/error/timeout/data can all race to terminate the RPC,
		// so every terminal path goes through doResolve/doReject which
		// short-circuits if we have already settled. Without this, the
		// natural close event that follows a clean resolve would try to
		// reject a settled promise (silent under V8) or — worse — duplicate
		// listeners would attempt to write on a destroyed socket.
		let settled = false;

		const doResolve = (value: { response: RpcResponse }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
			socket.end();
			resolve(value);
		};

		const doReject = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
			socket.destroy();
			reject(error);
		};

		socket.on("connect", () => {
			socket.write(`${JSON.stringify(command)}\n`);
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
				if (!line) continue;

				try {
					const msg = JSON.parse(line);
					if (msg.type === "response" && msg.command === command.type) {
						doResolve({ response: msg });
						return;
					}
				} catch {
					// Ignore parse errors, keep waiting
				}
			}
		});

		// Server closed the connection before any response arrived. Without
		// this branch the caller's only failure signal would be the
		// configured wait timeout, which is exactly the failure mode the
		// 2026-05-18 receiver-side stuck incident surfaced through. The
		// settled guard makes this a no-op when we already resolved
		// cleanly — every successful RPC ends with socket.end() and
		// triggers a natural close.
		socket.on("close", () => {
			doReject(new Error("connection closed before response"));
		});

		socket.on("error", (error) => {
			doReject(error);
		});
	});
}
