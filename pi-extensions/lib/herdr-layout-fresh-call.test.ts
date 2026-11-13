/**
 * herdr-layout-fresh-call — pi-durable opened inside herdr through ONE layout.apply on the caller's
 * own herdr socket (#157 A-L1), proven beside the module.
 *
 * Two kinds of evidence, kept apart. The BRANCH is driven through `herdrFreshCall` with an injected
 * socket factory: a table of endpoints keyed by socket path, each answering per request, so a request
 * that reaches the wrong endpoint, or a write that should not happen, is visible as a recorded fact.
 * The TRANSPORT is the production `createHerdrSocketCall` against real unix-socket servers in a private
 * temporary directory — framing, size, EOF, connect failure and timeout are properties of a socket,
 * and a fake would agree with whatever we believed. No herdr binary and no herdr server run here.
 *
 * The reply literals are independent of the code under test: the pane read is the recorded herdr
 * 0.9.5 `pane get` reply (G3-B1 s06), the success is the recorded `layout.apply` reply shape (G2
 * positive), and the refused write is the recorded NUL-byte error reply (G2 negative), each with its
 * id re-keyed to this call. The bootstrap round trip is judged by the EXISTING decoder
 * (`meta-bridge-omp.ts` `decodeOmpBootstrapPayload`), not by the encoder's own self-check.
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE (run.sh:104-113):
 *
 *   HLFC-SAME-ENDPOINT              the read and the one write go to the one explicit endpoint; pi and
 *                                   claude-code never touch it
 *   HLFC-READ-FAILURE-NO-WRITE      every caller-pane read failure refuses with zero layout writes
 *   HLFC-READ-DIAGNOSTICS           a read's transport cause or herdr error is quoted, bounded, in the refusal
 *   HLFC-ENVELOPE-BEFORE-CERTAINTY  a malformed envelope is unknown even when it carries a "none" code
 *   HLFC-NONE-CODES-ONLY            only the pinned pre-create codes are none; every other code is unknown
 *   HLFC-POST-WRITE-UNKNOWN         a write that may have landed is unknown, carries the nonce, never resent
 *   HLFC-SUCCESS-PROVES-LAUNCH      a success must echo THIS launch, or it is unknown drift
 *   HLFC-PAYLOAD-ROUNDTRIP          the task survives C0/NUL/DEL/C1/quote/backslash/non-BMP exactly
 *   HLFC-PACKET-LITERAL             the read and the write are exactly an independently written literal
 *   HLFC-CWD-NO-FALLBACK            requested → known-Codex record → process; a Codex caller never falls back
 *   HLFC-SOCKET-PATH-EXPLICIT       no absolute HERDR_SOCKET_PATH, no endpoint, nothing guessed
 *   HLFC-PREFLIGHT-BEFORE-SOCKET    the pi-durable preflight refuses before any socket exists
 *   HLFC-VERIFIED-LAUNCHER          the argv starts with this package's own executable run.sh, or nothing
 *   HLFC-SETS-AND-MAPS              the herdr kind maps are keyed by the agent-start set only
 *   HLFC-RENDER-CERTAINTY           none never says a sibling may exist; unknown says the write was attempted
 *   HLFC-DIAGNOSTIC-BOUND           reported strings are cut for display only, at 256, surrogate-safe
 *   HLFC-TRANSPORT-FRAMING          the reply bytes are decoded once, whole — never chunk by chunk
 *   HLFC-TRANSPORT-OVERSIZE         a reply line over the byte bound is oversize, never truncated
 *   HLFC-TRANSPORT-EOF              a close before the newline is post-connect EOF, not a connect failure
 *   HLFC-TRANSPORT-CONNECT-FAIL     a connection that never existed is the only certain no-write
 *   HLFC-TRANSPORT-TIMEOUT          a bound expiring after connect is a timeout, not a connect failure
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	HERDR_AGENT_START_BACKENDS,
	HERDR_FRESH_CALL_BACKENDS,
	HERDR_LAYOUT_LAUNCH_BACKENDS,
} from "../../scripts/herdr-rails.mjs";
import { decodeOmpBootstrapPayload } from "../meta-bridge-omp.ts";
import { composeFreshCallPrompt } from "./fresh-call-composition.ts";
import {
	boundHerdrDiagnostic,
	chooseHerdrLayoutCwd,
	classifyHerdrLayoutApplyReply,
	composeHerdrPiDurableCommand,
	createHerdrSocketCall,
	decodeHerdrReplyBytes,
	HERDR_AGENT_KIND,
	HERDR_CANONICAL_EXECUTABLE,
	HERDR_FRESH_CALL_OPENING_LINE,
	type HerdrFreshCallResult,
	type HerdrLayoutDeps,
	type HerdrRun,
	type HerdrSocketCallFactory,
	type HerdrSocketOutcome,
	herdrAgentNameFromNonce,
	herdrFreshCall,
	renderHerdrFreshCall,
} from "./herdr-fresh-call.ts";
import { type PiDurablePackageLayout, piDurableLayoutAt } from "./pi-durable-runtime.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const CALLER = "20260914T174741-2e9ba9";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
const PANE = "w1:p1";
const SOCKET = "/run/user/1000/herdr-a.sock";
const OTHER_SOCKET = "/run/user/1000/herdr-b.sock";
const ENV = { HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr", HERDR_PANE_ID: PANE, HERDR_SOCKET_PATH: SOCKET };
const BASE = herdrAgentNameFromNonce(NONCE);
const READ_ID = `${BASE}:pane.get`;
const WRITE_ID = `${BASE}:layout.apply`;
/** Unicode general category Cc: U+0000–U+001F and U+007F–U+009F. */
const ANY_CC = /\p{Cc}/u;

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-layout-fresh-call-"));
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));
function scratchDir(name: string): string {
	const dir = path.join(SCRATCH, name);
	fs.mkdirSync(dir);
	return dir;
}
const PROCESS_CWD = scratchDir("process-cwd");
const RECORD_CWD = scratchDir("record-cwd");
const REQUESTED_CWD = scratchDir("requested-cwd");

/** A package closure that satisfies the pi-durable unit preflight, with an executable run.sh. */
function packageFixture(name: string, launcher: "executable" | "plain" | "absent" | "directory" = "executable") {
	const root = path.join(SCRATCH, name);
	const layout = piDurableLayoutAt(root);
	for (const file of [layout.adapter, layout.bridgeEntry, layout.bootstrap, layout.ownerFence]) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "// unit\n");
	}
	fs.mkdirSync(path.dirname(layout.deliverability), { recursive: true });
	fs.writeFileSync(
		layout.deliverability,
		'export const SENDER_JOINED_RECEIVER_OWNER_KINDS = ["claude-code-hook", "pi-durable-host"];\n',
	);
	const runSh = path.join(root, "run.sh");
	if (launcher === "executable" || launcher === "plain") {
		fs.writeFileSync(runSh, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(runSh, launcher === "executable" ? 0o755 : 0o644);
	} else if (launcher === "directory") {
		fs.mkdirSync(runSh);
	}
	return layout;
}
const PACKAGE = packageFixture("package");

