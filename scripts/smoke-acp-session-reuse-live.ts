// S2d-1b-2b — live in-memory session reuse acceptance. LIVE-gated, OUT of check.
//
//   LIVE=1 ./run.sh smoke-acp-session-reuse-live
//
// The deterministic gate (check-acp-session-reuse) proves the prompt SCOPE
// (delta-only) and the wiring with a fake seam. This drives a REAL resident
// (`pi --entwurf-control --mode rpc` on an ACP model: real Pi session, real overlay,
// real spawn, real vendor) through TWO turns in one process and asserts that turn 2
// took the REUSE path.
//
// Why a real resident (#171): a resident turn reads the Pi session it belongs to
// (the session reader the provider entry reports at `session_start`) and stops with
// "cannot read this Pi session" without one. Until 0.61.0 this smoke called
// `streamShellAcp` directly and only reported the control flag; that is a host no Pi
// ever is, and the backend now refuses it. The host here is Pi itself, so the smoke
// holds whatever the host contract becomes.
//
// The reuse verdict is the production lifecycle notice, NOT the recall. A session
// that was rebuilt or resumed can recall the codeword too, so recall alone cannot
// tell reuse from either. Turn 2 must therefore announce `[acp: reusing live
// session]` and must not announce `[acp: preparing …]`; turn 1 must announce
// `[acp: preparing …]`, which also shows that this stream carries the notices at
// all. A notice counts only as the text block Entwurf signed (LIFECYCLE_NOTICE_SIGNATURE):
// the same words in the model's own answer prove nothing. check-acp-session-reuse pins that the reuse branch emits exactly that and the
// new branch the opposite. The recall is kept as a supporting check that the reused
// session still answers from its own history. Delta-only on the wire stays the
// deterministic gate's claim: the vendor stdio is not observed here.
//
// The meta store, mailbox and markers are a temp world, so the resident mints no
// citizen into the operator's garden. auth.json (the subscription login), the
// control dir and the ACP session store stay real, as in smoke-acp-v2-send-live.
//
// The one-shot exit0 half (a `pi -p` turn-scoped session tears down cleanly) is
// owned by smoke-acp-provider-live — reuse must not regress it.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { LIFECYCLE_NOTICE_SIGNATURE } from "../pi-extensions/lib/acp/event-mapper.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { skipLive } from "./lib/live-skip.ts";
import { PI_BOOT_TIMEOUT_MS, waitForPiRecord } from "./lib/pi-record-discovery.ts";

const NAME = "smoke-acp-session-reuse-live";
const ACP_PROVIDER = "entwurf";
const ACP_MODEL = process.env.ENTWURF_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-5-5";

const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load ONLY this checkout's extensions so the resident registers THIS acp-provider.ts.
// `builtin:mcp`: `--no-extensions` also turns off Pi's built-in MCP, which a citizen's entwurf-bridge
// registration needs (scripts/resident-rpc-drive.ts has the measurement).
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", "builtin:mcp", "-e", REPO_ROOT] as const;

const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_PROVIDER_TIMEOUT_MS) || 240_000;
const POLL_MS = 100;
const REUSE_NOTICE = "[acp: reusing live session]";

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return false;
}

interface TurnCapture {
	promptAccepted: boolean;
	agentEndSeen: boolean;
	extensionErrors: unknown[];
	/** Entwurf's own lifecycle notices: the text blocks it signed, and nothing the model wrote. */
	notices: string[];
	/** The model's answer: every unsigned text block of the turn's assistant messages. */
	answer: string;
	/** How the last assistant message of the turn ended, as Pi stored it. */
	stopReason: unknown;
	errorMessage: unknown;
	stream: string;
}

type Line = (evt: Record<string, unknown>, raw: string) => void;

/**
 * The text blocks of one assistant message, split by who wrote them. A lifecycle notice is the
 * block Entwurf stamps with LIFECYCLE_NOTICE_SIGNATURE (event-mapper.ts); the model cannot stamp
 * one, so a notice it merely typed stays in the answer and proves nothing.
 */
function textOf(message: unknown): { notices: string[]; answer: string } {
	const content = (message as { content?: unknown })?.content;
	const notices: string[] = [];
	let answer = "";
	if (typeof content === "string") return { notices, answer: content };
	if (!Array.isArray(content)) return { notices, answer };
	for (const part of content as Array<{ type?: unknown; text?: unknown; textSignature?: unknown }>) {
		if (part?.type !== "text" || typeof part.text !== "string") continue;
		if (part.textSignature === LIFECYCLE_NOTICE_SIGNATURE) notices.push(part.text.trim());
		else answer += part.text;
	}
	return { notices, answer };
}

