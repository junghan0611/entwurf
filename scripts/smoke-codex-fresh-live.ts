/**
 * First-admission LIVE acceptance for Codex visible fresh.
 *
 * The operator owns the existing exact `codex` tmux home and Codex app-server. This smoke neither
 * creates nor supervises them: an explicit ENTWURF_CODEX_APP_SERVER_PID names the already-running
 * process whose /proc environment must corroborate the home. It starts from a DIFFERENT caller
 * session; omitted Codex placement selects the home by exact name. The attached TUI pane is never guessed.
 *
 * RELEASE MUST once Codex is admitted. LIVE!=1 is the only host-prerequisite SKIP. With LIVE=1,
 * missing system birth, user MCP/status config, app-server, models, runtime, bridge, or tmux seat
 * is a FAIL. The smoke drives only public MCP calls, then joins Pi's native toolCall/toolResult
 * rows and Codex app-server thread events as receipt authority; screen text and model-reformatted
 * reports are never oracles.
 *
 * A record-backed self-fetch fixture opens a real visible Pi caller through public fresh_call.
 * That Pi opens Codex, correlates Codex's raw callback, and addresses Codex through v2. Codex then
 * opens outbound Pi, correlates that raw callback, and sends one final exact message that the
 * fixture must actually read.
 */

import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CODEX_PREFLIGHT_HINT, codexFreshPreflight } from "../pi-extensions/lib/codex-fresh-preflight.ts";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	metaRecordFilename,
	readMetaIdentityByGardenId,
	readMetaInbox,
	upsertMetaSession,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";