// ── herdr's replies, from recordings ───────────────────────────────────────────────────────────

/** The recorded herdr 0.9.5 `pane get` reply (G3-B1 s06), re-keyed to this call's id and pane. */
function paneGetLine(id: string, pane: Record<string, unknown> = {}): string {
	return JSON.stringify({
		id,
		result: {
			pane: {
				agent_status: "unknown",
				cwd: "/tmp/e157h/g3-b1-native-session-r1/fx/pd-cwd",
				focused: false,
				foreground_cwd: "/tmp/e157h/g3-b1-native-session-r1/fx/pd-cwd",
				pane_id: PANE,
				revision: 0,
				scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 40 },
				tab_id: "w1:t1",
				terminal_id: "term_65f32d8b1fa682",
				workspace_id: "w1",
				...pane,
			},
			type: "pane_info",
		},
	});
}

interface LayoutRequest {
	readonly id: string;
	readonly method: string;
	readonly params: {
		readonly workspace_id?: string;
		readonly focus?: boolean;
		readonly pane_id?: string;
		readonly root?: { type: string; cwd: string; command: string[]; env: Record<string, string> };
	};
}

/** The recorded `layout.apply` success shape (G2 positive), echoing the request it answers. */
function layoutSuccess(
	id: string,
	echo: { workspaceId: string; cwd: unknown; command: unknown },
	patch: (layout: Record<string, unknown>, root: Record<string, unknown>) => void = () => undefined,
): Record<string, unknown> {
	const root: Record<string, unknown> = { type: "pane", pane_id: "w1:p2", cwd: echo.cwd, command: echo.command };
	const layout: Record<string, unknown> = {
		workspace_id: echo.workspaceId,
		tab_id: "w1:t2",
		zoomed: false,
		focused_pane_id: "w1:p2",
		root,
	};
	patch(layout, root);
	return { id, result: { type: "layout_apply", layout } };
}

/** The recorded G2 negative reply: herdr refused a NUL byte in an argv after accepting the request. */
const RECORDED_NUL_ERROR = (id: string) =>
	JSON.stringify({ id, error: { code: "layout_apply_failed", message: "nul byte found in provided data" } });

const reply = (line: string): HerdrSocketOutcome => ({ kind: "reply", line });

type Answer = (request: LayoutRequest) => HerdrSocketOutcome;

/** A herdr that reads the caller's pane and echoes the layout it was asked for. */
const HAPPY: Answer = (request) =>
	request.method === "pane.get"
		? reply(paneGetLine(request.id))
		: reply(
				JSON.stringify(
					layoutSuccess(request.id, {
						workspaceId: request.params.workspace_id ?? "",
						cwd: request.params.root?.cwd,
						command: request.params.root?.command,
					}),
				),
			);

/** Answers the read like HAPPY and the write with `write`. */
const writeAnswers =
	(write: Answer): Answer =>
	(request) =>
		request.method === "pane.get" ? HAPPY(request) : write(request);

/** Endpoints keyed by socket path. `opened` is every factory call; `written` every request that
 * reached a server (a connect failure writes nothing, so it is not recorded there). */
function endpoints(servers: Record<string, Answer>) {
	const opened: string[] = [];
	const written: { path: string; line: string; request: LayoutRequest }[] = [];
	const socket: HerdrSocketCallFactory = (socketPath) => {
		opened.push(socketPath);
		return async (line) => {
			const answer = servers[socketPath];
			if (answer === undefined) return { kind: "connect-failed", code: "ENOENT" };
			const request = JSON.parse(line) as LayoutRequest;
			const outcome = answer(request);
			if (outcome.kind !== "connect-failed") written.push({ path: socketPath, line, request });
			return outcome;
		};
	};
	return { socket, opened, written };
}

/** A herdr CLI that must never be reached by this branch: it records and refuses. */
function refusingCli(): { run: HerdrRun; calls: string[][] } {
	const calls: string[][] = [];
	const run: HerdrRun = (args) => {
		calls.push([...args]);
		return Promise.resolve({ status: 1, stdout: "", stderr: "unscripted herdr CLI call" });
	};
	return { run, calls };
}

interface LaunchOptions {
	readonly backend?: string;
	readonly model?: string;
	readonly task?: string;
	readonly cwd?: string;
	readonly callerIsCodex?: boolean;
	readonly callerCwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly servers?: Record<string, Answer>;
	readonly deps?: Partial<HerdrLayoutDeps>;
}

async function launch(options: LaunchOptions = {}) {
	const ends = endpoints(options.servers ?? { [SOCKET]: HAPPY });
	const cli = refusingCli();
	const processCwdReads: number[] = [];
	const packageReads: number[] = [];
	const deps: Partial<HerdrLayoutDeps> = {
		socket: ends.socket,
		callerProcessCwd: () => {
			processCwdReads.push(1);
			return PROCESS_CWD;
		},
		packageLayout: () => {
			packageReads.push(1);
			return PACKAGE;
		},
		runtimeVerdict: () => null,
		...options.deps,
	};
	const result: HerdrFreshCallResult = await herdrFreshCall(
		{
			backend: options.backend ?? "pi-durable",
			model: options.model ?? "loopback/scripted",
			task: options.task ?? "say hello",
			callerGardenId: CALLER,
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			...(options.callerIsCodex === undefined ? {} : { callerIsCodex: options.callerIsCodex }),
			...(options.callerCwd === undefined ? {} : { callerCwd: options.callerCwd }),
		},
		cli.run,
		options.env ?? ENV,
		NONCE,
		undefined,
		deps,
	);
	const writes = ends.written.filter((w) => w.request.method === "layout.apply");
	return {
		result,
		opened: ends.opened,
		written: ends.written,
		writes,
		cli: cli.calls,
		processCwdReads: processCwdReads.length,
		packageReads: packageReads.length,
	};
}

const reasonOf = (result: HerdrFreshCallResult) => (result.ok ? null : result.reason);
const recoveryOf = (result: HerdrFreshCallResult) =>
	!result.ok && "recovery" in result ? result.recovery.outcome : undefined;
const nonceOf = (result: HerdrFreshCallResult) => (!result.ok && "nonce" in result ? result.nonce : undefined);