/**
 * Drive one model turn over the resident's stdin RPC and capture its stdout events until
 * `agent_end` (or a hard turn timeout, or the resident's death). One reader serves the whole run:
 * `listen` swaps the handler, so no line is lost between two turns.
 */
function driveTurn(
	child: ChildProcess,
	listen: (handler: Line | null) => void,
	id: string,
	prompt: string,
): Promise<TurnCapture> {
	return new Promise((resolve) => {
		const cap: TurnCapture = {
			promptAccepted: false,
			agentEndSeen: false,
			extensionErrors: [],
			notices: [],
			answer: "",
			stopReason: undefined,
			errorMessage: undefined,
			stream: "",
		};
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.off("exit", finish);
			listen(null);
			resolve(cap);
		};
		const timer = setTimeout(finish, TURN_TIMEOUT_MS);
		// A dead child can never emit agent_end — settle instead of burning the timeout.
		child.once("exit", finish);
		listen((evt, raw) => {
			cap.stream += `${raw}\n`;
			if (evt.type === "extension_error") cap.extensionErrors.push(evt.error);
			if (evt.type === "response" && evt.command === "prompt" && evt.id === id) {
				cap.promptAccepted = evt.success === true;
			}
			if (evt.type === "message_end") {
				const message = evt.message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown } | undefined;
				if (message?.role === "assistant") {
					const text = textOf(message);
					cap.notices.push(...text.notices);
					cap.answer += text.answer;
					cap.stopReason = message.stopReason;
					cap.errorMessage = message.errorMessage;
				}
			}
			if (evt.type === "agent_end") {
				cap.agentEndSeen = true;
				finish();
			}
		});
		child.stdin?.write(`${JSON.stringify({ type: "prompt", message: prompt, id })}\n`);
	});
}

