/**
 * Shared fixtures for the fresh-call vitest pilot (issue #62).
 *
 * One runtime observation surface lives here so the contract tests measure what a
 * host actually receives instead of regex-matching source text:
 *
 *   - `bootBridgeAndListTools()` boots the REAL MCP bridge exactly as it ships
 *     (start.sh → node --experimental-strip-types src/index.ts) and returns the
 *     runtime tools/list response — the same bytes an MCP host validates, and since
 *     #125 the same schema a pi session receives through Pi's built-in MCP.
 *
 * The native-pi `registerTool` capture that used to sit beside it is retired with the
 * native verbs themselves (#125): there is no second definition left to capture.
 *
 * It is not a fake re-statement of the schema: the escape that opened #62 lived
 * precisely in the gap between source text and what the host was sent.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const START_SH = path.join(REPO_DIR, "mcp", "entwurf-bridge", "start.sh");

/** Host cap measured on Claude Code: a tool description over this length is silently
 * truncated, which is how entwurf_v2 once lost its whole INTENT contract. */
export const HOST_DESCRIPTION_CAP = 2048;

export interface BridgeTool {
	name?: string;
	description?: string;
	inputSchema?: {
		type?: string;
		properties?: Record<string, Record<string, unknown>>;
		required?: unknown;
	};
}

/**
 * Boot start.sh, run the MCP handshake + one tools/list (id:2), resolve with the
 * registered tools. Same shape as check-entwurf-bridge-boot: a strip-types-hostile
 * construct anywhere in the static import graph crashes the boot, so a parseable
 * tools/list IS the proof the graph loaded. No tools/call is sent — no lock or
 * filesystem side effect, no auth, no model.
 */
export function bootBridgeAndListTools(): Promise<BridgeTool[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(START_SH, { stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;

		const fail = (msg: string): void => {
			if (settled) return;
			settled = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
			}, 300).unref();
			reject(new Error(`${msg}${stderr.trim() ? `\n--- bridge stderr ---\n${stderr.trim()}` : ""}`));
		};

		const timer = setTimeout(() => fail("no tools/list response before the 10s boot bound"), 10_000);

		child.on("error", (err) => {
			clearTimeout(timer);
			fail(`bridge failed to spawn: ${err.message}`);
		});
		child.on("exit", (code, signal) => {
			if (settled) return;
			clearTimeout(timer);
			fail(`bridge exited before answering tools/list (code=${code} signal=${signal})`);
		});
		child.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
			for (const line of stdout.split("\n")) {
				if (!line.trim()) continue;
				let msg: { id?: number; result?: { tools?: BridgeTool[] } };
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.id === 2 && msg.result) {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					child.kill("SIGTERM");
					if (!Array.isArray(msg.result.tools)) {
						reject(new Error("tools/list answered without a tools array"));
						return;
					}
					resolve(msg.result.tools);
					return;
				}
			}
		});

		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "entwurf-vitest-pilot", version: "0.0.0" },
				},
			})}\n`,
		);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
	});
}

export function requireTool<T extends { name?: string }>(tools: T[], name: string): T {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool ${name} is not registered (got: ${tools.map((t) => t.name).join(", ")})`);
	return tool;
}
