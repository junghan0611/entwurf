#!/usr/bin/env -S node --experimental-strip-types
/**
 * resident-rpc-drive — sequential RPC driver for the resident-citizen LIVE smoke
 * (#50 C2). It replaces `gnew-rpc-drive`, which drove the `/gnew` command that no
 * longer exists.
 *
 * What it observes that a printf pipe cannot: the control socket and the meta-record
 * only exist WHILE pi is alive, so both are snapshotted mid-run, between ordered RPC
 * commands. pi's RPC `prompt` is async (`void session.prompt(...)`), so ordering is
 * enforced by waiting for each response before sending the next command.
 *
 * Flow (0 tokens — nothing here runs a model turn):
 *   g1: get_state             → pi's OWN session id (a uuidv7 when no id was passed)
 *   snapshot                  → control sockets + meta-records, pi still alive
 *   n1: new_session (optional)→ in-process replacement, which is ALLOWED post-cut
 *   g2: get_state             → the replacement's pi session id
 *   snapshot                  → sockets + records again (the address must have moved)
 *
 * Usage:
 *   resident-rpc-drive.ts <provider> <model> [timeoutMs] [sessionFile] [replace:0|1]
 *
 * `sessionFile` (absolute) resumes an existing pi session via `--session <path>` —
 * the same argv the v2 spawn path now uses. Omit it for a fresh session with NO
 * `--session-id`: the shape that used to be a hard-exit and is now the normal birth.
 *
 * Emits ONE JSON object on stdout for the bash smoke to assert against.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ENTWURF_DIR = process.env.ENTWURF_DIR ?? path.join(os.homedir(), ".pi", "entwurf-control");
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
const META_DIR = process.env.ENTWURF_META_SESSIONS_DIR ?? path.join(AGENT_DIR, "meta-sessions");

const listSockets = (): string[] => {
	try {
		return fs.readdirSync(ENTWURF_DIR).filter((f) => f.endsWith(".sock"));
	} catch {
		return [];
	}
};

interface RecordView {
	file: string;
	schemaVersion: unknown;
	gardenId: unknown;
	backend: unknown;
	nativeSessionId: unknown;
	transcriptPath: unknown;
	model: unknown;
}

const listRecords = (): RecordView[] => {
	let files: string[];
	try {
		files = fs.readdirSync(META_DIR).filter((f) => f.endsWith(".meta.json"));
	} catch {
		return [];
	}
	const out: RecordView[] = [];
	for (const file of files) {
		try {
			const r = JSON.parse(fs.readFileSync(path.join(META_DIR, file), "utf8"));
			out.push({
				file,
				schemaVersion: r.schemaVersion,
				gardenId: r.gardenId,
				backend: r.backend,
				nativeSessionId: r.nativeSessionId,
				transcriptPath: r.transcriptPath,
				model: r.model,
			});
		} catch {
			out.push({
				file,
				schemaVersion: null,
				gardenId: null,
				backend: null,
				nativeSessionId: null,
				transcriptPath: null,
				model: null,
			});
		}
	}
	return out;
};

const [provider, model, timeoutMsArg, sessionFile, replaceArg] = process.argv.slice(2);
if (!provider || !model) {
	process.stderr.write("usage: resident-rpc-drive.ts <provider> <model> [timeoutMs] [sessionFile] [replace:0|1]\n");
	process.exit(2);
}
const timeoutMs = Number(timeoutMsArg) || 90_000;
const wantReplace = replaceArg === "1";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The citizen view for ONE native session id, computed HERE rather than left to the
 * bash caller. The temp store accumulates records across the smoke's cells, so
 * "the first gardenId in the JSON" is not this session's address, and a text count of
 * `nativeSessionId` occurrences also matches this result's own top-level field — a
 * false duplicate report (observed 2026-07-23). Compute the join once, in the place
 * that knows which id it is asking about.
 */
function selfView(
	records: RecordView[],
	nativeSessionId: string | null,
): { gardenId: string | null; count: number; transcriptPath: string | null } {
	if (!nativeSessionId) return { gardenId: null, count: 0, transcriptPath: null };
	const mine = records.filter((r) => r.nativeSessionId === nativeSessionId);
	const first = mine[0];
	return {
		gardenId: mine.length > 0 ? String(first?.gardenId ?? "") || null : null,
		count: mine.length,
		transcriptPath: typeof first?.transcriptPath === "string" ? first.transcriptPath : null,
	};
}

