// Tiny stdio MCP server used by smoke-acp-mcp-live (S2g LIVE 1) and by the
// §11-7 ordering probe (smoke-acp-ordering-probe-live).
//
// It exposes ONE tool — `probe_nonce` — that returns a per-run secret nonce
// supplied via the PROBE_NONCE env var. The smoke registers this server in a
// scratch `.pi/settings.json` under `entwurfProvider.mcpServers` and asks the
// ACP model to CALL the tool and echo the nonce. If the operator mcpServers
// passthrough (S2g) works, the ACP child spawns this server, the tool is visible
// in the session schema, and the model's reply carries the nonce. If passthrough
// is broken (the pre-S2g hardcoded `mcpServers:[]`), the tool never exists and
// the nonce cannot appear.
//
// §11-7 ordering-probe mode — active ONLY when PROBE_MCP_EVENT_LOG is set
// (smoke-acp-mcp-live never sets it, so its behavior is unchanged):
//   - PROBE_MCP_STARTUP_DELAY_MS delays the transport connect — the controlled
//     input the probe injects instead of trying to observe a window that has no
//     observable signal on this server's ACP surface;
//   - the tool takes a REQUIRED `probeRunId` argument, the cross-layer join key
//     (§11-7: the ACP toolCallId and the MCP JSON-RPC id share no namespace, so
//     correlation must ride an argument we control);
//   - every wire step appends to the shared NDJSON event log, including THE
//     wire-availability marker `tools_list_response_forwarded`, emitted only
//     after the ENTIRE tools/list response frame was write()-n to downstream
//     stdio AND the write callback fired. The SDK's own send() resolves on
//     buffered-write/drain — NOT the write callback — which is exactly the
//     false-green §11-7 forbids, so probe mode swaps in a callback-forwarding
//     transport instead of trusting send().
//
// Lives under the repo's scripts/fixtures/ so its `@modelcontextprotocol/sdk`
// import resolves against the repo node_modules even though the server is spawned
// (by the claude ACP child) with an arbitrary scratch cwd. Deliberately minimal:
// no identity / env coupling beyond the PROBE_* vars, so a failure isolates to
// "did the operator mcpServers reach newSession" — not to entwurf-bridge wiring.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { z } from "zod";
import {
	appendProbeEvent,
	PROBE_EXPECTED_TOOL as EXPECTED_TOOL,
	PROBE_ENV,
	PROBE_EVENTS,
	type ProbeEventName,
} from "../lib/probe-event-log.ts";

const eventLog = process.env[PROBE_ENV.eventLog];
const probeMode = typeof eventLog === "string" && eventLog.length > 0;
const runId = process.env[PROBE_ENV.runId] ?? "unknown-run";
const startupDelayMs = Math.max(0, Number(process.env[PROBE_ENV.startupDelayMs] ?? "0") || 0);

function emit(event: ProbeEventName, payload: Record<string, unknown> = {}): void {
	if (probeMode && eventLog) appendProbeEvent(eventLog, runId, event, payload);
}

// ---------------------------------------------------------------------------
// §11-7 instrumented transport — write-callback semantics + wire markers.
// ---------------------------------------------------------------------------

type JsonRpcMessage = {
	id?: string | number;
	method?: string;
	params?: { name?: string; arguments?: Record<string, unknown> };
	result?: { tools?: Array<{ name?: string }> };
};

class InstrumentedStdioServerTransport extends StdioServerTransport {
	// JSON-RPC request id → method, so a response frame can be attributed to the
	// request that caused it (the response itself carries no method).
	private readonly pendingMethods = new Map<string | number, string>();

	constructor() {
		super();
		// The SDK protocol layer assigns `transport.onmessage = handler` after
		// connect; the base class reads `this.onmessage`. Intercept the assignment
		// so every inbound frame is stamped BEFORE the handler runs — receipt
		// markers, not handler-return markers. Installed via defineProperty because
		// the base declares `onmessage` as a plain property (TS2611 forbids a
		// static accessor override) yet never assigns it in its constructor, so an
		// instance accessor here wins cleanly.
		let raw: ((message: unknown, extra?: unknown) => void) | undefined;
		const stampInbound = (msg: JsonRpcMessage) => this.stampInbound(msg);
		Object.defineProperty(this, "onmessage", {
			get(): ((message: unknown, extra?: unknown) => void) | undefined {
				if (!raw) return undefined;
				return (message: unknown, extra?: unknown) => {
					stampInbound(message as JsonRpcMessage);
					raw?.(message, extra);
				};
			},
			set(handler: ((message: unknown, extra?: unknown) => void) | undefined) {
				raw = handler;
			},
		});
	}

