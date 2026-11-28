/**
 * hc-launch — the Herdr Core launch of a same-id resume (#178), proven beside the module.
 *
 * Deterministic. The core is a scripted table of replies in call order, served two ways: an injected
 * call (most claims) and a REAL unix socket a node server listens on (the transport claim), so the
 * production client's framing, connect failure and no-autostart are exercised without an hc binary.
 * An UNSCRIPTED request fails the test: a stage that runs when it should not have is a failure, not a
 * silent extra read. The reply shapes are hc 0.1.20's, recorded on oracle on 2026-11-28 (`hello`, a
 * `not_found` error, `terminal.get` of a live terminal).
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE:
 *
 *   HCL-CONTEXT-NO-FALLBACK      a missing or malformed hc context refuses with zero requests
 *   HCL-BACKEND-CLOSED           only pi, pi-durable and Claude Code reach the core
 *   HCL-RUNTIME-ABSOLUTE         argv[0] is an absolute file from the CALLER's PATH, or nothing is asked
 *   HCL-NUL-REFUSED              a NUL in the argv is refused while it is free
 *   HCL-READS-BEFORE-WRITE       hello and the caller-terminal read both pass before the one write
 *   HCL-CALLER-TERMINAL-ADMITS   a socket that does not hold the caller's terminal live is refused
 *   HCL-RUN-PACKET-EXACT         the write is argv, cwd, the fixed env, a name, no parent, no notes
 *   HCL-ADOPT-ENV-FIVE           a pi-durable launch adds exactly the five adopt names
 *   HCL-RECOVERY-CLASSIFIED      none only when unwritten or declined before a record; else unknown
 *   HCL-ECHO-DRIFT-LEFT-OPEN     a drifted echo is a named failure naming the terminal, never killed
 *   HCL-RECEIPT-IS-A-VIEW        the receipt carries core, terminal, name, pid — and no garden id
 *   HCL-OUTCOME-MAPPING          the v2 seam gets an hc handle, a refusal, or a failure with recovery
 *   HCL-SOCKET-NO-AUTOSTART      the production client connects or fails; one request, one reply line
 *   HCL-NO-TYPING-NO-KILL        the module names no typing or kill method and imports no other rail
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	buildHcTerminalRunPacket,
	createHcSocketCall,
	HC_RESUME_HINT,
	HC_RUN_NONE_KINDS,
	HC_SCRUBBED_ENV,
	type HcLaunchDeps,
	type HcSocketOutcome,
	hasHcMarker,
	hcResumeCall,
	hcResumeLaunchOutcome,
	launchHcResume,
	mintHcTerminalName,
	resolveHcContext,
	resolveHcRuntimeOnPath,
} from "./hc-launch.ts";
import type { PiDurablePackageLayout } from "./pi-durable-runtime.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hc-launch-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
const CWD = path.join(TMP, "cwd");
fs.mkdirSync(CWD);
const BIN = path.join(TMP, "bin");
fs.mkdirSync(BIN);
for (const name of ["pi", "claude"]) fs.writeFileSync(path.join(BIN, name), "#!/bin/sh\n", { mode: 0o755 });
fs.writeFileSync(path.join(BIN, "not-exec"), "", { mode: 0o644 });

const SOCKET = "/run/user/1000/herdr-core/default.sock";
const ENV: NodeJS.ProcessEnv = { HC_TERMINAL_ID: "t7", HC_TERMINAL_SOCKET: SOCKET, PATH: `relative:${BIN}` };
const NAME = "entwurf-resume-0123456789abcdef";
const PI_ARGS = ["--entwurf-control", "--session", "/home/op/.pi/agent/sessions/x.jsonl", "--model", "p/m"];
const CC_ARGS = ["--resume", "0b9d3c1e-1111-4222-8333-444455556666"];
const CORE = { id: "96a4987dcca010b410faac93b2d0607c", name: "oracle" };
const LAYOUT = { root: path.join(TMP, "pkg") } as PiDurablePackageLayout;
const ADOPT = {
	PI_CODING_AGENT_DIR: "/home/op/.pi-durable",
	ENTWURF_META_SESSIONS_DIR: "/home/op/meta/meta-sessions",
	ENTWURF_META_MAILBOX_DIR: "/home/op/meta/meta-mailbox",
	ENTWURF_META_SENDERS_DIR: "/home/op/meta/meta-senders",
	ENTWURF_META_RECEIVERS_DIR: "/home/op/meta/meta-receivers",
};

type Reply = HcSocketOutcome | ((request: Record<string, unknown>) => HcSocketOutcome);
const reply = (id: string, result: unknown): HcSocketOutcome => ({
	kind: "reply",
	line: JSON.stringify({ jsonrpc: "2.0", id, result }),
});
const errorReply = (id: string, kind: string, message = "m"): HcSocketOutcome => ({
	kind: "reply",
	line: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { kind, hint: "h" } } }),
});
// Keyed by the request's own id, so a launch that mints its own name is answered too.
const HELLO: Reply = (r) => reply(String(r.id), { generation: 1, version: "0.1.20", core: CORE, framed: false });
const CALLER_LIVE: Reply = (r) => reply(String(r.id), { address: "t7", state: "live", pid: 100 });

/** A scripted core: replies in order; a request past the script throws. */
function scripted(replies: Reply[]): { deps: HcLaunchDeps; requests: Record<string, unknown>[]; sockets: string[] } {
	const requests: Record<string, unknown>[] = [];
	const sockets: string[] = [];
	const deps: HcLaunchDeps = {
		socket: (socketPath) => {
			sockets.push(socketPath);
			return async (line) => {
				const request = JSON.parse(line) as Record<string, unknown>;
				const next = replies[requests.length];
				requests.push(request);
				if (next === undefined) throw new Error(`unscripted hc request: ${String(request.method)}`);
				return typeof next === "function" ? next(request) : next;
			};
		},
		resolveRuntime: resolveHcRuntimeOnPath,
		packageLayout: () => LAYOUT,
		runtimeVerdict: () => null,
		isExecutable: () => true,
	};
	return { deps, requests, sockets };
}

