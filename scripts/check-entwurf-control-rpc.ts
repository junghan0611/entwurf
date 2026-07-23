/**
 * check-entwurf-control-rpc — gate for the 5d-2 RPC-helper EXTRACTION micro-slice. It
 * proves the `--entwurf-control` socket protocol moved to the ctx-free SSOT
 * `lib/entwurf-control-rpc.ts` WITHOUT a behaviour change, and that the surface file now
 * consumes it instead of defining its own:
 *
 *   1. ctx-free source guard — the new lib imports NO surface-only world
 *      (ExtensionContext / ExtensionAPI / pi. / @earendil-works/pi-ai). It is a pure
 *      transport so the 5d-2b production `sendOverSocket` can share it from lib/.
 *   2. extraction guard — `entwurf-control.ts` IMPORTS `sendRpcCommand` from the shared
 *      lib and no longer DEFINES its own `async function sendRpcCommand` (no protocol fork).
 *   3. round-trip — a real (short) unix-socket server echoes `{type:"response",
 *      command:<same>, success:true}` and `sendRpcCommand` resolves `{response.success:true}`
 *      with the matching command tag (the newline-JSON write + matched-response parse wire).
 *   4. close-before-response — a server that accepts then closes WITHOUT a response makes
 *      `sendRpcCommand` reject `connection closed before response` (the 2026-05-18
 *      receiver-stuck backstop the settled-guard preserves).
 *   5. get_info runtime helper parses/formats cwd/model/idle once for every caller.
 *
 * No model / auth / pi process — only `net.Server` on a tmp socket, so it rides `pnpm check`.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	fetchControlSocketRuntimeInfo,
	formatRuntimeModel,
	formatSenderInfoBlock,
	parseGetInfoResponseData,
	type RpcSendCommand,
	sendRpcCommand,
} from "../pi-extensions/lib/entwurf-control-rpc.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const LIB_SRC = path.join(REPO, "pi-extensions/lib/entwurf-control-rpc.ts");
const CONTROL_SRC = path.join(REPO, "pi-extensions/entwurf-control.ts");

/** Spin up a one-shot unix-socket server; `onLine` decides the reply (or null = no reply). */
async function withServer(
	onLine: (line: string, socket: net.Socket) => void,
	body: (socketPath: string) => Promise<void>,
): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpc-"));
	const socketPath = path.join(dir, "s.sock");
	const server = net.createServer((socket) => {
		socket.setEncoding("utf8");
		let buf = "";
		socket.on("data", (chunk) => {
			buf += chunk;
			let nl = buf.indexOf("\n");
			while (nl !== -1) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				nl = buf.indexOf("\n");
				if (line) onLine(line, socket);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	try {
		await body(socketPath);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	// ── 1: ctx-free source guard ──────────────────────────────────────────────
	{
		const src = await fs.readFile(LIB_SRC, "utf8");
		// Strip line/block comments so the module-header prose ("must NOT import …") never
		// trips the guard — only real import statements count.
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		const forbidden = ["ExtensionContext", "ExtensionAPI", "@earendil-works/pi-ai", "pi."];
		for (const term of forbidden) {
			ok(`1: lib is ctx-free — no '${term}'`, !code.includes(term));
		}
		ok("1: lib imports only node:net (value)", /import \* as net from "node:net";/.test(code));
	}

	// ── 2: extraction guard — surface imports shared runtime helper, no fork ────
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		ok(
			"2: entwurf-control imports fetchControlSocketRuntimeInfo from the shared lib",
			/from "\.\/lib\/entwurf-control-rpc\.js"/.test(src) && /\bfetchControlSocketRuntimeInfo\b/.test(src),
		);
		ok("2: entwurf-control no longer DEFINES sendRpcCommand", !/(async\s+)?function\s+sendRpcCommand\s*\(/.test(src));
		ok("2: entwurf-control does not call sendRpcCommand directly", !/[^.]\bsendRpcCommand\s*\(/.test(src));
	}

	// ── 3: round-trip — write command, matched response, success:true ─────────
	{
		let seenLine: string | null = null;
		await withServer(
			(line, socket) => {
				seenLine = line;
				const cmd = JSON.parse(line);
				socket.write(`${JSON.stringify({ type: "response", command: cmd.type, success: true, data: { ok: 1 } })}\n`);
			},
			async (socketPath) => {
				const cmd: RpcSendCommand = { type: "send", message: "hi", mode: "follow_up", wants_reply: false };
				const { response } = await sendRpcCommand(socketPath, cmd, { timeout: 2000 });
				ok("3: round-trip → response.success true", response.success === true);
				ok("3: response tagged with the SAME command", response.command === "send");
				ok(
					"3: server saw the newline-JSON command",
					seenLine !== null && JSON.parse(seenLine as string).type === "send",
				);
			},
		);
	}

	// ── 4: close-before-response → reject 'connection closed before response' ──
	{
		let rejected: unknown;
		await withServer(
			(_line, socket) => {
				// Accept the command, then close WITHOUT replying.
				socket.end();
			},
			async (socketPath) => {
				try {
					await sendRpcCommand(socketPath, { type: "get_info" }, { timeout: 2000 });
				} catch (err) {
					rejected = err;
				}
			},
		);
		ok(
			"4: close-before-response → rejects 'connection closed before response'",
			rejected instanceof Error && rejected.message === "connection closed before response",
		);
	}

	// ── 5: get_info runtime parse/format/fetch SSOT ───────────────────────────
	{
		const parsed = parseGetInfoResponseData({
			cwd: "/work/cos",
			model: { provider: "entwurf", id: "gpt-5.5" },
			idle: false,
		});
		ok("5: parse cwd", parsed.cwd === "/work/cos");
		ok("5: parse model id", parsed.modelId === "gpt-5.5");
		ok("5: parse model provider", parsed.modelProvider === "entwurf");
		ok("5: parse idle false", parsed.idle === false);
		ok("5: format provider/model", formatRuntimeModel(parsed) === "entwurf/gpt-5.5");
		ok("5: format model-only fallback", formatRuntimeModel({ modelId: "gpt-5.5" }) === "gpt-5.5");
		const malformed = parseGetInfoResponseData({ model: null });
		ok(
			"5: parse malformed data yields undefined fields",
			malformed.cwd === undefined && malformed.modelId === undefined,
		);

		await withServer(
			(line, socket) => {
				const cmd = JSON.parse(line);
				socket.write(
					`${JSON.stringify({ type: "response", command: cmd.type, success: true, data: { cwd: "/w", model: { provider: "p", id: "m" }, idle: true } })}\n`,
				);
			},
			async (socketPath) => {
				const info = await fetchControlSocketRuntimeInfo(socketPath, { timeout: 2000 });
				ok(
					"5: fetch get_info parses response",
					info.cwd === "/w" && formatRuntimeModel(info) === "p/m" && info.idle === true,
				);
			},
		);
	}

	// ── 6. formatSenderInfoBlock — THE <sender_info> synthesis (#50 C3) ─────────
	// One formatter feeds BOTH rails (live receiver + dormant resume prompt), so
	// the exact string shape is a contract, not an implementation detail.
	{
		const base = {
			sessionId: "20260613T091000-98363c",
			agentId: "pi/claude-opus-4-8",
			cwd: "/w",
			timestamp: "2026-06-13T09:10:00.000Z",
		};
		ok(
			"6: minimal envelope → exact block (leading blank line, required fields only)",
			formatSenderInfoBlock(base) ===
				`\n\n<sender_info>{"sessionId":"20260613T091000-98363c","agentId":"pi/claude-opus-4-8","cwd":"/w","timestamp":"2026-06-13T09:10:00.000Z"}</sender_info>`,
		);
		const full = formatSenderInfoBlock({ ...base, origin: "pi-session", replyable: false }, true);
		ok(
			"6: origin/replyable/wants_reply present when set (replyable:false is a FACT, not omitted)",
			full.includes('"origin":"pi-session"') &&
				full.includes('"replyable":false') &&
				full.includes('"wants_reply":true'),
		);
		ok("6: wants_reply omitted unless explicitly true", !formatSenderInfoBlock(base, false).includes("wants_reply"));
		ok("6: undefined origin/replyable render nothing", !formatSenderInfoBlock(base).includes("origin"));
	}

	console.log(`\ncheck-entwurf-control-rpc: ${passed} checks passed`);
}

await main();
