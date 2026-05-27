/**
 * entwurf-async — shared state and async-resume launcher.
 *
 * Two callers need the same async machinery:
 *   - the in-pi `entwurf_resume` tool (pi-extensions/entwurf.ts) — calls this
 *     module directly via `spawnEntwurfResumeAsync`.
 *   - the entwurf-control `spawn_async_resume` RPC (pi-extensions/entwurf-control.ts,
 *     Phase B Step 2) — calls the same launcher from RPC dispatch so the MCP
 *     bridge surface (Phase B Step 3) can delegate replyable async resumes
 *     here instead of cloning the body. Preserves the "this bridge is not a
 *     second harness" invariant.
 *
 * Both callers share a single Map (`activeEntwurfs`) — `/entwurf-status` sees
 * every async task regardless of which surface spawned it. This module is the
 * SSOT for that state; importers must not maintain their own parallel maps.
 *
 * No ExtensionAPI dependency: the launcher accepts callbacks for the two
 * ExtensionAPI touchpoints (entry append + completion delivery), so the lib
 * stays platform-neutral and both callsites supply their own parent-session
 * notification surface.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	analyzeSessionFileLike,
	getEntwurfExplicitExtensions,
	mirrorChildStderr,
	readSessionHeader,
} from "./entwurf-core.js";

// Local copy of the POSIX-safe quoter — must match the reference body in
// `scripts/check-shell-quote.ts` and the production sites in entwurf.ts and
// entwurf-core.ts. The gate enforces source parity across all three sites.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const ENTWURF_ENTRY_TYPE = "entwurf-task";
const SESSIONS_BASE = path.join(os.homedir(), ".pi", "agent", "sessions");

export interface AsyncEntwurfInfo {
	taskId: string;
	sessionFile: string;
	pid: number;
	host: string;
	task: string;
	// Optional: for local spawn/resume this is the saved-session-header cwd
	// (the authority for cold resume — see entwurf-core.ts INVARIANT block
	// and #9). For remote spawn/resume the spawn-side cwd is ssh-internal and
	// not always knowable here; we record it when present rather than fall
	// back to the resumer's `process.cwd()`, which would re-introduce #9.
	cwd?: string;
	model?: string;
	startTime: number;
	status: "running" | "completed" | "failed";
	exitCode?: number;
	output?: string;
	error?: string;
	stopReason?: string;
	explicitExtensions?: string[];
	warnings?: string[];
}

export type ActiveEntwurfInfo = AsyncEntwurfInfo & { proc?: ChildProcess };

/**
 * Shared map of active async entwurfs (spawn + resume). Both the native pi
 * tool surface and the entwurf-control RPC dispatch surface (Phase B) write
 * here; `/entwurf-status` reads here. Module-level singleton — do NOT create
 * a parallel map at the callsite.
 */
export const activeEntwurfs = new Map<string, ActiveEntwurfInfo>();

/** Cheap liveness check for a given pid. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Find the entwurf session file for the given taskId by scanning sessions/. */
export function findEntwurfSession(taskId: string): string | null {
	const active = activeEntwurfs.get(taskId);
	if (active?.sessionFile) return active.sessionFile;

	try {
		for (const dir of fs.readdirSync(SESSIONS_BASE)) {
			const dirPath = path.join(SESSIONS_BASE, dir);
			try {
				if (!fs.statSync(dirPath).isDirectory()) continue;
				for (const file of fs.readdirSync(dirPath)) {
					if (file.includes(`entwurf-${taskId}`)) {
						return path.join(dirPath, file);
					}
				}
			} catch {
				/* skip inaccessible dirs */
			}
		}
	} catch {
		/* sessions base not found */
	}
	return null;
}

const analyzeSessionFile = analyzeSessionFileLike;

// ============================================================================
// Async resume launcher
// ============================================================================

export interface AsyncResumeParams {
	taskId: string;
	prompt: string;
	host?: string;
}

/**
 * Completion-time payload — what the callsite delivers to the parent session
 * via its ExtensionAPI. Mirrors the body of `pi.sendMessage(message, {
 * triggerTurn: true, deliverAs: "followUp" })` without binding the lib to
 * the ExtensionAPI type.
 */
