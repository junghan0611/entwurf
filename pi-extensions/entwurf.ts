/**
 * entwurf — entwurf a task to an independent agent process.
 *
 * Spawns a dedicated pi process to run a task rather than using a sub-agent
 * inside the caller. It's inter-process coordination, not recursion inside
 * one session. Local and SSH-remote spawns follow the same pattern.
 *
 * Modes:
 *   async — spawn and return immediately; notify the caller session on
 *           completion. The entwurf session persists and is resumable. (default)
 *   sync  — block until completion, return the result. Opt in only for
 *           short status checks.
 *
 * The sync path lives in `./lib/entwurf-core.js` so the same core can be
 * re-exposed by `mcp/pi-tools-bridge` as an MCP tool — single logic, two
 * surfaces.
 *
 * Async entwurf wiring:
 *   - the caller session exposes a Unix socket via --entwurf-control
 *     (see `pi-extensions/entwurf-control.ts` — the peer extension)
 *   - the entwurf itself runs WITHOUT --entwurf-control, because a socket
 *     server would keep `pi -p` from exiting
 *   - on completion, proc.on('close') injects a followUp message into the
 *     caller session
 *   - entwurf_status reports live state (pid + JSONL parse)
 *
 * Usage:
 *   LLM calls the `entwurf` tool  → a separate pi process is spawned
 *   /entwurf "task"               → command-line form
 *
 * Runtime dependency:
 *   - `pi-extensions/entwurf-control.ts` loaded in the CALLER session, with
 *     `--entwurf-control` enabled there. The entwurf itself does not need
 *     the extension.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type AsyncEntwurfInfo,
	activeEntwurfs,
	ENTWURF_ENTRY_TYPE,
	findEntwurfSession,
	isProcessAlive,
	spawnEntwurfResumeAsync,
} from "./lib/entwurf-async.js";
import {
	analyzeSessionFileLike,
	cwdToSessionDir,
	DEFAULT_ENTWURF_MODEL,
	enrichTaskWithProjectContext,
	ensureEntwurfOncePerTarget,
	formatSyncSummary,
	getEntwurfExplicitExtensions,
	getRegistryRouting,
	markEntwurfTargetUsed,
	mirrorChildStderr,
	resolveEntwurfTarget,
	resolveGuardTargetKey,
	runEntwurfResumeSync,
	runEntwurfSync,
} from "./lib/entwurf-core.js";

function getParentSessionId(pi: ExtensionAPI): string {
	const sm = (pi as unknown as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
	return sm?.getSessionId?.() ?? "__no_session__";
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ============================================================================
// Async resume/spawn — state, types, and helpers live in lib/entwurf-async.ts
// (Phase B Step 1). entwurf-control RPC dispatch (Phase B Step 2) and the
// MCP bridge surface (Phase B Step 3) share the same `activeEntwurfs` map
// and the same `spawnEntwurfResumeAsync` launcher via that lib — SSOT.
// ============================================================================

const analyzeSessionFile = analyzeSessionFileLike;

// ============================================================================
// Async entwurf (entwurf-control peer pattern)
// ============================================================================

async function runEntwurfAsync(
	pi: ExtensionAPI,
	task: string,
	options: {
		host?: string;
		cwd?: string;
		provider?: string;
		model?: string;
	},
): Promise<{ taskId: string; sessionFile: string; pid: number }> {
	const host = options.host ?? "local";
	const isRemote = host !== "local";
	const taskId = crypto.randomUUID().slice(0, 8);
	const cwd = options.cwd ?? process.cwd();
	const enrichedTask = enrichTaskWithProjectContext(task, cwd);

	// Entwurf Target Registry: async spawns go through the same gate as sync.
	// Identity Preservation Rule: only spawn paths consult the registry; resume
	// paths preserve the recorded identity verbatim.
	const fallbackModel = options.model && options.model.trim() ? options.model : DEFAULT_ENTWURF_MODEL;
	const target = resolveEntwurfTarget({ provider: options.provider, model: fallbackModel });
	const effectiveModel = target.model;

	const sessionDir = cwdToSessionDir(cwd);
	fs.mkdirSync(sessionDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const sessionFile = path.join(sessionDir, `${timestamp}_entwurf-${taskId}.jsonl`);
	const routing = getRegistryRouting(target, isRemote);

	// --no-extensions: global extensions would hold the event loop and block
	//                  `pi -p` from exiting after the task completes.
	// No --entwurf-control: the socket server would keep the process alive.
	const piArgs = [
		"--mode",
		"json",
		"-p",
		"--no-extensions",
		...routing.args,
		"--session",
		sessionFile,
		"--provider",
		routing.provider,
		"--model",
		routing.modelOverride ?? target.model,
		enrichedTask,
	];

	const parentSessionId = process.env.PI_SESSION_ID;

	let command: string;
	let args: string[];
	if (isRemote) {
		command = "ssh";
		const envPrefix = parentSessionId ? `PARENT_SESSION_ID=${shellQuote(parentSessionId)} ` : "";
		const remoteCmd = `cd ${shellQuote(cwd)} && ${envPrefix}pi ${piArgs.map(shellQuote).join(" ")}`;
		args = [host, remoteCmd];
	} else {
		command = "pi";
		args = piArgs;
	}

	const proc = spawn(command, args, {
		cwd: isRemote ? undefined : cwd,
		shell: false,
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
		env: {
			...process.env,
			...(parentSessionId ? { PARENT_SESSION_ID: parentSessionId } : {}),
		},
	});
	// Fire-and-forget async: don't let the child's stderr pipe keep the parent's
	// event loop alive. Interactive parents stay alive on their own (REPL), so
	// the `close` listener below still fires and delivers the followUp. In
	// `pi -p`, once the parent's turn ends the loop empties and the parent
	// exits cleanly — the child continues detached and the listener simply
	// doesn't fire (no session left to notify, which is the right outcome).
	proc.unref();
	mirrorChildStderr(proc);

	const pid = proc.pid ?? 0;

	const info: AsyncEntwurfInfo & { proc?: ChildProcess } = {
		taskId,
		sessionFile: isRemote ? `${host}:${sessionFile}` : sessionFile,
		pid,
		host,
		task,
		cwd,
		model: effectiveModel,
		startTime: Date.now(),
		status: "running",
		explicitExtensions: [...routing.names],
		warnings: [...routing.warnings],
		proc,
	};
	activeEntwurfs.set(taskId, info);

	pi.appendEntry(ENTWURF_ENTRY_TYPE, {
		taskId,
		sessionFile: info.sessionFile,
		pid,
		host,
		task,
		cwd,
		model: effectiveModel,
		startTime: info.startTime,
		explicitExtensions: info.explicitExtensions,
		warnings: info.warnings,
	});

	let stderr = "";
	proc.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	proc.on("close", (code) => {
		info.exitCode = code ?? 0;
		info.status = code === 0 ? "completed" : "failed";
		delete info.proc;

		const localSessionFile = isRemote ? null : info.sessionFile;
		if (localSessionFile && fs.existsSync(localSessionFile)) {
			const analysis = analyzeSessionFile(localSessionFile);
			if (analysis.lastModel) info.model = analysis.lastModel;
			info.stopReason = analysis.lastStopReason ?? undefined;
			info.error = analysis.lastError ?? undefined;
			if (!info.error && info.stopReason === "error") {
				info.error = "Entwurf model returned stopReason=error";
			}
			if ((info.error || info.stopReason === "error") && info.exitCode === 0) {
				info.exitCode = 1;
			}
			if (info.error || info.stopReason === "error") info.status = "failed";

			info.output = analysis.lastAssistantText ?? info.error ?? stderr ?? "(no output)";
			const summaryText = analysis.lastAssistantText ?? info.error ?? `exit code ${info.exitCode}`;
			const summary =
				summaryText.slice(0, 2000) + (summaryText.length > 2000 ? "\n(truncated, full: session-recap)" : "");
			const meta = [
				info.explicitExtensions?.length ? `Compat: ${info.explicitExtensions.join(", ")}` : null,
				info.warnings?.length ? `Warnings: ${info.warnings.join(" | ")}` : null,
			]
				.filter(Boolean)
				.join("\n");

			pi.sendMessage(
				{
					customType: "entwurf-complete",
					content: [
						`${info.status === "failed" ? "❌" : "🏁"} entwurf \`${taskId}\` ${info.status} (${host}, ${analysis.turns} turns, $${analysis.cost.toFixed(4)})`,
						meta || null,
						summary,
					]
						.filter(Boolean)
						.join("\n\n"),
					display: true,
					details: {
						taskId,
						host,
						status: info.status,
						turns: analysis.turns,
						cost: analysis.cost,
						error: info.error,
						stopReason: info.stopReason,
						explicitExtensions: info.explicitExtensions,
						warnings: info.warnings,
					},
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (isRemote) {
			// Remote async sessions live on the SSH host, so the caller cannot analyze
			// the JSONL directly. Completion must still be delivered; stderr is a
			// diagnostic stream, not by itself a failure signal. The process exit code
			// remains the transport-level authority here.
			info.status = info.exitCode === 0 ? "completed" : "failed";
			info.error = info.exitCode === 0 ? undefined : stderr.slice(0, 500) || `exit code ${info.exitCode}`;
			info.output = info.error ?? `Remote session: ${info.sessionFile}`;
			const stderrNote = stderr ? `stderr:\n${stderr.slice(0, 1000)}` : null;
			pi.sendMessage(
				{
					customType: "entwurf-complete",
					content: [
						`${info.status === "failed" ? "❌" : "🏁"} entwurf \`${taskId}\` ${info.status} (${host}, remote)`,
						`Session: ${info.sessionFile}`,
						stderrNote,
					]
						.filter(Boolean)
						.join("\n\n"),
					display: true,
					details: {
						taskId,
						host,
						status: info.status,
						exitCode: info.exitCode,
						error: info.error,
						explicitExtensions: info.explicitExtensions,
						warnings: info.warnings,
					},
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (stderr || info.exitCode !== 0) {
			info.status = "failed";
			info.error = stderr.slice(0, 500) || `exit code ${info.exitCode} (no session file)`;
			info.output = info.error;
			pi.sendMessage(
				{
					customType: "entwurf-complete",
					content: `❌ entwurf \`${taskId}\` failed (${host}, no session file): ${info.error}`,
					display: true,
					details: {
						taskId,
						host,
						status: "failed",
						exitCode: info.exitCode,
						error: info.error,
						explicitExtensions: info.explicitExtensions,
						warnings: info.warnings,
					},
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		}
	});

	proc.on("error", (err) => {
		info.status = "failed";
		info.output = err.message;
		delete info.proc;
	});

	return { taskId, sessionFile: info.sessionFile, pid };
}

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- session_start: restore active entwurfs ---
	pi.on("session_start", async (_event, ctx) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && (entry as { customType?: string }).customType === ENTWURF_ENTRY_TYPE) {
				const data = (entry as { data?: AsyncEntwurfInfo }).data;
				if (!data?.taskId) continue;

				if (activeEntwurfs.has(data.taskId)) continue;

				const alive = data.pid > 0 && isProcessAlive(data.pid);

				activeEntwurfs.set(data.taskId, {
					...data,
					status: alive ? "running" : "completed",
				});
			}
		}
	});

	// --- entwurf tool (sync + async) ---
	// Extracted schema — inline Type.Object with many Optional + nested Union
	// triggers TS2589 ("Type instantiation excessively deep") under 0.70.0's
	// registerTool generic inference. Extraction flattens one recursion level.
	const entwurfModeSchema = Type.Union([Type.Literal("sync"), Type.Literal("async")], {
		description:
			"async (default since 0.7.0): spawn and return immediately with taskId; the parent turn is not blocked. sync: wait for completion and block the parent turn — opt in only for short status checks (<5s).",
		default: "async",
	});
	const entwurfParameters = Type.Object({
		task: Type.String({ description: "The task to entwurf" }),
		host: Type.Optional(Type.String({ description: "SSH host (default: 'local'). e.g., 'gpu1i'" })),
		cwd: Type.Optional(Type.String({ description: "Working directory for the entwurf" })),
		provider: Type.Optional(
			Type.String({
				description:
					"Provider id (e.g. 'pi-shell-acp', 'openai-codex'). Pair with `model` to disambiguate against the Entwurf Target Registry.",
			}),
		),
		model: Type.Optional(
			Type.String({
				description:
					"Model id. Qualified ('pi-shell-acp/claude-sonnet-4-6') or bare ('claude-sonnet-4-6'). Bare names must resolve unambiguously in the registry; otherwise pass `provider`.",
			}),
		),
		mode: Type.Optional(entwurfModeSchema),
	});

	// The schema (runtime) and the params type (compile-time) describe the same
	// contract. Same TS2589 rationale as registerSessionTool in entwurf-control.ts:
	// schema-driven inference would push past TypeScript's recursion budget, so we
	// write both explicitly. Revisit conditions identical to registerSessionTool.
	type EntwurfParams = {
		task: string;
		host?: string;
		cwd?: string;
		provider?: string;
		model?: string;
		mode?: "sync" | "async";
	};

	// TS2589 workaround — 0.70.0's registerTool generic couples typebox
	// `Static<TParameters>` with `TDetails` inference, and our parameter
	// schemas (Optional + nested Union) push TypeScript past its recursion
	// depth. Each `execute` body still asserts `Promise<AgentToolResult<unknown>>`
	// so the runtime contract is locked; this cast only relaxes the registration
	// boundary. Revisit when pi-coding-agent exposes a type helper that
	// short-circuits the depth (or when typebox narrows Static).
	const registerTool = pi.registerTool as (def: any) => void;

	registerTool({
		name: "entwurf",
		label: "Entwurf",
		description:
			"Entwurf a task to an independent agent process. Spawns a separate pi instance (local or remote via SSH) and returns the result. Use when a task needs isolated execution or should run on a different machine.\n\nModes:\n- async (default): Spawn and return immediately with a Task ID — the parent turn is not blocked. Get notified on completion. Use entwurf_status to check progress. Suitable for review, research, build, anything that takes more than a few seconds.\n- sync: Wait for completion, return result. Blocks the parent turn until the child finishes — use only for short status checks (<5s).",
		promptSnippet: "Spawn independent agent for isolated task execution (local or SSH remote)",
		promptGuidelines: [
			"Use entwurf for tasks that should run in isolation — different cwd, different machine, or resource-intensive work.",
			"For SSH remote: set host to SSH config name (e.g., 'gpu1i'). The remote must have pi installed.",
			"mode='async' (default): Spawn and return immediately. Get notified on completion. Use entwurf_status to check progress. Default since 0.7.0 because review/research/build calls dominate spawn usage and blocking the parent turn for >30s reads as 'stuck' to the operator.",
			"Spawn routing comes from the Entwurf Target Registry (~/.pi/agent/entwurf-targets.json). Caller passes provider+model (or qualified 'provider/model'); unregistered tuples are refused with a list of allowed targets. Default when omitted: openai-codex/gpt-5.4.",
			"Bare model auto-resolves only when the registry has exactly one non-explicitOnly match. Example: 'gpt-5.4' resolves to native openai-codex; for ACP gpt-5.4, pass provider='pi-shell-acp' explicitly.",
			"mode='sync': Wait for completion, return result. Blocks the parent turn — opt in only for short status checks (<5s) or one-line queries where blocking is acceptable.",
			"async entwurfs save sessions — use entwurf_status to check, or resume later.",
			"When a task involves research, analysis, writing, or anything that takes more than a few seconds → use async.",
			"Async entwurfs save sessions — use entwurf_status to check, or resume later.",
			"When delegating tasks that produce notes, instruct the entwurf to use llmlog (not botlog). Entwurfd work is agent-to-agent, not public.",
		],
		parameters: entwurfParameters,

		async execute(
			_toolCallId: string,
			params: EntwurfParams,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			// Default `async` since 0.7.0 — review/research/build dominate spawn
			// usage, and blocking the parent turn for >30s reads as "stuck" to the
			// operator. Sync is opt-in for short status checks. Note: this is the
			// in-pi tool surface; the external MCP host surface
			// (mcp/pi-tools-bridge) intentionally exposes sync only — see that
			// file's tool description for the deferred async design round.
			const mode = params.mode ?? "async";

			const guardSessionId = getParentSessionId(pi);
			const guardTargetKey = resolveGuardTargetKey(params.provider, params.model);
			ensureEntwurfOncePerTarget(guardSessionId, guardTargetKey);

			if (mode === "async") {
				const result = await runEntwurfAsync(pi, params.task, {
					host: params.host,
					cwd: params.cwd,
					provider: params.provider,
					model: params.model,
				});
				markEntwurfTargetUsed(guardSessionId, guardTargetKey);

				return {
					content: [
						{
							type: "text",
							text: [
								`🚀 Async entwurf spawned`,
								`Task ID: ${result.taskId}`,
								`Session: ${result.sessionFile}`,
								`PID: ${result.pid}`,
								`Host: ${params.host ?? "local"}`,
								"",
								"Use entwurf_status to check progress. You'll be notified on completion.",
							].join("\n"),
						},
					],
					details: {
						taskId: result.taskId,
						sessionFile: result.sessionFile,
						pid: result.pid,
						host: params.host ?? "local",
						mode: "async",
					},
				};
			}

			// sync mode — shares the entwurf-core path with mcp/pi-tools-bridge
			const result = await runEntwurfSync(params.task, {
				host: params.host,
				cwd: params.cwd,
				provider: params.provider,
				model: params.model,
				signal: signal ?? undefined,
				onUpdate: (text) => {
					onUpdate?.({
						content: [{ type: "text", text: `[${params.host ?? "local"}] ${text.slice(0, 200)}...` }],
						details: {},
					});
				},
			});
			markEntwurfTargetUsed(guardSessionId, guardTargetKey);

			// Fail-fast under pi 0.70: AgentToolResult lost `isError`; the contract
			// is now "throw on failure instead of encoding errors in content". A
			// non-zero exit is a entwurf failure — surface it as an exception so
			// the caller cannot treat this as a successful (but empty) result.
			if (result.exitCode !== 0) {
				const summary = formatSyncSummary(result);
				const reason = result.error ? `: ${result.error}` : "";
				throw new Error(
					`entwurf sync failed (exitCode=${result.exitCode}${reason}). ` +
						`host=${result.host} model=${result.model} turns=${result.turns}. ` +
						`Session: ${result.sessionFile}\n\n${summary}`,
				);
			}

			return {
				content: [{ type: "text", text: formatSyncSummary(result) }],
				details: {
					task: result.task,
					host: result.host,
					exitCode: result.exitCode,
					turns: result.turns,
					cost: result.cost,
					model: result.model,
					sessionFile: result.sessionFile,
					error: result.error,
					stopReason: result.stopReason,
					explicitExtensions: result.explicitExtensions,
					warnings: result.warnings,
				},
			};
		},
	});

	// --- entwurf_status tool ---
	registerTool({
		name: "entwurf_status",
		label: "Entwurf Status",
		description:
			"Check status of async entwurf tasks. Without taskId, lists all tracked entwurfs. With taskId, shows detailed status including last message.",
		parameters: Type.Object({
			taskId: Type.Optional(Type.String({ description: "Specific entwurf task ID. Omit to list all." })),
		}),

		async execute(
			_toolCallId: string,
			params: { taskId?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			if (params.taskId) {
				const info = activeEntwurfs.get(params.taskId);
				if (!info) {
					// Fail-fast under pi 0.70: explicit unknown taskId is a caller
					// mistake (or a stale reference). Throw rather than return a
					// content-only "not found" message that the model might paper over.
					throw new Error(
						`Unknown entwurf task: ${params.taskId}. ` +
							`The taskId is not tracked by this session — it may belong to a different pi session, ` +
							`have completed and been cleaned up, or never existed. ` +
							`Call entwurf_status without taskId to list active entwurfs.`,
					);
				}

				const alive = info.pid > 0 && isProcessAlive(info.pid);
				if (info.status === "running" && !alive) {
					info.status = "completed";
				}

				let lastMessage: string | null = null;
				let stats = { turns: 0, cost: 0 };
				if (info.host === "local" && fs.existsSync(info.sessionFile)) {
					const analysis = analyzeSessionFile(info.sessionFile);
					lastMessage = analysis.lastAssistantText;
					stats = { turns: analysis.turns, cost: analysis.cost };
					if (analysis.lastModel) info.model = analysis.lastModel;
					info.stopReason = analysis.lastStopReason ?? info.stopReason;
					info.error = analysis.lastError ?? info.error;
					if (!info.error && info.stopReason === "error") {
						info.error = "Entwurf model returned stopReason=error";
					}
					if (info.error || info.stopReason === "error") info.status = "failed";
					if ((info.error || info.stopReason === "error") && info.exitCode === 0) info.exitCode = 1;
				}

				const elapsed = Math.round((Date.now() - info.startTime) / 1000);

				return {
					content: [
						{
							type: "text",
							text: [
								`Task: ${info.taskId}`,
								`Status: ${info.status}`,
								`Host: ${info.host}`,
								`Elapsed: ${elapsed}s`,
								`Turns: ${stats.turns}`,
								`Cost: $${stats.cost.toFixed(4)}`,
								`Session: ${info.sessionFile}`,
								info.model ? `Model: ${info.model}` : null,
								info.exitCode !== undefined ? `Exit: ${info.exitCode}` : null,
								info.stopReason ? `Stop reason: ${info.stopReason}` : null,
								info.explicitExtensions?.length ? `Compat: ${info.explicitExtensions.join(", ")}` : null,
								info.warnings?.length ? `Warnings: ${info.warnings.join(" | ")}` : null,
								info.error ? `Error: ${info.error}` : null,
								lastMessage ? `\nLast message:\n${lastMessage.slice(0, 3000)}` : null,
							]
								.filter(Boolean)
								.join("\n"),
						},
					],
					details: {
						taskId: info.taskId,
						status: info.status,
						host: info.host,
						elapsed,
						turns: stats.turns,
						cost: stats.cost,
						exitCode: info.exitCode,
						model: info.model,
						error: info.error,
						stopReason: info.stopReason,
						explicitExtensions: info.explicitExtensions,
						warnings: info.warnings,
					},
				};
			}

			if (activeEntwurfs.size === 0) {
				return {
					content: [{ type: "text", text: "No active entwurfs." }],
					details: { count: 0 },
				};
			}

			const lines: string[] = [];
			for (const [id, info] of activeEntwurfs) {
				const alive = info.pid > 0 && isProcessAlive(info.pid);
				if (info.status === "running" && !alive) {
					info.status = "completed";
				}
				if (info.host === "local" && fs.existsSync(info.sessionFile)) {
					const analysis = analyzeSessionFile(info.sessionFile);
					if (analysis.lastModel) info.model = analysis.lastModel;
					info.stopReason = analysis.lastStopReason ?? info.stopReason;
					info.error = analysis.lastError ?? info.error;
					if (!info.error && info.stopReason === "error") {
						info.error = "Entwurf model returned stopReason=error";
					}
					if (info.error || info.stopReason === "error") info.status = "failed";
					if ((info.error || info.stopReason === "error") && info.exitCode === 0) info.exitCode = 1;
				}
				const elapsed = Math.round((Date.now() - info.startTime) / 1000);
				const icon = info.status === "running" ? "⏳" : info.status === "completed" ? "✅" : "❌";
				const suffix = info.error ? ` — ${info.error.slice(0, 80)}` : "";
				lines.push(`${icon} ${id} [${info.host}] ${info.status} (${elapsed}s) — ${info.task.slice(0, 60)}${suffix}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: activeEntwurfs.size },
			};
		},
	});

	// --- /entwurf command ---
	pi.registerCommand("entwurf", {
		description: "Entwurf task to independent agent — /entwurf [sync|async] [host:] task",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /entwurf [sync|async] [host:] task\n" +
						"Examples:\n" +
						"  /entwurf review NEXT.md            (async, default since 0.7.0)\n" +
						"  /entwurf gpu1i: train model        (async, remote)\n" +
						"  /entwurf sync git rev-parse HEAD   (sync, short status check)\n" +
						"  /entwurf async build project       (async explicit — same as default)",
					"warning",
				);
				return;
			}

			let host = "local";
			let task = args.trim();
			// Default `async` since 0.7.0 — review/research/build dominate. Sync is
			// opt-in for short status checks.
			let mode: "sync" | "async" = "async";

			if (task.startsWith("sync ")) {
				mode = "sync";
				task = task.slice(5).trim();
			} else if (task.startsWith("async ")) {
				// backward compat — explicit async is now the default, but accepting
				// the keyword preserves the pre-0.7.0 muscle memory.
				mode = "async";
				task = task.slice(6).trim();
			}

			const colonMatch = task.match(/^(\S+):\s+(.+)$/);
			if (colonMatch) {
				host = colonMatch[1];
				task = colonMatch[2];
			}

			const guardSessionId = getParentSessionId(pi);
			const guardTargetKey = resolveGuardTargetKey(undefined, undefined);
			ensureEntwurfOncePerTarget(guardSessionId, guardTargetKey);

			if (mode === "async") {
				ctx.ui.notify(`🚀 Async delegating to ${host}...`, "info");
				const result = await runEntwurfAsync(pi, task, { host });
				markEntwurfTargetUsed(guardSessionId, guardTargetKey);
				ctx.ui.notify(`✅ Spawned: ${result.taskId} (pid ${result.pid})\nSession: ${result.sessionFile}`, "info");
			} else {
				ctx.ui.notify(`🚀 Delegating to ${host}...`, "info");
				const result = await runEntwurfSync(task, { host });
				markEntwurfTargetUsed(guardSessionId, guardTargetKey);
				ctx.ui.notify(
					`✅ ${host}: ${result.turns} turns, $${result.cost.toFixed(4)}\n${result.output.slice(0, 200)}`,
					result.exitCode === 0 ? "info" : "error",
				);
			}
		},
	});

	// --- entwurf_resume tool ---
	// Identity Preservation Rule (AGENTS.md): the parameter schema intentionally
	// does NOT include a `model` field. The model is locked to the saved session's
	// recorded value (or the in-process spawn-time record). host/cwd may shift
	// between spawn and resume; identity may not.
	//
	// Default-async restoration (0.7.x, Phase A of the async-resume regression
	// repair). Before Phase 0.5 this surface was implicitly async (detached
	// spawn + followUp); Phase 0.5 (agent-config e5aa5a1, 2026-04-24) flipped
	// the native default to sync to mirror the MCP bridge surface, which had
	// no `mode` parameter. The 0.7.0 spawn flip (`ad4413e`, 2026-05-19)
	// returned `entwurf` to async-default for the same reason — review /
	// research / build dominate, blocking the parent turn reads as "stuck".
	// Resume was left on sync default at that point, which produced the most
	// awkward state: short spawn (often <5s) defaulted async while long
	// resume (often >30s) blocked the parent turn — exactly backward. This
	// restoration flips resume back to async default, matching pre-Phase-0.5
	// behavior and the 0.7.0 spawn axis. Sync stays available as opt-in for
	// short status-check resumes. The MCP bridge surface (Phase B) is the
	// remaining half — see NEXT.md "Top regression" for the replyable-gate
	// + launcher-extraction design.

	// Same TS2589 schema-vs-type-source rationale as EntwurfParams above.
	type EntwurfResumeParams = {
		taskId: string;
		prompt: string;
		host?: string;
		mode?: "sync" | "async";
	};

	registerTool({
		name: "entwurf_resume",
		label: "Resume Entwurf",
		description:
			"Resume a completed entwurf session. Runs the entwurf's saved session with an additional prompt.\n\n" +
			"Modes:\n" +
			"- async (default since 0.7.x): spawn detached, deliver completion as followUp message to this session. The parent turn is not blocked. Long-running resume (review / research / build) is the dominant case — async matches that expectation and restores the pre-Phase-0.5 native pattern.\n" +
			"- sync: wait for completion, return result inline. Blocks the parent turn — opt in only for short status-check resumes (<5s).\n\n" +
			"Identity Preservation Rule: model is locked to the saved session — this tool does NOT accept a model override. " +
			"host may change (a session can be resumed from a different machine). " +
			"cwd does NOT change at will — cold resume uses the saved session header cwd as authority. " +
			"An explicit cwd override is a debug/migration escape hatch and may forfeit backend continuity (see #9). " +
			"Model may not change. " +
			"If the session has no recorded model the resume is refused rather than falling back to a default.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Entwurf task ID to resume" }),
			prompt: Type.String({ description: "Additional prompt to continue the work" }),
			host: Type.Optional(Type.String({ description: "SSH host override (for remote entwurfs)" })),
			mode: Type.Optional(
				Type.Union([Type.Literal("sync"), Type.Literal("async")], {
					description:
						"async (default since 0.7.x): spawn detached, deliver completion as followUp; the parent turn is not blocked. sync: wait for completion and block the parent turn — opt in only for short status-check resumes (<5s).",
					default: "async",
				}),
			),
		}),

		async execute(
			_toolCallId: string,
			params: EntwurfResumeParams,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			// Default `async` since 0.7.x — long-running resume (review / research /
			// build) dominates this surface, and blocking the parent turn reads as
			// "stuck" to the operator. Sync stays available as opt-in for short
			// status-check resumes (<5s). The MCP bridge surface still exposes
			// sync-only; Phase B (NEXT.md "Top regression") will add a
			// replyable-gated async path there via control-RPC delegation back to
			// this same async branch.
			const mode = params.mode ?? "async";

			// Sync branch — entwurf to core, return inline (mirrors the MCP bridge
			// surface which uses runEntwurfResumeSync directly).
			if (mode === "sync") {
				const info = activeEntwurfs.get(params.taskId);
				const syncHost = params.host ?? info?.host;
				const syncCwd = info?.cwd;
				const result = await runEntwurfResumeSync(params.taskId, params.prompt, {
					host: syncHost,
					cwd: syncCwd,
					signal: signal ?? undefined,
					onUpdate: (text) => {
						onUpdate?.({
							content: [{ type: "text", text: `[${syncHost ?? "local"}] ${text.slice(0, 200)}...` }],
							details: {},
						});
					},
				});

				// Fail-fast under pi 0.70 — non-zero exit from the resumed session is
				// a entwurf failure. Throw so callers can't treat the partial output
				// as a successful resume.
				if (result.exitCode !== 0) {
					const summary = formatSyncSummary(result);
					const reason = result.error ? `: ${result.error}` : "";
					throw new Error(
						`entwurf_resume sync failed (exitCode=${result.exitCode}${reason}). ` +
							`originalTaskId=${params.taskId} resumedTaskId=${result.taskId} ` +
							`host=${result.host} model=${result.model} turns=${result.turns}.\n\n${summary}`,
					);
				}

				return {
					content: [{ type: "text", text: formatSyncSummary(result) }],
					details: {
						task: result.task,
						host: result.host,
						exitCode: result.exitCode,
						turns: result.turns,
						cost: result.cost,
						model: result.model,
						sessionFile: result.sessionFile,
						taskId: result.taskId,
						originalTaskId: params.taskId,
						error: result.error,
						stopReason: result.stopReason,
						explicitExtensions: result.explicitExtensions,
						warnings: result.warnings,
					},
				};
			}

			// Async branch — body lives in `lib/entwurf-async.ts` (Phase B Step 1).
			// The entwurf-control `spawn_async_resume` RPC (Phase B Step 2) and the
			// MCP bridge surface (Phase B Step 3) share the same launcher + state
			// map there, so `/entwurf-status` sees every async task regardless of
			// which surface spawned it. ExtensionAPI touchpoints (entry append +
			// completion delivery) are wired through callbacks at this callsite.
			const ack = await spawnEntwurfResumeAsync(
				{ taskId: params.taskId, prompt: params.prompt, host: params.host },
				{
					appendActiveEntry: (data) => pi.appendEntry(ENTWURF_ENTRY_TYPE, data),
					deliverCompletion: (message) => pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" }),
				},
			);
			return {
				content: [{ type: "text", text: ack.text }],
				details: ack.details,
			};
		},
	});

	// --- /entwurf-status command ---
	pi.registerCommand("entwurf-status", {
		description: "Show status of async entwurfs",
		handler: async (_args, ctx) => {
			if (activeEntwurfs.size === 0) {
				ctx.ui.notify("No active entwurfs.", "info");
				return;
			}
			const lines: string[] = [];
			for (const [id, info] of activeEntwurfs) {
				const alive = info.pid > 0 && isProcessAlive(info.pid);
				if (info.status === "running" && !alive) {
					info.status = "completed";
				}
				if (info.host === "local" && fs.existsSync(info.sessionFile)) {
					const analysis = analyzeSessionFile(info.sessionFile);
					if (analysis.lastModel) info.model = analysis.lastModel;
					info.stopReason = analysis.lastStopReason ?? info.stopReason;
					info.error = analysis.lastError ?? info.error;
					if (!info.error && info.stopReason === "error") {
						info.error = "Entwurf model returned stopReason=error";
					}
					if (info.error || info.stopReason === "error") info.status = "failed";
				}
				const elapsed = Math.round((Date.now() - info.startTime) / 1000);
				const icon = info.status === "running" ? "⏳" : info.status === "completed" ? "✅" : "❌";
				const suffix = info.error ? ` — ${info.error.slice(0, 80)}` : "";
				lines.push(`${icon} ${id} [${info.host}] ${info.status} (${elapsed}s) — ${info.task.slice(0, 60)}${suffix}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
