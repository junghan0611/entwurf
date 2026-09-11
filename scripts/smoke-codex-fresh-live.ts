/**
 * First-admission LIVE acceptance for Codex visible fresh.
 *
 * The operator owns the Codex app-server. This smoke neither starts nor supervises it: an
 * explicit ENTWURF_CODEX_APP_SERVER_PID names the already-running process whose /proc environment is
 * the seat authority. In Codex remote mode every TUI hook and MCP child belongs to that one
 * app-server process, so its TMUX/TMUX_PANE identify the real launch seat; the attached TUI pane
 * is deliberately not guessed.
 *
 * RELEASE MUST once Codex is admitted. LIVE!=1 is the only host-prerequisite SKIP. With LIVE=1,
 * missing system birth, user MCP/status config, app-server, models, runtime, bridge, or tmux seat
 * is a FAIL. The smoke uses only public MCP calls and receipt bodies; screen text is never an
 * oracle.
 *
 * A record-backed self-fetch fixture only collects travelling receipts. It first opens a real
 * visible Pi caller through public fresh_call; that Pi opens Codex, correlates Codex's callback,
 * and addresses Codex through v2. Codex then opens the outbound Pi and correlates that callback.
 */

import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CODEX_PREFLIGHT_HINT, codexFreshPreflight } from "../pi-extensions/lib/codex-fresh-preflight.ts";
import {
	defaultMetaMailboxDir,
	readMetaIdentityByGardenId,
	readMetaInbox,
	upsertMetaSession,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
import { readCodexThread, resolveCodexDefaultSocketPath } from "../pi-extensions/lib/native-push/codex-ws-client.ts";
import {
	buildCodexInstruction,
	buildInitialPiPhaseOne,
	buildInitialPiPhaseTwo,
	runCleanupStages,
	selectReport,
	selectReportByBackend,
} from "./lib/codex-fresh-live-protocol.ts";
import { launchReceiptWindows } from "./lib/launch-receipt-windows.ts";
import { skipLive } from "./lib/live-skip.ts";
import { parseTmuxRow, TMUX_COORDINATE_FIELDS, TMUX_COORDINATE_FORMAT } from "./lib/tmux-coordinate-row.ts";

const LABEL = "smoke-codex-fresh-live";
const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const WINDOW_ID = /^@\d+$/;
const CALLBACK_WAIT_MS = 300_000;
const ROUND_TRIP_WAIT_MS = 600_000;
const META_CONTEXT_ENV_KEYS = [
	"HOME",
	"CODEX_HOME",
	"PI_CODING_AGENT_DIR",
	"ENTWURF_META_SESSIONS_DIR",
	"ENTWURF_META_MAILBOX_DIR",
	"ENTWURF_META_SENDERS_DIR",
	"ENTWURF_META_RECEIVERS_DIR",
] as const;

type ToolResult = { text: string; isError: boolean };
type RpcReply = { result?: unknown; error?: unknown };
interface TmuxCoordinate {
	serverPid: string;
	sessionId: string;
	windowId: string;
	paneId: string;
}

const receipts: Record<string, string> = {};
let passed = 0;
let appServerEnv: NodeJS.ProcessEnv | null = null;
let bridge: BridgeClient | null = null;
const openedWindows: string[] = [];
const fixtureArtifacts: string[] = [];
// What a LATER receipt would have named. A timeout is exactly where a visible window
// becomes an orphan, so the two authorities that already hold the exact handles — the
// caller Pi's own transcript and the Codex thread's own tool-call results — are recorded
// as they become known.
let codexSocketPath = "";
let initialPiTranscript = "";
let codexThreadId = "";
// Reachable from the EXIT path, not just from a wait: an assertion that throws must still be
// able to ask the fixture's own mailbox which windows this run opened.
let fixtureGid = "";
const seenInbox: string[] = [];

function ok(label: string, condition: unknown, detail = ""): asserts condition {
	if (!condition) throw new Error(`${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function printReceipts(): void {
	if (Object.keys(receipts).length === 0) return;
	console.log(`\n[${LABEL}] decisive receipts`);
	for (const [name, receipt] of Object.entries(receipts)) console.log(`--- ${name} ---\n${receipt}`);
}

function parseNulFile(file: string): string[] {
	return fs
		.readFileSync(file)
		.toString("utf8")
		.split("\0")
		.filter((value) => value.length > 0);
}

function readProcessEnvironment(pid: number): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const entry of parseNulFile(`/proc/${pid}/environ`)) {
		const equals = entry.indexOf("=");
		if (equals > 0) result[entry.slice(0, equals)] = entry.slice(equals + 1);
	}
	return result;
}

function resolveExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
	for (const dir of (env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.resolve(dir, name);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			if (!fs.statSync(candidate).isFile()) continue;
			return candidate;
		} catch {
			// Continue through the app-server's literal PATH; do not consult a shell alias.
		}
	}
	return null;
}

function inspectTmuxCoordinate(label: string, env: NodeJS.ProcessEnv): TmuxCoordinate {
	const tmuxValue = env.TMUX ?? "";
	const paneValue = env.TMUX_PANE ?? "";
	const tmuxMatch = /^(.*),(\d+),(\d+)$/.exec(tmuxValue);
	ok(
		`${label} carries an inspectable absolute TMUX socket tuple`,
		tmuxMatch !== null && path.isAbsolute(tmuxMatch[1] ?? ""),
		`TMUX=${JSON.stringify(tmuxValue)}`,
	);
	ok(`${label} carries a native TMUX_PANE handle`, /^%\d+$/.test(paneValue));
	const inspected = spawnSync("tmux", ["display-message", "-p", "-t", paneValue, TMUX_COORDINATE_FORMAT], {
		env,
		encoding: "utf8",
	});
	ok(
		`${label} tmux coordinate answers through its own environment`,
		inspected.status === 0,
		String(inspected.stderr ?? ""),
	);
	// Positionally, with empty fields preserved: a format key that answers with nothing must
	// fail at ITS coordinate instead of shifting every later one left (measured on tmux 3.6a,
	// where `#{server_pid}` is empty — see scripts/lib/tmux-coordinate-row.ts).
	let row: string[];
	try {
		row = parseTmuxRow(String(inspected.stdout ?? ""), TMUX_COORDINATE_FIELDS);
	} catch (error) {
		throw new Error(
			`${label} tmux coordinate row is malformed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const [serverPid, sessionId, windowId, paneId] = row;
	ok(
		`${label} resolves its exact server/session/window/pane coordinate`,
		serverPid === tmuxMatch?.[2] &&
			/^\$\d+$/.test(sessionId ?? "") &&
			WINDOW_ID.test(windowId ?? "") &&
			paneId === paneValue,
		`coordinate=${JSON.stringify({ serverPid, sessionId, windowId, paneId })}`,
	);
	return {
		serverPid: serverPid as string,
		sessionId: sessionId as string,
		windowId: windowId as string,
		paneId: paneId as string,
	};
}

function cleanupWindows(): string[] {
	const failures: string[] = [];
	if (!appServerEnv) return failures;
	for (const windowId of [...openedWindows].reverse()) {
		if (!WINDOW_ID.test(windowId)) {
			failures.push(`refused malformed recorded window handle ${JSON.stringify(windowId)}`);
			continue;
		}
		const killed = spawnSync("tmux", ["kill-window", "-t", windowId], {
			env: appServerEnv,
			encoding: "utf8",
		});
		if (killed.status !== 0) {
			failures.push(
				`${windowId}: tmux kill-window failed (${killed.status ?? "signal"}): ${(killed.stderr ?? killed.stdout ?? "").trim()}`,
			);
		} else {
			console.log(`  cleanup  removed smoke-opened window ${windowId}`);
		}
	}
	openedWindows.length = 0;
	return failures;
}

function cleanupFixture(): string[] {
	const failures: string[] = [];
	for (const artifact of fixtureArtifacts.reverse()) {
		try {
			fs.rmSync(artifact, { recursive: true, force: true });
		} catch (error) {
			failures.push(`${artifact}: ${String(error)}`);
		}
	}
	fixtureArtifacts.length = 0;
	return failures;
}

/** The Codex window handle as the initial Pi caller's OWN transcript recorded its tool result. */
function recoverCodexWindows(): string[] {
	if (initialPiTranscript === "") return [];
	try {
		return launchReceiptWindows(fs.readFileSync(initialPiTranscript, "utf8"), "codex");
	} catch {
		return [];
	}
}

/** The outbound Pi handle as the Codex thread's own mcpToolCall result recorded it. */
async function recoverOutboundPiWindows(): Promise<string[]> {
	if (codexThreadId === "" || codexSocketPath === "") return [];
	try {
		const thread = await readCodexThread(codexSocketPath, codexThreadId, true);
		const found: string[] = [];
		for (const turn of thread.turns ?? []) {
			for (const item of turn.items ?? []) {
				if (item?.type !== "mcpToolCall" || !String(item.tool ?? "").includes("entwurf_fresh_call")) continue;
				for (const block of item.result?.content ?? []) {
					const text = (block as { text?: unknown } | null)?.text;
					if (typeof text === "string") found.push(...launchReceiptWindows(text, "pi"));
				}
			}
		}
		return found;
	} catch {
		return [];
	}
}

/**
 * Wait for a travelling receipt, and when it never comes, hand cleanup the EXACT handles the
 * two authorities above already hold before rethrowing. No tmux inventory scan and no guess:
 * a handle nobody recorded stays unrecovered and the cleanup failure says so.
 */
async function awaitOrRecover<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
	try {
		return await until(what, timeoutMs, probe);
	} catch (error) {
		for (const windowId of [...recoverCodexWindows(), ...(await recoverOutboundPiWindows())]) {
			if (openedWindows.includes(windowId)) continue;
			openedWindows.push(windowId);
			console.error(`  recovered  ${windowId} from its own receipt authority after: ${what}`);
		}
		throw error;
	}
}

/**
 * Every stable window handle any authority this run owns has written down: the fixture's own
 * delivered mailbox bodies (drained once more, in case the failure beat the last drain), the
 * initial Pi's transcript, and the Codex thread's tool results. De-duplicated, and only
 * `@\d+` handles are kept.
 */
async function recoverEveryRecordedWindow(): Promise<void> {
	const found: string[] = [];
	if (fixtureGid !== "") {
		try {
			for (const message of readMetaInbox({ gardenId: fixtureGid }).messages) seenInbox.push(message.body);
		} catch {
			// The fixture mailbox may already be gone; the transcript authorities below remain.
		}
	}
	for (const body of seenInbox) {
		found.push(...launchReceiptWindows(body, "pi"), ...launchReceiptWindows(body, "codex"));
	}
	found.push(...recoverCodexWindows(), ...(await recoverOutboundPiWindows()));
	for (const windowId of found) {
		if (!WINDOW_ID.test(windowId) || openedWindows.includes(windowId)) continue;
		openedWindows.push(windowId);
		console.error(`  recovered  ${windowId} from a receipt this run already held`);
	}
}

async function until<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = probe();
		if (found !== null) return found;
		if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 500));
	}
}

class BridgeClient {
	private readonly child: ChildProcess;
	private buffer = "";
	private stderr = "";
	private nextId = 1;
	private readonly waiters = new Map<number, (reply: RpcReply) => void>();

	constructor(command: string, env: NodeJS.ProcessEnv) {
		this.child = spawn(command, [], { env, stdio: ["pipe", "pipe", "pipe"] });
		this.child.stderr?.on("data", (chunk) => {
			this.stderr += chunk.toString();
		});
		this.child.stdout?.on("data", (chunk) => {
			this.buffer += chunk.toString();
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim().startsWith("{")) continue;
				try {
					const reply = JSON.parse(line) as { id?: unknown; result?: unknown; error?: unknown };
					if (typeof reply.id !== "number") continue;
					const waiter = this.waiters.get(reply.id);
					if (!waiter) continue;
					this.waiters.delete(reply.id);
					waiter({ result: reply.result, error: reply.error });
				} catch {
					// A non-protocol stdout line is diagnostic, never evidence.
				}
			}
		});
	}

	private send(message: unknown): void {
		this.child.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	private rpc(method: string, params: unknown, timeoutMs = 60_000): Promise<RpcReply> {
		const id = this.nextId++;
		return new Promise<RpcReply>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters.delete(id);
				reject(new Error(`${method} did not answer in ${timeoutMs}ms\n${this.stderrTail()}`));
			}, timeoutMs);
			this.waiters.set(id, (reply) => {
				clearTimeout(timer);
				resolve(reply);
			});
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	async initialize(): Promise<string[]> {
		const initialized = await this.rpc("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: LABEL, version: "0" },
		});
		if (initialized.error !== undefined)
			throw new Error(`installed bridge initialize failed: ${JSON.stringify(initialized.error)}`);
		this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const listed = await this.rpc("tools/list", {});
		if (listed.error !== undefined)
			throw new Error(`installed bridge tools/list failed: ${JSON.stringify(listed.error)}`);
		const tools = (listed.result as { tools?: Array<{ name?: unknown }> } | undefined)?.tools;
		if (!Array.isArray(tools))
			throw new Error(`installed bridge returned malformed tools/list: ${JSON.stringify(listed.result)}`);
		return tools.map((tool) => tool.name).filter((name): name is string => typeof name === "string");
	}

	async call(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<ToolResult> {
		const reply = await this.rpc("tools/call", { name, arguments: args }, timeoutMs);
		if (reply.error !== undefined) throw new Error(`${name} RPC error: ${JSON.stringify(reply.error)}`);
		const result = reply.result as { content?: Array<{ text?: unknown }>; isError?: unknown } | undefined;
		return {
			text: (result?.content ?? []).map((item) => (typeof item.text === "string" ? item.text : "")).join("\n"),
			isError: result?.isError === true,
		};
	}

	stderrTail(): string {
		return this.stderr.slice(-3000);
	}

	close(): void {
		this.child.kill("SIGTERM");
	}
}

function closeBridge(): void {
	const activeBridge = bridge;
	if (activeBridge !== null) activeBridge.close();
}

async function run(): Promise<void> {
	if (!(FRESH_CALL_BACKENDS as readonly string[]).includes("codex")) {
		skipLive(
			LABEL,
			"codex is not admitted in FRESH_CALL_BACKENDS, so there is no visible-fresh product to accept; admission parity owns that composition state.",
		);
	}
	if (process.env.LIVE !== "1") {
		skipLive(
			LABEL,
			"set LIVE=1 plus ENTWURF_CODEX_APP_SERVER_PID, ENTWURF_CODEX_FRESH_MODEL, and ENTWURF_CODEX_FRESH_PI_MODEL to run; this opens real Codex and Pi windows and spends model turns.",
		);
	}
	ok("the measured/certified host axis is Linux", process.platform === "linux", `host=${process.platform}`);

	const pidText = process.env.ENTWURF_CODEX_APP_SERVER_PID?.trim() ?? "";
	ok(
		"ENTWURF_CODEX_APP_SERVER_PID explicitly names the existing operator-owned app-server",
		/^[1-9]\d*$/.test(pidText),
	);
	const appServerPid = Number(pidText);
	const procDir = `/proc/${appServerPid}`;
	ok(
		"the explicit app-server PID names a currently inspectable Linux process",
		fs.existsSync(procDir),
		`missing ${procDir}`,
	);
	const procStat = fs.statSync(procDir);
	if (typeof process.getuid === "function") {
		ok("the named app-server process belongs to this operator", procStat.uid === process.getuid());
	}
	const argv = parseNulFile(path.join(procDir, "cmdline"));
	const codexArg = argv.some((arg) => /(^|\/)codex(?:\.js)?$/.test(arg) || arg.includes("@openai/codex"));
	ok(
		"the explicit PID argv is a Codex app-server, not a guessed Codex-related process",
		codexArg && argv.includes("app-server"),
		`argv=${JSON.stringify(argv)}`,
	);

	const procEnv = readProcessEnvironment(appServerPid);
	ok(
		"the app-server /proc environment carries its own absolute HOME",
		typeof procEnv.HOME === "string" && path.isAbsolute(procEnv.HOME),
		`HOME=${JSON.stringify(procEnv.HOME)}`,
	);
	ok(
		"the app-server /proc environment carries its own non-empty PATH",
		typeof procEnv.PATH === "string" && procEnv.PATH.length > 0,
		`PATH=${JSON.stringify(procEnv.PATH)}`,
	);
	// Reproduce only the app-server's environment. Release-shell values absent from /proc
	// cannot be borrowed into a claim about what a Codex MCP child inherits.
	appServerEnv = { ...procEnv };
	codexSocketPath = resolveCodexDefaultSocketPath(appServerEnv);
	const expectedListen = `unix://${codexSocketPath}`;
	const listensOnDefaultSocket = argv.some(
		(arg, index) => (arg === "--listen" && argv[index + 1] === expectedListen) || arg === `--listen=${expectedListen}`,
	);
	ok(
		"the explicit app-server PID owns the same default UDS the fresh Codex runtime will use",
		listensOnDefaultSocket,
		`expected --listen ${expectedListen}; argv=${JSON.stringify(argv)}`,
	);
	const appServerCoordinate = inspectTmuxCoordinate("Codex app-server/MCP inherited seat", appServerEnv);
	receipts["1-codex-app-server-mcp-coordinate"] =
		`pid=${appServerPid}\nargv=${argv.join(" ")}\nserver=${appServerCoordinate.serverPid}\n` +
		`session=${appServerCoordinate.sessionId}\nwindow=${appServerCoordinate.windowId}\npane=${appServerCoordinate.paneId}`;

	const codexModel = process.env.ENTWURF_CODEX_FRESH_MODEL?.trim() ?? "";
	const piModel = process.env.ENTWURF_CODEX_FRESH_PI_MODEL?.trim() ?? "";
	ok("ENTWURF_CODEX_FRESH_MODEL explicitly names the Codex runtime model", codexModel.length > 0);
	ok("ENTWURF_CODEX_FRESH_PI_MODEL explicitly names the Pi callback sibling model", piModel.length > 0);
	const codexRuntime = resolveExecutable("codex", appServerEnv);
	ok("the Codex runtime resolves on the app-server PATH", codexRuntime !== null);
	const bridgeRuntime = resolveExecutable("entwurf-bridge", appServerEnv);
	ok("the installed compiled entwurf-bridge resolves on the app-server PATH", bridgeRuntime !== null);

	const missing = await codexFreshPreflight(appServerEnv);
	ok(
		"the real installed Codex birth, MCP, visible identity, and default app-server preflight is green",
		missing === null,
		missing === null ? "" : `${missing}: ${CODEX_PREFLIGHT_HINT[missing]}`,
	);

	// The fixture and every bridge it talks to must resolve the same real stores the app-server
	// forwards into Codex MCP children. This is not an isolated lookalike store.
	for (const key of META_CONTEXT_ENV_KEYS) {
		const value = appServerEnv[key];
		if (typeof value === "string") process.env[key] = value;
		else delete process.env[key];
	}

	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-fresh-live-"));
	fixtureArtifacts.push(scratch);
	const nativeSessionId = `codex-fresh-live-fixture-${process.pid}-${Date.now()}`;
	const caller = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId, cwd: scratch },
	});
	const callerGid = caller.record.gardenId;
	fixtureGid = callerGid;
	const receiverMarker = writeMetaReceiverMarker({
		gardenId: callerGid,
		backend: "claude-code",
		nativeSessionId,
		ownerPid: process.pid,
		armProvenance: "session-start",
	});
	const senderMarker = writeMetaSenderMarker({
		backend: "claude-code",
		gardenId: callerGid,
		nativeSessionId,
		cwd: scratch,
		ownerPid: process.pid,
	});
	fixtureArtifacts.push(path.join(defaultMetaMailboxDir(), callerGid), receiverMarker, senderMarker, caller.path);
	ok("the original caller is a record-backed fixture on the app-server's real meta roots", GARDEN_ID.test(callerGid));

	const callerBridgeEnv: NodeJS.ProcessEnv = {
		...appServerEnv,
		ENTWURF_META_SENDER_MARKER: senderMarker,
	};
	delete callerBridgeEnv.ENTWURF_BRIDGE_NATIVE_HOST;
	delete callerBridgeEnv.PI_SESSION_ID;
	delete callerBridgeEnv.PI_AGENT_ID;
	bridge = new BridgeClient(bridgeRuntime, callerBridgeEnv);
	const tools = await bridge.initialize();
	ok(
		"the installed compiled bridge boots and exposes both public calls used by this acceptance",
		tools.includes("entwurf_fresh_call") && tools.includes("entwurf_v2"),
		`tools=${tools.join(",")}`,
	);

	const initialPiWaitToken = `INITIAL-PI-WAIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const initialPiLaunch = await bridge.call("entwurf_fresh_call", {
		backend: "pi",
		model: piModel,
		cwd: scratch,
		task:
			`After your required callback receipt, wait for one addressed message containing ${initialPiWaitToken}. ` +
			"That message is the only authority to open the Codex sibling.",
	});
	receipts["2-initial-pi-launch"] = initialPiLaunch.text;
	ok(
		"the record-backed fixture opened a real initial Pi caller through public entwurf_fresh_call",
		!initialPiLaunch.isError,
		`${initialPiLaunch.text}\nbridge stderr:\n${bridge.stderrTail()}`,
	);
	const initialPiNonce = /nonce:\s*(mux-fresh-call-[0-9a-f]+)/.exec(initialPiLaunch.text)?.[1] ?? "";
	const initialPiWindow = /window:\s+(@\d+)/.exec(initialPiLaunch.text)?.[1] ?? "";
	const initialPiTmuxSession = /window:\s+@\d+.*\bin session (\$\d+)/.exec(initialPiLaunch.text)?.[1] ?? "";
	ok("the initial Pi LAUNCH receipt carries a stable cleanup handle", WINDOW_ID.test(initialPiWindow));
	openedWindows.push(initialPiWindow);
	ok("the initial Pi LAUNCH receipt carries its exact callback nonce", initialPiNonce.length > 0);
	ok(
		"the initial Pi caller is visible in the app-server seat",
		initialPiTmuxSession === appServerCoordinate.sessionId,
		`initial-pi=${initialPiTmuxSession} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["3-initial-caller-pi-coordinate"] =
		`session=${initialPiTmuxSession}\nwindow=${initialPiWindow}\napp-server-session=${appServerCoordinate.sessionId}`;

	const drain = (): void => {
		for (const message of readMetaInbox({ gardenId: callerGid }).messages) seenInbox.push(message.body);
	};
	const initialPiCallback = await awaitOrRecover("the initial Pi exact nonce callback", CALLBACK_WAIT_MS, () => {
		drain();
		return seenInbox.find((body) => body.includes(initialPiNonce)) ?? null;
	});
	receipts["4-initial-pi-callback"] = initialPiCallback;
	const initialPiGid = /^\s*session:\s+(\S+)/m.exec(initialPiCallback)?.[1] ?? "";
	ok("the initial Pi callback carries the exact launch nonce", initialPiCallback.includes(initialPiNonce));
	ok("the initial Pi callback sender envelope supplies its garden address", GARDEN_ID.test(initialPiGid));
	const initialPiIdentity = readMetaIdentityByGardenId(initialPiGid);
	ok("the initial caller callback resolves to a real Pi V3 citizen", initialPiIdentity.backend === "pi");
	initialPiTranscript = initialPiIdentity.transcriptPath ?? "";

	const codexWaitToken = `CODEX-WAIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const codexLaunchToken = `PI-REPORTS-CODEX-LAUNCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const codexAddressedToken = `PI-REPORTS-CODEX-ADDRESSED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const outboundPiToken = `CODEX-REPORTS-PI-LAUNCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const finalToken = `CODEX-PI-FINAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const codexInstruction = buildCodexInstruction({
		waitToken: codexWaitToken,
		outboundPiToken,
		finalToken,
		callerGid,
		piModel,
		scratch,
	});

	// PHASE 1 — launch, correlate, forward, stop. The forwarded payload is the tail of this
	// message and nothing follows it: the report token below has not been transmitted yet, so
	// no sibling can emit it by copying text it was handed.
	const instructInitialPi = await bridge.call("entwurf_v2", {
		target: initialPiGid,
		intent: "fire-and-forget",
		message: buildInitialPiPhaseOne({
			initialPiWaitToken,
			codexWaitToken,
			launchToken: codexLaunchToken,
			callerGid,
			codexModel,
			scratch,
			codexInstruction,
		}),
	});
	receipts["5-fixture-to-initial-pi-v2"] = instructInitialPi.text;
	ok(
		"the fixture addressed the real initial Pi caller through an actual control-socket entwurf_v2 receipt",
		!instructInitialPi.isError &&
			/control-socket/i.test(instructInitialPi.text) &&
			/(?:sent|delivered)/i.test(instructInitialPi.text),
		instructInitialPi.text,
	);

	const codexLaunchBody = await awaitOrRecover(
		"the travelling Codex LAUNCH receipt from initial Pi",
		ROUND_TRIP_WAIT_MS,
		() => {
			drain();
			// Token AND sender, decided before the wait ends: a matching token from anyone but
			// the Pi we addressed is skipped, never returned and then asserted on.
			return selectReport(seenInbox, codexLaunchToken, initialPiGid);
		},
	);
	receipts["6-pi-to-fixture-codex-launch"] = codexLaunchBody;
	const codexLaunchReporter = /^\s*session:\s+(\S+)/m.exec(codexLaunchBody)?.[1] ?? "";
	const reportedCodexNonce = /CODEX_LAUNCH_NONCE=(mux-fresh-call-[0-9a-f]+)/.exec(codexLaunchBody)?.[1] ?? "";
	const reportedCodexSession = /CODEX_SESSION_ID=(\$\d+)/.exec(codexLaunchBody)?.[1] ?? "";
	const reportedCodexWindow = /CODEX_WINDOW_ID=(@\d+)/.exec(codexLaunchBody)?.[1] ?? "";
	const codexNonce = /^\s*nonce:\s*(mux-fresh-call-[0-9a-f]+)/m.exec(codexLaunchBody)?.[1] ?? "";
	const codexReceiptCoordinate = /^\s*window:\s+(@\d+).*?\bin session (\$\d+)/m.exec(codexLaunchBody);
	const codexWindow = codexReceiptCoordinate?.[1] ?? "";
	const codexLaunchSession = codexReceiptCoordinate?.[2] ?? "";
	ok("the Codex LAUNCH receipt travelled from the initial Pi citizen", codexLaunchReporter === initialPiGid);
	ok(
		"the travelling raw Codex LAUNCH receipt names Codex and a stable cleanup handle",
		WINDOW_ID.test(codexWindow) && /^\s*backend:\s+codex\b/m.test(codexLaunchBody),
	);
	openedWindows.push(codexWindow);
	ok(
		"the copied Codex fields match the travelling raw LAUNCH receipt",
		reportedCodexNonce === codexNonce &&
			reportedCodexSession === codexLaunchSession &&
			reportedCodexWindow === codexWindow,
	);
	ok("the raw Codex LAUNCH receipt carries its exact callback nonce", codexNonce.length > 0);
	ok(
		"fresh Codex was opened in the app-server/MCP inherited tmux session",
		codexLaunchSession === appServerCoordinate.sessionId,
		`codex=${codexLaunchSession} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["7-fresh-codex-coordinate"] = `session=${codexLaunchSession}\nwindow=${codexWindow}`;

	// Established by the Codex report below, and used by every later assertion — including the
	// final-body filter — so it is bound for the whole run rather than inside the wait.
	let codexGid = "";
	const outboundPiBody = await awaitOrRecover("Codex outbound fresh Pi LAUNCH receipt", ROUND_TRIP_WAIT_MS, () => {
		drain();
		// The FIRST report from a citizen whose garden id we do not know yet. The token narrows
		// the candidates; the backend decides acceptance, so the same token from a Pi sibling is
		// skipped instead of being adopted as the Codex address.
		const selected = selectReportByBackend(seenInbox, outboundPiToken, (gardenId) => {
			try {
				return readMetaIdentityByGardenId(gardenId).backend === "codex";
			} catch {
				return false;
			}
		});
		if (selected === null) return null;
		codexGid = selected.sender;
		// Cleanup authority BEFORE any assertion below can throw: this body carries the outbound
		// Pi window, and an assertion failure must not orphan it.
		for (const windowId of launchReceiptWindows(selected.body, "pi")) {
			if (!openedWindows.includes(windowId)) openedWindows.push(windowId);
		}
		return selected.body;
	});
	receipts["9-codex-to-fixture-outbound-pi-launch"] = outboundPiBody;
	const outboundReporter = /^\s*session:\s+(\S+)/m.exec(outboundPiBody)?.[1] ?? "";
	const reportedOutboundPiNonce = /PI_LAUNCH_NONCE=(mux-fresh-call-[0-9a-f]+)/.exec(outboundPiBody)?.[1] ?? "";
	const reportedOutboundPiSession = /PI_SESSION_ID=(\$\d+)/.exec(outboundPiBody)?.[1] ?? "";
	const reportedOutboundPiWindow = /PI_WINDOW_ID=(@\d+)/.exec(outboundPiBody)?.[1] ?? "";
	const outboundPiNonce = /^\s*nonce:\s*(mux-fresh-call-[0-9a-f]+)/m.exec(outboundPiBody)?.[1] ?? "";
	const outboundPiReceiptCoordinate = /^\s*window:\s+(@\d+).*?\bin session (\$\d+)/m.exec(outboundPiBody);
	const outboundPiWindow = outboundPiReceiptCoordinate?.[1] ?? "";
	const outboundPiSession = outboundPiReceiptCoordinate?.[2] ?? "";
	ok("the outbound Pi LAUNCH receipt came from a real Codex V3 citizen", outboundReporter === codexGid);
	const codexIdentity = readMetaIdentityByGardenId(codexGid);
	ok("the reporting Codex citizen resolves to a codex-backend record", codexIdentity.backend === "codex");
	codexThreadId = codexIdentity.nativeSessionId;
	// The VISIBLE half of admission, read from the live app-server — not from the birth
	// payload's intent, and not from screen text.
	const codexThread = await readCodexThread(codexSocketPath, codexThreadId, false);
	receipts["8b-codex-live-thread-title"] =
		`threadId=${codexThreadId}\nlive name=${JSON.stringify(codexThread.name)}\ngarden=${codexGid}`;
	ok(
		"the LIVE Codex thread's visible title IS its garden id (read back through the operator's app-server)",
		codexThread.name === codexGid,
		`thread/read name=${JSON.stringify(codexThread.name)} garden=${codexGid}`,
	);
	ok("the live thread the title was read from is the record's own thread", codexThread.id === codexThreadId);
	ok(
		"the travelling raw outbound Pi LAUNCH receipt names Pi and a stable cleanup handle",
		WINDOW_ID.test(outboundPiWindow) && /^\s*backend:\s+pi\b/m.test(outboundPiBody),
	);
	if (!openedWindows.includes(outboundPiWindow)) openedWindows.push(outboundPiWindow);
	ok(
		"the copied outbound Pi fields match the travelling raw LAUNCH receipt",
		reportedOutboundPiNonce === outboundPiNonce &&
			reportedOutboundPiSession === outboundPiSession &&
			reportedOutboundPiWindow === outboundPiWindow,
	);
	ok("the raw outbound Pi LAUNCH receipt carries its exact nonce", outboundPiNonce.length > 0);
	ok(
		"supported same-session deployment condition: fresh Codex, app-server/MCP inheritance, and outbound fresh Pi " +
			"resolve to ONE tmux session. This proves THAT deployment, not an unrestricted 'Codex 옆에 Pi' — Codex request " +
			"metadata carries no request→TUI-seat join, so N TUIs in other sessions behind one shared app-server stay uncovered",
		codexLaunchSession === appServerCoordinate.sessionId && outboundPiSession === appServerCoordinate.sessionId,
		`codex=${codexLaunchSession} app-server=${appServerCoordinate.sessionId} outbound-pi=${outboundPiSession}`,
	);
	receipts["10-outbound-fresh-pi-coordinate"] = `session=${outboundPiSession}\nwindow=${outboundPiWindow}`;

	// PHASE 2 — audit, not a product rail. The report token below has never been transmitted
	// until this call, and the Pi it goes to was told to stop after its forward. The product
	// chain (Pi -> Codex native-push, Codex -> Pi) already happened above.
	const requestPiReport = await bridge.call("entwurf_v2", {
		target: initialPiGid,
		intent: "fire-and-forget",
		message: buildInitialPiPhaseTwo({ reportToken: codexAddressedToken, callerGid }),
	});
	receipts["8-fixture-to-initial-pi-report-request"] = requestPiReport.text;
	ok(
		"the fixture asked the initial Pi for its own record of the addressed delivery",
		!requestPiReport.isError && /control-socket/i.test(requestPiReport.text),
		requestPiReport.text,
	);

	const codexAddressedBody = await awaitOrRecover(
		"the initial Pi's addressed-delivery report",
		ROUND_TRIP_WAIT_MS,
		() => {
			drain();
			return selectReport(seenInbox, codexAddressedToken, initialPiGid);
		},
	);
	receipts["8c-initial-pi-addressed-report"] = codexAddressedBody;
	const callbackNonce = /CODEX_CALLBACK_NONCE=(mux-fresh-call-[0-9a-f]+)/.exec(codexAddressedBody)?.[1] ?? "";
	const reportedCodexGid = /CODEX_CALLBACK_FROM=(\d{8}T\d{6}-[0-9a-f]{6})/.exec(codexAddressedBody)?.[1] ?? "";
	ok(
		"the initial Pi's report names the SAME Codex citizen the Codex report already established",
		reportedCodexGid === codexGid,
		`pi-reported=${reportedCodexGid} codex-established=${codexGid}`,
	);
	ok("initial Pi correlated the Codex callback to the exact Codex launch nonce", callbackNonce === codexNonce);
	ok(
		"initial Pi -> Codex used an actual native-push entwurf_v2 receipt",
		/native-push/i.test(codexAddressedBody) && /deliver/i.test(codexAddressedBody),
		codexAddressedBody,
	);

	const finalBody = await awaitOrRecover("Codex final exact-nonce Pi callback evidence", ROUND_TRIP_WAIT_MS, () => {
		drain();
		return selectReport(seenInbox, finalToken, codexGid);
	});
	receipts["11-codex-final-pi-callback-evidence"] = finalBody;
	const finalSender = /^\s*session:\s+(\S+)/m.exec(finalBody)?.[1] ?? "";
	const finalLaunchNonce = /PI_LAUNCH_NONCE=(mux-fresh-call-[0-9a-f]+)/.exec(finalBody)?.[1] ?? "";
	const finalCallbackNonce = /PI_CALLBACK_NONCE=(mux-fresh-call-[0-9a-f]+)/.exec(finalBody)?.[1] ?? "";
	const outboundPiGid = /PI_CALLBACK_FROM=(\d{8}T\d{6}-[0-9a-f]{6})/.exec(finalBody)?.[1] ?? "";
	const finalPiSession = /PI_SESSION_ID=(\$\d+)/.exec(finalBody)?.[1] ?? "";
	const finalWindow = /PI_WINDOW_ID=(@\d+)/.exec(finalBody)?.[1] ?? "";
	ok("the final evidence delivery came from the same Codex citizen", finalSender === codexGid);
	ok(
		"Codex reports the outbound Pi callback only when its callback nonce equals its LAUNCH nonce exactly",
		finalLaunchNonce === outboundPiNonce && finalCallbackNonce === outboundPiNonce,
		`launch=${outboundPiNonce} final-launch=${finalLaunchNonce} callback=${finalCallbackNonce}`,
	);
	ok(
		"the outbound fresh Pi callback names a new citizen, not the initial Pi or Codex",
		GARDEN_ID.test(outboundPiGid) && outboundPiGid !== initialPiGid && outboundPiGid !== codexGid,
	);
	ok("the final evidence preserves the exact outbound Pi session", finalPiSession === outboundPiSession);
	ok("the final evidence preserves the exact outbound Pi cleanup handle", finalWindow === outboundPiWindow);
	const outboundPiIdentity = readMetaIdentityByGardenId(outboundPiGid);
	ok("the outbound Pi callback address resolves to a real Pi V3 citizen", outboundPiIdentity.backend === "pi");
}

let failure: unknown = null;
try {
	await run();
} catch (error) {
	failure = error;
}
// Cleanup authority runs on EVERY exit, not only on a wait that timed out. The first real run
// failed inside an `ok()` and left a visible outbound Pi window alive, even though the handle
// was already sitting in the fixture's own mailbox: a launch receipt the Codex sibling had
// travelled to us. Recovery reads THAT — plus the two transcript authorities — and never scans
// tmux inventory or guesses a handle nobody recorded. Every stage is attempted even when an
// earlier stage itself throws; recovery trouble is evidence, never authority to skip cleanup.
const cleanupFailures = await runCleanupStages([
	{ label: "bridge", run: closeBridge },
	{ label: "recovery", run: recoverEveryRecordedWindow },
	{ label: "window", run: cleanupWindows },
	{ label: "fixture", run: cleanupFixture },
]);
printReceipts();
if (cleanupFailures.length > 0) {
	const cleanupError =
		`[${LABEL}] CLEANUP FAILURE — only recorded smoke-owned stable window ids and exact fixture artifacts were targeted:\n` +
		cleanupFailures.join("\n");
	console.error(cleanupError);
	failure = failure === null ? new Error(cleanupError) : new Error(`${String(failure)}\n${cleanupError}`);
}
if (failure !== null) {
	console.error(`[${LABEL}] FAIL: ${failure instanceof Error ? failure.message : String(failure)}`);
	process.exitCode = 1;
} else {
	console.log(
		`[${LABEL}] ${passed} assertions ok — fixture -> initial visible Pi -> visible Codex/exact callback -> Pi-addressed native-push v2 -> Codex outbound v2 -> visible Pi/exact callback`,
	);
}