export interface AsyncResumeCompletionMessage {
	customType: "entwurf-complete";
	content: string;
	display: true;
	details: {
		taskId: string;
		originalTaskId: string;
		status: AsyncEntwurfInfo["status"];
		error?: string;
		stopReason?: string;
		exitCode?: number;
		explicitExtensions?: string[];
		warnings?: string[];
	};
}

export interface AsyncResumeCallbacks {
	/**
	 * Append a record of the spawn into the parent session's history. Wraps
	 * `pi.appendEntry(ENTWURF_ENTRY_TYPE, data)` at the callsite.
	 */
	appendActiveEntry: (data: AsyncEntwurfInfo) => void;
	/**
	 * Deliver completion as a followUp message into the parent session. Wraps
	 * `pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" })`
	 * at the callsite. Called exactly once when the detached child exits.
	 */
	deliverCompletion: (message: AsyncResumeCompletionMessage) => void;
}

export interface AsyncResumeAck {
	text: string;
	details: { taskId: string; originalTaskId: string; sessionFile: string; pid: number };
}

/**
 * Spawn an async entwurf_resume. Detached child + immediate ack; completion is
 * delivered via `callbacks.deliverCompletion` when the child exits.
 *
 * Identity Preservation Rule is enforced here: the model recorded in the
 * session JSONL (or the in-memory spawn-time info) is the resume's identity;
 * no model parameter overrides this. Throws when neither carrier supplies a
 * model — never invent identity on resume.
 *
 * Cold-resume cwd authority (#9): the saved session header cwd is the
 * authority. In-process spawn-time info.cwd is used when present, header cwd
 * is the fallback, neither falls back to the resumer's `process.cwd()`.
 */
