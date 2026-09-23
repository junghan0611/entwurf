/**
 * First-admission LIVE acceptance for Codex visible fresh — reshaped for the #95 lane B caller
 * seat.
 *
 * The operator owns the Codex app-server and the tmux session it sits in (#95 D1 retired the fixed
 * `codex` home). This smoke neither creates nor supervises them: an explicit
 * ENTWURF_CODEX_APP_SERVER_PID names the already-running process whose /proc environment must
 * corroborate its seat. The attached TUI pane is never guessed.
 *
 * ── THE TOPOLOGY, AND WHY IT IS DELIBERATELY SPLIT (#95 lane B) ──
 *
 * Four coordinates on ONE tmux server, in TWO sessions:
 *
 *   A = wherever the operator started their app-server, and it must NOT be S. This is the
 *       session the app-server's inherited `TMUX` names — the value a Codex MCP child would
 *       fall back to. Its NAME does not matter: #95 D1 retired the fixed `codex` home, so the
 *       operator seats the app-server wherever they like and Entwurf never asks which room.
 *   S = the fixture's own session. The initial Pi caller opens here.
 *
 *   initial Pi   → S   (the fixture's own seat)
 *   fresh Codex  → S   (hop 1, omitted placement: the caller's own session)
 *   outbound Pi  → S   (hop 2, omitted placement — and this is the claim)
 *
 * Hop 2 is the whole point. Its seat is decided by the Codex caller's own pane title
 * (`codex-title-anchor`), and the proof is that it lands in S: the app-server's environment
 * points at A, so an env fallback — the pre-#95 behaviour — would have put it there. S is
 * reachable only through the anchor. A receipt that says `codex-title-anchor` AND a session
 * that is not A are two independent halves of the same claim, and both are asserted.
 *
 * A ≠ S is therefore a PRECONDITION of this card, not a convenience: run it with the app-server
 * in the fixture's own session and hop 2 proves nothing, because both rules would answer S.
 *
 * RELEASE MUST once Codex is admitted. LIVE!=1 is the only host-prerequisite SKIP. With LIVE=1,
 * missing system birth, user MCP/status/terminal-title config, app-server, models, runtime,
 * bridge, or tmux seat is a FAIL. The smoke drives only public MCP calls, then joins Pi's native
 * toolCall/toolResult rows and Codex app-server thread events as receipt authority; screen text
 * and model-reformatted reports are never oracles.
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
import {
	CODEX_CALLER_PREFLIGHT_HINT,
	CODEX_LAUNCH_CWD_PREFLIGHT_HINT,
	CODEX_PREFLIGHT_HINT,
	codexCallerFreshPreflight,
	codexFreshPreflight,
	codexLaunchCwdFreshPreflight,
} from "../pi-extensions/lib/codex-fresh-preflight.ts";
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
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
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

/**
 * The session NAME behind a coordinate. Read on its own rather than added to the shared
 * `TMUX_COORDINATE_FORMAT`: that row's field count is a pinned contract with its own
 * deterministic oracle, and this card needs a name for exactly two reasons — to hand the fresh
 * hand the fresh call a seat it can address, and to record which rooms A and S actually were.
 */
function tmuxSessionName(label: string, env: NodeJS.ProcessEnv, paneId: string): string {
	const inspected = spawnSync("tmux", ["display-message", "-p", "-t", paneId, "#{session_name}"], {
		env,
		encoding: "utf8",
	});
	ok(
		`${label} session name answers through its own environment`,
		inspected.status === 0,
		String(inspected.stderr ?? ""),
	);
	const name = String(inspected.stdout ?? "").replace(/\r?\n$/, "");
	ok(`${label} session name is non-empty`, name.length > 0, `name=${JSON.stringify(name)}`);
	return name;
}

/**
 * The DIRECTORY behind a pane, read from tmux itself. Its own reader for the same reason the
 * session name has one: this card needs it for exactly one claim (#95 lane C — where a sibling
 * actually started), and the pinned coordinate row stays a fixed field count.
 *
 * `[측정 2026-09-16]` this value is read from the child's `/proc` at QUERY time and tmux chdirs
 * in that child AFTER forking it, so a read taken in the same millisecond as a launch can still
 * answer the SERVER's directory. Every call here happens after that citizen's own callback has
 * already arrived, which is long past exec — the deterministic gate that reads it straight after
 * a launch is the one that has to wait (`scripts/check-mux-launch-tmux.ts`).
 */
