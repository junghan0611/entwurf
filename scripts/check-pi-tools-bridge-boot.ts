/**
 * check-pi-tools-bridge-boot — deterministic gate (0.11 step 5d-5-pre, G1a/G1b):
 * boots the pi-tools-bridge MCP server EXACTLY as it ships (start.sh →
 * `node --experimental-strip-types src/index.ts`, no build step) and asserts the
 * runtime contract that the source-shape gate `check-entwurf-v2-surface` cannot:
 *
 *   - G1a: the server actually BOOTS. start.sh static-imports the whole v2 fence
 *     graph (entwurf-v2-surface → runner → production → decider/lock/send/spawn/
 *     mailbox/control-rpc) at top level under strip-types; a strip-types-hostile
 *     construct (enum / namespace / parameter property / `import =`) anywhere in
 *     that graph would crash the server at boot. A parseable tools/list (id:2)
 *     response IS the proof the graph loaded and `server.tool` registration ran.
 *   - G1b: `entwurf_v2` is registered on the runtime tools/list surface with the
 *     expected input schema (props ⊇ target/intent/message/mode/wants_reply;
 *     required ⊇ target/intent/message; intent/mode enums).
 *
 * Scope boundary (D1=A안): this gate owns boot + entwurf_v2 registration/schema.
 * The broad protocol/negative suite stays in check-bridge/test.sh. Only a
 * `tools/list` is sent — no `tools/call` — so there is NO lock/filesystem side
 * effect and no auth/model is needed; it lives in `pnpm check`.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START_SH = path.join(REPO_DIR, "mcp", "pi-tools-bridge", "start.sh");

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	if (!cond) {
		console.error(`  ✗ ${label}`);
		if (detail) console.error(detail);
		process.exit(1);
	}
	passed++;
}

function fatal(msg: string): never {
	console.error(`check-pi-tools-bridge-boot: ${msg}`);
	process.exit(1);
}

interface BridgeTool {
	name?: string;
	inputSchema?: {
		properties?: Record<string, { enum?: unknown; maxLength?: unknown }>;
		required?: unknown;
	};
}

/**
 * Boot start.sh, run the MCP handshake + a single tools/list (id:2), and resolve
 * with the registered tools. The failure paths are split (timeout / early-exit /
 * parse / missing result.tools) so a strip-types boot crash surfaces with its
 * rc/signal/stderr — not as an opaque "no response".
 */
function bootAndListTools(): Promise<BridgeTool[]> {
	return new Promise((resolve) => {
		const child = spawn(START_SH, { stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
			}, 300);
			fatal(`no tools/list response before timeout${stderr.trim() ? `\n--- stderr ---\n${stderr.trim()}` : ""}`);
		}, 10_000);

		function tryResolve(): void {
			if (settled) return;
			// MCP frames are newline-delimited JSON-RPC; find the id:2 (tools/list) reply.
			for (const line of stdout
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean)) {
				let msg: { id?: unknown; result?: { tools?: unknown } };
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg?.id !== 2) continue;
				settled = true;
				clearTimeout(timer);
				try {
					child.kill("SIGTERM");
				} catch {}
				const tools = msg?.result?.tools;
				if (!Array.isArray(tools)) {
					fatal(`id:2 response missing result.tools\n--- raw ---\n${line}`);
				}
				resolve(tools as BridgeTool[]);
				return;
			}
		}

		child.stdout.on("data", (d) => {
			stdout += d.toString();
			tryResolve();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fatal(`failed to spawn start.sh: ${String(err)}`);
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// Closed before id:2 — this is where a strip-types boot crash / SyntaxError
			// in the static-import fence graph surfaces.
			fatal(
				`server exited before tools/list response (code=${code} signal=${String(signal)})` +
					(stderr.trim() ? `\n--- stderr ---\n${stderr.trim()}` : "") +
					(stdout.trim() ? `\n--- stdout ---\n${stdout.trim()}` : ""),
			);
		});

		const send = (obj: unknown): void => {
			child.stdin.write(`${JSON.stringify(obj)}\n`);
		};
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check-boot", version: "0" } },
		});
		send({ jsonrpc: "2.0", method: "notifications/initialized" });
		send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	});
}

/** Order-independent set equality — the enum is a contract on membership, not order. */
function setEq(actual: unknown, expected: string[]): boolean {
	if (!Array.isArray(actual)) return false;
	const got = new Set(actual.map(String));
	return got.size === expected.length && expected.every((e) => got.has(e));
}

async function main(): Promise<void> {
	const tools = await bootAndListTools();

	// G1a — a parseable tools/list arrived → the strip-types fence graph loaded + server.tool ran.
	ok("G1a: MCP server boots under strip-types and answers tools/list", tools.length > 0);

	// G1b — entwurf_v2 registered + schema contract.
	const v2 = tools.find((t) => t?.name === "entwurf_v2");
	ok("G1b: entwurf_v2 registered on the runtime tools/list surface", !!v2);

	const schema = v2?.inputSchema ?? {};
	const rawSchema = JSON.stringify(schema);
	const props = schema.properties ?? {};
	for (const p of ["target", "intent", "message", "mode", "wants_reply"]) {
		ok(`G1b: entwurf_v2 schema has property '${p}'`, p in props, `--- inputSchema ---\n${rawSchema}`);
	}
	const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
	for (const r of ["target", "intent", "message"]) {
		ok(`G1b: entwurf_v2 schema requires '${r}'`, required.includes(r), `--- inputSchema ---\n${rawSchema}`);
	}
	ok(
		"G1b: entwurf_v2 intent enum == {fire-and-forget, owned-outcome}",
		setEq(props.intent?.enum, ["fire-and-forget", "owned-outcome"]),
		`--- inputSchema ---\n${rawSchema}`,
	);
	ok(
		"G1b: entwurf_v2 mode enum == {steer, follow_up}",
		setEq(props.mode?.enum, ["steer", "follow_up"]),
		`--- inputSchema ---\n${rawSchema}`,
	);
	ok(
		"G1b: entwurf_v2 message maxLength == 16000",
		props.message?.maxLength === 16000,
		`--- inputSchema ---\n${rawSchema}`,
	);

	ok(
		"G1c: legacy v1 MCP tools are absent",
		!tools.some((t) => ["entwurf", "entwurf_resume", "entwurf_send"].includes(String(t?.name))),
	);

	console.log(`\ncheck-pi-tools-bridge-boot: ${passed} checks passed`);
}

await main();