interface DriveResult {
	/** pi's OWN session id at first get_state (a uuidv7 for a fresh launch). */
	nativeSessionId: string | null;
	sessionFile: string | null;
	socketsWhileAlive: string[];
	records: RecordView[];
	/** This session's own address + how many records claim its native id (must be 1). */
	selfGardenId: string | null;
	selfRecordCount: number;
	/** The self record's transcriptPath — null until pi actually writes the session
	 * file (a non-null value for a file that is not on disk is the F7 phantom). */
	selfTranscriptPath: string | null;
	/** After the optional in-process replacement. */
	replacedNativeSessionId: string | null;
	replaceOk: boolean;
	replaceCancelled: boolean;
	socketsAfterReplace: string[];
	recordsAfterReplace: RecordView[];
	replacedGardenId: string | null;
	replacedRecordCount: number;
	agentStartSeen: boolean;
	extensionErrors: Array<{ path: unknown; event: unknown; error: unknown }>;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
}

const result: DriveResult = {
	nativeSessionId: null,
	sessionFile: null,
	socketsWhileAlive: [],
	records: [],
	selfGardenId: null,
	selfRecordCount: 0,
	selfTranscriptPath: null,
	replacedNativeSessionId: null,
	replaceOk: false,
	replaceCancelled: false,
	socketsAfterReplace: [],
	recordsAfterReplace: [],
	replacedGardenId: null,
	replacedRecordCount: 0,
	agentStartSeen: false,
	extensionErrors: [],
	stderr: "",
	exitCode: null,
	timedOut: false,
};

const piArgs = ["--no-extensions", "-e", REPO_ROOT, "--entwurf-control"];
// NO --session-id. That injection is what the #50 C2 cut removed: pi mints its own
// id and the record mints the address. A resume names the FILE, never an id.
if (sessionFile) piArgs.push("--session", sessionFile);
piArgs.push("--provider", provider, "--model", model, "--mode", "rpc");

const child = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "pipe"] });
child.stderr?.on("data", (d: Buffer) => {
	result.stderr += d.toString();
});

const send = (obj: Record<string, unknown>): void => {
	child.stdin?.write(`${JSON.stringify(obj)}\n`);
};

// phases: 0 await g1 · 1 await new_session · 2 await g2 · 3 done
let phase = 0;
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
	if (evt.type !== "response") return;
	const data = (evt.data ?? null) as { sessionId?: string; sessionFile?: string; cancelled?: boolean } | null;

	if (phase === 0 && evt.command === "get_state") {
		result.nativeSessionId = data?.sessionId ?? null;
		result.sessionFile = data?.sessionFile ?? null;
		// pi is alive HERE — the socket and the record only exist during the run.
		result.socketsWhileAlive = listSockets();
		result.records = listRecords();
		{
			const self = selfView(result.records, result.nativeSessionId);
			result.selfGardenId = self.gardenId;
			result.selfRecordCount = self.count;
			result.selfTranscriptPath = self.transcriptPath;
		}
		if (wantReplace) {
			phase = 1;
			send({ type: "new_session", id: "n1" });
		} else {
			phase = 3;
			finish();
		}
		return;
	}
	if (phase === 1 && evt.command === "new_session") {
		result.replaceOk = evt.success === true;
		result.replaceCancelled = data?.cancelled === true;
		phase = 2;
		send({ type: "get_state", id: "g2" });
		return;
	}
	if (phase === 2 && evt.command === "get_state") {
		result.replacedNativeSessionId = data?.sessionId ?? null;
		result.socketsAfterReplace = listSockets();
		result.recordsAfterReplace = listRecords();
		{
			const self = selfView(result.recordsAfterReplace, result.replacedNativeSessionId);
			result.replacedGardenId = self.gardenId;
			result.replacedRecordCount = self.count;
		}
		phase = 3;
		finish();
	}
});

child.on("error", (err: Error) => {
	process.stderr.write(`resident-rpc-drive: spawn failed: ${err.message}\n`);
	process.exit(2);
});
child.on("exit", (code: number | null) => {
	result.exitCode = code;
	if (phase < 3) finish();
});

// kick off
send({ type: "get_state", id: "g1" });