function tmuxPaneCwd(label: string, env: NodeJS.ProcessEnv, paneId: string): string {
	const inspected = spawnSync("tmux", ["display-message", "-p", "-t", paneId, "#{pane_current_path}"], {
		env,
		encoding: "utf8",
	});
	ok(
		`${label} pane directory answers through its own environment`,
		inspected.status === 0,
		String(inspected.stderr ?? ""),
	);
	const dir = String(inspected.stdout ?? "").replace(/\r?\n$/, "");
	ok(`${label} pane directory is non-empty`, dir.length > 0, `cwd=${JSON.stringify(dir)}`);
	return dir;
}

/** A live process's own working directory, read from the kernel rather than from any report. */
function processCwd(pid: number): string {
	return fs.readlinkSync(`/proc/${pid}/cwd`);
}

/** The `session_meta` header of a Codex rollout — the VENDOR's own record of where a thread opened. */
function rolloutSessionMetaCwd(transcriptPath: string): string {
	const first = fs.readFileSync(transcriptPath, "utf8").split("\n", 1)[0] ?? "";
	const row = JSON.parse(first) as { type?: unknown; payload?: { cwd?: unknown } };
	if (row.type !== "session_meta") throw new Error(`rollout row 1 is ${JSON.stringify(row.type)}, not session_meta`);
	const cwd = row.payload?.cwd;
	if (typeof cwd !== "string" || cwd.length === 0) throw new Error("rollout session_meta carries no cwd string");
	return cwd;
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

	// ── THE OPERATOR-SUPPLIED PREREQUISITE TRIPLE, AND WHY ITS ABSENCE IS A SKIP ──
	//
	// Entwurf does not own the Codex app-server (VERIFY: "The A cell takes no inferred
	// server or models"), so these three values can only come from the operator. That
	// stays true. What was wrong is the CLASSIFICATION of their absence.
	//
	// `[측정 2026-09-23]` the skip line directly above promised four prerequisites in one
	// breath — LIVE=1 *plus* the three env names — but only the first could ever produce a
	// SKIP. The other three were `ok()` assertions, and `ok()` throws, so a missing
	// operator input exited as FAIL. `release_gate()` supplies none of them, so this MUST
	// step declined as a FAILURE inside every aggregate on every host: 0.25.0's own
	// candidate receipt reads `MUST PASS=23 FAIL=1`, and the release record had to carry a
	// prose classification explaining that the one red was "the shape of that step", and the
	// cut stayed BLOCKED. A contract that manufactures a red every cut and then needs a human
	// to excuse it is not a floor.
	//
	// `scripts/lib/step-outcome.sh` already wrote the rule this violated: "a step that RAN
	// AND BROKE and a step that NEVER RAN are different facts, and a release record that
	// blurs them is worthless: the first is a defect to fix, the second is a prerequisite to
	// supply." An absent operator input is the second.
	//
	// So the axis is split, and the split is the whole repair:
	//   ABSENT  (unset/empty) -> skipLive: nothing ran, the missing names are printed, and
	//                            `--cut` still refuses it as BLOCKED (MUST SKIP). Nothing is
	//                            excused — a cut without this receipt remains impossible.
	//   PRESENT BUT WRONG     -> FAIL, unchanged: a malformed or dead PID, a process whose
	//                            argv is not a Codex app-server, a foreign uid, A == S. The
	//                            operator answered, and the answer is a defect.
	// Nothing is inferred either way, and no default is invented for a value the operator
	// did not give. The reproducible green is the invocation VERIFY and the release skill's
	// P5 both now spell out, and `release_gate` needs no plumbing for it: measured on this
	// source, that function exports no scrub and unsets nothing, so an exported triple
	// already reaches this step.
	//
	// DELIBERATELY NOT MOVED: the installed-config preflights below (`codexFreshPreflight`,
	// `codexCallerFreshPreflight`, `codexLaunchCwdFreshPreflight`). Those are host state
	// `setup` establishes and the Codex doctors cover, and the file header's contract
	// already decided them — "missing system birth, user MCP/status/terminal-title config,
	// app-server, models, runtime, bridge, or tmux seat is a FAIL". A one-time answered
	// launch directory is host setup, not a per-invocation input, and reclassifying it would
	// be a second contract change riding this one.
	const OPERATOR_INPUTS = [
		["ENTWURF_CODEX_APP_SERVER_PID", "the pid of the app-server YOU started (never inferred)"],
		["ENTWURF_CODEX_FRESH_MODEL", "the Codex-side model this cell may spend a turn on"],
		["ENTWURF_CODEX_FRESH_PI_MODEL", "the pi-side model of the callback sibling"],
	] as const;
	const absentInputs = OPERATOR_INPUTS.filter(([name]) => (process.env[name]?.trim() ?? "") === "");
	if (absentInputs.length > 0) {
		skipLive(
			LABEL,
			`this cell takes no inferred server or models, and ${absentInputs.length} operator-supplied ` +
				`prerequisite(s) are absent: ${absentInputs.map(([name, why]) => `${name} (${why})`).join("; ")}. ` +
				"Supply them on the invocation — LIVE=1 ENTWURF_CODEX_APP_SERVER_PID=<pid> " +
				"ENTWURF_CODEX_FRESH_MODEL=<codex-model> ENTWURF_CODEX_FRESH_PI_MODEL=<pi-model> — either for the " +
				"standalone run or for `./run.sh release-gate <scratch> --cut`, which inherits them. " +
				"A cut is still blocked without this receipt: --cut reads a MUST SKIP as red.",
		);
	}

	ok("the measured/certified host axis is Linux", process.platform === "linux", `host=${process.platform}`);

	// Present, so a malformed value is the operator's answer being wrong — a FAIL, not a
	// declined prerequisite. The absence arm above already left.
	const pidText = process.env.ENTWURF_CODEX_APP_SERVER_PID?.trim() ?? "";
	ok(
		"ENTWURF_CODEX_APP_SERVER_PID explicitly names the existing operator-owned app-server",
		/^[1-9]\d*$/.test(pidText),
		`ENTWURF_CODEX_APP_SERVER_PID=${JSON.stringify(pidText)} is not a positive decimal pid`,
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
		"the fixture/initial-Pi seat S and the app-server seat A share one tmux server but are different sessions",
		fixtureCoordinate.serverPid === appServerCoordinate.serverPid &&
			fixtureCoordinate.sessionId !== appServerCoordinate.sessionId,
		`fixture=${fixtureCoordinate.serverPid}/${fixtureCoordinate.sessionId} app-server=${appServerCoordinate.serverPid}/${appServerCoordinate.sessionId}`,
	);
	// A and S, by NAME — recorded so the receipt says which rooms this run actually used. The
	// load-bearing fact is A ≠ S, already asserted above: "the env fallback would have said A"
	// is only a proof when A is a session the anchor could not have chosen. Since #95 D1 there
	// is no required NAME for either — the operator seats the app-server wherever they like.
	const appServerSessionName = tmuxSessionName(
		"Codex app-server/MCP inherited seat",
		appServerEnv,
		appServerCoordinate.paneId,
	);
	const fixtureSessionName = tmuxSessionName("fixture/initial-Pi caller seat", process.env, fixtureCoordinate.paneId);
	ok(
		"the app-server's own session is a DIFFERENT room from the fixture's, which is what makes hop 2 decisive",
		appServerSessionName !== fixtureSessionName,
		`app-server=${JSON.stringify(appServerSessionName)} fixture=${JSON.stringify(fixtureSessionName)}`,
	);
	receipts["1-codex-app-server-mcp-coordinate"] =
		`pid=${appServerPid}\nargv=${argv.join(" ")}\nserver=${appServerCoordinate.serverPid}\n` +
		`session=${appServerCoordinate.sessionId}\nname=${appServerSessionName}\n` +
		`window=${appServerCoordinate.windowId}\npane=${appServerCoordinate.paneId}\n` +
		`fixture-session=${fixtureCoordinate.sessionId}\nfixture-name=${fixtureSessionName}\n` +
		`fixture-window=${fixtureCoordinate.windowId}`;

	// Both are non-empty: the prerequisite arm at the top of `run` left otherwise. Asserting
	// `.length > 0` again here would be a tautology dressed as a check, so the pair is
	// RECORDED instead — the tier a live receipt is read on is a fact the evidence needs, and
	// 0.25.0 already had to explain in prose that its pi leg ran on terra rather than luna.
	const codexModel = process.env.ENTWURF_CODEX_FRESH_MODEL?.trim() ?? "";
	const piModel = process.env.ENTWURF_CODEX_FRESH_PI_MODEL?.trim() ?? "";
	receipts["1b-operator-supplied-models"] = `codex=${codexModel}\npi=${piModel}`;
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
	// The CALLER axis, and a different fact from the five above: hop 2 is made BY a Codex
	// citizen, so this host's `[tui].terminal_title` must carry `thread-id` or that citizen has
	// no findable pane. Asserted here, before any window opens, because the alternative is
	// discovering it three model turns later as a seat refusal.
	const callerMissing = codexCallerFreshPreflight(appServerEnv);
	ok(
		"the installed Codex CALLER seat config is green — tui.terminal_title carries thread-id",
		callerMissing === null,
		callerMissing === null ? "" : `${callerMissing}: ${CODEX_CALLER_PREFLIGHT_HINT[callerMissing]}`,
	);

	// The fixture and every bridge it talks to must resolve the same real stores the app-server
	// forwards into Codex MCP children. This is not an isolated lookalike store.
	for (const key of META_CONTEXT_ENV_KEYS) {
		const value = appServerEnv[key];
		if (typeof value === "string") process.env[key] = value;
		else delete process.env[key];
	}

	// A STABLE directory, not a fresh `mkdtemp` per run, and that is a folder-consent fact rather
	// than a tidiness preference. `[측정 2026-09-16]` codex keys its project trust to the exact
	// launch directory on this rail, so a new random scratch is an UNDECIDED folder every time:
	// the sibling opens on the vendor's trust screen, starts no turn, writes no rollout and never
	// calls back — which is exactly how the two unattended release-gate runs failed while the two
	// runs a human sat through passed. One path, answered `Trust` once, keeps the operator's
	// config from growing an entry per run. The path stays OUTSIDE the repo and is asserted
	// different from the app-server's own directory below, which is all lane C needs of it.
	//
	// It is PRINTED rather than documented as a literal, because `os.tmpdir()` is a host fact:
	// this process's `TMPDIR` when it has one and `/tmp` when it does not, and the trust key is
	// the exact string either way. A doc that spelled it `$TMPDIR/...` would send an operator
	// whose TMPDIR is unset to `/entwurf-codex-fresh-live` — a different directory, in the root
	// of the filesystem, that the vendor would then ask about separately.
	const scratch = path.join(os.tmpdir(), "entwurf-codex-fresh-live");
	fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
	fixtureArtifacts.push(scratch);
	console.log(`  launch-cwd ${scratch}`);
	// Named HERE, before anything is launched, because the same refusal arriving 20 assertions
	// later reads as a callback timeout — the failure mode this whole comment exists to retire.
	// The detail carries the REPAIR COMMAND with the resolved path already in it, so the answer
	// cannot be given for a near-miss directory.
	const untrustedScratch = codexLaunchCwdFreshPreflight(appServerEnv, scratch);
	ok(
		"the Codex launch directory carries the vendor's own trust receipt, so a sibling opened there starts its first turn",
		untrustedScratch === null,
		untrustedScratch === null
			? ""
			: `${untrustedScratch}: ${CODEX_LAUNCH_CWD_PREFLIGHT_HINT[untrustedScratch]}\n` +
					`            repair (this host, exact directory): codex -C ${scratch}   → answer \`Trust\``,
	);
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
		"the initial Pi caller is visible in the fixture's own session S, not the app-server's A",
		initialPiTmuxSession === fixtureCoordinate.sessionId && initialPiTmuxSession !== appServerCoordinate.sessionId,
		`initial-pi=${initialPiTmuxSession} fixture=${fixtureCoordinate.sessionId} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["3-initial-caller-pi-coordinate"] =
		`session=${initialPiTmuxSession}\nwindow=${initialPiWindow}\napp-server-session=${appServerCoordinate.sessionId}`;

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
	// #120 P2: the control-socket rail answers with the ACCEPTANCE BOUNDARY the receiver observed,
	// and every member of that closed set is a success. The initial Pi is mid-turn while the fixture
	// addresses it, so `queued-follow-up` is an ORDINARY answer here — measured 2026-09-23, this
	// exact step. The old `sent|delivered` pin passed only when the caller happened to be idle, and
	// before P2 it passed on the busy path too because the rail said `sent` either way; `delivered`
	// was never a member of the set at all. The sibling LIVE smokes took this widening in 6d90d73
	// (`smoke-herdr-fresh-call-live.ts`, `smoke-mux-lifecycle-live.ts`); this step was missed.
	ok(
		"the fixture addressed the real initial Pi caller through an actual control-socket entwurf_v2 receipt",
		!instructInitialPi.isError &&
			/entwurf_v2 control-socket → (?:sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/.test(
				instructInitialPi.text,
			),
		instructInitialPi.text,
	);

	const piFreshReceipt = await awaitOrRecover("the initial Pi source-owned Codex LAUNCH receipt", SOURCE_WAIT_MS, () =>
		selectExactSourceToolReceipt(
			piSourceToolReceipts(readInitialPiEntries()),
			"entwurf_fresh_call",
			{
				backend: "codex",
				model: codexModel,
				cwd: scratch,
				task: codexTask,
			},
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
	// HOP 1. An omitted seat, which since #95 D1 means the CALLER's own session for every backend
	// — Codex no longer selects a fixed room. It is the setup rather than the claim: it puts the
	// Codex TUI in S so hop 2's answer can be told apart from the app-server's inherited A. The
	// receipt must name NO seat at all: the caller's own session is the absence of a seat rule,
	// not a rule with a name.
	ok(
		"omitted placement opened fresh Codex in the caller's own session S, away from the app-server's A",
		codexLaunchSession === fixtureCoordinate.sessionId &&
			codexLaunchSession !== appServerCoordinate.sessionId &&
			!/^\s*seat:/m.test(codexLaunchReceipt),
		`codex=${codexLaunchSession} fixture=${fixtureCoordinate.sessionId} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["7-fresh-codex-coordinate"] =
		`session=${codexLaunchSession}\nname=${fixtureSessionName}\nwindow=${codexWindow}\n` +
		`app-server-session=${appServerCoordinate.sessionId}\napp-server-name=${appServerSessionName}`;

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

	// #95 lane C (i). WHERE THE CODEX THREAD OPENED, from four authorities that cannot borrow
	// from each other: tmux's pane, the vendor's own rollout header, Entwurf's record, and the
	// directory this call requested. Before the `-C` carrier they disagreed while every receipt
	// still looked right — the pane sat in the requested scratch and the THREAD opened in the
	// app-server's repo, which the birth hook then recorded honestly. The app-server's live cwd
	// is read from the kernel and asserted DIFFERENT, because a scratch that happened to equal it
	// would make all four agree for the wrong reason.
	const codexPane = /^\s*pane:\s+(%\d+)/m.exec(codexLaunchReceipt)?.[1] ?? "";
	ok("the Codex LAUNCH receipt names its pane", /^%\d+$/.test(codexPane), codexLaunchReceipt);
	const appServerCwd = processCwd(appServerPid);
	const codexPaneCwd = tmuxPaneCwd("fresh Codex", process.env, codexPane);
	const codexRolloutCwd =
		codexIdentity.transcriptPath === null ? "" : rolloutSessionMetaCwd(codexIdentity.transcriptPath);
	ok(
		"the fresh Codex thread, its pane, its record and the requested cwd are ONE directory — and it is not the app-server's",
		codexPaneCwd === scratch &&
			codexRolloutCwd === scratch &&
			codexIdentity.cwd === scratch &&
			appServerCwd !== scratch,
		`pane=${codexPaneCwd} rollout=${codexRolloutCwd} record=${codexIdentity.cwd} requested=${scratch} app-server=${appServerCwd}`,
	);
	receipts["8b-codex-thread-cwd"] =
		`requested=${scratch}\npane=${codexPaneCwd}\nrollout-session_meta=${codexRolloutCwd}\n` +
		`record=${codexIdentity.cwd}\napp-server=${appServerCwd}`;

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
				{ backend: "pi", model: piModel, task: outboundPiTask },
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
	// HOP 2 — THE CLAIM (#95 lane B). Two independent halves of one fact, and both are required.
	// The SEAT: this Pi landed in S, the session the Codex TUI is in. The app-server's inherited
	// `TMUX` names A, so the pre-#95 env fallback would have put it there; S is reachable only
	// through the caller's own pane title. The LABEL: the receipt says `codex-title-anchor`, so
	// the rule that chose it is named rather than inferred from a coincidence of sessions.
	ok(
		"omitted placement opened the outbound Pi beside the CODEX TUI in S — not in the app-server's home A",
		outboundPiSession === codexLaunchSession &&
			outboundPiSession === fixtureCoordinate.sessionId &&
			outboundPiSession !== appServerCoordinate.sessionId,
		`outbound-pi=${outboundPiSession} codex=${codexLaunchSession} fixture=${fixtureCoordinate.sessionId} app-server=${appServerCoordinate.sessionId}`,
	);
	ok(
		"the outbound Pi receipt names the title anchor as the rule that chose that seat, and no session name",
		/^\s*seat:\s+\$\d+ \(the Codex caller's own pane, found by its thread-id terminal title/m.test(outboundPiReceipt) &&
			!outboundPiReceipt.includes("requested tmux session"),
		outboundPiReceipt,
	);
	// The four coordinates, stated together so the shape is readable in one place. This claims
	// the CALLER-seat topology and nothing wider: no arbitrary attached-TUI inference, and no
	// claim about a Codex TUI this smoke did not open.
	ok(
		"supported caller-seat topology: initial Pi in S, Codex in S, Codex opens outbound Pi in S, " +
			"while the operator-owned app-server stays in its own session A",
		initialPiTmuxSession === fixtureCoordinate.sessionId &&
			codexLaunchSession === fixtureCoordinate.sessionId &&
			outboundPiSession === fixtureCoordinate.sessionId &&
			appServerCoordinate.sessionId !== fixtureCoordinate.sessionId,
		`initial-pi=${initialPiTmuxSession} codex=${codexLaunchSession} outbound-pi=${outboundPiSession} app-server=${appServerCoordinate.sessionId}`,
	);
	receipts["12-outbound-fresh-pi-coordinate"] =
		`session=${outboundPiSession}\nwindow=${outboundPiWindow}\ncodex-session=${codexLaunchSession}\n` +
		`app-server-session=${appServerCoordinate.sessionId}\nseat-source=codex-title-anchor`;

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

	// #95 lane C (ii) — THE CLAIM. This leg named NO cwd, so the only directory the composition
	// could use is the Codex caller's own record. Its oracle is independent twice over: the pane
	// answers tmux, and the outbound Pi's RECORD is written by that Pi's own birth from its own
	// process directory — neither reads the launch receipt. Before lane C this landed in the
	// app-server's repo, because the bridge is the app-server's MCP child and an omitted cwd
	// inherited ITS directory; the app-server's live cwd is asserted different so that failure
	// mode stays visible rather than coincidentally equal.
	const outboundPiPane = /^\s*pane:\s+(%\d+)/m.exec(outboundPiReceipt)?.[1] ?? "";
	ok("the outbound Pi LAUNCH receipt names its pane", /^%\d+$/.test(outboundPiPane), outboundPiReceipt);
	const outboundPiPaneCwd = tmuxPaneCwd("outbound Pi", process.env, outboundPiPane);
	ok(
		"with NO cwd requested, the outbound Pi opened in the CODEX CALLER's own record directory — not in the app-server's",
		outboundPiPaneCwd === codexIdentity.cwd &&
			outboundPiIdentity.cwd === codexIdentity.cwd &&
			outboundPiPaneCwd !== appServerCwd,
		`pane=${outboundPiPaneCwd} outbound-record=${outboundPiIdentity.cwd} codex-record=${codexIdentity.cwd} app-server=${appServerCwd}`,
	);
	ok(
		"the outbound Pi receipt NAMES the caller-record rule rather than calling that directory requested",
		outboundPiReceipt.includes(`cwd:      ${codexIdentity.cwd} (the Codex caller's own record directory`) &&
			!outboundPiReceipt.includes("requested start directory"),
		outboundPiReceipt,
	);
	receipts["13b-outbound-pi-cwd"] =
		`requested=<none>\npane=${outboundPiPaneCwd}\nrecord=${outboundPiIdentity.cwd}\n` +
		`codex-caller-record=${codexIdentity.cwd}\napp-server=${appServerCwd}`;

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
			// 0.24.0 moved a pi sibling's first action to the ZERO-ARGUMENT eighth verb, and this
			// smoke's own launch receipt says so in the same run: "its first action is the
			// zero-argument callback verb (codex is the one arm that still sends the nonce as
			// arguments)". The Codex audit below therefore keeps its `entwurf_v2` shape, and only
			// this one moves. `{}` is matched by deep-strict equality, so it pins the verb's actual
			// contract — a target or message typed here would be a second address axis and the verb
			// refuses it by name.
			//
			// Nothing is weakened by dropping the nonce from THIS expectation: the correlation is
			// proven earlier and from the delivered body, which is where a nonce can actually be
			// corrupted — `the initial Pi callback carries the exact launch nonce` (:970-973) reads
			// the fixture's own mailbox, requires exactly one exact match and refuses duplicates,
			// and the two cells beside it bind that callback's sender envelope to a real pi V3
			// citizen. This audit's job is the different one its name says: exactly these calls,
			// once each, and nothing else.
			{ toolName: "entwurf_callback", arguments: {} },
			{
				toolName: "entwurf_fresh_call",
				arguments: {
					backend: "codex",
					model: codexModel,
					cwd: scratch,
					task: codexTask,
				},
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
				arguments: { backend: "pi", model: piModel, task: outboundPiTask },
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
