#!/usr/bin/env -S node --experimental-strip-types
/**
 * gnew-rpc-drive — sequential RPC driver for the /gnew E2E smoke.
 *
 * pi's native RPC `prompt` is async (it `void session.prompt(...)` and returns
 * immediately), so a blind printf pipe can race a follow-up get_state ahead of
 * the switch. This driver enforces ordering: it waits for each response before
 * sending the next command.
 *
 * Base flow (0 tokens — `/gnew` is a slash command intercepted by session.prompt
 * BEFORE any model turn, so NO agent_start should appear):
 *   g1: get_state            → capture BEFORE sessionId
 *   p1: prompt "/gnew"       → wait for the prompt response (the in-process switch
 *                              completes inside the command handler, before this
 *                              response fires)
 *   g2: get_state            → capture AFTER sessionId / sessionFile / msgCount
 *
 * Optional self turn (T3 backend identity, ~1 turn — pass a 5th arg `selfPrompt`):
 *   p2: prompt <selfPrompt>  → drive one model turn that calls entwurf_self; scan
 *                              the stream for the identity envelope and capture
 *                              every sessionId it reports (proves PI_SESSION_ID
 *                              reached the backend MCP child AFTER the switch).
 *
 * Emits a single JSON object on stdout for the bash smoke to assert against.
 *
 * Usage: node --experimental-strip-types gnew-rpc-drive.ts <sessionId> <provider> <model> [timeoutMs] [selfPrompt]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ENTWURF_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const listSockets = (): string[] => {
	try {
		return fs.readdirSync(ENTWURF_DIR).filter((f) => f.endsWith(".sock"));
	} catch {
		return [];
	}
};

const [sessionId, provider, model, timeoutMsArg, selfPrompt] = process.argv.slice(2);
if (!sessionId || !provider || !model) {
	process.stderr.write("usage: gnew-rpc-drive.ts <sessionId> <provider> <model> [timeoutMs] [selfPrompt]\n");
	process.exit(2);
}
const timeoutMs = Number(timeoutMsArg) || 90_000;
const wantSelf = typeof selfPrompt === "string" && selfPrompt.length > 0;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

interface DriveResult {
	before: string | null;
	after: string | null;
	afterFile: string | null;
	afterMsgCount: number | null;
	promptOk: boolean;
	agentStartSeen: boolean;
	extensionErrors: Array<{ path: unknown; event: unknown; error: unknown }>;
	socketsAfterSwitch: string[];
	selfEnvelopeSessionIds: string[];
	selfTurnEnded: boolean;
	timedOut: boolean;
}

const result: DriveResult = {
	before: null,
	after: null,
	afterFile: null,
	afterMsgCount: null,
	promptOk: false,
	agentStartSeen: false,
	extensionErrors: [],
	// Control sockets present right after the switch, while pi is still alive (the
	// socket vanishes on shutdown, so it can only be observed mid-run). Proves
	// startControlServer rebound to the new garden id and dropped the old one.
	socketsAfterSwitch: [],
	selfEnvelopeSessionIds: [],
	selfTurnEnded: false,
	timedOut: false,
};

const child = spawn(
	"pi",
	[
		...REPO_EXTENSION_ARGS,
		"--session-id",
		sessionId,
		"--entwurf-control",
		"--provider",
		provider,
		"--model",
		model,
		"--mode",
		"rpc",
	],
	{ stdio: ["pipe", "pipe", "inherit"] },
);

const send = (obj: Record<string, unknown>): void => {
	child.stdin?.write(`${JSON.stringify(obj)}\n`);
};

// phases: 0 await g1 · 1 await prompt/gnew · 2 await g2 · 3 self turn (optional) · 4 done
let phase = 0;
// finish() can be reached from three racing paths — the timeout timer, child
// `exit`, and the normal phase-2/phase-3 completion. Guard so the single result
// JSON is emitted exactly once; a double emit would tear the bash JSON parse.
let finished = false;
const finish = (): void => {
	if (finished) return;
	finished = true;
	clearTimeout(timer);
	try {
		child.stdin?.end();
	} catch {
		/* best-effort */
	}
	process.stdout.write(`${JSON.stringify(result)}\n`);
	setTimeout(() => {
		try {
			child.kill("SIGTERM");
		} catch {
			/* best-effort */
		}
		process.exit(0);
	}, 1500);
};

const timer = setTimeout(() => {
	result.timedOut = true;
	finish();
}, timeoutMs);

const rl = readline.createInterface({ input: child.stdout! });
rl.on("line", (line: string) => {
	const trimmed = line.trim();
	if (!trimmed) return;
	let evt: Record<string, unknown>;
	try {
		evt = JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		return;
	}

	if (evt.type === "agent_start") result.agentStartSeen = true;
	if (evt.type === "extension_error") {
		result.extensionErrors.push({ path: evt.extensionPath, event: evt.event, error: evt.error });
	}

	// entwurf_self identity envelope: streamed as a tool result embedded as a STRING
	// inside the message event, so its JSON quotes are escaped (\"sessionId\":...) —
	// match the garden-id TOKEN instead (alphanumerics, never escaped). The envelope
	// is marked by `agentId` (get_state never emits it); the only garden-shaped token
	// in it is the sessionId (= the backend MCP child's PI_SESSION_ID after the switch).
	if (phase === 3 && trimmed.includes("agentId")) {
		const m = trimmed.match(/\d{8}T\d{6}-[0-9a-f]{6}/g);
		if (m) {
			for (const id of m) {
				if (!result.selfEnvelopeSessionIds.includes(id)) result.selfEnvelopeSessionIds.push(id);
			}
		}
	}
	if (phase === 3 && evt.type === "agent_end") {
		result.selfTurnEnded = true;
		finish();
		return;
	}

	if (evt.type !== "response") return;
	const data = (evt.data ?? null) as { sessionId?: string; sessionFile?: string; messageCount?: number } | null;

	if (phase === 0 && evt.command === "get_state") {
		result.before = data?.sessionId ?? null;
		phase = 1;
		send({ type: "prompt", message: "/gnew", id: "p1" });
		return;
	}
	if (phase === 1 && evt.command === "prompt") {
		result.promptOk = evt.success === true;
		phase = 2;
		send({ type: "get_state", id: "g2" });
		return;
	}
	if (phase === 2 && evt.command === "get_state") {
		result.after = data?.sessionId ?? null;
		result.afterFile = data?.sessionFile ?? null;
		result.afterMsgCount = data?.messageCount ?? null;
		result.socketsAfterSwitch = listSockets(); // pi still alive here — snapshot now
		if (wantSelf) {
			phase = 3;
			send({ type: "prompt", message: selfPrompt, id: "p2" });
		} else {
			phase = 4;
			finish();
		}
	}
});

child.on("error", (err: Error) => {
	process.stderr.write(`gnew-rpc-drive: spawn failed: ${err.message}\n`);
	process.exit(2);
});
child.on("exit", () => {
	if (phase < 4) finish();
});

// kick off
send({ type: "get_state", id: "g1" });