/** The core's echo of a run request, as `terminal.run` returns it: the terminal's public facts
 * FLATTENED into the result (`[측정 2026-11-28, hc 0.1.20, oracle]` — the first LIVE run of this rail
 * read a nested `terminal` and called a created terminal unparsable), with `first_message`, `wait`
 * and `output` absent unless a template or a wait ran. */
function echoOf(
	request: Record<string, unknown>,
	over: Record<string, unknown> = {},
	top: Record<string, unknown> = {},
) {
	const p = request.params as Record<string, unknown>;
	return reply(String(request.id), {
		address: "t15",
		argv: p.argv,
		cols: 200,
		created_ms: 1795836786000,
		cwd: p.cwd,
		die_with_parent: false,
		exit_code: null,
		identity: "ghostty",
		keep: false,
		labels: {},
		name: p.name,
		notify: false,
		parent: null,
		pid: 4242,
		rm: false,
		rows: 120,
		state: "live",
		...over,
		...top,
	});
}

const pi = { backend: "pi", cwd: CWD, runtimeArgs: PI_ARGS };

describe("hc-launch", () => {
	it("[QK:HCL-CONTEXT-NO-FALLBACK] a missing or malformed hc context refuses with zero requests", async () => {
		for (const env of [
			{},
			{ HC_TERMINAL_ID: "t7" },
			{ HC_TERMINAL_SOCKET: SOCKET },
			{ HC_TERMINAL_ID: "t7", HC_TERMINAL_SOCKET: "relative.sock" },
			{ HC_TERMINAL_ID: "vps/t7", HC_TERMINAL_SOCKET: SOCKET },
			{ HC_TERMINAL_ID: "", HC_TERMINAL_SOCKET: "" },
		] as NodeJS.ProcessEnv[]) {
			const core = scripted([]);
			const result = await hcResumeCall(pi, { ...env, PATH: BIN }, core.deps, NAME);
			ok("refused as hc-context-missing", !result.ok && result.reason === "hc-context-missing");
			ok("no socket was even named", core.sockets.length === 0 && core.requests.length === 0);
		}
		ok(
			"either variable alone is a marker",
			hasHcMarker({ HC_TERMINAL_ID: "t7" }) && hasHcMarker({ HC_TERMINAL_SOCKET: "x" }),
		);
		ok("empty strings are no marker", !hasHcMarker({ HC_TERMINAL_ID: "", HC_TERMINAL_SOCKET: "" }) && !hasHcMarker({}));
		ok("a complete context resolves", resolveHcContext(ENV).ok);
	});

	it("[QK:HCL-BACKEND-CLOSED] only pi, pi-durable and Claude Code reach the core", async () => {
		for (const backend of ["codex", "agy", "copilot", ""]) {
			const core = scripted([]);
			const result = await hcResumeCall({ ...pi, backend }, ENV, core.deps, NAME);
			ok(`${backend} refused`, !result.ok && result.reason === "hc-backend-unsupported");
			ok("nothing asked", core.requests.length === 0);
		}
	});

	it("[QK:HCL-RUNTIME-ABSOLUTE] argv[0] is an absolute file from the CALLER's PATH, or nothing is asked", async () => {
		const missing = scripted([]);
		const none = await hcResumeCall(pi, { ...ENV, PATH: `${TMP}:rel` }, missing.deps, NAME);
		ok("no pi on PATH refuses", !none.ok && none.reason === "hc-runtime-unresolved" && missing.requests.length === 0);
		ok("a non-executable file is not a runtime", resolveHcRuntimeOnPath("not-exec", { PATH: BIN }) === null);
		ok("a relative PATH entry is skipped", resolveHcRuntimeOnPath("pi", { PATH: "bin" }) === null);
		ok("no PATH is no runtime", resolveHcRuntimeOnPath("pi", {}) === null);

		const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const result = await hcResumeCall({ backend: "claude-code", cwd: CWD, runtimeArgs: CC_ARGS }, ENV, core.deps, NAME);
		const argv = (core.requests[2].params as { argv: string[] }).argv;
		ok("claude resolved to the absolute file", argv[0] === path.join(BIN, "claude") && path.isAbsolute(argv[0]));
		ok("the record argv follows untouched", JSON.stringify(argv.slice(1)) === JSON.stringify(CC_ARGS));
		ok("launched", result.ok && result.receipt.runtimePath === path.join(BIN, "claude"));

		for (const [cwd, reason] of [
			["rel/dir", "cwd-not-absolute"],
			[path.join(TMP, "gone"), "cwd-missing"],
			[path.join(BIN, "pi"), "cwd-not-directory"],
		] as const) {
			const bad = scripted([]);
			const refused = await hcResumeCall({ ...pi, cwd }, ENV, bad.deps, NAME);
			ok(`${reason}`, !refused.ok && refused.reason === reason && bad.requests.length === 0);
		}
	});

	it("[QK:HCL-NUL-REFUSED] a NUL in the argv is refused while it is free", async () => {
		const core = scripted([]);
		const result = await hcResumeCall({ ...pi, runtimeArgs: ["--session", "a\0b"] }, ENV, core.deps, NAME);
		ok("refused", !result.ok && result.reason === "hc-argv-nul");
		ok("nothing asked", core.requests.length === 0);
	});

	it("[QK:HCL-READS-BEFORE-WRITE] hello and the caller-terminal read both pass before the one write", async () => {
		const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const result = await hcResumeCall(pi, ENV, core.deps, NAME);
		ok("launched", result.ok);
		ok(
			"exactly hello, terminal.get, terminal.run — in that order, on the one named socket",
			JSON.stringify(core.requests.map((r) => r.method)) ===
				JSON.stringify(["hello", "terminal.get", "terminal.run"]) &&
				core.sockets.length === 1 &&
				core.sockets[0] === SOCKET,
		);
		ok("hello pins generation 1", JSON.stringify(core.requests[0].params) === JSON.stringify({ generation: 1 }));
		ok(
			"the caller read names the caller's terminal and no caller field",
			JSON.stringify(core.requests[1].params) === JSON.stringify({ terminal: "t7" }),
		);

		const cases: [HcSocketOutcome, string][] = [
			[{ kind: "connect-failed", code: "ENOENT" }, "hc-socket-unavailable"],
			[{ kind: "timeout" }, "hc-hello-failed"],
			[{ kind: "reply", line: "not json" }, "hc-hello-failed"],
			[errorReply(`${NAME}:hello`, "unsupported_generation"), "hc-protocol-generation-unsupported"],
			[reply(`${NAME}:hello`, { generation: 2, core: CORE }), "hc-protocol-generation-unsupported"],
			[reply(`${NAME}:hello`, { generation: 1 }), "hc-hello-failed"],
			[reply("someone-else", { generation: 1, core: CORE }), "hc-hello-failed"],
		];
		for (const [helloReply, reason] of cases) {
			const refused = scripted([helloReply]);
			const r = await hcResumeCall(pi, ENV, refused.deps, NAME);
			ok(`${reason}: refused with one request and no recovery`, !r.ok && r.reason === reason && !("recovery" in r));
			ok("the write was never reached", refused.requests.length === 1);
		}
	});

	it("[QK:HCL-CALLER-TERMINAL-ADMITS] a socket that does not hold the caller's terminal live is refused", async () => {
		const id = `${NAME}:terminal.get`;
		const cases: [HcSocketOutcome, string][] = [
			[errorReply(id, "not_found", 'no terminal "t7"'), "hc-caller-terminal-get-failed"],
			[{ kind: "eof-before-newline" }, "hc-caller-terminal-get-failed"],
			[{ kind: "reply", line: "{" }, "hc-caller-terminal-unparsable"],
			[reply(id, { state: "live" }), "hc-caller-terminal-unparsable"],
			[reply(id, { address: "t8", state: "live" }), "hc-caller-terminal-drift"],
			[reply(id, { address: "t7", state: "finished" }), "hc-caller-terminal-not-live"],
		];
		for (const [getReply, reason] of cases) {
			const core = scripted([HELLO, getReply]);
			const r = await hcResumeCall(pi, ENV, core.deps, NAME);
			ok(`${reason}`, !r.ok && r.reason === reason && !("recovery" in r));
			ok(
				"two reads, zero writes",
				core.requests.length === 2 && core.requests.every((q) => q.method !== "terminal.run"),
			);
		}
	});

	it("[QK:HCL-RUN-PACKET-EXACT] the write is argv, cwd, the fixed env, a name, no parent, no notes", async () => {
		const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		await hcResumeCall(pi, ENV, core.deps, NAME);
		const write = core.requests[2];
		expect(write).toEqual({
			jsonrpc: "2.0",
			id: `${NAME}:terminal.run`,
			method: "terminal.run",
			params: {
				argv: [path.join(BIN, "pi"), ...PI_ARGS],
				cwd: CWD,
				env: {
					PI_SESSION_ID: "",
					PI_AGENT_ID: "",
					HERDR_ENV: "",
					HERDR_PANE_ID: "",
					HERDR_SOCKET_PATH: "",
					HERDR_BIN_PATH: "",
					TMUX: "",
					TMUX_PANE: "",
				},
				name: NAME,
				no_parent: true,
				no_notify: true,
			},
		});
		ok(
			"the scrub table is what was sent",
			JSON.stringify((write.params as { env: unknown }).env) === JSON.stringify(HC_SCRUBBED_ENV),
		);
		ok(
			"one line, newline-terminated",
			buildHcTerminalRunPacket("i", { argv: ["/a"], cwd: "/", env: {}, name: "n" }).endsWith("}\n"),
		);
		ok("a minted name fits the core's 32", /^entwurf-resume-[0-9a-f]{16}$/.test(mintHcTerminalName()));
	});

	it("[QK:HCL-ADOPT-ENV-FIVE] a pi-durable launch adds exactly the five adopt names", async () => {
		const args = ["pi-durable", "--entwurf-adopt", '{"v":1}'];
		const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const result = await hcResumeCall(
			{ backend: "pi-durable", cwd: CWD, runtimeArgs: args, adoptEnv: ADOPT },
			{ ...ENV, PATH: "" },
			core.deps,
			NAME,
		);
		const params = core.requests[2].params as { argv: string[]; env: Record<string, string> };
		ok(
			"launched through the package's own run.sh, no PATH needed",
			result.ok && params.argv[0] === path.join(LAYOUT.root, "run.sh"),
		);
		ok("the adopt argv follows untouched", JSON.stringify(params.argv.slice(1)) === JSON.stringify(args));
		expect(params.env).toEqual({ ...HC_SCRUBBED_ENV, ...ADOPT });

		const refusals: [Partial<HcLaunchDeps>, string][] = [
			[{ packageLayout: () => null }, "pi-durable-package-incomplete"],
			[{ runtimeVerdict: () => "pi-durable-sdk-absent" }, "pi-durable-sdk-absent"],
			[{ isExecutable: () => false }, "pi-durable-launcher-missing"],
		];
		for (const [over, reason] of refusals) {
			const bad = scripted([]);
			const r = await hcResumeCall(
				{ backend: "pi-durable", cwd: CWD, runtimeArgs: args, adoptEnv: ADOPT },
				ENV,
				{ ...bad.deps, ...over },
				NAME,
			);
			ok(`${reason}`, !r.ok && r.reason === reason && bad.requests.length === 0);
		}
		await expect(
			hcResumeCall({ backend: "pi-durable", cwd: CWD, runtimeArgs: args }, ENV, scripted([]).deps, NAME),
		).rejects.toThrow(/without its adopt projection/);
		await expect(
			hcResumeCall(
				{ backend: "pi-durable", cwd: CWD, runtimeArgs: args, adoptEnv: { ...ADOPT, PI_CODING_AGENT_DIR: "rel" } },
				ENV,
				scripted([]).deps,
				NAME,
			),
		).rejects.toThrow(/non-absolute PI_CODING_AGENT_DIR/);
	});

	it("[QK:HCL-RECOVERY-CLASSIFIED] none only when unwritten or declined before a record; else unknown", async () => {
		const id = `${NAME}:terminal.run`;
		const cases: [HcSocketOutcome, string, string][] = [
			[{ kind: "connect-failed", code: "ECONNREFUSED" }, "hc-run-transport-failed", "none"],
			[{ kind: "timeout" }, "hc-run-transport-failed", "unknown"],
			[{ kind: "io-failed", code: "EPIPE" }, "hc-run-transport-failed", "unknown"],
			[{ kind: "eof-before-newline" }, "hc-run-transport-failed", "unknown"],
			[{ kind: "oversize" }, "hc-run-transport-failed", "unknown"],
			[{ kind: "reply", line: "garbage" }, "hc-run-reply-unparsable", "unknown"],
			[reply(id, { address: "vps/t3" }), "hc-run-reply-unparsable", "unknown"],
			[reply(id, { terminal: { address: "t3" } }), "hc-run-reply-unparsable", "unknown"],
			[errorReply(id, "invalid_params"), "hc-run-refused", "none"],
			[errorReply(id, "unavailable"), "hc-run-refused", "none"],
			[errorReply(id, "name_taken"), "hc-run-refused", "none"],
			[errorReply(id, "config"), "hc-run-refused", "none"],
			[errorReply(id, "spawn_failed", "the holder did not answer"), "hc-run-failed", "unknown"],
			[errorReply(id, "spawn_failed", 'cannot start "x": No such file'), "hc-run-failed", "unknown"],
			[errorReply(id, "internal"), "hc-run-failed", "unknown"],
			[errorReply(id, "some_future_kind"), "hc-run-failed", "unknown"],
		];
		for (const [runReply, reason, outcome] of cases) {
			const core = scripted([HELLO, CALLER_LIVE, runReply]);
			const r = await hcResumeCall(pi, ENV, core.deps, NAME);
			ok(
				`${reason} → ${outcome}`,
				!r.ok && r.reason === reason && "recovery" in r && r.recovery.outcome === outcome && r.core.id === CORE.id,
			);
			ok(
				"the write was sent once and never resent",
				core.requests.filter((q) => q.method === "terminal.run").length === 1,
			);
		}
		ok(
			"the none set is exactly the four pre-record kinds",
			[...HC_RUN_NONE_KINDS].sort().join() === "config,invalid_params,name_taken,unavailable",
		);
		const kind = scripted([HELLO, CALLER_LIVE, errorReply(id, "spawn_failed")]);
		const quoted = await hcResumeCall(pi, ENV, kind.deps, NAME);
		ok("the core's own kind is quoted", !quoted.ok && "recovery" in quoted && quoted.hcErrorKind === "spawn_failed");
	});

	it("[QK:HCL-ECHO-DRIFT-LEFT-OPEN] a drifted echo is a named failure naming the terminal, never killed", async () => {
		const drifts: [Record<string, unknown>, Record<string, unknown>][] = [
			[{ argv: ["/other/pi"] }, {}],
			[{ cwd: "/elsewhere" }, {}],
			[{ name: "someone-else" }, {}],
			[{ parent: "t7" }, {}],
			[{ notify: true }, {}],
			[{ die_with_parent: true }, {}],
			[{ keep: true }, {}],
			[{}, { first_message: { sent: true } }],
		];
		for (const [over, top] of drifts) {
			const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r, over, top)]);
			const r = await hcResumeCall(pi, ENV, core.deps, NAME);
			ok(
				`drift ${JSON.stringify({ ...over, ...top })}`,
				!r.ok &&
					r.reason === "hc-run-echo-drift" &&
					"recovery" in r &&
					r.recovery.outcome === "left-open" &&
					r.recovery.terminal === "t15",
			);
			ok("three requests: nothing was killed or removed", core.requests.length === 3);
		}
	});

	it("[QK:HCL-RECEIPT-IS-A-VIEW] the receipt carries core, terminal, name, pid — and no garden id", async () => {
		const core = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const result = await hcResumeCall(pi, ENV, core.deps, NAME);
		expect(result).toEqual({
			ok: true,
			receipt: { core: CORE, terminal: "t15", name: NAME, pid: "4242", runtimePath: path.join(BIN, "pi"), cwd: CWD },
		});
		for (const pid of [null, 0, 1, "4242", 1.5]) {
			const nopid = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r, { pid })]);
			const r = await hcResumeCall(pi, ENV, nopid.deps, NAME);
			ok(`pid ${JSON.stringify(pid)} is reported as none, and the launch stands`, r.ok && r.receipt.pid === null);
		}
	});

	it("[QK:HCL-OUTCOME-MAPPING] the v2 seam gets an hc handle, a refusal, or a failure with recovery", async () => {
		const launched = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const handle = await launchHcResume(pi, ENV, launched.deps);
		ok("an hc handle", handle.ok && handle.handle.rail === "hc" && handle.handle.terminal === "t15");

		const refused = hcResumeLaunchOutcome({ ok: false, reason: "hc-socket-unavailable", reported: "ENOENT" });
		ok(
			"a refusal has a hint, the reported cause quoted, and no failure",
			!refused.ok &&
				!("failure" in refused) &&
				refused.hint.startsWith(HC_RESUME_HINT["hc-socket-unavailable"]) &&
				refused.hint.includes('"ENOENT"'),
		);
		const failed = hcResumeLaunchOutcome({
			ok: false,
			reason: "hc-run-failed",
			core: CORE,
			hcErrorKind: "spawn_failed",
			recovery: { outcome: "unknown" },
		});
		expect(failed).toEqual({
			ok: false,
			reason: "hc-run-failed",
			hint: HC_RESUME_HINT["hc-run-failed"],
			failure: { rail: "hc", vendorCode: "spawn_failed", recovery: { outcome: "unknown" }, core: CORE },
		});
		const adopt = scripted([HELLO, CALLER_LIVE, (r) => echoOf(r)]);
		const durable = await launchHcResume(
			{ backend: "pi-durable", cwd: CWD, runtimeArgs: ["pi-durable"], piDurableAdoptEnv: ADOPT },
			ENV,
			adopt.deps,
		);
		ok(
			"the seam's adopt projection reaches the write",
			durable.ok &&
				(adopt.requests[2].params as { env: Record<string, string> }).env.PI_CODING_AGENT_DIR ===
					ADOPT.PI_CODING_AGENT_DIR,
		);
	});

	it("[QK:HCL-SOCKET-NO-AUTOSTART] the production client connects or fails; one request, one reply line", async () => {
		const absent = await createHcSocketCall(path.join(TMP, "no-such.sock"))("{}\n", 500);
		ok("no listener is a connect failure", absent.kind === "connect-failed");
		ok("and nothing was created at that path", !fs.existsSync(path.join(TMP, "no-such.sock")));

		const sock = path.join(TMP, "core.sock");
		const seen: string[] = [];
		let mode: "reply" | "silent" | "close" | "big" = "reply";
		const server = net.createServer((conn) => {
			conn.on("error", () => undefined);
			conn.on("data", (data) => {
				seen.push(data.toString("utf8"));
				if (mode === "reply") {
					// Split inside a multi-byte character: decoded once, after the newline.
					const bytes = Buffer.from('{"id":"a","result":{"name":"é"}}\ntrailing', "utf8");
					const cut = bytes.indexOf(0xc3) + 1;
					conn.write(bytes.subarray(0, cut));
					setTimeout(() => conn.write(bytes.subarray(cut)), 10);
				} else if (mode === "close") conn.end("no newline");
				else if (mode === "big") conn.write(Buffer.alloc(128, 0x61));
			});
		});
		await new Promise<void>((resolve) => server.listen(sock, resolve));
		try {
			const call = createHcSocketCall(sock, 64);
			const answered = await call('{"id":"a"}\n', 1000);
			ok(
				"one reply line, decoded whole",
				answered.kind === "reply" && answered.line === '{"id":"a","result":{"name":"é"}}',
			);
			ok("the request line was written once", seen.length === 1 && seen[0] === '{"id":"a"}\n');
			mode = "silent";
			ok("no reply in the bound is a timeout", (await call("x\n", 100)).kind === "timeout");
			mode = "close";
			ok("a close before a newline is named", (await call("x\n", 1000)).kind === "eof-before-newline");
			mode = "big";
			ok("an oversize line is refused, not truncated", (await call("x\n", 1000)).kind === "oversize");
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("[QK:HCL-NO-TYPING-NO-KILL] the module names no typing or kill method and imports no other rail", () => {
		const src = fs.readFileSync(path.join(import.meta.dirname, "hc-launch.ts"), "utf8");
		const code = src
			.split("\n")
			.filter((line) => !/^\s*(\/\*\*|\*|\/\/)/.test(line))
			.join("\n");
		const methods = [...code.matchAll(/method: "([a-z_.]+)"/g)].map((m) => m[1]).sort();
		ok("exactly three methods are ever sent", methods.join() === "hello,terminal.get,terminal.run");
		for (const forbidden of [
			"terminal.send",
			"terminal.keys",
			"terminal.put",
			"terminal.interrupt",
			"terminal.kill",
			"terminal.rm",
			"server.",
		]) {
			ok(`${forbidden} is not in the code`, !code.includes(forbidden));
		}
		const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm), ...src.matchAll(/^} from "([^"]+)";$/gm)].map(
			(m) => m[1],
		);
		ok(
			"imports are node builtins and the pi-durable package verifier only",
			imports.length > 0 && imports.every((spec) => spec.startsWith("node:") || spec === "./pi-durable-runtime.ts"),
		);
		ok("no child process: the hc CLI can start a core, so it is never run", !imports.includes("node:child_process"));
	});
});