describe("herdr layout fresh call (#157 A-L1)", () => {
	it("[QK:HLFC-SAME-ENDPOINT] the caller-pane read and the ONE layout write go to the one explicit HERDR_SOCKET_PATH endpoint — never a CLI read plus a socket write, and never a second endpoint that answers with the same w1/p1 strings — while pi and claude-code never touch that endpoint", async () => {
		// Two servers that would give IDENTICAL answers: the strings cannot tell them apart, so the
		// only proof of continuity is which endpoint each request actually reached.
		const split = await launch({ servers: { [SOCKET]: HAPPY, [OTHER_SOCKET]: HAPPY } });
		ok(
			"one endpoint, both requests, in order, no CLI",
			split.result.ok &&
				JSON.stringify(split.opened) === JSON.stringify([SOCKET]) &&
				JSON.stringify(split.written.map((w) => [w.path, w.request.method])) ===
					JSON.stringify([
						[SOCKET, "pane.get"],
						[SOCKET, "layout.apply"],
					]) &&
				split.written[0]?.request.id === READ_ID &&
				split.written[0]?.request.params.pane_id === PANE &&
				split.written[1]?.request.id === WRITE_ID &&
				split.written[1]?.request.params.workspace_id === "w1" &&
				split.written[1]?.request.params.focus === false &&
				split.cli.length === 0,
		);
		for (const backend of ["pi", "claude-code"]) {
			const agentStart = await launch({ backend, model: backend === "pi" ? "openai-codex/x" : "opus" });
			ok(
				`${backend} stays on the herdr CLI and never opens the layout endpoint`,
				agentStart.opened.length === 0 && agentStart.cli.length > 0 && agentStart.cli[0]?.[0] === "pane",
			);
		}

		// The same claim over REAL unix sockets with the production client: the server at the
		// explicit path sees both connections, the other server none.
		const dir = fs.mkdtempSync(path.join(SCRATCH, "ep-"));
		const named = await serve(path.join(dir, "a.sock"), answerLines(HAPPY));
		const other = await serve(path.join(dir, "b.sock"), answerLines(HAPPY));
		try {
			const real = await launch({
				env: { ...ENV, HERDR_SOCKET_PATH: named.path },
				deps: { socket: (socketPath) => createHerdrSocketCall(socketPath) },
			});
			ok(
				"real sockets: two connections to the named endpoint, none elsewhere",
				real.result.ok &&
					JSON.stringify(named.requests.map((r) => r.method)) === JSON.stringify(["pane.get", "layout.apply"]) &&
					named.connections === 2 &&
					other.connections === 0,
			);
		} finally {
			await named.close();
			await other.close();
		}
	});

	it("[QK:HLFC-READ-FAILURE-NO-WRITE] every failure of the caller-pane read is a REFUSAL with zero layout writes and no CLI — the read is the only thing between the decisions and the mutation, so it cannot let a guessed workspace through", async () => {
		const cases: ReadonlyArray<readonly [string, Answer, string]> = [
			["connect failure", () => ({ kind: "connect-failed", code: "ENOENT" }), "herdr-caller-pane-get-failed"],
			["timeout", () => ({ kind: "timeout" }), "herdr-caller-pane-get-failed"],
			["eof", () => ({ kind: "eof-before-newline" }), "herdr-caller-pane-get-failed"],
			["io failure", () => ({ kind: "io-failed", code: "EPIPE" }), "herdr-caller-pane-get-failed"],
			["oversize", () => ({ kind: "oversize" }), "herdr-caller-pane-get-failed"],
			[
				"error arm",
				(r) => reply(JSON.stringify({ id: r.id, error: { code: "pane_not_found", message: "no pane" } })),
				"herdr-caller-pane-get-failed",
			],
			["not json", () => reply("{not json"), "herdr-caller-pane-unparsable"],
			[
				"both arms",
				(r) =>
					reply(
						JSON.stringify({
							...JSON.parse(paneGetLine(r.id)),
							error: { code: "pane_not_found", message: "x" },
						}),
					),
				"herdr-caller-pane-unparsable",
			],
			["another id", () => reply(paneGetLine("cli:pane:get")), "herdr-caller-pane-unparsable"],
			[
				"wrong type",
				(r) => reply(paneGetLine(r.id).replace('"type":"pane_info"', '"type":"pane_list"')),
				"herdr-caller-pane-unparsable",
			],
			["no terminal", (r) => reply(paneGetLine(r.id, { terminal_id: "" })), "herdr-caller-pane-unparsable"],
			["negative revision", (r) => reply(paneGetLine(r.id, { revision: -1 })), "herdr-caller-pane-unparsable"],
			["focused not boolean", (r) => reply(paneGetLine(r.id, { focused: "no" })), "herdr-caller-pane-unparsable"],
			[
				"agent_status absent",
				(r) => {
					const line = JSON.parse(paneGetLine(r.id));
					delete line.result.pane.agent_status;
					return reply(JSON.stringify(line));
				},
				"herdr-caller-pane-unparsable",
			],
			["another pane", (r) => reply(paneGetLine(r.id, { pane_id: "w1:p9" })), "herdr-caller-pane-drift"],
			["no workspace", (r) => reply(paneGetLine(r.id, { workspace_id: "" })), "herdr-caller-workspace-missing"],
		];
		for (const [name, read, reason] of cases) {
			const refused = await launch({
				servers: { [SOCKET]: (r) => (r.method === "pane.get" ? read(r) : HAPPY(r)) },
			});
			ok(
				`${name}: refused as ${reason}, nothing written after the read`,
				reasonOf(refused.result) === reason &&
					refused.writes.length === 0 &&
					refused.cli.length === 0 &&
					renderHerdrFreshCall(refused.result).text.includes("No tab and no pane were created."),
			);
		}
	});

	it("[QK:HLFC-READ-DIAGNOSTICS] a failed caller-pane read keeps its cause: the transport outcome, or herdr's well-formed error code and message, travel as bounded display-only diagnostics into the QUOTED refusal — still no layout write, no nonce, no close — and the repair text tells the pi-durable socket read apart from the pi/claude-code CLI read", async () => {
		const longMessage = `pane w1:p1 is gone ${"z".repeat(400)}`;
		const cases: ReadonlyArray<readonly [string, Answer, Record<string, string>]> = [
			["connect failure", () => ({ kind: "connect-failed", code: "ENOENT" }), { transport: "connect-failed: ENOENT" }],
			["io failure", () => ({ kind: "io-failed", code: "ECONNRESET" }), { transport: "io-failed: ECONNRESET" }],
			["timeout", () => ({ kind: "timeout" }), { transport: "timeout" }],
			[
				"herdr error",
				(r) => reply(JSON.stringify({ id: r.id, error: { code: "pane_not_found", message: longMessage } })),
				{ errorCode: "pane_not_found", errorMessage: `${longMessage.slice(0, 255)}…` },
			],
		];
		for (const [name, read, expected] of cases) {
			const refused = await launch({
				servers: { [SOCKET]: (r) => (r.method === "pane.get" ? read(r) : HAPPY(r)) },
			});
			const reported = !refused.result.ok && "reported" in refused.result ? refused.result.reported : undefined;
			const text = renderHerdrFreshCall(refused.result).text;
			ok(
				`${name}: the cause is kept, bounded and quoted; nothing written`,
				reasonOf(refused.result) === "herdr-caller-pane-get-failed" &&
					JSON.stringify(reported) === JSON.stringify(expected) &&
					Object.values(expected).every((value) => text.includes(JSON.stringify(value))) &&
					text.includes("No tab and no pane were created.") &&
					text.includes("HERDR_SOCKET_PATH") &&
					text.includes("`herdr pane get $HERDR_PANE_ID`") &&
					nonceOf(refused.result) === undefined &&
					recoveryOf(refused.result) === undefined &&
					refused.writes.length === 0 &&
					refused.cli.length === 0,
			);
		}
	});

	it("[QK:HLFC-ENVELOPE-BEFORE-CERTAINTY] the envelope is judged BEFORE the error-code allowlist: both arms, a missing or mistyped code or message, a null/array arm, another id or a non-object line is UNKNOWN unparsable — even when it carries a pre-create code that would otherwise mean nothing was created", () => {
		const expectation = { id: "x:layout.apply", workspaceId: "w1", cwd: "/w", command: ["/pkg/run.sh", "pi-durable"] };
		const validSuccess = layoutSuccess(expectation.id, expectation);
		const lines: ReadonlyArray<readonly [string, string]> = [
			[
				"both arms with a valid success",
				JSON.stringify({ ...validSuccess, error: { code: "workspace_not_found", message: "gone" } }),
			],
			["missing message", JSON.stringify({ id: expectation.id, error: { code: "invalid_layout" } })],
			["numeric code", JSON.stringify({ id: expectation.id, error: { code: 7, message: "x" } })],
			["empty code", JSON.stringify({ id: expectation.id, error: { code: "", message: "x" } })],
			["null error", JSON.stringify({ id: expectation.id, error: null })],
			["array error", JSON.stringify({ id: expectation.id, error: ["invalid_env", "x"] })],
			["null result", JSON.stringify({ id: expectation.id, result: null })],
			["neither arm", JSON.stringify({ id: expectation.id })],
			["another id", JSON.stringify({ id: "y", error: { code: "invalid_env", message: "x" } })],
			["top-level array", JSON.stringify([{ id: expectation.id, error: { code: "invalid_env", message: "x" } }])],
			["not json", '{"id":"x:layout.apply","error":{"code":"invalid_env"'],
		];
		for (const [name, line] of lines) {
			const judged = classifyHerdrLayoutApplyReply(reply(line), expectation);
			ok(
				`${name}: unknown unparsable`,
				!judged.ok && judged.reason === "herdr-layout-reply-unparsable" && judged.recovery.outcome === "unknown",
			);
		}
	});

	it("[QK:HLFC-NONE-CODES-ONLY] only workspace_not_found, invalid_layout and invalid_env — the codes the pinned handler returns before its first creation — mean nothing was created; layout_apply_failed (recorded: herdr's NUL refusal) and every other code is UNKNOWN", async () => {
		for (const code of ["workspace_not_found", "invalid_layout", "invalid_env"]) {
			const refused = await launch({
				servers: {
					[SOCKET]: writeAnswers((r) => reply(JSON.stringify({ id: r.id, error: { code, message: "declined" } }))),
				},
			});
			ok(
				`${code}: none, no nonce`,
				reasonOf(refused.result) === "herdr-layout-apply-refused" &&
					recoveryOf(refused.result) === "none" &&
					nonceOf(refused.result) === undefined &&
					refused.writes.length === 1,
			);
		}
		const recorded = await launch({ servers: { [SOCKET]: writeAnswers((r) => reply(RECORDED_NUL_ERROR(r.id))) } });
		ok(
			"recorded layout_apply_failed: unknown, with the nonce",
			reasonOf(recorded.result) === "herdr-layout-apply-failed" &&
				recoveryOf(recorded.result) === "unknown" &&
				nonceOf(recorded.result) === NONCE &&
				recorded.writes.length === 1,
		);
		for (const code of ["tab_not_found", "invalid_target", "internal_error", "WORKSPACE_NOT_FOUND"]) {
			const judged = classifyHerdrLayoutApplyReply(reply(JSON.stringify({ id: "x", error: { code, message: "m" } })), {
				id: "x",
				workspaceId: "w1",
				cwd: "/w",
				command: ["a"],
			});
			ok(
				`${code}: unknown apply-failed`,
				!judged.ok && judged.reason === "herdr-layout-apply-failed" && judged.recovery.outcome === "unknown",
			);
		}
	});

	it("[QK:HLFC-POST-WRITE-UNKNOWN] once the layout request may have been written — an I/O error, a timeout, an oversized reply or EOF — the outcome is UNKNOWN, carries the nonce, and the request is NEVER resent and nothing is closed; only a layout connection that never existed is none", async () => {
		const postWrite: ReadonlyArray<HerdrSocketOutcome> = [
			{ kind: "io-failed", code: "ECONNRESET" },
			{ kind: "timeout" },
			{ kind: "oversize" },
			{ kind: "eof-before-newline" },
		];
		for (const outcome of postWrite) {
			const unknown = await launch({ servers: { [SOCKET]: writeAnswers(() => outcome) } });
			ok(
				`${outcome.kind}: unknown, nonce, one write, no CLI`,
				reasonOf(unknown.result) === "herdr-layout-transport-failed" &&
					recoveryOf(unknown.result) === "unknown" &&
					nonceOf(unknown.result) === NONCE &&
					unknown.writes.length === 1 &&
					unknown.cli.length === 0,
			);
		}
		const neverConnected = await launch({
			servers: { [SOCKET]: writeAnswers(() => ({ kind: "connect-failed", code: "ECONNREFUSED" })) },
		});
		ok(
			"layout connect failure: none, no nonce, nothing written",
			reasonOf(neverConnected.result) === "herdr-layout-transport-failed" &&
				recoveryOf(neverConnected.result) === "none" &&
				nonceOf(neverConnected.result) === undefined &&
				neverConnected.writes.length === 0,
		);
	});

	it("[QK:HLFC-SUCCESS-PROVES-LAUNCH] a success reply must describe THIS launch — layout_apply, the workspace asked for, a tab, a boolean zoom, a one-pane root that is the tab's focus, and the exact cwd and argv sent — or it is UNKNOWN drift whose coordinates are display-only, compared on their complete values", async () => {
		const drifts: ReadonlyArray<
			readonly [string, (layout: Record<string, unknown>, root: Record<string, unknown>) => void]
		> = [
			[
				"another workspace",
				(layout) => {
					layout.workspace_id = "w2";
				},
			],
			[
				"an over-long workspace",
				(layout) => {
					layout.workspace_id = `w1${"x".repeat(400)}`;
				},
			],
			[
				"empty tab",
				(layout) => {
					layout.tab_id = "";
				},
			],
			[
				"string zoom",
				(layout) => {
					layout.zoomed = "false";
				},
			],
			[
				"focus elsewhere",
				(layout) => {
					layout.focused_pane_id = "w1:p3";
				},
			],
			[
				"a split root",
				(_layout, root) => {
					root.type = "split";
				},
			],
			[
				"null pane",
				(_layout, root) => {
					root.pane_id = null;
				},
			],
			[
				"null cwd",
				(_layout, root) => {
					root.cwd = null;
				},
			],
			[
				"another cwd",
				(_layout, root) => {
					root.cwd = "/elsewhere";
				},
			],
			[
				"null argv",
				(_layout, root) => {
					root.command = null;
				},
			],
			[
				"one argv token changed",
				(_layout, root) => {
					root.command = [...(root.command as string[]).slice(0, -1), "x"];
				},
			],
			[
				"one argv token dropped",
				(_layout, root) => {
					root.command = (root.command as string[]).slice(0, -1);
				},
			],
			[
				"one argv token added",
				(_layout, root) => {
					root.command = [...(root.command as string[]), "--extra"];
				},
			],
		];
		for (const [name, patch] of drifts) {
			const drifted = await launch({
				servers: {
					[SOCKET]: writeAnswers((r) =>
						reply(
							JSON.stringify(
								layoutSuccess(
									r.id,
									{
										workspaceId: r.params.workspace_id ?? "",
										cwd: r.params.root?.cwd,
										command: r.params.root?.command,
									},
									patch,
								),
							),
						),
					),
				},
			});
			const reported = !drifted.result.ok && "reported" in drifted.result ? drifted.result.reported : undefined;
			ok(
				`${name}: unknown drift, nonce, display-only coordinates`,
				reasonOf(drifted.result) === "herdr-layout-reply-drift" &&
					recoveryOf(drifted.result) === "unknown" &&
					nonceOf(drifted.result) === NONCE &&
					drifted.writes.length === 1 &&
					Object.values(reported ?? {}).every((value) => typeof value === "string" && value.length <= 256),
			);
		}
		// Compared WHOLE: a caller workspace longer than the display cut, answered with one that differs
		// only after the cut, is drift — the cut never decides anything.
		const longWorkspace = `w${"x".repeat(300)}`;
		const lateDiffer = await launch({
			servers: {
				[SOCKET]: (r) =>
					r.method === "pane.get"
						? reply(paneGetLine(r.id, { workspace_id: longWorkspace }))
						: reply(
								JSON.stringify(
									layoutSuccess(r.id, {
										workspaceId: `${longWorkspace.slice(0, -1)}z`,
										cwd: r.params.root?.cwd,
										command: r.params.root?.command,
									}),
								),
							),
			},
		});
		ok(
			"a workspace that differs only after the display cut is drift",
			reasonOf(lateDiffer.result) === "herdr-layout-reply-drift" &&
				lateDiffer.writes[0]?.request.params.workspace_id === longWorkspace,
		);
		const wrongType = classifyHerdrLayoutApplyReply(
			reply(JSON.stringify({ id: "x", result: { type: "layout_get", layout: {} } })),
			{ id: "x", workspaceId: "w1", cwd: "/w", command: ["a"] },
		);
		ok("another result type: unknown drift", !wrongType.ok && wrongType.reason === "herdr-layout-reply-drift");
		const exact = await launch();
		ok(
			"the exact echo is the receipt",
			exact.result.ok &&
				exact.result.receipt.backend === "pi-durable" &&
				exact.result.receipt.herdrWorkspaceId === "w1" &&
				exact.result.receipt.herdrTabId === "w1:t2" &&
				exact.result.receipt.herdrPaneId === "w1:p2" &&
				exact.result.receipt.nonce === NONCE,
		);
	});

	it("[QK:HLFC-PAYLOAD-ROUNDTRIP] a task carrying C0, NUL, DEL, C1, a quote, a backslash, non-BMP characters and Hangul is launched, not refused: the argv's bootstrap element holds no control character, and the existing bootstrap decoder returns the framed prompt byte for byte — after herdr's own JSON decode of the request", async () => {
		const task =
			'C0 \u0001\u0002 tab\tnl\ncr\r NUL\u0000 DEL\u007f C1\u0085\u009b quote" backslash\\ \u{1F600}\u{1D11E} 한글 끝';
		const prompt = composeFreshCallPrompt({
			backend: "pi-durable",
			model: "m",
			task,
			callerGardenId: CALLER,
			nonce: NONCE,
			openingLine: HERDR_FRESH_CALL_OPENING_LINE,
		});
		const runtime = path.join(PACKAGE.root, "run.sh");
		const command = composeHerdrPiDurableCommand({
			runtime,
			prompt,
			model: "loopback/scripted",
			callerGardenId: CALLER,
			nonce: NONCE,
			task,
		});
		const decoded = decodeOmpBootstrapPayload(command.at(-1));
		ok(
			"composed: run.sh, the pi-durable verb, a Cc-free payload the decoder returns exactly",
			command[0] === runtime &&
				command[1] === "pi-durable" &&
				command.at(-2) === "--entwurf-bootstrap" &&
				!ANY_CC.test(command.at(-1) ?? "\u0000") &&
				decoded.ok &&
				decoded.value.task === prompt &&
				decoded.value.task.includes(task),
		);
		const launched = await launch({ task });
		const sent = launched.writes[0];
		const received = sent?.request.params.root?.command ?? [];
		const receivedDecode = decodeOmpBootstrapPayload(received.at(-1));
		ok(
			"launched: herdr decodes the request to the same argv, and the task survives that decode too",
			launched.result.ok &&
				sent !== undefined &&
				!ANY_CC.test(sent.line.slice(0, -1)) &&
				sent.line.endsWith("\n") &&
				JSON.stringify(received) === JSON.stringify(command) &&
				receivedDecode.ok &&
				receivedDecode.value.task === prompt,
		);
	});

	it("[QK:HLFC-PACKET-LITERAL] for a fixed nonce, caller, model, cwd and task the two requests are exactly an independently written literal — the read names the caller's pane; the write is one unfocused pane root with the explicit cwd, the verified run.sh and pi-durable's native flags, a closed {v, task} bootstrap payload, the empty PI_SESSION_ID/PI_AGENT_ID scrub and exactly the callback target and nonce, with no extra key anywhere", async () => {
		// Written by hand from the contract, NOT from the production packet or composition functions.
		// The agent name is sha256(nonce)[:20] computed outside this code; the framing sentences between
		// the opening line and the task are the composition leaf's own contract and are not restated.
		const AGENT = "entwurf-211c63b227211fc5829e";
		const launched = await launch({ task: "write the release note", model: "loopback/scripted" });
		const [read, write] = launched.written;
		const parsedWrite = JSON.parse(write?.line ?? "null");
		const command: unknown[] = parsedWrite?.params?.root?.command ?? [];
		const payload = command.at(-1);
		expect(launched.written.map((w) => w.line.indexOf("\n") === w.line.length - 1)).toStrictEqual([true, true]);
		expect(JSON.parse(read?.line ?? "null")).toStrictEqual({
			id: `${AGENT}:pane.get`,
			method: "pane.get",
			params: { pane_id: "w1:p1" },
		});
		expect({
			...parsedWrite,
			params: { ...parsedWrite.params, root: { ...parsedWrite.params.root, command: command.slice(0, -1) } },
		}).toStrictEqual({
			id: `${AGENT}:layout.apply`,
			method: "layout.apply",
			params: {
				workspace_id: "w1",
				focus: false,
				root: {
					type: "pane",
					cwd: PROCESS_CWD,
					command: [
						path.join(PACKAGE.root, "run.sh"),
						"pi-durable",
						"--provider",
						"loopback",
						"--model",
						"scripted",
						"--width",
						"task-wide",
						"--entwurf-bootstrap",
					],
					env: {
						PI_SESSION_ID: "",
						PI_AGENT_ID: "",
						ENTWURF_CALLBACK_TARGET: "20260914T174741-2e9ba9",
						ENTWURF_CALLBACK_NONCE: "mux-fresh-call-deadbeefdeadbeefdeadbeef",
					},
				},
			},
		});
		ok(
			"the payload is the closed {v, task} JSON: herdr's opening line first, the operator task last",
			typeof payload === "string" &&
				payload.startsWith(
					'{"v":2,"task":"You are a fresh visible citizen that entwurf opened in a new herdr tab.\\n',
				) &&
				payload.endsWith('\\n\\nAfter the tool receipt, carry out this task:\\n\\nwrite the release note"}') &&
				JSON.stringify(Object.keys(JSON.parse(payload))) === '["v","task"]' &&
				launched.result.ok,
		);
	});

	it("[QK:HLFC-CWD-NO-FALLBACK] the start directory is always sent explicitly: requested first, then a known Codex caller's RECORD cwd, then — only for a non-Codex caller — this process's own; a Codex caller with no record cwd is refused and this process's directory is never read for it", async () => {
		const codexNone = await launch({ callerIsCodex: true });
		const codexEmpty = await launch({ callerIsCodex: true, callerCwd: "" });
		ok(
			"a Codex caller with no record cwd is refused before any socket, without reading the process cwd",
			reasonOf(codexNone.result) === "codex-caller-cwd-unavailable" &&
				reasonOf(codexEmpty.result) === "codex-caller-cwd-unavailable" &&
				codexNone.processCwdReads + codexEmpty.processCwdReads === 0 &&
				codexNone.opened.length + codexEmpty.opened.length === 0,
		);
		const record = await launch({ callerIsCodex: true, callerCwd: RECORD_CWD });
		const plain = await launch({ callerCwd: RECORD_CWD });
		const requested = await launch({ callerIsCodex: true, callerCwd: RECORD_CWD, cwd: REQUESTED_CWD });
		const sentCwd = (run: Awaited<ReturnType<typeof launch>>) => run.writes[0]?.request.params.root?.cwd;
		const sourceOf = (run: Awaited<ReturnType<typeof launch>>) =>
			run.result.ok && run.result.receipt.backend === "pi-durable" ? run.result.receipt.cwdSource : undefined;
		ok(
			"record for Codex, process for anyone else, requested over both — each sent explicitly",
			sentCwd(record) === RECORD_CWD &&
				sourceOf(record) === "codex-caller-record" &&
				record.processCwdReads === 0 &&
				sentCwd(plain) === PROCESS_CWD &&
				sourceOf(plain) === "caller-process" &&
				sentCwd(requested) === REQUESTED_CWD &&
				sourceOf(requested) === "requested",
		);
		ok(
			"the chooser alone, as a table",
			JSON.stringify(chooseHerdrLayoutCwd({ callerIsCodex: true, callerProcessCwd: () => "/p" })) ===
				JSON.stringify({ ok: false, reason: "codex-caller-cwd-unavailable" }) &&
				JSON.stringify(chooseHerdrLayoutCwd({ callerIsCodex: false, callerProcessCwd: () => "/p" })) ===
					JSON.stringify({ ok: true, cwd: "/p", source: "caller-process" }),
		);
	});

	it("[QK:HLFC-SOCKET-PATH-EXPLICIT] with HERDR_SOCKET_PATH absent, empty or relative there is no endpoint: the call is refused by name before the pi-durable preflight and no socket is opened — nothing is guessed, scanned or defaulted", async () => {
		const { HERDR_SOCKET_PATH: _dropped, ...withoutSocket } = ENV;
		const envs: readonly NodeJS.ProcessEnv[] = [
			withoutSocket,
			{ ...ENV, HERDR_SOCKET_PATH: "" },
			{ ...ENV, HERDR_SOCKET_PATH: "herdr.sock" },
		];
		for (const env of envs) {
			const refused = await launch({ env });
			ok(
				`HERDR_SOCKET_PATH=${JSON.stringify(env.HERDR_SOCKET_PATH)}: refused, no socket, no preflight`,
				reasonOf(refused.result) === "herdr-socket-path-missing" &&
					refused.opened.length === 0 &&
					refused.packageReads === 0 &&
					refused.cli.length === 0,
			);
		}
	});

	it("[QK:HLFC-PREFLIGHT-BEFORE-SOCKET] the pi-durable preflight — provider-qualified model, package, carrier/SDK verdict, units — refuses by its own name before any socket is opened", async () => {
		const missingAdapter = packageFixture("no-adapter");
		fs.rmSync(missingAdapter.adapter);
		const cases: ReadonlyArray<readonly [string, LaunchOptions, string]> = [
			["no provider", { model: "scripted" }, "pi-durable-model-not-provider-qualified"],
			["no package", { deps: { packageLayout: () => null } }, "pi-durable-package-incomplete"],
			["carrier drift", { deps: { runtimeVerdict: () => "pi-durable-carrier-drift" } }, "pi-durable-carrier-drift"],
			["sdk mismatch", { deps: { runtimeVerdict: () => "pi-durable-sdk-mismatch" } }, "pi-durable-sdk-mismatch"],
			[
				"no birth unit",
				{ deps: { packageLayout: (): PiDurablePackageLayout => missingAdapter } },
				"pi-durable-birth-unit-missing",
			],
		];
		for (const [name, options, reason] of cases) {
			const refused = await launch(options);
			ok(
				`${name}: ${reason}, no socket`,
				reasonOf(refused.result) === reason && refused.opened.length === 0 && refused.cli.length === 0,
			);
		}
	});

	it("[QK:HLFC-VERIFIED-LAUNCHER] the argv's first element is this verified package's own run.sh and it must be an executable regular file — a missing, non-executable or directory run.sh is refused by name before any socket, never replaced by a PATH lookup", async () => {
		for (const launcher of ["absent", "plain", "directory"] as const) {
			const pkg = packageFixture(`launcher-${launcher}`, launcher);
			const refused = await launch({ deps: { packageLayout: () => pkg } });
			ok(
				`run.sh ${launcher}: pi-durable-launcher-missing, no socket`,
				reasonOf(refused.result) === "pi-durable-launcher-missing" && refused.opened.length === 0,
			);
		}
		const launched = await launch();
		const runtime = path.join(PACKAGE.root, "run.sh");
		ok(
			"the verified run.sh leads the argv and the receipt",
			launched.result.ok &&
				launched.result.receipt.backend === "pi-durable" &&
				launched.result.receipt.runtime === runtime &&
				launched.writes[0]?.request.params.root?.command[0] === runtime &&
				launched.writes[0]?.request.params.root?.command[1] === "pi-durable",
		);
	});

	it("[QK:HLFC-SETS-AND-MAPS] the herdr kind and canonical-executable maps are keyed by the agent-start set ONLY; the layout set is disjoint from it, the admitted aggregate is exactly their union, and a backend outside the aggregate is refused before any socket or CLI", async () => {
		const sorted = (values: Iterable<string>) => JSON.stringify([...values].sort());
		ok(
			"maps keyed by agent-start only; layout disjoint; aggregate the union",
			sorted(Object.keys(HERDR_AGENT_KIND)) === sorted(HERDR_AGENT_START_BACKENDS) &&
				sorted(Object.keys(HERDR_CANONICAL_EXECUTABLE)) === sorted(HERDR_AGENT_START_BACKENDS) &&
				!Object.hasOwn(HERDR_AGENT_KIND, "pi-durable") &&
				HERDR_LAYOUT_LAUNCH_BACKENDS.every((b) => !(HERDR_AGENT_START_BACKENDS as readonly string[]).includes(b)) &&
				sorted(HERDR_FRESH_CALL_BACKENDS) === sorted([...HERDR_AGENT_START_BACKENDS, ...HERDR_LAYOUT_LAUNCH_BACKENDS]),
		);
		for (const backend of ["codex", "copilot", "omp"]) {
			const refused = await launch({ backend });
			ok(
				`${backend}: herdr-backend-unsupported, no socket, no CLI`,
				reasonOf(refused.result) === "herdr-backend-unsupported" &&
					refused.opened.length === 0 &&
					refused.cli.length === 0,
			);
		}
	});

	it("[QK:HLFC-RENDER-CERTAINTY] the operator text says only what the outcome licenses: none says nothing was created and never mentions a callback; an unknown says the layout write was attempted and may have reached herdr — never that it was delivered — names the nonce, and promises no close and no retry; a success is a launch receipt whose coordinates are a view", async () => {
		const none = await launch({
			servers: {
				[SOCKET]: writeAnswers((r) =>
					reply(JSON.stringify({ id: r.id, error: { code: "invalid_env", message: "bad env" } })),
				),
			},
		});
		const notWritten = await launch({
			servers: { [SOCKET]: writeAnswers(() => ({ kind: "connect-failed", code: "ECONNREFUSED" })) },
		});
		const unknown = await launch({ servers: { [SOCKET]: writeAnswers(() => ({ kind: "timeout" })) } });
		const noneTexts = [renderHerdrFreshCall(none.result).text, renderHerdrFreshCall(notWritten.result).text];
		const unknownText = renderHerdrFreshCall(unknown.result).text;
		ok(
			"none never says a sibling may exist",
			noneTexts.every(
				(text) => text.includes("nothing was created") && !text.includes("call back") && !text.includes(NONCE),
			) && noneTexts[1]?.includes("never written") === true,
		);
		ok(
			"unknown says the write was attempted and may have reached herdr, names the nonce, closes and retries nothing",
			unknownText.includes("the layout write was attempted and may have reached herdr") &&
				!/WAS written|was delivered/i.test(unknownText) &&
				unknownText.includes(`nonce ${NONCE}`) &&
				unknownText.includes("Nothing was closed and nothing will be retried") &&
				!unknownText.includes("nothing was created"),
		);
		const success = await launch();
		const receipt = renderHerdrFreshCall(success.result).text;
		ok(
			"the success is a launch receipt with a view",
			!renderHerdrFreshCall(success.result).isError &&
				receipt.includes("This is a LAUNCH receipt") &&
				receipt.includes("REQUESTED unfocused") &&
				receipt.includes("not an address") &&
				receipt.includes(NONCE),
		);
	});

	it("[QK:HLFC-DIAGNOSTIC-BOUND] every reported herdr string is cut at 256 characters for DISPLAY only, never splitting a surrogate pair, and rendered JSON-quoted so it cannot pose as another line of the receipt", async () => {
		const exact = "a".repeat(256);
		const long = "b".repeat(1000);
		const surrogate = `${"c".repeat(254)}\u{1F600}tail`;
		const cutSurrogate = boundHerdrDiagnostic(surrogate);
		ok(
			"256 is kept, longer is cut to 256 with a marker, no lone surrogate",
			boundHerdrDiagnostic(exact) === exact &&
				boundHerdrDiagnostic(long).length === 256 &&
				boundHerdrDiagnostic(long).endsWith("…") &&
				cutSurrogate.length <= 256 &&
				!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cutSurrogate),
		);
		const message = `\nrecovery: none — forged ${"m".repeat(600)}`;
		const failed = await launch({
			servers: {
				[SOCKET]: writeAnswers((r) => reply(JSON.stringify({ id: r.id, error: { code: "internal_error", message } }))),
			},
		});
		const reported = !failed.result.ok && "reported" in failed.result ? failed.result.reported : undefined;
		const text = renderHerdrFreshCall(failed.result).text;
		ok(
			"the reported message is cut, quoted, and forges no line",
			reported?.errorMessage?.length === 256 &&
				text.includes(JSON.stringify(reported.errorMessage)) &&
				!text.includes("\nrecovery: none — forged"),
		);
	});
});

