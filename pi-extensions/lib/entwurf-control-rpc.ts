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
// side so callers never have to mangle the message body; pi-tools-bridge
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

export interface RpcClientOptions {
	timeout?: number;
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
