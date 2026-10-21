import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type ControlBinding,
	type RetireContext,
	type RetireState,
	requestControlRetire,
	retireResponseEnvelope,
} from "./control-retire.ts";
import { attachAcceptedSocketDisconnectPolicy } from "./entwurf-control-rpc.ts";
import type { MetaIdentity } from "./meta-session.ts";
import { parsePiRetireResponse, requestPiRetire } from "./pi-retire-request.ts";

// Typed record fixture; store certification belongs upstream, not to this adapter/test.
const target: MetaIdentity = {
	schemaVersion: 3,
	gardenId: "20261021T120000-abcdef",
	backend: "pi",
	nativeSessionId: "fixture-native-id",
	cwd: "/test-owned",
	model: null,
	transcriptPath: null,
	createdAt: "2026-10-21T12:00:00.000Z",
	recordUpdatedAt: "2026-10-21T12:00:00.000Z",
	attachIncarnation: null,
};
const expected = { gardenId: target.gardenId, nativeSessionId: target.nativeSessionId };
const ack = { type: "response", command: "retire", success: true, data: { boundary: "shutdown-requested" } };

async function localReceiver(
	onRequest: (command: unknown, socket: net.Socket) => void,
	run: (dir: string, counts: { connections: number; requests: number }) => Promise<void>,
) {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-retire-request-"));
	const sockets = new Set<net.Socket>();
	const counts = { connections: 0, requests: 0 };
	const server = net.createServer((socket) => {
		counts.connections++;
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		attachAcceptedSocketDisconnectPolicy(socket);
		let buffer = "";
		socket.on("data", (bytes) => {
			buffer += bytes.toString();
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			counts.requests++;
			const command: unknown = JSON.parse(buffer.slice(0, newline));
			buffer = buffer.slice(newline + 1);
			onRequest(command, socket);
		});
	});
	try {
		await new Promise<void>((resolve) => server.listen(path.join(dir, `${target.gardenId}.sock`), resolve));
		await run(dir, counts);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("Pi retire request adapter (no native SDK lifecycle)", () => {
	it("[QK:PI-RETIRE-PREFLIGHT] wrong backend or mismatched identity sends zero RPCs", async () => {
		const sendRpc = vi.fn(async () => ({ response: ack }));
		expect(await requestPiRetire({ ...target, backend: "claude-code" }, expected, { sendRpc })).toEqual({
			boundary: "refused",
			phase: "preflight",
			reason: "target-backend-unsupported",
		});
		for (const wrong of [
			{ ...target, gardenId: "20261021T120001-abcdef" },
			{ ...target, nativeSessionId: "different-native" },
		]) {
			expect(await requestPiRetire(wrong, expected, { sendRpc })).toEqual({
				boundary: "refused",
				phase: "preflight",
				reason: "target-identity-mismatch",
			});
		}
		expect(
			await requestPiRetire({ ...target, gardenId: "../escape" }, { ...expected, gardenId: "../escape" }, { sendRpc }),
		).toEqual({
			boundary: "refused",
			phase: "preflight",
			reason: "target-identity-mismatch",
		});
		expect(sendRpc).not.toHaveBeenCalled();
	});

	it("[QK:PI-RETIRE-WIRE] record garden path and exact fixed payload yield request-only acknowledgement", async () => {
		let observed: unknown;
		await localReceiver(
			(command, socket) => {
				observed = command;
				socket.end(`${JSON.stringify(retireResponseEnvelope({ boundary: "shutdown-requested" }))}\n`);
			},
			async (dir, counts) => {
				expect(await requestPiRetire(target, expected, { controlSocketDir: dir })).toEqual({
					boundary: "shutdown-requested",
				});
				expect(observed).toEqual({ type: "retire", ...expected });
				expect(counts).toEqual({ connections: 1, requests: 1 });
			},
		);
	});

	it("[QK:PI-RETIRE-ENVELOPE] production builder serializes the exact current wire contract", () => {
		const requested = JSON.parse(JSON.stringify(retireResponseEnvelope({ boundary: "shutdown-requested" })));
		expect(requested).toEqual(ack);
		expect(Object.hasOwn(requested, "id")).toBe(false);
		expect(Object.hasOwn(requested, "error")).toBe(false);
		const refused = JSON.parse(
			JSON.stringify(retireResponseEnvelope({ boundary: "refused", reason: "target-busy" }, "r1")),
		);
		expect(refused).toEqual({
			type: "response",
			command: "retire",
			id: "r1",
			success: false,
			data: { boundary: "refused", reason: "target-busy" },
			error: "target-busy",
		});
		expect(parsePiRetireResponse(refused)).toEqual({ boundary: "refused", phase: "receiver", reason: "target-busy" });
		const unknown = JSON.parse(
			JSON.stringify(retireResponseEnvelope({ boundary: "unknown", reason: "shutdown-call-failed" })),
		);
		expect(unknown).toEqual({
			type: "response",
			command: "retire",
			success: false,
			data: { boundary: "unknown", reason: "shutdown-call-failed" },
			error: "shutdown-call-failed",
		});
		expect(parsePiRetireResponse(unknown)).toEqual({ boundary: "unknown", reason: "shutdown-call-failed" });
	});

	it("[QK:PI-RETIRE-REFUSALS] only the closed receiver refusal/unknown combinations are preserved", () => {
		for (const reason of [
			"target-closing",
			"target-stale",
			"target-context-unavailable",
			"target-non-tui",
			"target-busy",
			"target-pending",
		]) {
			expect(
				parsePiRetireResponse({
					type: "response",
					command: "retire",
					success: false,
					data: { boundary: "refused", reason },
					error: reason,
				}),
			).toEqual({ boundary: "refused", phase: "receiver", reason });
		}
		expect(
			parsePiRetireResponse({
				type: "response",
				command: "retire",
				success: false,
				data: { boundary: "unknown", reason: "shutdown-call-failed" },
				error: "shutdown-call-failed",
			}),
		).toEqual({
			boundary: "unknown",
			reason: "shutdown-call-failed",
		});
	});

	it("[QK:PI-RETIRE-PARSE-CLOSED] malformed or contradictory replies cannot be accepted/refused as if reliable", () => {
		const malformed = [
			null,
			[],
			{},
			{ ...ack, command: "send" },
			{ ...ack, type: "event" },
			{ ...ack, data: undefined },
			{ ...ack, data: {} },
			{ ...ack, success: "true" },
			{ ...ack, success: false },
			{ ...ack, error: "surprise" },
			{ ...ack, id: 4 },
			{ ...ack, extra: true },
			{ ...ack, data: { boundary: "process-exited" } },
			{ ...ack, data: { boundary: "shutdown-requested", reason: "target-busy" } },
			{ ...ack, data: { boundary: "refused", reason: "target-busy" }, error: "target-busy" },
			{ ...ack, success: false, data: { boundary: "refused", reason: "invented" }, error: "invented" },
			{ ...ack, success: false, data: { boundary: "refused", reason: "target-busy" }, error: "target-stale" },
			{ ...ack, success: false, data: { boundary: "unknown", reason: "invented" }, error: "invented" },
		];
		for (const response of malformed)
			expect(parsePiRetireResponse(response)).toEqual({ boundary: "unknown", reason: "malformed-response" });
		expect(parsePiRetireResponse({ ...ack, id: "valid-id" })).toEqual({ boundary: "shutdown-requested" });
	});

	it("[QK:PI-RETIRE-TRANSPORT] timeout, dropped or malformed reply remain unknown; one connection/request only", async () => {
		for (const behavior of ["timeout", "drop", "malformed", "wrong-command"] as const) {
			await localReceiver(
				(_command, socket) => {
					if (behavior === "drop") socket.destroy();
					else if (behavior === "malformed") socket.end(`${JSON.stringify({ ...ack, data: {} })}\n`);
					else if (behavior === "wrong-command") socket.end(`${JSON.stringify({ ...ack, command: "send" })}\n`);
				},
				async (dir, counts) => {
					expect(await requestPiRetire(target, expected, { controlSocketDir: dir, timeoutMs: 50 })).toEqual({
						boundary: "unknown",
						reason: behavior === "malformed" ? "malformed-response" : "transport-error",
					});
					expect(counts).toEqual({ connections: 1, requests: 1 });
				},
			);
		}
		const sendRpc = vi.fn(async () => {
			throw new Error("ECONNREFUSED gives no request-phase receipt");
		});
		expect(await requestPiRetire(target, expected, { sendRpc })).toEqual({
			boundary: "unknown",
			reason: "transport-error",
		});
		expect(sendRpc).toHaveBeenCalledTimes(1);
	});

	it("[QK:PI-RETIRE-STALE-RECEIVER] old native SID reaches new generation's receiver refusal and never SDK shutdown", async () => {
		const shutdown = vi.fn();
		const ctx: RetireContext = {
			mode: "tui",
			sessionManager: { getSessionId: () => "new-native-id" },
			isIdle: () => true,
			hasPendingMessages: () => false,
			shutdown,
		};
		const binding: ControlBinding = { gardenId: target.gardenId, nativeSessionId: "new-native-id", context: ctx };
		const state: RetireState = { context: ctx, binding, closing: false, retireRequested: false };
		await localReceiver(
			(command, socket) => {
				const result = requestControlRetire(state, binding, target.gardenId, command as typeof expected);
				// Production receiver helper + envelope builder + real transport, not the
				// production createServer handler (its builder wiring is source-read evidence).
				socket.end(`${JSON.stringify(retireResponseEnvelope(result))}\n`);
			},
			async (dir, counts) => {
				expect(await requestPiRetire(target, expected, { controlSocketDir: dir })).toEqual({
					boundary: "refused",
					phase: "receiver",
					reason: "target-stale",
				});
				expect(counts).toEqual({ connections: 1, requests: 1 });
				expect(shutdown).not.toHaveBeenCalled();
			},
		);
	});
});