// ── the transport: real unix sockets, the production client ─────────────────────────────────────

interface Served {
	readonly path: string;
	readonly requests: LayoutRequest[];
	readonly lines: string[];
	connections: number;
	close(): Promise<void>;
}

/** A private unix-socket server. `onConnection` decides what each connection gets. */
async function serve(socketPath: string, onConnection: (socket: net.Socket, served: Served) => void): Promise<Served> {
	const sockets = new Set<net.Socket>();
	const server = net.createServer();
	const served: Served = {
		path: socketPath,
		requests: [],
		lines: [],
		connections: 0,
		close: () =>
			new Promise((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => resolve());
			}),
	};
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => undefined);
		served.connections++;
		onConnection(socket, served);
	});
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	return served;
}

/** Read one request line, then hand it to `then`. */
function onRequestLine(socket: net.Socket, served: Served, then: (line: string) => void): void {
	let buffered = "";
	socket.on("data", (chunk: Buffer) => {
		buffered += chunk.toString("utf8");
		const at = buffered.indexOf("\n");
		if (at === -1) return;
		const line = buffered.slice(0, at);
		served.lines.push(line);
		served.requests.push(JSON.parse(line) as LayoutRequest);
		then(line);
	});
}

/** A server that answers each request line with `answer`'s reply, then ends the connection. */
function answerLines(answer: Answer) {
	return (socket: net.Socket, served: Served) =>
		onRequestLine(socket, served, (line) => {
			const outcome = answer(JSON.parse(line) as LayoutRequest);
			if (outcome.kind === "reply") socket.end(`${outcome.line}\n`);
			else socket.destroy();
		});
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("herdr layout socket transport (#157 A-L1)", () => {
	const dir = fs.mkdtempSync(path.join(SCRATCH, "tx-"));
	let n = 0;
	const fresh = () => path.join(dir, `s${n++}.sock`);
	const BOUNDS = { timeoutMs: 400, maxReplyBytes: 64 };

	it("[QK:HLFC-TRANSPORT-FRAMING] the client's one decode leaf turns bytes split INSIDE a Hangul and a non-BMP character back into exactly the text herdr wrote — the chunks are joined before UTF-8 decoding, never decoded one by one — and the real client reads one exact line across pieces", async () => {
		// Deterministic, and the claim's kill: explicit buffers cut inside multi-byte characters. The
		// self-check proves the cuts really are inside characters — decoded alone, a piece is corrupt.
		const text = '{"id":"x","s":"한글 \u{1F3BC} reply"}';
		const whole = Buffer.from(text, "utf8");
		const hangulAt = whole.indexOf(Buffer.from("한", "utf8"));
		const clefAt = whole.indexOf(Buffer.from("\u{1F3BC}", "utf8"));
		const pieces = [
			whole.subarray(0, hangulAt + 1),
			whole.subarray(hangulAt + 1, clefAt + 2),
			whole.subarray(clefAt + 2),
		];
		ok(
			"split inside two characters, decoded whole",
			pieces.some((piece) => piece.toString("utf8").includes("\uFFFD")) &&
				decodeHerdrReplyBytes(pieces) === text &&
				decodeHerdrReplyBytes([whole]) === text,
		);
		// Integration over a real socket. Its pieces may be coalesced by the OS, so it is supporting
		// evidence only — the kill above does not depend on it.
		const line = JSON.stringify({ id: "x", result: { type: "t", s: "한글 reply" } });
		const bytes = Buffer.from(`${line}\nTRAILING`, "utf8");
		const hangul = bytes.indexOf(Buffer.from("한", "utf8"));
		const server = await serve(fresh(), (socket, served) =>
			onRequestLine(socket, served, async () => {
				socket.write(bytes.subarray(0, hangul + 1));
				await delay(30);
				socket.write(bytes.subarray(hangul + 1, hangul + 4));
				await delay(30);
				socket.write(bytes.subarray(hangul + 4));
			}),
		);
		try {
			const outcome = await createHerdrSocketCall(server.path, { timeoutMs: 2000, maxReplyBytes: 1024 })(
				'{"id":"x"}\n',
			);
			ok(
				"one exact line, decoded after its newline",
				outcome.kind === "reply" && outcome.line === line && server.lines[0] === '{"id":"x"}',
			);
		} finally {
			await server.close();
		}
	});

	it("[QK:HLFC-TRANSPORT-OVERSIZE] a reply line longer than the byte bound is `oversize` — never truncated into a line we would parse — while a line exactly at the bound is read", async () => {
		const over = await serve(fresh(), (socket, served) =>
			onRequestLine(socket, served, () => socket.write("x".repeat(200))),
		);
		const exact = await serve(fresh(), (socket, served) =>
			onRequestLine(socket, served, () => socket.write(`${"y".repeat(64)}\n`)),
		);
		try {
			const tooLong = await createHerdrSocketCall(over.path, BOUNDS)("{}\n");
			const atBound = await createHerdrSocketCall(exact.path, BOUNDS)("{}\n");
			ok(
				"over the bound: oversize; at the bound: the line",
				tooLong.kind === "oversize" && atBound.kind === "reply" && atBound.line === "y".repeat(64),
			);
		} finally {
			await over.close();
			await exact.close();
		}
	});

	it("[QK:HLFC-TRANSPORT-EOF] a server that receives the request and closes before a newline is `eof-before-newline` — a POST-CONNECT outcome, never reported as a connection that did not exist", async () => {
		const partial = await serve(fresh(), (socket, served) => onRequestLine(socket, served, () => socket.end('{"id":')));
		const silent = await serve(fresh(), (socket, served) => onRequestLine(socket, served, () => socket.end()));
		try {
			const half = await createHerdrSocketCall(partial.path, BOUNDS)('{"id":"q"}\n');
			const none = await createHerdrSocketCall(silent.path, BOUNDS)('{"id":"q"}\n');
			ok(
				"both EOFs, and the server did receive the request",
				half.kind === "eof-before-newline" &&
					none.kind === "eof-before-newline" &&
					partial.lines[0] === '{"id":"q"}' &&
					silent.lines[0] === '{"id":"q"}',
			);
		} finally {
			await partial.close();
			await silent.close();
		}
	});

	it("[QK:HLFC-TRANSPORT-CONNECT-FAIL] a socket path with nothing listening — absent, or a plain file — is `connect-failed`, the only outcome in which the request was certainly never written", async () => {
		const plainFile = path.join(dir, "plain-file");
		fs.writeFileSync(plainFile, "");
		const absent = await createHerdrSocketCall(path.join(dir, "absent.sock"), BOUNDS)("{}\n");
		const notSocket = await createHerdrSocketCall(plainFile, BOUNDS)("{}\n");
		ok(
			"connect-failed with the system's code",
			absent.kind === "connect-failed" &&
				absent.code === "ENOENT" &&
				notSocket.kind === "connect-failed" &&
				notSocket.code.length > 0,
		);
	});

	it("[QK:HLFC-TRANSPORT-TIMEOUT] a bound expiring AFTER the connection exists is `timeout` — the request may be in herdr's hands — and the server did receive it", async () => {
		const mute = await serve(fresh(), (socket, served) => onRequestLine(socket, served, () => undefined));
		try {
			const outcome = await createHerdrSocketCall(mute.path, { timeoutMs: 200, maxReplyBytes: 64 })('{"id":"t"}\n');
			ok("timeout after connect, request received", outcome.kind === "timeout" && mute.lines[0] === '{"id":"t"}');
		} finally {
			await mute.close();
		}
	});
});