import { CODEX_HOME_TMUX_SESSION, FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
import {
	readCodexThread,
	realCodexProtocolOpener,
	resolveCodexDefaultSocketPath,
} from "../pi-extensions/lib/native-push/codex-ws-client.ts";
import {
	buildCodexInstruction,
	buildInitialPiPhaseOne,
	runCleanupStages,
	selectReport,
} from "./lib/codex-fresh-live-protocol.ts";
import {
	assertExactSourceToolCalls,
	assertSourceCallScopes,
	codexCallbackSenders,
	codexSourceToolReceipts,
	codexThreadIsTerminal,
	mailboxCallbacks,
	parseJsonLines,
	parseMetaMailboxBody,
	piCallbackSenders,
	piSourceToolReceipts,
	resolveSourceTranscriptPath,
	selectExactSourceToolReceipt,
	sourceCleanupWindows,
	validateFinalMailboxBody,
} from "./lib/codex-fresh-source-receipts.ts";
import { skipLive } from "./lib/live-skip.ts";
import { parseTmuxRow, TMUX_COORDINATE_FIELDS, TMUX_COORDINATE_FORMAT } from "./lib/tmux-coordinate-row.ts";

const LABEL = "smoke-codex-fresh-live";
const REPO = path.resolve(import.meta.dirname, "..");
const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const WINDOW_ID = /^@\d+$/;
const CALLBACK_WAIT_MS = 300_000;
// Source calls in accepted runs arrive in under a minute. Five minutes preserves cold-start room
// without repeating the old blind ten-minute model-report wait.
const SOURCE_WAIT_MS = 300_000;
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
let initialPiGardenId = "";
// Set once run() owns its evidence file, so a path resolved DURING a poll is recorded there too.
let recordEvidence: ((patch: Record<string, unknown>) => void) | null = null;
let codexLaunchNonce = "";
let codexThreadId = "";
let codexGardenId = "";
// Reachable from the EXIT path, not just from a wait: an assertion that throws must still be
// able to ask the fixture's own mailbox which windows this run opened.
let fixtureGid = "";
let evidenceDir = "";
const seenInbox: string[] = [];
const expectedReportTokens: string[] = [];
const relatedRecordPaths = new Set<string>();
const relatedTranscripts = new Set<string>();

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

async function preservePreCleanupEvidence(reason: unknown): Promise<string[]> {
	if (evidenceDir === "") return [];
	const failures: string[] = [];
	const snapshot = path.join(evidenceDir, "pre-cleanup-snapshot");
	try {
		fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
		fs.writeFileSync(
			path.join(snapshot, "reason.txt"),
			`${reason instanceof Error ? reason.stack : String(reason)}\n`,
			{
				mode: 0o600,
			},
		);
	} catch (snapshotError) {
		return [`failure evidence root: ${String(snapshotError)}`];
	}
	// Recovery is optional enrichment. A corrupt source is exactly when the raw files matter most,
	// so its failure is recorded but can never prevent the known sources below from being copied.
	try {
		recoverCodexThreadAuthority();
	} catch (recoveryError) {
		failures.push(`optional identity recovery: ${String(recoveryError)}`);
	}
	const sources = [
		...(fixtureGid === "" ? [] : [path.join(defaultMetaMailboxDir(), fixtureGid)]),
		...fixtureArtifacts,
		...relatedRecordPaths,
		...relatedTranscripts,
	];
	for (const [index, source] of sources.entries()) {
		if (!fs.existsSync(source)) {
			failures.push(`missing expected evidence source ${source}`);
			continue;
		}
		try {
			fs.cpSync(source, path.join(snapshot, `${String(index).padStart(2, "0")}-${path.basename(source)}`), {
				recursive: true,
			});
		} catch (copyError) {
			failures.push(`${source}: ${String(copyError)}`);
		}
	}
	if (codexThreadId !== "" && codexSocketPath !== "") {
		try {
			const thread = await readCodexThread(codexSocketPath, codexThreadId, true);
			fs.writeFileSync(path.join(snapshot, "codex-thread.json"), `${JSON.stringify(thread, null, 2)}\n`, {
				mode: 0o600,
			});
		} catch (threadError) {
			failures.push(`Codex thread ${codexThreadId}: ${String(threadError)}`);
		}
	}
	console.error(`  evidence  preserved pre-cleanup snapshot at ${snapshot}`);
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

function readInitialPiEntries(): unknown[] {
	const before = initialPiTranscript;
	initialPiTranscript = resolveSourceTranscriptPath(initialPiTranscript, () =>
		initialPiGardenId === "" ? "" : readMetaIdentityByGardenId(initialPiGardenId).transcriptPath,
	);
	if (initialPiTranscript !== before && initialPiTranscript !== "") {
		relatedTranscripts.add(initialPiTranscript);
		recordEvidence?.({ initialPiTranscript, initialPiTranscriptResolvedLate: true });
	}
	if (initialPiTranscript === "" || !fs.existsSync(initialPiTranscript)) return [];
	return parseJsonLines(fs.readFileSync(initialPiTranscript, "utf8"));
}

/** Exact joined fresh-call receipts from the initial Pi's own call/result rows. */
function readInitialPiFreshReceipts(backend: "codex" | "pi"): string[] {
	return piSourceToolReceipts(readInitialPiEntries())
		.filter(
			(receipt) =>
				receipt.toolName === "entwurf_fresh_call" &&
				!receipt.isError &&
				new RegExp(`^\\[entwurf fresh call →\\]\\n\\s*backend:\\s+${backend}\\b`, "m").test(receipt.text),
		)
		.map((receipt) => receipt.text);
}

/** The Codex window handle as the initial Pi caller's OWN transcript recorded its tool result. */
function recoverCodexWindows(): string[] {
	return sourceCleanupWindows(piSourceToolReceipts(readInitialPiEntries()));
}

/** Recover the exact launch nonce from the initial Pi's one raw Codex tool receipt. */
function recoverCodexLaunchNonce(): void {
	if (codexLaunchNonce !== "") return;
	const receipts = readInitialPiFreshReceipts("codex");
	if (receipts.length !== 1) return;
	codexLaunchNonce = /^\s*nonce:\s*(mux-fresh-call-[0-9a-f]+)/m.exec(receipts[0] ?? "")?.[1] ?? "";
}

/**
 * Recover the launched Codex thread from its exact nonce callback in the initial Pi transcript,
 * then validate that carrier through the V3 record authority. The ordinary and failure paths use
 * the same source-owned callback; model report prose has no identity role.
 */
function recoverCodexThreadAuthority(): void {
	recoverCodexLaunchNonce();
	if (codexThreadId !== "" || initialPiTranscript === "" || codexLaunchNonce === "") return;
	try {
		const senders = piCallbackSenders(readInitialPiEntries(), codexLaunchNonce);
		if (senders.length > 1) throw new Error(`duplicate exact Codex callbacks (${senders.length})`);
		const sender = senders[0];
		if (sender === undefined || !GARDEN_ID.test(sender)) return;
		const identity = readMetaIdentityByGardenId(sender);
		if (identity.backend !== "codex") return;
		codexGardenId = sender;
		codexThreadId = identity.nativeSessionId;
		relatedRecordPaths.add(path.join(defaultMetaSessionsDir(), metaRecordFilename(identity)));
		if (identity.transcriptPath != null) relatedTranscripts.add(identity.transcriptPath);
		console.error(`  recovered  Codex thread ${codexThreadId} from its exact nonce callback`);
		return;
	} catch {
		// The later cleanup stages still remove every stable window handle already recorded.
	}
}

/** The outbound Pi handle as the Codex thread's own mcpToolCall result recorded it. */
async function recoverOutboundPiWindows(): Promise<string[]> {
	if (codexThreadId === "" || codexSocketPath === "") return [];
	try {
		const thread = await readCodexThread(codexSocketPath, codexThreadId, true);
		return sourceCleanupWindows(codexSourceToolReceipts(thread));
	} catch {
		return [];
	}
}

/**
 * Wait for source evidence, and when it never comes, hand cleanup the exact handles the two
 * transcript authorities already hold before rethrowing. No tmux inventory scan and no guess:
 * a handle no joined fresh-call result recorded stays unrecovered.
 */
async function awaitOrRecover<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
	try {
		return await until(what, timeoutMs, probe);
	} catch (error) {
		recoverCodexThreadAuthority();
		for (const windowId of [...recoverCodexWindows(), ...(await recoverOutboundPiWindows())]) {
			if (openedWindows.includes(windowId)) continue;
			openedWindows.push(windowId);
			console.error(`  recovered  ${windowId} from its own receipt authority after: ${what}`);
		}
		// A source that never appeared leaves no cleanup authority, and mailbox prose or a tmux
		// listing must not be promoted into one. Name the state instead of leaking it silently.
		if (initialPiTranscript === "") {
			const unrecoverable = "initial Pi record still carries no transcriptPath; no unverified child window killed";
			console.error(`  cleanup  ${unrecoverable}`);
			recordEvidence?.({ sourcePathUnresolved: unrecoverable });
		}
		throw error;
	}
}

/**
 * Every stable window handle the initial Pi or Codex source transcript recorded in an exact
 * fresh-call tool result. Mailbox prose is diagnostic evidence, never cleanup authority.
 */
async function recoverEveryRecordedWindow(): Promise<void> {
	recoverCodexThreadAuthority();
	const found = [...recoverCodexWindows(), ...(await recoverOutboundPiWindows())];
	for (const windowId of found) {
		if (!WINDOW_ID.test(windowId) || openedWindows.includes(windowId)) continue;
		openedWindows.push(windowId);
		console.error(`  recovered  ${windowId} from a receipt this run already held`);
	}
}

/**
 * Interrupt only this smoke's exact still-running Codex turn before its visible window closes.
 * `[source]` rust-v0.153.4 `app-server-protocol/src/protocol/v2/turn.rs:311-319` owns
 * `{threadId,turnId}` and the empty acknowledgement; no app-server lifecycle is touched here.
 */
async function interruptCodexSmokeTurn(): Promise<string[]> {
	if (codexThreadId === "" || codexSocketPath === "") return [];
	try {
		const thread = (await readCodexThread(codexSocketPath, codexThreadId, true)) as {
			turns?: Array<{ id?: unknown; status?: unknown }>;
		};
		const turn = [...(thread.turns ?? [])].reverse().find((candidate) => candidate.status === "inProgress");
		if (typeof turn?.id !== "string" || turn.id === "") return [];
		const protocol = await realCodexProtocolOpener.open(codexSocketPath);
		try {
			await protocol.request("initialize", {
				clientInfo: { name: "entwurf-codex-live-cleanup", title: "entwurf-codex-live-cleanup", version: "0" },
				capabilities: { experimentalApi: true, requestAttestation: false },
			});
			protocol.notify("initialized");
			await protocol.request("turn/interrupt", { threadId: codexThreadId, turnId: turn.id });
		} finally {
			protocol.close();
		}
		console.error(`  cleanup  interrupted smoke-owned Codex turn ${turn.id}`);
		return [];
	} catch (error) {
		return [`codex turn ${codexThreadId}: ${String(error)}`];
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

async function untilAsync<T>(what: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await probe();
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
	const fixtureCoordinate = inspectTmuxCoordinate("fixture/initial-Pi caller seat", process.env);
	ok(
		"the fixture/initial-Pi seat and Codex home share one tmux server but are different sessions",
		fixtureCoordinate.serverPid === appServerCoordinate.serverPid &&
			fixtureCoordinate.sessionId !== appServerCoordinate.sessionId,
		`fixture=${fixtureCoordinate.serverPid}/${fixtureCoordinate.sessionId} app-server=${appServerCoordinate.serverPid}/${appServerCoordinate.sessionId}`,
	);
	receipts["1-codex-app-server-mcp-coordinate"] =
		`pid=${appServerPid}\nargv=${argv.join(" ")}\nserver=${appServerCoordinate.serverPid}\n` +
		`session=${appServerCoordinate.sessionId}\nwindow=${appServerCoordinate.windowId}\npane=${appServerCoordinate.paneId}\n` +
		`fixture-session=${fixtureCoordinate.sessionId}\nfixture-window=${fixtureCoordinate.windowId}`;

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
	fs.mkdirSync(path.join(REPO, ".probe-artifacts"), { recursive: true, mode: 0o700 });
	evidenceDir = fs.mkdtempSync(path.join(REPO, ".probe-artifacts", "codex-fresh-live-"));
	fs.chmodSync(evidenceDir, 0o700);
	console.log(`  evidence  ${evidenceDir}`);
	const nativeSessionId = `codex-fresh-live-fixture-${process.pid}-${Date.now()}`;
	const caller = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId, cwd: scratch },
	});
	const callerGid = caller.record.gardenId;
	fixtureGid = callerGid;
	relatedRecordPaths.add(caller.path);
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
	const evidenceManifest: Record<string, unknown> = {
		runPid: process.pid,
		scratch,
		appServerPid,
		appServerCoordinate,
		fixtureCoordinate,
		fixtureGardenId: callerGid,
		fixtureRecordPath: caller.path,
		resolvedRoots: Object.fromEntries(META_CONTEXT_ENV_KEYS.map((key) => [key, appServerEnv?.[key] ?? null])),
		resolvedMetaSessionsDir: defaultMetaSessionsDir(),
		resolvedMetaMailboxDir: defaultMetaMailboxDir(),
	};
	const writeEvidenceManifest = (patch: Record<string, unknown>): void => {
		Object.assign(evidenceManifest, patch);
		fs.writeFileSync(path.join(evidenceDir, "run-manifest.json"), `${JSON.stringify(evidenceManifest, null, 2)}\n`, {
			mode: 0o600,
		});
	};
	recordEvidence = writeEvidenceManifest;
	writeEvidenceManifest({ phase: "fixture-ready" });
	ok("the original caller is a record-backed fixture on the app-server's real meta roots", GARDEN_ID.test(callerGid));

	const callerBridgeEnv: NodeJS.ProcessEnv = {
		...appServerEnv,
		// The fixture launches the initial Pi from THIS operator session, not from Codex's
		// app-server seat. Store/runtime facts come from the app-server environment above;
		// only placement comes from the fixture's own exact tmux anchor.
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
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
			`After your required callback receipt, end the turn and wait passively for one addressed message containing ${initialPiWaitToken}. ` +
			"That message is the only authority to open the Codex sibling. Do not call shell, sleep, terminal, or any tool to wait.",
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
		"the initial Pi caller is visible in the fixture's non-Codex session",
		initialPiTmuxSession === fixtureCoordinate.sessionId && initialPiTmuxSession !== appServerCoordinate.sessionId,
		`initial-pi=${initialPiTmuxSession} fixture=${fixtureCoordinate.sessionId} codex-home=${appServerCoordinate.sessionId}`,
	);
	receipts["3-initial-caller-pi-coordinate"] =
		`session=${initialPiTmuxSession}\nwindow=${initialPiWindow}\ncodex-home-session=${appServerCoordinate.sessionId}`;

	let drainedCount = 0;
	const drain = (): void => {
		for (const message of readMetaInbox({ gardenId: callerGid }).messages) {
			const index = String(++drainedCount).padStart(3, "0");
			const bodyFile = path.join(evidenceDir, `mailbox-${index}.txt`);
			fs.writeFileSync(bodyFile, message.body, { mode: 0o600 });
			const parsed = parseMetaMailboxBody(message.body);
			const matchingTokens = expectedReportTokens.filter((token) => message.body.includes(token));
			const observedTokens = message.body.match(/\b(?:INITIAL-PI-WAIT|CODEX-WAIT|CODEX-PI-FINAL)-[A-Z0-9]+\b/g) ?? [];
			const observation = {
				kind: "candidate",
				file: message.file,
				bytes: Buffer.byteLength(message.body),
				sha256: createHash("sha256").update(message.body).digest("hex"),
				sender: parsed?.sender ?? null,
				matchingTokens,
				observedTokens,
				bodyArtifact: path.basename(bodyFile),
			};
			fs.appendFileSync(path.join(evidenceDir, "mailbox-observations.jsonl"), `${JSON.stringify(observation)}\n`, {
				mode: 0o600,
			});
			seenInbox.push(message.body);
		}
	};
	const recordMailboxSelection = (phase: string, body: string, selected: boolean, reason: string): void => {
		const parsed = parseMetaMailboxBody(body);
		fs.appendFileSync(
			path.join(evidenceDir, "mailbox-selections.jsonl"),
			`${JSON.stringify({
				phase,
				sha256: createHash("sha256").update(body).digest("hex"),
				sender: parsed?.sender ?? null,
				selected,
				reason,
			})}\n`,
			{ mode: 0o600 },
		);
	};
	const initialPiCallback = await awaitOrRecover("the initial Pi exact nonce callback", CALLBACK_WAIT_MS, () => {
		drain();
		const matching = mailboxCallbacks(seenInbox, initialPiNonce);
		if (matching.length > 1) throw new Error(`duplicate exact initial Pi callbacks (${matching.length})`);
		return matching[0] ?? null;
	});
	for (const body of seenInbox) {
		recordMailboxSelection(
			"initial-pi-callback",
			body,
			body === initialPiCallback.body,
			body === initialPiCallback.body
				? "selected: exact outer frame, nonce, and sender"
				: "excluded: not the exact callback",
		);
	}
	receipts["4-initial-pi-callback"] = initialPiCallback.body;
	const initialPiGid = initialPiCallback.sender;
	ok(
		"the initial Pi callback carries the exact launch nonce",
		mailboxCallbacks([initialPiCallback.body], initialPiNonce).length === 1,
	);
	ok("the initial Pi callback sender envelope supplies its garden address", GARDEN_ID.test(initialPiGid));
	const initialPiIdentity = readMetaIdentityByGardenId(initialPiGid);
	ok("the initial caller callback resolves to a real Pi V3 citizen", initialPiIdentity.backend === "pi");
	relatedRecordPaths.add(path.join(defaultMetaSessionsDir(), metaRecordFilename(initialPiIdentity)));
	initialPiGardenId = initialPiGid;
	initialPiTranscript = initialPiIdentity.transcriptPath ?? "";
	if (initialPiTranscript !== "") relatedTranscripts.add(initialPiTranscript);
	writeEvidenceManifest({
		phase: "initial-pi-correlated",
		initialPiGardenId: initialPiGid,
		initialPiTranscript,
		initialPiRecordPath: path.join(defaultMetaSessionsDir(), metaRecordFilename(initialPiIdentity)),
	});

	const codexWaitToken = `CODEX-WAIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	const finalToken = `CODEX-PI-FINAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
	expectedReportTokens.push(finalToken);
	const outboundPiTask = "After your automatic callback succeeds, answer ACK and stop. Do not open another sibling.";
	const codexTask =
		`After your required callback receipt, end the turn and wait passively for the addressed instruction containing ${codexWaitToken}. ` +
		"Do not call shell, sleep, terminal, or any tool to wait.";
	const codexInstruction = buildCodexInstruction({
		waitToken: codexWaitToken,
		finalToken,
		callerGid,
		piModel,
		scratch,
	});
	const initialPiInstruction = buildInitialPiPhaseOne({
		initialPiWaitToken,
		codexWaitToken,
		codexModel,
		scratch,
		codexInstruction,
	});

	// The model is asked to operate public tools, but every launch and delivery assertion below
	// joins the harness's source-owned call arguments to its native result. Model reports are not
	// coordinates and never enter the cleanup allowlist.
	const instructInitialPi = await bridge.call("entwurf_v2", {
		target: initialPiGid,
		intent: "fire-and-forget",
		message: initialPiInstruction,
	});
	receipts["5-fixture-to-initial-pi-v2"] = instructInitialPi.text;
	ok(
		"the fixture addressed the real initial Pi caller through an actual control-socket entwurf_v2 receipt",
		!instructInitialPi.isError &&
			/control-socket/i.test(instructInitialPi.text) &&
			/(?:sent|delivered)/i.test(instructInitialPi.text),
		instructInitialPi.text,
	);

	const piFreshReceipt = await awaitOrRecover("the initial Pi source-owned Codex LAUNCH receipt", SOURCE_WAIT_MS, () =>
		selectExactSourceToolReceipt(
			piSourceToolReceipts(readInitialPiEntries()),
			"entwurf_fresh_call",
			{ backend: "codex", model: codexModel, cwd: scratch, task: codexTask },
			"initial Pi Codex fresh call",
		),
	);
	const codexLaunchReceipt = piFreshReceipt.text;
	receipts["6-initial-pi-source-codex-launch"] = codexLaunchReceipt;
	const codexNonce = /^\s*nonce:\s*(mux-fresh-call-[0-9a-f]+)/m.exec(codexLaunchReceipt)?.[1] ?? "";
	codexLaunchNonce = codexNonce;
	const codexReceiptCoordinate = /^\s*window:\s+(@\d+).*?\bin session (\$\d+)/m.exec(codexLaunchReceipt);
	const codexWindow = codexReceiptCoordinate?.[1] ?? "";
	const codexLaunchSession = codexReceiptCoordinate?.[2] ?? "";
	ok(
		"the initial Pi's joined source receipt names Codex and a stable cleanup handle",
		WINDOW_ID.test(codexWindow) && /^\s*backend:\s+codex\b/m.test(codexLaunchReceipt),
	);
	if (!openedWindows.includes(codexWindow)) openedWindows.push(codexWindow);
	ok("the source-owned Codex LAUNCH receipt carries its exact callback nonce", codexNonce.length > 0);
	ok(
		"omitted placement opened fresh Codex in exact named `codex` home, resolved to the app-server session",
		codexLaunchSession === appServerCoordinate.sessionId &&
			codexLaunchReceipt.includes(
				`seat:     ${CODEX_HOME_TMUX_SESSION} (Codex home tmux session, resolved to ${appServerCoordinate.sessionId})`,
			),
		`codex=${codexLaunchSession} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["7-fresh-codex-coordinate"] = `session=${codexLaunchSession}\nwindow=${codexWindow}`;

	const codexCallbackSender = await awaitOrRecover(
		"the exact Codex callback in initial Pi source",
		CALLBACK_WAIT_MS,
		() => {
			const senders = piCallbackSenders(readInitialPiEntries(), codexNonce);
			if (senders.length > 1) throw new Error(`duplicate exact Codex callbacks (${senders.length})`);
			return senders[0] ?? null;
		},
	);
	ok("the Codex callback sender envelope supplies its garden address", GARDEN_ID.test(codexCallbackSender));
	const codexIdentity = readMetaIdentityByGardenId(codexCallbackSender);
	ok("the callback-derived citizen resolves to a real Codex V3 citizen", codexIdentity.backend === "codex");
	codexGardenId = codexCallbackSender;
	codexThreadId = codexIdentity.nativeSessionId;
	relatedRecordPaths.add(path.join(defaultMetaSessionsDir(), metaRecordFilename(codexIdentity)));
	if (codexIdentity.transcriptPath != null) relatedTranscripts.add(codexIdentity.transcriptPath);
	writeEvidenceManifest({
		phase: "codex-correlated",
		codexGardenId,
		codexThreadId,
		codexRecordPath: path.join(defaultMetaSessionsDir(), metaRecordFilename(codexIdentity)),
	});
	receipts["8-initial-pi-source-codex-callback"] =
		`nonce=${codexNonce}\ngarden=${codexGardenId}\nthread=${codexThreadId}`;

	const initialPiToCodex = await awaitOrRecover("the initial Pi joined native-push receipt", SOURCE_WAIT_MS, () => {
		const piSources = piSourceToolReceipts(readInitialPiEntries());
		assertSourceCallScopes(piSources, "entwurf_v2", "target", [callerGid, codexGardenId], "initial Pi v2 roles");
		return selectExactSourceToolReceipt(
			piSources,
			"entwurf_v2",
			{
				target: codexGardenId,
				intent: "fire-and-forget",
				wants_reply: false,
				message: codexInstruction,
			},
			"initial Pi addressed Codex call",
		);
	});
	ok(
		"initial Pi -> Codex used an actual joined native-push entwurf_v2 receipt",
		initialPiToCodex.text === "entwurf_v2 native-push → delivered",
		initialPiToCodex.text,
	);
	receipts["9-initial-pi-source-native-push"] = initialPiToCodex.text;

	let codexThread = await readCodexThread(codexSocketPath, codexThreadId, true);
	writeEvidenceManifest({
		phase: "codex-thread-read",
		codexThreadPath: (codexThread as { path?: unknown }).path ?? null,
	});
	receipts["10-codex-live-thread-title"] =
		`threadId=${codexThreadId}\nlive name=${JSON.stringify(codexThread.name)}\ngarden=${codexGardenId}`;
	ok(
		"the LIVE Codex thread's visible title IS its garden id (read back through the operator's app-server)",
		codexThread.name === codexGardenId,
		`thread/read name=${JSON.stringify(codexThread.name)} garden=${codexGardenId}`,
	);
	ok("the live thread the title was read from is the record's own thread", codexThread.id === codexThreadId);

	const codexPiFreshReceipt = await untilAsync(
		"the Codex thread source-owned outbound Pi LAUNCH receipt",
		SOURCE_WAIT_MS,
		async () => {
			codexThread = await readCodexThread(codexSocketPath, codexThreadId, true);
			return selectExactSourceToolReceipt(
				codexSourceToolReceipts(codexThread),
				"entwurf_fresh_call",
				{ backend: "pi", model: piModel, cwd: scratch, task: outboundPiTask },
				"Codex outbound Pi fresh call",
			);
		},
	);
	const outboundPiReceipt = codexPiFreshReceipt.text;
	receipts["11-codex-source-outbound-pi-launch"] = outboundPiReceipt;
	const outboundPiNonce = /^\s*nonce:\s*(mux-fresh-call-[0-9a-f]+)/m.exec(outboundPiReceipt)?.[1] ?? "";
	const outboundPiReceiptCoordinate = /^\s*window:\s+(@\d+).*?\bin session (\$\d+)/m.exec(outboundPiReceipt);
	const outboundPiWindow = outboundPiReceiptCoordinate?.[1] ?? "";
	const outboundPiSession = outboundPiReceiptCoordinate?.[2] ?? "";
	ok(
		"the Codex thread's joined source receipt names Pi and a stable cleanup handle",
		WINDOW_ID.test(outboundPiWindow) && /^\s*backend:\s+pi\b/m.test(outboundPiReceipt),
	);
	if (!openedWindows.includes(outboundPiWindow)) openedWindows.push(outboundPiWindow);
	ok("the source-owned outbound Pi LAUNCH receipt carries its exact nonce", outboundPiNonce.length > 0);
	ok(
		"supported Codex-home topology: a Pi in another session opens Codex in exact home; Codex opens outbound Pi " +
			"beside itself and the operator-owned app-server. This does not claim arbitrary attached-TUI seat inference",
		initialPiTmuxSession !== appServerCoordinate.sessionId &&
			codexLaunchSession === appServerCoordinate.sessionId &&
			outboundPiSession === appServerCoordinate.sessionId,
		`initial-pi=${initialPiTmuxSession} codex=${codexLaunchSession} app-server=${appServerCoordinate.sessionId} outbound-pi=${outboundPiSession}`,
	);
	receipts["12-outbound-fresh-pi-coordinate"] = `session=${outboundPiSession}\nwindow=${outboundPiWindow}`;

	const outboundPiGid = await untilAsync(
		"the exact outbound Pi callback in Codex source",
		CALLBACK_WAIT_MS,
		async () => {
			codexThread = await readCodexThread(codexSocketPath, codexThreadId, true);
			const senders = codexCallbackSenders(codexThread, outboundPiNonce);
			if (senders.length > 1) throw new Error(`duplicate exact outbound Pi callbacks (${senders.length})`);
			return senders[0] ?? null;
		},
	);
	ok(
		"the outbound fresh Pi callback names a new citizen, not the initial Pi or Codex",
		GARDEN_ID.test(outboundPiGid) && outboundPiGid !== initialPiGid && outboundPiGid !== codexGardenId,
	);
	const outboundPiIdentity = readMetaIdentityByGardenId(outboundPiGid);
	ok("the outbound Pi callback address resolves to a real Pi V3 citizen", outboundPiIdentity.backend === "pi");
	relatedRecordPaths.add(path.join(defaultMetaSessionsDir(), metaRecordFilename(outboundPiIdentity)));
	if (outboundPiIdentity.transcriptPath != null) relatedTranscripts.add(outboundPiIdentity.transcriptPath);
	writeEvidenceManifest({
		phase: "outbound-pi-correlated",
		outboundPiGardenId: outboundPiGid,
		outboundPiRecordPath: path.join(defaultMetaSessionsDir(), metaRecordFilename(outboundPiIdentity)),
		outboundPiTranscript: outboundPiIdentity.transcriptPath ?? null,
	});
	receipts["13-codex-source-outbound-pi-callback"] = `nonce=${outboundPiNonce}\ngarden=${outboundPiGid}`;

	const expectedFinalMessage =
		`${finalToken}\nPI_LAUNCH_NONCE=${outboundPiNonce}\nPI_CALLBACK_NONCE=${outboundPiNonce}\n` +
		`PI_CALLBACK_FROM=${outboundPiGid}\nPI_SESSION_ID=${outboundPiSession}\nPI_WINDOW_ID=${outboundPiWindow}`;
	const codexFinalReceipt = await untilAsync("the Codex joined final mailbox receipt", SOURCE_WAIT_MS, async () => {
		codexThread = await readCodexThread(codexSocketPath, codexThreadId, true);
		const codexSources = codexSourceToolReceipts(codexThread);
		assertSourceCallScopes(codexSources, "entwurf_v2", "target", [initialPiGid, callerGid], "Codex v2 roles");
		return selectExactSourceToolReceipt(
			codexSources,
			"entwurf_v2",
			{ target: callerGid, intent: "fire-and-forget", wants_reply: false, message: expectedFinalMessage },
			"Codex final fixture call",
		);
	});
	ok(
		"Codex -> fixture used an actual joined meta-mailbox entwurf_v2 receipt",
		/^entwurf_v2 meta-mailbox → enqueued \([^\n]+\.msg\)$/.test(codexFinalReceipt.text),
		codexFinalReceipt.text,
	);
	receipts["14-codex-source-final-mailbox"] = codexFinalReceipt.text;

	const finalBody = await awaitOrRecover(
		"the fixture read Codex's final exact source message",
		CALLBACK_WAIT_MS,
		() => {
			drain();
			return selectReport(seenInbox, finalToken, codexGardenId);
		},
	);
	for (const body of seenInbox) {
		recordMailboxSelection(
			"codex-final-candidate",
			body,
			body === finalBody,
			body === finalBody
				? "candidate selected: exact token and sender; body validation pending"
				: "candidate excluded: token or sender differs",
		);
	}
	receipts["15-fixture-read-codex-final"] = finalBody;
	const finalValidation = validateFinalMailboxBody(finalBody, codexGardenId, expectedFinalMessage);
	recordMailboxSelection("codex-final-validation", finalBody, finalValidation.accepted, finalValidation.reason);
	ok(
		"the fixture read one exact outer-framed final message from the same Codex citizen",
		finalValidation.parsed?.sender === codexGardenId,
	);
	ok(
		"the fixture mailbox payload exactly equals the source-validated Codex call argument",
		finalValidation.accepted,
		`expected=${JSON.stringify(expectedFinalMessage)}\nactual=${JSON.stringify(finalValidation.parsed?.payload)}`,
	);

	// Final audit closes the race left by polling a completed subset. Codex's final tool result can
	// precede turn completion, so wait for the app-server's own terminal turn state before recounting.
	codexThread = await untilAsync("the Codex final turn to become terminal", SOURCE_WAIT_MS, async () => {
		const observed = await readCodexThread(codexSocketPath, codexThreadId, true);
		return codexThreadIsTerminal(observed) ? observed : null;
	});
	assertExactSourceToolCalls(
		piSourceToolReceipts(readInitialPiEntries()),
		[
			{
				toolName: "entwurf_v2",
				arguments: {
					target: callerGid,
					intent: "fire-and-forget",
					message: initialPiNonce,
					wants_reply: false,
				},
			},
			{
				toolName: "entwurf_fresh_call",
				arguments: { backend: "codex", model: codexModel, cwd: scratch, task: codexTask },
			},
			{
				toolName: "entwurf_v2",
				arguments: {
					target: codexGardenId,
					intent: "fire-and-forget",
					wants_reply: false,
					message: codexInstruction,
				},
			},
		],
		"initial Pi final exact-once audit",
	);
	assertExactSourceToolCalls(
		codexSourceToolReceipts(codexThread),
		[
			{
				toolName: "entwurf_v2",
				arguments: {
					target: initialPiGid,
					intent: "fire-and-forget",
					wants_reply: false,
					message: codexNonce,
				},
			},
			{
				toolName: "entwurf_fresh_call",
				arguments: { backend: "pi", model: piModel, cwd: scratch, task: outboundPiTask },
			},
			{
				toolName: "entwurf_v2",
				arguments: {
					target: callerGid,
					intent: "fire-and-forget",
					wants_reply: false,
					message: expectedFinalMessage,
				},
			},
		],
		"Codex final exact-once audit",
	);
	receipts["16-source-final-audit"] = "initial-pi=3/3 completed exact\ncodex=3/3 completed exact";
}

let failure: unknown = null;
try {
	await run();
} catch (error) {
	failure = error;
}
// Cleanup authority runs on EVERY exit, not only on a wait that timed out. Only joined source
// fresh-call receipts may add stable handles to the allowlist; mailbox prose is preserved as
// diagnostic evidence but never authorizes a kill. Every stage is attempted even when an earlier
// stage throws. A mandatory snapshot is copied after source recovery and before any destructive
// turn/window/fixture cleanup, so cleanup-only failures cannot erase their own evidence.
const cleanupFailures = await runCleanupStages([
	{ label: "bridge", run: closeBridge },
	{ label: "recovery", run: recoverEveryRecordedWindow },
	{
		label: "evidence",
		run: () => preservePreCleanupEvidence(failure ?? "run succeeded; mandatory pre-cleanup evidence checkpoint"),
	},
	{ label: "codex-turn", run: interruptCodexSmokeTurn },
	{ label: "window", run: cleanupWindows },
	{ label: "fixture", run: cleanupFixture },
]);
printReceipts();
if (cleanupFailures.length > 0) {
	const cleanupError =
		`[${LABEL}] CLEANUP FAILURE — only the exact smoke-owned Codex turn, recorded stable window ids, and exact fixture artifacts were targeted:\n` +
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