export async function spawnEntwurfResumeAsync(
	params: AsyncResumeParams,
	callbacks: AsyncResumeCallbacks,
): Promise<AsyncResumeAck> {
	const info = activeEntwurfs.get(params.taskId);

	let sessionFile: string | null = null;
	let host = params.host ?? "local";

	if (info) {
		sessionFile = info.sessionFile;
		host = params.host ?? info.host;
	} else {
		sessionFile = findEntwurfSession(params.taskId);
	}

	if (!sessionFile) {
		// Fail-fast: caller asked to resume a taskId that has no traceable
		// session (not in this session's active-entwurfs map, no match on
		// disk). Throw so the agent stops trying to continue this task.
		throw new Error(
			`Cannot resume entwurf_resume async: session not found for taskId=${params.taskId}. ` +
				`The task may belong to a different pi session, have been cleaned up, ` +
				`or the id may be wrong. Call entwurf_status to list active entwurfs.`,
		);
	}

	const isRemote = host !== "local";
	if (!isRemote && !fs.existsSync(sessionFile)) {
		throw new Error(
			`Cannot resume entwurf_resume async: session file missing at ${sessionFile} ` +
				`(taskId=${params.taskId}, host=${host}). ` +
				`The session record exists in memory but the JSONL on disk is gone — ` +
				`likely cleaned up or deleted externally.`,
		);
	}

	const sessionAnalysis = !isRemote && fs.existsSync(sessionFile) ? analyzeSessionFile(sessionFile) : null;
	// Identity Preservation Rule: prefer in-process spawn-time record (most
	// accurate), then session JSONL recorded model. Refuse if neither — we
	// never invent an identity for a resume.
	const resumeModel = info?.model ?? sessionAnalysis?.lastModel ?? null;
	if (!resumeModel) {
		// Identity Preservation Rule (throwing form). Refuse to resume when
		// neither the in-memory record nor the on-disk session can tell us
		// *which model* this entwurf was. Inventing an identity is worse
		// than stopping — this is the whole point of the rule.
		throw new Error(
			`Cannot resume ${params.taskId}: session has no recorded model ` +
				`(file empty, corrupted, or never reached an assistant turn). ` +
				`Start a fresh entwurf instead — identity must come from the session.`,
		);
	}
	// Pass recorded provider so ACP-routed spawns get re-injected with the
	// pi-shell-acp bridge on resume (otherwise pi cannot resolve the provider
	// and the resume dies silently — see getEntwurfExplicitExtensions guard).
	const explicitExtensions = getEntwurfExplicitExtensions(
		resumeModel,
		isRemote,
		sessionAnalysis?.lastProvider ?? undefined,
	);
	const resumeProvider = explicitExtensions.provider ?? sessionAnalysis?.lastProvider ?? undefined;

	const piArgs = ["--mode", "json", "-p", "--no-extensions", ...explicitExtensions.args];
	if (resumeProvider) piArgs.push("--provider", resumeProvider);
	piArgs.push("--model", explicitExtensions.modelOverride ?? resumeModel, "--session", sessionFile, params.prompt);

	let command: string;
	let args: string[];
	if (isRemote) {
		command = "ssh";
		const remoteCmd = `pi ${piArgs.map(shellQuote).join(" ")}`;
		args = [host, remoteCmd];
	} else {
		command = "pi";
		args = piArgs;
	}

	const resumeTaskId = crypto.randomUUID().slice(0, 8);
	// `info?.cwd` is the in-process carrier (spawn + resume in the same pi
	// process); the JSONL header is the cross-process carrier. Neither falls
	// back to `process.cwd()` — the resumer's cwd is NOT a valid authority
	// for cold resume, and a silent fallback re-introduces #9. Local fail-fast
	// when both carriers are absent.
	const headerCwd = readSessionHeader(sessionFile)?.cwd;
	const cwd = info?.cwd ?? headerCwd;
	if (!isRemote && !cwd) {
		throw new Error(
			`Cannot resume taskId "${params.taskId}": saved session header has no cwd ` +
				`and no in-process cwd carrier was available. The header cwd is the ` +
				`authority for cold resume (see #9).`,
		);
	}

	const proc = spawn(command, args, {
		cwd: isRemote ? undefined : cwd,
		shell: false,
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
	});
	// Detach so the resume child survives the parent pi shutting down — the
	// JSONL on disk is the authoritative completion record, not the parent's
	// in-memory map.
	proc.unref();
	mirrorChildStderr(proc);

	const pid = proc.pid ?? 0;

	const resumeInfo: ActiveEntwurfInfo = {
		taskId: resumeTaskId,
		sessionFile,
		pid,
		host,
		task: `resume:${params.taskId} — ${params.prompt.slice(0, 60)}`,
		cwd,
		model: resumeModel,
		startTime: Date.now(),
		status: "running",
		explicitExtensions: [...explicitExtensions.names],
		warnings: [...explicitExtensions.warnings],
		proc,
	};
	activeEntwurfs.set(resumeTaskId, resumeInfo);

	callbacks.appendActiveEntry({
		taskId: resumeTaskId,
		sessionFile,
		pid,
		host,
		task: resumeInfo.task,
		cwd,
		startTime: resumeInfo.startTime,
		model: resumeInfo.model,
		status: resumeInfo.status,
		explicitExtensions: resumeInfo.explicitExtensions,
		warnings: resumeInfo.warnings,
	});

	let stderr = "";
	proc.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	proc.on("close", (code) => {
		resumeInfo.exitCode = code ?? 0;
		resumeInfo.status = code === 0 ? "completed" : "failed";
		delete resumeInfo.proc;

		if (!isRemote && sessionFile && fs.existsSync(sessionFile)) {
			const analysis = analyzeSessionFile(sessionFile);
			if (analysis.lastModel) resumeInfo.model = analysis.lastModel;
			resumeInfo.stopReason = analysis.lastStopReason ?? undefined;
			resumeInfo.error = analysis.lastError ?? undefined;
			if (!resumeInfo.error && resumeInfo.stopReason === "error") {
				resumeInfo.error = "Entwurf model returned stopReason=error";
			}
			if ((resumeInfo.error || resumeInfo.stopReason === "error") && resumeInfo.exitCode === 0) {
				resumeInfo.exitCode = 1;
			}
			if (resumeInfo.error || resumeInfo.stopReason === "error") resumeInfo.status = "failed";

			resumeInfo.output = analysis.lastAssistantText ?? resumeInfo.error ?? stderr ?? "(no output)";
			const summaryText = analysis.lastAssistantText ?? resumeInfo.error ?? `exit code ${resumeInfo.exitCode}`;
			const summary =
				summaryText.slice(0, 2000) + (summaryText.length > 2000 ? "\n(truncated, full: session-recap)" : "");
			const meta = [
				resumeInfo.explicitExtensions?.length ? `Compat: ${resumeInfo.explicitExtensions.join(", ")}` : null,
				resumeInfo.warnings?.length ? `Warnings: ${resumeInfo.warnings.join(" | ")}` : null,
			]
				.filter(Boolean)
				.join("\n");

			callbacks.deliverCompletion({
				customType: "entwurf-complete",
				content: [
					`${resumeInfo.status === "failed" ? "❌" : "🏁"} resume \`${resumeTaskId}\` (← ${params.taskId}) ${resumeInfo.status} (${analysis.turns} turns, $${analysis.cost.toFixed(4)})`,
					meta || null,
					summary,
				]
					.filter(Boolean)
					.join("\n\n"),
				display: true,
				details: {
					taskId: resumeTaskId,
					originalTaskId: params.taskId,
					status: resumeInfo.status,
					error: resumeInfo.error,
					stopReason: resumeInfo.stopReason,
					explicitExtensions: resumeInfo.explicitExtensions,
					warnings: resumeInfo.warnings,
				},
			});
		} else if (isRemote) {
			resumeInfo.status = resumeInfo.exitCode === 0 ? "completed" : "failed";
			resumeInfo.error =
				resumeInfo.exitCode === 0 ? undefined : stderr.slice(0, 500) || `exit code ${resumeInfo.exitCode}`;
			resumeInfo.output = resumeInfo.error ?? `Remote session: ${sessionFile}`;
			const stderrNote = stderr ? `stderr:\n${stderr.slice(0, 1000)}` : null;
			callbacks.deliverCompletion({
				customType: "entwurf-complete",
				content: [
					`${resumeInfo.status === "failed" ? "❌" : "🏁"} resume \`${resumeTaskId}\` (← ${params.taskId}) ${resumeInfo.status} (${host}, remote)`,
					`Session: ${sessionFile}`,
					stderrNote,
				]
					.filter(Boolean)
					.join("\n\n"),
				display: true,
				details: {
					taskId: resumeTaskId,
					originalTaskId: params.taskId,
					status: resumeInfo.status,
					exitCode: resumeInfo.exitCode,
					error: resumeInfo.error,
					explicitExtensions: resumeInfo.explicitExtensions,
					warnings: resumeInfo.warnings,
				},
			});
		} else if (stderr || resumeInfo.exitCode !== 0) {
			resumeInfo.status = "failed";
			resumeInfo.error = stderr.slice(0, 500) || `exit code ${resumeInfo.exitCode} (no session file)`;
			resumeInfo.output = resumeInfo.error;
			callbacks.deliverCompletion({
				customType: "entwurf-complete",
				content: `❌ resume \`${resumeTaskId}\` (← ${params.taskId}) failed (${host}, no session file): ${resumeInfo.error}`,
				display: true,
				details: {
					taskId: resumeTaskId,
					originalTaskId: params.taskId,
					status: "failed",
					exitCode: resumeInfo.exitCode,
					error: resumeInfo.error,
					explicitExtensions: resumeInfo.explicitExtensions,
					warnings: resumeInfo.warnings,
				},
			});
		}
	});

	proc.on("error", (err) => {
		resumeInfo.status = "failed";
		resumeInfo.error = err.message;
		resumeInfo.output = err.message;
		delete resumeInfo.proc;
	});

	return {
		text: [
			`🔄 Resume spawned (async)`,
			`Resume ID: ${resumeTaskId}`,
			`Original: ${params.taskId}`,
			`Session: ${sessionFile}`,
			`PID: ${pid}`,
			"",
			"Use entwurf_status to check progress. You'll be notified on completion.",
		].join("\n"),
		details: { taskId: resumeTaskId, originalTaskId: params.taskId, sessionFile, pid },
	};
}
