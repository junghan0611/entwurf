import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	acceptControlConnection,
	type ControlBinding,
	type ControlServerState,
	closeControlConnections,
	endRetireResponse,
	invalidateControlBinding,
	type RetireContext,
	type RetireState,
	requestControlRetire,
	startOrRebindControlServer,
} from "./control-retire.ts";
import { attachAcceptedSocketDisconnectPolicy, sendRpcCommand } from "./entwurf-control-rpc.ts";

const gardenId = "20261021T120000-abcdef";
const nativeSessionId = "native-test-owned";
const expected = { gardenId, nativeSessionId };
function fixture() {
	const shutdown = vi.fn();
	const ctx: RetireContext = {
		mode: "tui",
		sessionManager: { getSessionId: () => nativeSessionId },
		isIdle: () => true,
		hasPendingMessages: () => false,
		shutdown,
	};
	const binding: ControlBinding = { ...expected, context: ctx };
	const state: RetireState = { context: ctx, binding, closing: false, retireRequested: false };
	return { shutdown, ctx, binding, state, run: () => requestControlRetire(state, binding, gardenId, expected) };
}

describe("internal Pi retire (fake SDK only)", () => {
	it("[QK:RETIRE-REQUEST-ONCE] same binding idle TUI calls SDK exactly once; receipt is only requested", () => {
		const h = fixture();
		expect(h.run()).toEqual({ boundary: "shutdown-requested" });
		expect(h.run()).toEqual({ boundary: "refused", reason: "target-closing" });
		expect(h.shutdown).toHaveBeenCalledTimes(1);
	});

	it("[QK:RETIRE-IDLE] [QK:RETIRE-PENDING] [QK:RETIRE-TUI] busy, pending and non-TUI never schedule shutdown", () => {
		for (const [change, reason] of [
			[
				(h: ReturnType<typeof fixture>) => {
					h.ctx.isIdle = () => false;
				},
				"target-busy",
			],
			[
				(h: ReturnType<typeof fixture>) => {
					h.ctx.hasPendingMessages = () => true;
				},
				"target-pending",
			],
			[
				(h: ReturnType<typeof fixture>) => {
					Object.defineProperty(h.ctx, "mode", { value: "rpc" });
				},
				"target-non-tui",
			],
		] as const) {
			const h = fixture();
			change(h);
			expect(h.run()).toEqual({ boundary: "refused", reason });
			expect(h.shutdown).not.toHaveBeenCalled();
		}
	});

	it("[QK:RETIRE-IDENTITY] every identity join and old server generation refuses", () => {
		const changes = [
			(h: ReturnType<typeof fixture>) => {
				h.state.binding = { ...h.binding };
			},
			(h: ReturnType<typeof fixture>) => {
				h.state.context = { ...h.ctx };
			},
			(h: ReturnType<typeof fixture>) => {
				h.state.context = null;
			},
			(h: ReturnType<typeof fixture>) => {
				h.ctx.sessionManager.getSessionId = () => "other";
			},
		];
		for (const change of changes) {
			const h = fixture();
			change(h);
			expect(h.run()).toEqual({ boundary: "refused", reason: "target-stale" });
			expect(h.shutdown).not.toHaveBeenCalled();
		}
		for (const [resident, target] of [
			["other", expected],
			[gardenId, { ...expected, gardenId: "other" }],
			[gardenId, { ...expected, nativeSessionId: "other" }],
		] as const) {
			const h = fixture();
			expect(requestControlRetire(h.state, h.binding, resident, target).boundary).toBe("refused");
			expect(h.shutdown).not.toHaveBeenCalled();
		}
	});

	it("[QK:RETIRE-INVALIDATE] shutdown invalidates before teardown, stale getter is a named refusal", () => {
		const h = fixture();
		invalidateControlBinding(h.state);
		expect(h.state.context).toBeNull();
		expect(h.state.binding).toBeNull();
		expect(h.run()).toEqual({ boundary: "refused", reason: "target-closing" });
		expect(h.shutdown).not.toHaveBeenCalled();
		const stale = fixture();
		Object.defineProperty(stale.ctx, "sessionManager", {
			get() {
				throw new Error("SDK stale context");
			},
		});
		expect(stale.run()).toEqual({ boundary: "refused", reason: "target-context-unavailable" });
		expect(stale.shutdown).not.toHaveBeenCalled();
	});

	it("[QK:RETIRE-CALL-UNKNOWN] SDK call failure is unknown and cannot be replayed", () => {
		const h = fixture();
		h.shutdown.mockImplementation(() => {
			throw new Error("after request");
		});
		expect(h.run()).toEqual({ boundary: "unknown", reason: "shutdown-call-failed" });
		h.run();
		expect(h.shutdown).toHaveBeenCalledTimes(1);
	});

	// Production rebind + accept helpers are exercised on a real listener below. This test's
	// net.createServer handler is a fixture: production createServer's accept-time wiring
	// is separately source-read evidence, not automatically certified by this QK.
	it("[QK:RETIRE-SAME-PATH-REBIND] production rebind preserves listener/path, old accepted connection stays stale", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "entwurf-rebind-"));
		const socketPath = path.join(dir, "test.sock");
		const first = fixture();
		const second = fixture();
		const state: ControlServerState<RetireContext> = {
			...first.state,
			server: null,
			socketPath: null,
			connections: new Set(),
		};
		const accepted: Array<ControlBinding | null> = [];
		const io = {
			prepare: vi.fn(async () => {}),
			stop: vi.fn(async () => {
				invalidateControlBinding(state);
			}),
			remove: vi.fn(async (_address: string) => {}),
			create: vi.fn(async (address: string) => {
				const server = net.createServer((socket) => {
					const captured = acceptControlConnection(state, socket);
					accepted.push(captured);
					attachAcceptedSocketDisconnectPolicy(socket);
					socket.once("data", (bytes) => {
						const command = JSON.parse(bytes.toString());
						const result = requestControlRetire(state, captured, gardenId, command);
						endRetireResponse(socket, {
							type: "response",
							command: "retire",
							success: result.boundary === "shutdown-requested",
							data: result,
						});
					});
				});
				await new Promise<void>((resolve) => server.listen(address, resolve));
				return server;
			}),
		};
		let oldClient: net.Socket | undefined;
		try {
			await startOrRebindControlServer(state, first.ctx, socketPath, gardenId, io);
			const originalServer = state.server!;
			const originalBinding = state.binding;
			const acceptedOld = new Promise<void>((resolve) => originalServer.once("connection", () => resolve()));
			oldClient = net.createConnection(socketPath);
			oldClient.on("error", () => {});
			await acceptedOld;
			for (const method of Object.values(io)) method.mockClear();
			const rebound = startOrRebindControlServer(state, second.ctx, socketPath, gardenId, io);
			expect(state.context).toBe(second.ctx);
			expect(state.binding).not.toBe(originalBinding);
			await rebound;
			expect(state.server).toBe(originalServer);
			expect(originalServer.listening).toBe(true);
			for (const method of Object.values(io)) expect(method).not.toHaveBeenCalled();
			const oldReply = new Promise<string>((resolve) => oldClient!.once("data", (bytes) => resolve(bytes.toString())));
			oldClient.write(`${JSON.stringify({ type: "retire", ...expected })}\n`);
			expect(JSON.parse(await oldReply).data).toEqual({ boundary: "refused", reason: "target-stale" });
			const newReply = await sendRpcCommand(socketPath, { type: "retire", ...expected });
			expect(newReply.response.data).toEqual({ boundary: "shutdown-requested" });
			expect(accepted[0]).toBe(originalBinding);
			expect(accepted[1]).toBe(state.binding);
			expect(first.shutdown).not.toHaveBeenCalled();
			expect(second.shutdown).toHaveBeenCalledTimes(1);
		} finally {
			oldClient?.destroy();
			invalidateControlBinding(state);
			if (state.server) await closeControlConnections(state.server, state.connections);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("[QK:RETIRE-ACK-CLOSE] real local transport ACK completes before server teardown; no SDK/process exit", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "entwurf-retire-"));
		const socketPath = path.join(dir, "test.sock");
		const sockets = new Set<net.Socket>();
		const h = fixture();
		let teardown: Promise<void> | undefined;
		const server = net.createServer((socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			attachAcceptedSocketDisconnectPolicy(socket);
			socket.once("data", (bytes) => {
				const command = JSON.parse(bytes.toString());
				const result = requestControlRetire(h.state, h.binding, gardenId, command);
				endRetireResponse(socket, { type: "response", command: "retire", success: true, data: result });
				invalidateControlBinding(h.state);
				teardown = closeControlConnections(server, sockets);
			});
		});
		try {
			await new Promise<void>((resolve) => server.listen(socketPath, resolve));
			const reply = await sendRpcCommand(socketPath, { type: "retire", ...expected }, { timeout: 1500 });
			expect(reply.response.data).toEqual({ boundary: "shutdown-requested" });
			await teardown;
			expect(h.shutdown).toHaveBeenCalledTimes(1);
			expect(server.listening).toBe(false);
		} finally {
			for (const socket of sockets) socket.destroy();
			if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("[QK:RETIRE-BOUNDED-CLOSE] a half-open accepted peer cannot hold teardown forever", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "entwurf-retire-held-"));
		const socketPath = path.join(dir, "test.sock");
		const sockets = new Set<net.Socket>();
		const server = net.createServer({ allowHalfOpen: true }, (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			attachAcceptedSocketDisconnectPolicy(socket);
		});
		let client: net.Socket | undefined;
		let teardown: Promise<void> | undefined;
		let witnessTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			await new Promise<void>((resolve) => server.listen(socketPath, resolve));
			client = net.createConnection({ path: socketPath, allowHalfOpen: true });
			client.on("error", () => {});
			await new Promise<void>((resolve) => client!.once("connect", resolve));
			const accepted = [...sockets][0];
			expect(accepted).toBeDefined();
			teardown = closeControlConnections(server, sockets);
			// Independent witness bound, not a time-based success predicate. If the destroy
			// mutant hangs teardown, fail THIS QK and still reach owned-resource cleanup.
			await Promise.race([
				teardown,
				new Promise<never>((_resolve, reject) => {
					witnessTimer = setTimeout(() => reject(new Error("owned teardown did not complete")), 2000);
				}),
			]);
			expect(accepted.destroyed).toBe(true);
		} finally {
			if (witnessTimer !== undefined) clearTimeout(witnessTimer);
			client?.destroy();
			for (const socket of sockets) socket.destroy();
			if (teardown) await teardown;
			else if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("[QK:RETIRE-RESPONSE-THROW] a failed response closes transport without replaying shutdown", () => {
		const h = fixture();
		const socket = {
			end: vi.fn(() => {
				throw new Error("closed");
			}),
			destroy: vi.fn(),
		};
		const result = h.run();
		endRetireResponse(socket as unknown as net.Socket, result);
		expect(socket.destroy).toHaveBeenCalledTimes(1);
		expect(h.shutdown).toHaveBeenCalledTimes(1);
	});

	it("[QK:RETIRE-TRANSPORT-UNKNOWN] response loss makes the client fail once without retry", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "entwurf-retire-lost-"));
		const socketPath = path.join(dir, "test.sock");
		const h = fixture();
		let connections = 0;
		const server = net.createServer((socket) => {
			connections++;
			socket.once("data", () => {
				h.run();
				socket.destroy();
			});
		});
		try {
			await new Promise<void>((resolve) => server.listen(socketPath, resolve));
			await expect(sendRpcCommand(socketPath, { type: "retire", ...expected })).rejects.toThrow(
				"connection closed before response",
			);
			expect(h.shutdown).toHaveBeenCalledTimes(1);
			expect(connections).toBe(1);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
