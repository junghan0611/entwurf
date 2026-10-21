/** Internal Pi lifecycle leaf, not an authorization boundary. The future core caller must
 * authorize retirement (and reject self-retirement) before reaching this local socket.
 * No prompt, abort, queue clearing, deferred shutdown, or retry is performed here.
 */
import type * as net from "node:net";
import type { RpcResponse } from "./entwurf-control-rpc.js";

export interface RetireContext {
	readonly mode: string;
	readonly sessionManager: { getSessionId(): string };
	isIdle(): boolean;
	hasPendingMessages(): boolean;
	shutdown(): void;
}

/** Object identity is the session binding generation, captured when a connection is accepted.
 * A listener may survive same-path rebinds; old accepted connections retain their old binding.
 */
export interface ControlBinding {
	readonly gardenId: string;
	readonly nativeSessionId: string;
	readonly context: RetireContext;
}

export interface RetireState {
	context: RetireContext | null;
	binding: ControlBinding | null;
	closing: boolean;
	retireRequested: boolean;
}

export interface ControlServerState<C extends RetireContext> extends RetireState {
	context: C | null;
	server: net.Server | null;
	socketPath: string | null;
	connections: Set<net.Socket>;
}

/** Production start/rebind seam. Same-path rebind is entirely synchronous and performs NO
 * listener/path IO. Each accept snapshots the binding via acceptControlConnection below.
 */
export async function startOrRebindControlServer<C extends RetireContext>(
	state: ControlServerState<C>,
	ctx: C,
	socketPath: string,
	gardenId: string,
	io: {
		prepare(): Promise<void>;
		stop(): Promise<void>;
		remove(socketPath: string): Promise<void>;
		create(socketPath: string): Promise<net.Server>;
	},
): Promise<void> {
	const binding: ControlBinding = { gardenId, nativeSessionId: ctx.sessionManager.getSessionId(), context: ctx };
	const bind = () => {
		state.context = ctx;
		state.binding = binding;
		state.closing = false;
		state.retireRequested = false;
	};
	if (state.socketPath === socketPath && state.server) {
		bind();
		return;
	}
	await io.prepare();
	await io.stop();
	await io.remove(socketPath);
	bind();
	state.socketPath = socketPath;
	state.server = await io.create(socketPath);
}

/** Snapshot exactly once, on accept, NOT when the listener was created or a command arrives. */
export function acceptControlConnection(
	state: Pick<ControlServerState<RetireContext>, "binding" | "connections">,
	socket: net.Socket,
): ControlBinding | null {
	state.connections.add(socket);
	socket.once("close", () => state.connections.delete(socket));
	return state.binding;
}

export type RetireResult =
	| { boundary: "shutdown-requested" }
	| { boundary: "unknown"; reason: "shutdown-call-failed" }
	| {
			boundary: "refused";
			reason:
				| "target-closing"
				| "target-stale"
				| "target-context-unavailable"
				| "target-non-tui"
				| "target-busy"
				| "target-pending";
	  };

/** Entire final check + SDK void call is synchronous. Call only AFTER any async preflight.
 * A returned request receipt proves neither process exit nor persistence/flush completion.
 * After requested/unknown, unobserved exit can leave a connect-alive socket refusing commands
 * as target-closing until exit or a new session_start. No same-generation unlatch or retry.
 */
export function requestControlRetire(
	state: RetireState,
	serverBinding: ControlBinding | null,
	residentGardenId: string | null,
	expected: { gardenId: unknown; nativeSessionId: unknown },
): RetireResult {
	if (state.closing || state.retireRequested) return { boundary: "refused", reason: "target-closing" };
	const ctx = state.context;
	if (
		!serverBinding ||
		!ctx ||
		state.binding !== serverBinding ||
		ctx !== serverBinding.context ||
		residentGardenId !== serverBinding.gardenId ||
		expected.gardenId !== serverBinding.gardenId ||
		expected.nativeSessionId !== serverBinding.nativeSessionId
	) {
		return { boundary: "refused", reason: "target-stale" };
	}
	let shutdown: () => void;
	try {
		if (ctx.sessionManager.getSessionId() !== serverBinding.nativeSessionId) {
			return { boundary: "refused", reason: "target-stale" };
		}
		if (ctx.mode !== "tui") return { boundary: "refused", reason: "target-non-tui" };
		if (!ctx.isIdle()) return { boundary: "refused", reason: "target-busy" };
		if (ctx.hasPendingMessages()) return { boundary: "refused", reason: "target-pending" };
		shutdown = ctx.shutdown;
	} catch {
		// SDK invalidates captured contexts on replacement/reload. Never call through one.
		return { boundary: "refused", reason: "target-context-unavailable" };
	}
	state.retireRequested = true;
	try {
		shutdown.call(ctx);
	} catch {
		// The call may have started shutdown before throwing. Do not invite a replay.
		return { boundary: "unknown", reason: "shutdown-call-failed" };
	}
	return { boundary: "shutdown-requested" };
}

/** Invalidate BEFORE waiting for server.close: accepted old connections must not act. */
export function invalidateControlBinding(state: RetireState): void {
	state.closing = true;
	state.binding = null;
	state.context = null;
}

/** The production receiver's one wire envelope. The RpcResponse import is type-only:
 * no runtime dependency on the RPC client is introduced. An absent id is omitted by JSON;
 * error is present only for refused/unknown, matching the strict core-side parser.
 */
export function retireResponseEnvelope(result: RetireResult, id?: string): RpcResponse {
	return {
		type: "response",
		command: "retire",
		id,
		success: result.boundary === "shutdown-requested",
		data: result,
		...(result.boundary !== "shutdown-requested" ? { error: result.reason } : {}),
	};
}

/** One response, then FIN; never wait for SDK termination to acknowledge its request.
 * A failed transport leaves the caller with unknown outcome, not retry authority.
 * The internal client sends one command per connection: concurrent responses on this same
 * connection can be lost when retire sends FIN. It is not a multiplexed lifecycle protocol.
 */
export function endRetireResponse(socket: net.Socket, response: unknown): void {
	try {
		socket.end(`${JSON.stringify(response)}\n`);
	} catch {
		socket.destroy();
	}
}

/** Session teardown only: flush accepted writes with FIN, then bound a non-cooperating peer.
 * This timer exists solely for this server.close operation, not as a resident watcher.
 * Applied to all session shutdowns: other in-flight replies may become transport-unknown.
 */
export async function closeControlConnections(server: net.Server, sockets: Set<net.Socket>): Promise<void> {
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			for (const socket of sockets) socket.destroy();
		}, 250);
		timer.unref();
		server.close(() => {
			clearTimeout(timer);
			resolve();
		});
		for (const socket of sockets) socket.end();
	});
}
