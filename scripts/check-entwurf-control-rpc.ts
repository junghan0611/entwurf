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
 *   7. accepted-connection disconnect policy — a REAL peer that hangs up mid-exchange must not
 *      reach this process as an uncaught exception (the 2026-09-14 C4 incident: a resident pi died
 *      writing a late response to a sender that had already timed out), must not be diagnosed, and
 *      an error that is NOT a disconnect must be diagnosed exactly once without rethrowing.
 *   8. ordering — the surface installs that policy before setEncoding and before the data handler.
 *
 * No model / auth / pi process — only `net.Server` on a tmp socket, so it rides `pnpm run check:full`.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	attachAcceptedSocketDisconnectPolicy,
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

	// ── 2: extraction guard — surface consumes the shared lib, never forks it ───
	// (#50 C4 re-author: the `/entwurf-sessions` socket-scan lane was the last
	// fetchControlSocketRuntimeInfo consumer on this surface; with it gone the
	// guard pins "imports the shared wire SSOT, defines/calls no RPC client of
	// its own" — the helper itself stays in the lib for the live smokes.)
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		ok(
			"2: entwurf-control imports the shared wire SSOT (lib/entwurf-control-rpc.js)",
			/from "\.\/lib\/entwurf-control-rpc\.js"/.test(src) && /\bformatSenderInfoBlock\b/.test(src),
		);
		ok(
			"2: entwurf-control no longer references fetchControlSocketRuntimeInfo (#50 C4 — its lane is gone)",
			!/\bfetchControlSocketRuntimeInfo\b/.test(src),
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
	// ONE formatter, and since the visible-first cut exactly one consumer (the live
	// receiver) — the dormant resume prompt that shared it is gone. The exact string
	// shape stays a contract so a future VISIBLE resume renders through it, not beside it.
	{
		const base = {
			sessionId: "20260613T091000-98363c",
			agentId: "pi/claude-opus-5",
			cwd: "/w",
			timestamp: "2026-06-13T09:10:00.000Z",
		};
		ok(
			"6: minimal envelope → exact block (leading blank line, required fields only)",
			formatSenderInfoBlock(base) ===
				`\n\n<sender_info>{"sessionId":"20260613T091000-98363c","agentId":"pi/claude-opus-5","cwd":"/w","timestamp":"2026-06-13T09:10:00.000Z"}</sender_info>`,
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

	// ── 7. accepted-connection disconnect policy (the server half of the wire) ──
	// `[측정 2026-09-14]` a resident pi was killed by a late response written to a socket whose
	// peer had already timed out and hung up. The EPIPE arrived asynchronously as an `error`
	// event, and an `error` event with no listener is an uncaught exception. These cells drive a
	// REAL unix socket to a real peer disconnect — no fake control server, no synthetic stand-in
	// for the crash itself.
	{
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpc-disconnect-"));
		const socketPath = path.join(dir, "s.sock");
		const diagnostics: string[] = [];
		const accepted: net.Socket[] = [];
		const server = net.createServer((socket) => {
			// Exactly what the surface does, and the ONLY error listener on this connection: if the
			// policy stops absorbing, nothing else here is catching it.
			attachAcceptedSocketDisconnectPolicy(socket, (line) => diagnostics.push(line));
			accepted.push(socket);
		});
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));

		// Record instead of dying, so the crash becomes an assertion we can attribute rather than
		// a stack trace that kills the gate run itself.
		const uncaught: Error[] = [];
		const onUncaught = (err: Error) => uncaught.push(err);
		process.on("uncaughtException", onUncaught);
		// Every socket this cell opens, torn down in `finally` — `server.close()` only calls back
		// once the LAST connection is gone, so a client left open on a failing assertion would turn
		// a red gate into a hang (which is not a kill: a mutant must fail bounded, with its QK).
		const opened: net.Socket[] = [];
		try {
			const client = net.createConnection(socketPath);
			opened.push(client);
			await new Promise<void>((resolve, reject) => {
				client.once("connect", resolve);
				client.once("error", reject);
			});
			// The sender gives up and hangs up — the C4 shape exactly.
			client.on("error", () => {});
			client.destroy();

			// The receiver answers LATE, into a peer that is gone. Bounded: writes until the stream
			// records an error, never longer.
			for (let i = 0; i < 200 && accepted[0] !== undefined && accepted[0].errored === null; i++) {
				try {
					accepted[0].write(`${"x".repeat(64 * 1024)}\n`);
				} catch {
					// A synchronous ERR_STREAM_DESTROYED is the OTHER half — writeResponse's own
					// try/catch owns it. This loop is hunting the asynchronous one.
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 10));
			}

			// Fixture integrity FIRST: if no peer-disconnect error ever landed, the two cells below
			// would be vacuously green no matter what the policy did.
			const errored = accepted[0]?.errored as NodeJS.ErrnoException | null | undefined;
			ok(
				"7: fixture — a real peer disconnect produced an async EPIPE/ECONNRESET on the accepted socket",
				errored != null && (errored.code === "EPIPE" || errored.code === "ECONNRESET"),
			);
			ok(
				"7: [QK:CONTROL-SOCKET-NO-UNCAUGHT] a vanished peer never reaches the process as an uncaught exception " +
					`(would have killed this resident session) — uncaught=${JSON.stringify(uncaught.map((e) => String(e)))}`,
				uncaught.length === 0,
			);
			ok(
				"7: [QK:CONTROL-SOCKET-ABSORBS-PEER-DISCONNECT] a vanished peer is absorbed silently, never diagnosed " +
					`(it describes the client, not our state) — diagnostics=${JSON.stringify(diagnostics)}`,
				diagnostics.length === 0,
			);

			// Unexpected code on a REAL accepted socket: diagnosed exactly once, with code AND
			// message, and the emit must not throw back out of the event callback.
			const client2 = net.createConnection(socketPath);
			opened.push(client2);
			await new Promise<void>((resolve, reject) => {
				client2.once("connect", resolve);
				client2.once("error", reject);
			});
			client2.on("error", () => {});
			// The SECOND accepted connection — live, never disconnected, so the diagnosis path is
			// exercised on a socket in ordinary service rather than on the already-errored one.
			for (let i = 0; i < 200 && accepted[1] === undefined; i++) {
				await new Promise<void>((resolve) => setTimeout(resolve, 10));
			}
			const live = accepted[1];
			ok("7: fixture — the second connection was accepted and carries the policy", live !== undefined);
			const unexpected: NodeJS.ErrnoException = Object.assign(new Error("no space left on device"), {
				code: "ENOSPC",
			});
			const before = diagnostics.length;
			let threw = false;
			try {
				live?.emit("error", unexpected);
			} catch {
				threw = true;
			}
			const emitted = diagnostics.slice(before);
			ok(
				"7: [QK:CONTROL-SOCKET-DIAGNOSES-UNEXPECTED] a non-disconnect error diagnoses EXACTLY once with code and " +
					`message, and never rethrows from the event callback — threw=${threw} emitted=${JSON.stringify(emitted)}`,
				threw === false &&
					emitted.length === 1 &&
					emitted[0]!.includes("ENOSPC") &&
					emitted[0]!.includes("no space left on device"),
			);
		} finally {
			process.off("uncaughtException", onUncaught);
			for (const socket of [...opened, ...accepted]) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.rm(dir, { recursive: true, force: true });
		}
	}

	// ── 8. the surface installs the policy FIRST on every accepted connection ───
	// Ordering is the contract, not merely presence: a listener attached after setEncoding or
	// after the data handler leaves a window in which the very first write can still kill us.
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		const accept = src.slice(src.indexOf("const server = net.createServer((socket) => {"));
		const attachAt = accept.indexOf("attachAcceptedSocketDisconnectPolicy(socket)");
		const encodingAt = accept.indexOf('socket.setEncoding("utf8")');
		const dataAt = accept.indexOf('socket.on("data"');
		ok(
			"8: [QK:CONTROL-SOCKET-POLICY-FIRST] createServer attaches the disconnect policy before setEncoding and " +
				`before the data handler — attach=${attachAt} setEncoding=${encodingAt} data=${dataAt}`,
			attachAt !== -1 && encodingAt !== -1 && dataAt !== -1 && attachAt < encodingAt && attachAt < dataAt,
		);
		ok(
			"8: the surface consumes the shared policy and defines no second error listener of its own",
			/from "\.\/lib\/entwurf-control-rpc\.js"/.test(src) && !/socket\.on\("error"/.test(src),
		);
	}

	console.log(`\ncheck-entwurf-control-rpc: ${passed} checks passed`);
}

await main();
