/**
 * pi-tools-bridge — MCP adapter exposing selected pi-side tools to ACP hosts.
 *
 * Ownership: this adapter lives inside `pi-shell-acp` alongside the rest of the
 * entwurf orchestration surface (pi-extensions/entwurf.ts + lib/entwurf-core.ts +
 * pi/entwurf-targets.json). See AGENTS.md §Entwurf Orchestration.
 *
 * Wiring: registered only via piShellAcpProvider.mcpServers in pi settings.
 * No ambient discovery. The bridge never auto-promotes pi extension tools.
 *
 * Currently exposed tools (scope is deliberately narrow — anything that can live
 * as a local skill should live as a skill, not here):
 *   - entwurf_send    — pi control.ts Unix-socket RPC, transparency envelope
 *   - entwurf_peers   — active pi control sockets only (see control.ts getLiveSessions)
 *   - entwurf_self    — own session identity envelope (sessionId, agentId, cwd, timestamp)
 *   - entwurf         → pi-extensions/lib/entwurf-core (sync mode only)
 *   - entwurf_resume  — saved entwurf session revival by taskId (sync only)
 *
 * Not here on purpose: semantic memory / session search / knowledge-base search.
 * Those are personal-workflow surfaces and live as Claude Code / Codex skills
 * (the "semantic-memory" skill, which in turn shells out to the user's
 * embedding CLI). Keeping them out of the MCP bridge is what lets pi-shell-acp
 * be a generic public package rather than a reflection of one operator's setup.
 *
 * Phase-2b deferred to a separate design round:
 *   - entwurf_status + mode=async — couples with completion-notification contract that MCP
 *     currently has no surface for; design after the resume contract has settled in use.
 *
 * Layer separation (PM-mandated, do not blur):
 *   - entwurf_peers     = active control-socket discovery (control.ts world)
 *   - entwurf_resume   = saved entwurf-session revival (entwurf.ts world)
 *   These are different lookup layers with different sources of truth. entwurf_resume
 *   must NOT depend on a live control socket; the original entwurf process may be dead
 *   and that is the normal case.
 *
 * Model routing:
 *   - entwurf (spawn) — the Entwurf Target Registry is the SSOT. Caller passes
 *     `provider` and/or `model`; resolveEntwurfTarget normalizes to an exact
 *     (provider, model) tuple from `pi/entwurf-targets.json` and routes via
 *     getRegistryRouting. Bare model auto-resolves only when unambiguous and
 *     not flagged `explicitOnly`.
 *   - entwurf_resume — registry is NOT consulted. The session JSONL's recorded
 *     (provider, model) is reused verbatim per Identity Preservation Rule.
 *   - Legacy: PI_ENTWURF_ACP_FOR_CODEX env var still affects the heuristic
 *     getEntwurfExplicitExtensions used only by the resume path. Slated for
 *     removal once the matrix routine settles.
 *
 * Principles:
 *   - explicit forwarding, no dynamic tool discovery
 *   - surface errors (isError:true); never silent empty results
 *   - no user-specific paths baked in; env-configurable with safe defaults
 */

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
	DEFAULT_ENTWURF_MODEL,
	ensureEntwurfOncePerTarget,
	formatSyncSummary,
	markEntwurfTargetUsed,
	resolveGuardTargetKey,
	runEntwurfResumeSync,
	runEntwurfSync,
} from "../../../pi-extensions/lib/entwurf-core.ts";
import { resolveEntwurfResumeMode } from "./resume-mode.ts";

const HOME = os.homedir();
const DEFAULT_ENTWURF_DIR = path.join(HOME, ".pi", "entwurf-control");
const ENTWURF_DIR = process.env.PI_ENTWURF_DIR ?? DEFAULT_ENTWURF_DIR;
const SOCKET_SUFFIX = ".sock";

const RPC_TIMEOUT_MS = Number(process.env.PI_TOOLS_BRIDGE_RPC_TIMEOUT_MS ?? 5_000);

// ============================================================================
// pi control-socket RPC (for entwurf_send)
// ============================================================================

interface RpcResponse {
	type: "response";
	command: string;
	success: boolean;
	error?: string;
	data?: unknown;
}