	private stampInbound(msg: JsonRpcMessage): void {
		if (typeof msg?.method !== "string") return;
		if (msg.id !== undefined) this.pendingMethods.set(msg.id, msg.method);
		if (msg.method === "initialize") {
			emit(PROBE_EVENTS.fixtureInitializeReceived, { jsonrpcId: msg.id });
		} else if (msg.method === "tools/list") {
			emit(PROBE_EVENTS.fixtureToolsListReceived, { jsonrpcId: msg.id });
		} else if (msg.method === "tools/call") {
			emit(PROBE_EVENTS.fixtureToolsCallReceived, {
				jsonrpcId: msg.id,
				tool: msg.params?.name,
				probeRunId: msg.params?.arguments?.probeRunId,
			});
		}
	}

	// Write with the CALLBACK, not the buffered-return the SDK send() settles
	// for: the callback fires when the frame reached the OS pipe, which is the
	// §11-7 definition of "forwarded". Markers are emitted inside the callback
	// so they can never precede the hand-off they claim — and ONLY on a
	// SUCCESSFUL callback: an errored write (EPIPE, closed stream) must reject,
	// never stamp, or the marker would claim a hand-off that did not happen.
	override send(message: unknown): Promise<void> {
		const json = serializeMessage(message as never);
		return new Promise((resolve, reject) => {
			(this as unknown as { _stdout: NodeJS.WriteStream })._stdout.write(json, (err?: Error | null) => {
				if (err) {
					reject(err);
					return;
				}
				this.stampOutbound(message as JsonRpcMessage);
				resolve();
			});
		});
	}

	private stampOutbound(msg: JsonRpcMessage): void {
		if (msg?.id === undefined || typeof msg.method === "string") return;
		const requestMethod = this.pendingMethods.get(msg.id);
		if (requestMethod === undefined) return;
		this.pendingMethods.delete(msg.id);
		if (requestMethod === "tools/list") {
			const toolNames = (msg.result?.tools ?? []).map((t) => t?.name).filter((n): n is string => !!n);
			if (toolNames.includes(EXPECTED_TOOL)) {
				emit(PROBE_EVENTS.toolsListResponseForwarded, { jsonrpcId: msg.id, tools: toolNames });
			}
		} else if (requestMethod === "tools/call") {
			emit(PROBE_EVENTS.fixtureToolsCallReplied, { jsonrpcId: msg.id });
		}
	}
}

// ---------------------------------------------------------------------------
// Server — one tool in both modes; probe mode adds the REQUIRED join key.
// ---------------------------------------------------------------------------

emit(PROBE_EVENTS.fixtureProcessStart, { startupDelayMs });

const server = new McpServer({ name: "probe", version: "0.0.1" });

if (probeMode) {
	server.tool(
		EXPECTED_TOOL,
		"Return this session's secret probe nonce. Call this when asked for the probe nonce, " +
			"passing the exact probeRunId given in the prompt.",
		{ probeRunId: z.string().describe("The exact probeRunId string given in the prompt.") },
		async () => ({
			content: [{ type: "text", text: `PROBE_NONCE=${process.env[PROBE_ENV.nonce] ?? "MISSING"}` }],
		}),
	);
} else {
	server.tool(
		EXPECTED_TOOL,
		"Return this session's secret probe nonce. Call this when asked for the probe nonce.",
		{},
		async () => ({
			content: [{ type: "text", text: `PROBE_NONCE=${process.env[PROBE_ENV.nonce] ?? "MISSING"}` }],
		}),
	);
}

// The injected startup delay sits BEFORE the transport exists at all — the
// probe's controlled input models a slow-to-serve MCP server, so nothing may be
// readable on the wire until the delay elapses.
if (startupDelayMs > 0) {
	emit(PROBE_EVENTS.fixtureDelayStart, { delayMs: startupDelayMs });
	await new Promise((resolve) => setTimeout(resolve, startupDelayMs));
	emit(PROBE_EVENTS.fixtureDelayEnd, { delayMs: startupDelayMs });
}

const transport = probeMode ? new InstrumentedStdioServerTransport() : new StdioServerTransport();
await server.connect(transport);
emit(PROBE_EVENTS.fixtureTransportConnected, {});