/** On failure, keep what the smoke saw outside the temp world, and name the file. Best-effort. */
async function writeFailureArtifact(turns: TurnCapture[], stderrTail: string, err: unknown): Promise<void> {
	try {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const file = path.join(os.tmpdir(), `entwurf-${NAME}-FAIL-${stamp}.log`);
		await fsp.writeFile(
			file,
			`# ${NAME} FAILURE\n# ${err instanceof Error ? err.message : String(err)}\n` +
				`# model: ${ACP_PROVIDER}/${ACP_MODEL}\n\n` +
				turns.map((turn, i) => `## turn ${i + 1} event stream\n${turn.stream}\n`).join("\n") +
				`\n## resident stderr tail\n${stderrTail || "(empty)"}\n`,
			"utf8",
		);
		console.error(`[${NAME}] FAILURE transcript: ${file}`);
	} catch {
		console.error(`[${NAME}] could not write the failure transcript (reporting the original error)`);
	}
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		skipLive(NAME, "set LIVE=1 to run (spawns a real pi --entwurf-control resident + drives two model turns).");
	}

	const world = await fsp.mkdtemp(path.join(os.tmpdir(), "entwurf-reuse-"));
	const sessionsDir = path.join(world, "sessions");
	const mailboxDir = path.join(world, "mailbox");
	const receiversDir = path.join(world, "receivers");
	const sendersDir = path.join(world, "senders");
	for (const d of [sessionsDir, mailboxDir, receiversDir, sendersDir]) await fsp.mkdir(d, { recursive: true });

	const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`.toUpperCase();
	const codeword = `KIWI${nonce}`;

	console.error(`[${NAME}] repo:     ${REPO_ROOT}`);
	console.error(`[${NAME}] world:    ${world}`);
	console.error(`[${NAME}] model:    ${ACP_PROVIDER}/${ACP_MODEL}`);
	console.error(`[${NAME}] codeword: ${codeword}`);

	let stderrTail = "";
	let resident: ChildProcess | null = null;
	const turns: TurnCapture[] = [];
	try {
		resident = spawn(
			"pi",
			[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", ACP_PROVIDER, "--model", ACP_MODEL, "--mode", "rpc"],
			{
				cwd: world,
				stdio: ["pipe", "pipe", "pipe"],
				detached: false,
				env: {
					...process.env,
					ENTWURF_META_SESSIONS_DIR: sessionsDir,
					ENTWURF_META_MAILBOX_DIR: mailboxDir,
					ENTWURF_META_RECEIVERS_DIR: receiversDir,
					ENTWURF_META_SENDERS_DIR: sendersDir,
				},
			},
		);
		resident.stderr?.on("data", (b: Buffer) => {
			stderrTail = (stderrTail + b.toString()).slice(-4000);
		});
		let handler: Line | null = null;
		const listen = (next: Line | null): void => {
			handler = next;
		};
		readline.createInterface({ input: resident.stdout! }).on("line", (line: string) => {
			const raw = line.trim();
			if (!raw || !handler) return;
			let evt: Record<string, unknown>;
			try {
				evt = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				return;
			}
			handler(evt, raw);
		});

		// A resident is one with a record and a control socket: wait for both before the first prompt.
		const gardenId = await waitForPiRecord(sessionsDir, PI_BOOT_TIMEOUT_MS);
		ok(`ACP-model resident birthed its own V3 record (${ACP_PROVIDER}/${ACP_MODEL})`, gardenId !== null);
		ok(
			"resident stood up a control socket keyed on its record gardenId",
			await waitForSocket(path.join(REAL_CONTROL_DIR, `${gardenId}.sock`), PI_BOOT_TIMEOUT_MS),
		);

		// --- turn 1 (new): introduce the codeword ---
		const t1 = await driveTurn(
			resident,
			listen,
			"reuse-1",
			`Remember this codeword: ${codeword}. Reply with exactly OK and nothing else.`,
		);
		turns.push(t1);
		console.error(
			`[${NAME}] turn 1 notices: ${JSON.stringify(t1.notices)} answer: ${JSON.stringify(t1.answer.slice(-160))}`,
		);
		ok("turn 1: the prompt RPC command was accepted", t1.promptAccepted);
		ok("turn 1 completed over RPC (agent_end — no hang)", t1.agentEndSeen);
		ok("turn 1: no extension_error", t1.extensionErrors.length === 0);
		ok(
			`turn 1 ended as a completed answer (stopReason=${String(t1.stopReason)}${t1.errorMessage ? `, ${String(t1.errorMessage)}` : ""})`,
			t1.stopReason === "stop",
		);
		// The positive control: a first turn bootstraps, and the signed channel shows it.
		ok(
			'turn 1 bootstrapped a session (signed notice "[acp: preparing claude session]")',
			t1.notices.includes("[acp: preparing claude session]"),
		);
		ok("turn 1 did not claim a reuse", !t1.notices.includes(REUSE_NOTICE));

		// --- turn 2 (reuse): ask for the codeword; this prompt does not carry it ---
		const t2 = await driveTurn(
			resident,
			listen,
			"reuse-2",
			"What codeword did I ask you to remember? Reply with exactly that codeword and nothing else.",
		);
		turns.push(t2);
		console.error(
			`[${NAME}] turn 2 notices: ${JSON.stringify(t2.notices)} answer: ${JSON.stringify(t2.answer.slice(-160))}`,
		);
		ok("turn 2: the prompt RPC command was accepted", t2.promptAccepted);
		ok("turn 2 completed over RPC (agent_end — no hang)", t2.agentEndSeen);
		ok("turn 2: no extension_error", t2.extensionErrors.length === 0);
		ok(
			`turn 2 ended as a completed answer (stopReason=${String(t2.stopReason)}${t2.errorMessage ? `, ${String(t2.errorMessage)}` : ""})`,
			t2.stopReason === "stop",
		);
		// The reuse verdict: the backend's own signed lifecycle notices name the path turn 2 took. A
		// rebuild or a resume would announce `preparing` instead.
		ok(`turn 2 took the reuse path (signed notice "${REUSE_NOTICE}")`, t2.notices.includes(REUSE_NOTICE));
		ok(
			'turn 2 did not bootstrap a session again (no signed "[acp: preparing …" notice)',
			!t2.notices.some((notice) => notice.startsWith("[acp: preparing")),
		);
		// Supporting only: the reused session still answers from its own history, in the model's own text.
		ok(`turn 2 recalled the turn-1 codeword ${codeword}`, t2.answer.includes(codeword));
	} catch (err) {
		await writeFailureArtifact(turns, stderrTail, err);
		throw err;
	} finally {
		if (resident) await terminateChild(resident);
		if (process.env.ENTWURF_KEEP_SMOKE_WORLD === "1") {
			console.error(`[${NAME}] kept world: ${world}`);
		} else {
			await fsp.rm(world, { recursive: true, force: true }).catch(() => {});
		}
	}

	if (stderrTail && process.env.ENTWURF_SMOKE_VERBOSE === "1") {
		console.error(`[${NAME}] resident stderr tail:\n${stderrTail}`);
	}
	console.log(
		`[${NAME}] PASS (${passed} assertions) — turn 2 took the reuse path ([acp: reusing live session], no re-bootstrap) and recalled the turn-1 codeword`,
	);
	console.log(`  model:    ${ACP_PROVIDER}/${ACP_MODEL}`);
	console.log(`  codeword: ${codeword} recalled in turn 2 (supporting; delta-only is check-acp-session-reuse's claim)`);
}

await main();