async function resolveControlSocket(sessionId: string): Promise<string> {
	try {
		await fs.access(ENTWURF_DIR);
	} catch {
		throw new Error(`pi control dir not found at ${ENTWURF_DIR}. Target pi needs --entwurf-control.`);
	}

	if (!sessionId || sessionId.includes("/") || sessionId.includes("..")) {
		throw new Error(`Invalid sessionId: ${sessionId}`);
	}
	const socketPath = path.join(ENTWURF_DIR, `${sessionId}${SOCKET_SUFFIX}`);
	if (existsSync(socketPath)) return socketPath;
	throw new Error(`No pi control socket for sessionId "${sessionId}" under ${ENTWURF_DIR}`);
}

function rpcCall(socketPath: string, payload: Record<string, unknown>): Promise<RpcResponse> {
	return new Promise((resolve, reject) => {
		const conn = net.createConnection(socketPath);
		let buffer = "";
		const timer = setTimeout(() => {
			conn.destroy();
			reject(new Error(`RPC timeout (${RPC_TIMEOUT_MS}ms) to ${socketPath}`));
		}, RPC_TIMEOUT_MS);
		conn.setEncoding("utf8");
		conn.on("connect", () => {
			conn.write(`${JSON.stringify(payload)}\n`);
		});
		conn.on("data", (chunk) => {
			buffer += chunk;
			const nl = buffer.indexOf("\n");
			if (nl !== -1) {
				clearTimeout(timer);
				const line = buffer.slice(0, nl).trim();
				conn.end();
				try {
					resolve(JSON.parse(line) as RpcResponse);
				} catch {
					reject(new Error(`Invalid RPC response: ${line.slice(0, 200)}`));
				}
			}
		});
		conn.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

// ============================================================================
// Live control-socket discovery (for entwurf_peers)
//
// PM-mandated layer separation: this is the *active* control-socket world
// (~/.pi/entwurf-control/*.sock). It is NOT used by entwurf_resume — that
// layer lives over saved entwurf session JSONL files in ~/.pi/agent/sessions
// and must not depend on a live socket.
// ============================================================================

interface LiveSessionInfo {
	sessionId: string;
	socketPath: string;
}

const SOCKET_PROBE_TIMEOUT_MS = 300;

async function isSocketAlive(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const conn = net.createConnection(socketPath);
		const timer = setTimeout(() => {
			conn.destroy();
			resolve(false);
		}, SOCKET_PROBE_TIMEOUT_MS);
		conn.once("connect", () => {
			clearTimeout(timer);
			conn.end();
			resolve(true);
		});
		conn.once("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
	});
}

async function getLiveSessions(): Promise<LiveSessionInfo[]> {
	try {
		await fs.access(ENTWURF_DIR);
	} catch {
		return [];
	}
	const entries = await fs.readdir(ENTWURF_DIR, { withFileTypes: true }).catch(() => []);
	const sessions: LiveSessionInfo[] = [];

	for (const entry of entries) {
		if (!entry.name.endsWith(SOCKET_SUFFIX)) continue;
		if (entry.isSymbolicLink()) continue;
		const socketPath = path.join(ENTWURF_DIR, entry.name);
		if (!(await isSocketAlive(socketPath))) continue;
		const sessionId = entry.name.slice(0, -SOCKET_SUFFIX.length);
		if (!sessionId || sessionId.includes("/")) continue;
		sessions.push({ sessionId, socketPath });
	}

	sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
	return sessions;
}

// ============================================================================
// Helpers
// ============================================================================

function textOk(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

function textErr(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], isError: true };
}

// ============================================================================
// MCP server
// ============================================================================

const server = new McpServer({ name: "pi-tools-bridge", version: "0.1.0" });

// Transparency envelope.
//
// pi-session senders carry a structured sender envelope so the receiver renders
// WHO (agentId, sessionId), FROM WHERE (cwd), and WHEN (timestamp UTC,
// displayed in KST). `entwurf_self` is identity-required and therefore stays
// strict: missing PI_SESSION_ID / PI_AGENT_ID is a wiring break. `entwurf_send`
// is identity-enhanced, not identity-required: an explicitly wired external MCP
// host (Claude Code, Codex, Gemini, …) may deliver into live pi sessions even
// though it has no replyable pi session identity. In that case we attach an
// external, non-replyable envelope so the receiver sees the origin honestly.
class EntwurfEnvelopeWiringError extends Error {
	constructor(missing: string[]) {
		super(
			`entwurf sender envelope wiring incomplete — missing env: ${missing.join(", ")}. ` +
				"This MCP child should inherit PI_SESSION_ID (from entwurf-control) and PI_AGENT_ID " +
				"(from pi-shell-acp/acp-bridge.ts). entwurf_self is only callable from a pi session " +
				"launched with --entwurf-control through the pi-shell-acp bridge.",
		);
	}
}

interface SenderEnvelope {
	sessionId: string;
	agentId: string;
	cwd: string;
	timestamp: string;
	origin?: "pi-session" | "external-mcp";
	replyable?: boolean;
}

function buildStrictPiSenderEnvelope(): SenderEnvelope {
	const sessionId = process.env.PI_SESSION_ID?.trim();
	const agentId = process.env.PI_AGENT_ID?.trim();
	const cwd = process.cwd();
	const missing: string[] = [];
	if (!sessionId) missing.push("PI_SESSION_ID");
	if (!agentId) missing.push("PI_AGENT_ID");
	if (!cwd) missing.push("cwd");
	if (missing.length > 0) throw new EntwurfEnvelopeWiringError(missing);
	return {
		sessionId: sessionId as string,
		agentId: agentId as string,
		cwd,
		timestamp: new Date().toISOString(),
		origin: "pi-session",
		replyable: true,
	};
}

function buildSendSenderEnvelope(): SenderEnvelope {
	const sessionId = process.env.PI_SESSION_ID?.trim();
	const agentId = process.env.PI_AGENT_ID?.trim();
	const cwd = process.cwd();
	if (sessionId && agentId && cwd) return buildStrictPiSenderEnvelope();
	return {
		sessionId: "external-mcp",
		agentId: process.env.PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID?.trim() || "external-mcp/unknown-host",
		cwd,
		timestamp: new Date().toISOString(),
		origin: "external-mcp",
		replyable: false,
	};
}

function formatKstTimestamp(iso: string): string {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return iso;
	const kst = new Date(ms + 9 * 60 * 60 * 1000);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ` +
		`${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`
	);
}

function abbreviateHomeMcp(cwd: string): string {
	const home = process.env.HOME ?? os.homedir();
	if (!home) return cwd;
	if (cwd === home) return "~";
	if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

// Truncate a multi-line body to the first N lines, appending "..." when
// truncated. The send-side preview is what lets the operator (and the sending
// model) see WHAT was actually transmitted — not just the target id. 5 lines is
// a deliberate floor: enough to recognize the message intent without dumping
// the whole body into the response stream.
function previewBody(body: string, maxLines = 5): string {
	const lines = body.split("\n");
	if (lines.length <= maxLines) return body;
	return `${lines.slice(0, maxLines).join("\n")}\n...`;
}

server.tool(
	"entwurf_send",
	"Send a message to another running pi session via its control socket. " +
		"Target by sessionId. The target must be running with --entwurf-control. " +
		"Use entwurf_peers to discover live sessionIds. " +
		"This MCP surface is fire-and-forget: delivery is confirmed, a turn result is not. " +
		"There is no wait/poll: the sender does not block. If the caller needs a result it owns, " +
		"use entwurf(mode=async) + entwurf_resume instead. " +
		"wants_reply is a human-conversation etiquette marker (default false). Set it true only " +
		"when you genuinely want a conversational response back — it shows as '(wants reply)' on " +
		"the receiver render. It is not a delivery flag, not a wait/poll, not a contract; whether " +
		"the receiver replies is decided by the message body. " +
		"When called from inside a pi session, a replyable sender envelope is attached " +
		"automatically from PI_AGENT_ID + PI_SESSION_ID + cwd + now. When called from an " +
		"explicitly wired external MCP host, delivery is still allowed but the envelope is " +
		"marked external/non-replyable; wants_reply=true is rejected because there is no pi " +
		"session address to reply to.",
	{
		sessionId: z.string().min(1).describe("Target session id (UUID)"),
		message: z.string().min(1).describe("Message text to deliver"),
		mode: z.enum(["steer", "follow_up"]).optional().describe("Default follow_up"),
		wants_reply: z
			.boolean()
			.optional()
			.describe(
				"Human-conversation hint. No wait, no polling, no delivery tracking. " +
					"Set true only to surface a '(wants reply)' badge on the receiver. Default false.",
			),
	},
	async ({ sessionId, message, mode, wants_reply }) => {
		try {
			const sender = buildSendSenderEnvelope();
			const effectiveWantsReply = wants_reply === true;
			if (effectiveWantsReply && sender.replyable === false) {
				return textErr(
					"entwurf_send error: wants_reply=true requires a replyable pi-session sender envelope; " +
						"external MCP hosts can deliver messages but cannot request a reply path.",
				);
			}
			const sock = await resolveControlSocket(sessionId);
			const effectiveMode = mode ?? "follow_up";
			const resp = await rpcCall(sock, {
				type: "send",
				message,
				mode: effectiveMode,
				sender,
				wants_reply: effectiveWantsReply,
			});
			if (!resp.success) {
				return textErr(`entwurf_send failed: ${resp.error ?? "unknown"}`);
			}
			// Send-side preview — the sending model (or the operator reading the
			// tool result) sees the target, the mode actually delivered, and the
			// first 5 lines of the body. Header is "[entwurf sent →]" with a
			// right-pointing arrow to mirror the receiver's "[entwurf received ⟵]"
			// (see renderSessionMessage in pi-extensions/entwurf-control.ts). Same
			// transport, opposite arrows — when a transcript is read end-to-end
			// the direction of every peer message is unambiguous.
			const deliveredAs = (resp.data as { deliveredAs?: string } | undefined)?.deliveredAs ?? effectiveMode;
			const replyBadge = effectiveWantsReply ? "  (wants reply)" : "";
			const summary =
				`[entwurf sent →]\n` +
				`  to:   ${sessionId}\n` +
				`  from: ${sender.agentId} @ ${abbreviateHomeMcp(sender.cwd)}\n` +
				`  mode: ${effectiveMode}${replyBadge}\n` +
				`  preview:\n` +
				`${previewBody(message)
					.split("\n")
					.map((l) => `    ${l}`)
					.join("\n")}\n` +
				`✓ delivered (${deliveredAs})`;
			return textOk(summary);
		} catch (err) {
			return textErr(`entwurf_send error: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
);

server.tool(
	"entwurf_self",
	"Return this pi session's identity envelope — the same fields entwurf_send would " +
		"attach as the sender. Use to confirm WHO you are (agentId, sessionId), FROM WHERE " +
		"(cwd), and WHEN this snapshot was taken. Throws if the env wiring is incomplete " +
		"(PI_SESSION_ID / PI_AGENT_ID), which means the MCP child is not running under a " +
		"pi session launched with --entwurf-control through the pi-shell-acp bridge.",
	{},
	async () => {
		try {
			const sender = buildStrictPiSenderEnvelope();
			const socketPath = path.join(ENTWURF_DIR, `${sender.sessionId}${SOCKET_SUFFIX}`);
			const kst = formatKstTimestamp(sender.timestamp);
			const lines = [
				`sessionId:  ${sender.sessionId}`,
				`agentId:    ${sender.agentId}`,
				`cwd:        ${abbreviateHomeMcp(sender.cwd)}`,
				`timestamp:  ${kst}`,
				`socketPath: ${socketPath}`,
			];
			return textOk(`${lines.join("\n")}\n\n${JSON.stringify({ ...sender, socketPath })}`);
		} catch (err) {
			return textErr(`entwurf_self error: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
);

server.tool(
	"entwurf_peers",
	"List active pi sessions that currently expose a control socket (i.e. were launched with " +
		"--entwurf-control). Returns sessionId + socket path for each live session. " +
		"Pair with entwurf_send to address a specific peer. " +
		"Note: this is the *active* session world. It is NOT the way to discover saved entwurf " +
		"sessions — those live as JSONL files under ~/.pi/agent/sessions and are addressed by " +
		"taskId via entwurf_resume; their original processes may already have exited.",
	{},
	async () => {
		try {
			const sessions = await getLiveSessions();
			const lines = sessions.length
				? sessions.map((s) => `- ${s.sessionId}`)
				: ["(no live pi sessions with --entwurf-control found)"];
			const payload = {
				controlDir: ENTWURF_DIR,
				count: sessions.length,
				sessions: sessions.map((s) => ({
					sessionId: s.sessionId,
					socketPath: s.socketPath,
				})),
			};
			return textOk(`${lines.join("\n")}\n\n${JSON.stringify(payload)}`);
		} catch (err) {
			return textErr(`entwurf_peers error: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
);

server.tool(
	"entwurf",
	"Entwurf a task to an independent pi agent process (sync mode). " +
		"Spawns a fresh pi -p run, waits for completion, returns stdout + turns + cost. Use for " +
		"isolated work (different cwd, different machine via SSH, or resource-intensive jobs) " +
		"where you want the result inline. " +
		"The result includes a Task ID — pass it to entwurf_resume to continue this entwurf's " +
		"saved session with a follow-up prompt. " +
		"Entwurf Target Registry (narrow door, see pi-shell-acp/AGENTS.md §Entwurf Orchestration): every spawn must " +
		"resolve to an exact (provider, model) pair listed in ~/.pi/agent/entwurf-targets.json. " +
		"Caller may pass either a qualified `model` (provider/name) or both `provider` and `model` " +
		"fields. Bare model is accepted only when unambiguous — e.g. `claude-sonnet-4-6` resolves " +
		"to pi-shell-acp; bare `gpt-5.4` resolves to native openai-codex (the pi-shell-acp/gpt-5.4 " +
		"entry is marked explicitOnly and skipped from auto-resolution). " +
		"Async spawn + entwurf_status are not exposed here yet (deferred to a separate design round). " +
		"Spawn target is always a pi child (YOLO harness); backend CLIs (codex, gemini) are model carriers, " +
		"not entwurf spawn targets. Do not run `codex exec` / `gemini -p` directly for delegation — " +
		"select those models through `provider` / `model` so pi remains the YOLO harness. " +
		`Default model when omitted: ${DEFAULT_ENTWURF_MODEL}.`,
	{
		task: z.string().min(1).describe("The task to entwurf (plain text prompt)"),
		host: z.string().min(1).optional().describe("SSH host name (omit or 'local' for local)"),
		cwd: z.string().min(1).optional().describe("Working directory for the entwurf"),
		provider: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Provider id (e.g. 'pi-shell-acp', 'openai-codex'). Pair with `model` to disambiguate. " +
					"Optional if `model` is qualified ('provider/name') or unambiguous in the registry.",
			),
		model: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Model id. Either qualified ('pi-shell-acp/claude-sonnet-4-6') or bare ('claude-sonnet-4-6'). " +
					"Bare names must resolve unambiguously in the registry; otherwise pass `provider`.",
			),
	},
	async ({ task, host, cwd, provider, model }) => {
		try {
			const guardSessionId = process.pid.toString();
			const guardTargetKey = resolveGuardTargetKey(provider, model);
			ensureEntwurfOncePerTarget(guardSessionId, guardTargetKey);

			const result = await runEntwurfSync(task, { host, cwd, provider, model });
			markEntwurfTargetUsed(guardSessionId, guardTargetKey);
			const text = formatSyncSummary(result);
			return result.exitCode === 0 ? textOk(text) : textErr(text);
		} catch (err) {
			return textErr(`entwurf error: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
);

server.tool(
	"entwurf_resume",
	"Resume a saved entwurf session by taskId, with a follow-up prompt. " +
		"The taskId comes from a prior entwurf call's output (look for 'Task ID: <id>' in the " +
		"summary). The bridge looks up the saved session JSONL under ~/.pi/agent/sessions and " +
		"spawns `pi --session <file>` with the new prompt; pi appends to the same file. " +
		"Important: this works on the saved session file. The original entwurf process may have " +
		"exited and is NOT required to be alive — entwurf_resume does NOT consult control sockets " +
		"or entwurf_peers when running sync. The two surfaces are separate by design (active " +
		"sessions vs saved entwurf sessions). " +
		"Routing on resume comes entirely from the saved session JSONL (provider + model " +
		"as recorded). The Entwurf Target Registry that gates spawn is NOT consulted here. " +
		"Identity Preservation Rule: this tool intentionally does NOT accept a `model` " +
		"parameter. The model is locked to whatever the saved session recorded at first " +
		"spawn — resuming under a different model is treated as splicing a new identity " +
		"onto someone else's transcript and is refused at the API layer. host may change " +
		"(a session can be resumed from a different machine). cwd does NOT change at will — " +
		"cold resume uses the saved session header cwd as authority. An explicit cwd " +
		"override is a debug/migration escape hatch and may forfeit backend continuity " +
		"(see pi-shell-acp#9). Model may not. " +
		"`mode` follows the asymmetric-mitsein discriminator: when omitted, this MCP child " +
		"resolves the effective mode automatically from the caller's PI_SESSION_ID / " +
		"PI_AGENT_ID env — a replyable pi-session caller (pi-shell-acp Claude, sibling pi " +
		"sessions) gets async by default; an external MCP host (Claude Code standalone, " +
		"Codex CLI, Gemini CLI) gets sync, because there is no replyable pi address to " +
		"deliver a completion followUp to. Explicit `mode='async'` from an external host " +
		"is rejected with the same pattern as entwurf_send's `wants_reply=true` rejection. " +
		"Async resumes delegate back into the parent pi session via the entwurf-control " +
		"`spawn_async_resume` RPC, so completion lands as a followUp message in the same " +
		"session — preserves the `this bridge is not a second harness` invariant.",
	{
		taskId: z.string().min(1).describe("Task ID from a prior entwurf result (e.g. '3f9a8c1b')"),
		prompt: z.string().min(1).describe("Follow-up prompt to send into the resumed session"),
		host: z
			.string()
			.min(1)
			.optional()
			.describe(
				"SSH host name if the original entwurf ran remote (default: 'local'). " +
					"NOTE: remote SSH path is implemented but not yet end-to-end verified — " +
					"use with care until the remote rollout phase.",
			),
		cwd: z.string().min(1).optional().describe("Working directory override for the resume spawn"),
		mode: z
			.enum(["sync", "async"])
			.optional()
			.describe(
				"auto resolution by caller — async for replyable pi-session callers " +
					"(PI_SESSION_ID/PI_AGENT_ID present), sync for external MCP hosts. " +
					"Override with explicit 'sync' or 'async'. Explicit 'async' requires " +
					"a replyable caller; external hosts get reject.",
			),
	},
	async ({ taskId, prompt, host, cwd, mode }) => {
		try {
			// Phase B Step 3 — asymmetric-mitsein discriminator. The mode
			// resolution is in `resolveEntwurfResumeMode` so the deterministic
			// gate (Step 4) can pin it without spawning. Same buildSendSender-
			// Envelope replyable status that entwurf_send uses for wants_reply
			// (line 344). A static `default: "async"` would silently reject
			// every external MCP host turn — the UX inversion this Step closes.
			const sender = buildSendSenderEnvelope();
			const { mode: effectiveMode, rejectReason } = resolveEntwurfResumeMode(sender, mode);
			if (rejectReason) {
				return textErr(rejectReason);
			}

			if (effectiveMode === "async") {
				// Delegate to the parent pi session's entwurf-control RPC so the
				// async launcher runs inside the pi extension layer and delivers
				// completion via that session's `pi.sendMessage({deliverAs:
				// "followUp"})`. We do NOT clone the launcher body here — the
				// bridge stays thin (Hard Rule #8).
				const sock = await resolveControlSocket(sender.sessionId);
				const resp = await rpcCall(sock, {
					type: "spawn_async_resume",
					taskId,
					prompt,
					host,
				});
				if (!resp.success) {
					return textErr(`entwurf_resume async error: ${resp.error ?? "unknown"}`);
				}
				const data = (resp.data as { text?: string; taskId?: string; pid?: number; sessionFile?: string }) ?? {};
				const ackText =
					data.text ??
					[
						"🔄 Resume spawned (async, via MCP → control RPC)",
						`Resume ID: ${data.taskId ?? "(unknown)"}`,
						`Original: ${taskId}`,
						`Session: ${data.sessionFile ?? "(unknown)"}`,
						`PID: ${data.pid ?? "(unknown)"}`,
						"",
						"Completion will arrive as a followUp message in the parent pi session.",
					].join("\n");
				return textOk(ackText);
			}

			// Sync branch — unchanged. Direct call to the existing sync core.
			const result = await runEntwurfResumeSync(taskId, prompt, { host, cwd });
			const text = formatSyncSummary(result);
			return result.exitCode === 0 ? textOk(text) : textErr(text);
		} catch (err) {
			return textErr(`entwurf_resume error: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
);

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error(`[pi-tools-bridge] fatal: ${err instanceof Error ? err.stack : err}`);
	process.exit(1);
});
