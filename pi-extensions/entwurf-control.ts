/**
 * Session Control Extension — pi-shell-acp owned.
 *
 * Ingested from Armin Ronacher's `agent-stuff` (Apache 2.0) —
 *   https://github.com/mitsuhiko/agent-stuff (extensions/control.ts)
 * The AI-summarization `get_summary` command was dropped during ingest so
 * this file no longer depends on `@earendil-works/pi-ai.complete`. Model-routed
 * summarization belongs to consumer skills, not to the entwurf-control
 * protocol surface that pi-shell-acp publishes.
 *
 * Why this lives here (not in consumer dotfiles): pi-shell-acp's public
 * bridge surface (`mcp/pi-tools-bridge.entwurf_send`, `entwurf_peers`)
 * depends at runtime on some pi session having this extension loaded to
 * open the control socket. Bundling it here removes a hidden dependency on
 * a private consumer repo and makes pi-shell-acp installable as a public
 * package without extra setup.
 *
 * Enables inter-session communication via Unix domain sockets. When enabled
 * with the `--entwurf-control` flag, each pi session creates a control socket
 * at `~/.pi/entwurf-control/<session-id>.sock` that accepts JSON-RPC commands.
 *
 * Features:
 * - Send messages to other running pi sessions (steer or follow-up mode)
 *   via tool (`entwurf_send`) or startup CLI flags
 *   (`--entwurf-session`, `--entwurf-send-message`)
 * - Retrieve the last assistant message from a session
 * - Clear/rewind sessions to their initial state
 *
 * Send-is-throw — no `wait_until=turn_end`. Every send is fire-and-forget at the
 * delivery boundary: the RPC ack confirms the receiver enqueued the message
 * (`message_processed` semantics) and that is the end of the contract. The
 * older `wait_until=turn_end` surface was removed (2026-05-18) because it
 * turned `entwurf_send` into "await sibling's turn completion", which is a
 * worker pattern that contradicts pi-shell-acp's identity. Callers that need
 * a result they own should use `entwurf(mode=async)` + `entwurf_resume`; peers
 * that want a reply should say so in the message body and let the receiver send
 * a separate `entwurf_send` back. See AGENTS.md `Send-is-throw`.
 *
 * Once loaded the extension registers a `entwurf_send` tool that allows
 * the AI to communicate with other pi sessions programmatically.
 *
 * Usage:
 *   pi --session-id <garden-id> --entwurf-control
 *
 * One-shot startup send:
 *   pi -p --session-id <garden-id> --entwurf-control --entwurf-session <session-id> --entwurf-send-message <text>
 *     [--entwurf-send-mode steer|follow_up] [--entwurf-send-include-sender-info]
 *   (startup send is fire-and-forget; the legacy --entwurf-send-wait turn_end
 *    flag is refused at startup with an error report — the pi session itself
 *    continues, the startup send is simply not attempted; --entwurf-send-wait
 *    message_processed is accepted as a no-op for backward compatibility.)
 *
 * Addressing is sessionId-only. The sessionId (a garden id for
 * garden-native sessions, or a pi-assigned uuidv7 otherwise) is the only stable
 * identity a peer needs; alias / sessionName surfaces are deliberately not
 * exposed. Use entwurf_peers (or /entwurf-sessions) to discover live
 * sessions; pass the sessionId to entwurf_send. Note that this is independent
 * of agent-config's --session-control extension, which lives under
 * ~/.pi/session-control/ and may keep its own alias surface.
 *
 * Environment:
 *   Sets PI_SESSION_ID when enabled, allowing child processes to discover
 *   the current session.
 *
 * RPC Protocol:
 *   Commands are newline-delimited JSON objects with a `type` field:
 *   - { type: "send", message: "...", mode?: "steer"|"follow_up" }
 *   - { type: "get_message" }
 *   - { type: "get_info" }
 *   - { type: "clear", summarize?: boolean }
 *   - { type: "abort" }
 *   - { type: "spawn_async_resume", sessionId: "...", prompt: "...", host?: "..." }
 *     — Phase B Step 2 of the async-resume regression repair. Calls the
 *     `spawnEntwurfResumeAsync` launcher (from lib/entwurf-async.ts) with the
 *     control extension's own pi ExtensionAPI, so completion lands in the
 *     parent pi session as a followUp message — same as if a native pi tool
 *     had called the launcher directly. Lets the MCP bridge surface (Step 3)
 *     dispatch async resumes by delegating to this RPC instead of cloning
 *     the launcher body ("this bridge is not a second harness" invariant).
 *
 *   Responses are JSON objects with { type: "response", command, success, data?, error? }
 *   (No event channel — the turn_end subscribe surface was removed with the
 *    Send-is-throw cleanup; see note above.)
 */

import { existsSync, promises as fs } from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
// Use pi-ai's re-exports of typebox so the schema universe matches what
// pi-coding-agent.registerTool consumes. Importing Type from @sinclair/typebox
// directly mixes typebox 0.34 (Type.*) with typebox 1.x (StringEnum, TSchema
// inside pi-coding-agent), which silently widens StringEnum-typed parameters
// to `unknown` and broke renderCall/execute narrowing. Single-source-of-typebox.
import { StringEnum, type TextContent, Type } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	MessageRenderer,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { ENTWURF_SENT_MESSAGE_TYPE } from "../protocol.js";
import { ENTWURF_ENTRY_TYPE, makeBestEffortDeliverCompletion, spawnEntwurfResumeAsync } from "./lib/entwurf-async.js";
import {
	type RpcCommand,
	type RpcResponse,
	type RpcSendCommand,
	type SenderEnvelope,
	sendRpcCommand,
} from "./lib/entwurf-control-rpc.js";
import {
	assertGardenNativeSessionId,
	buildGardenSessionName,
	computeResidentStatusLabel,
	createGardenSessionFile,
	isValidSessionId,
	parseSessionName,
	RESIDENT_SESSION_TAG,
	readSessionHeader,
	removeUnadoptedGardenSessionFile,
} from "./lib/entwurf-core.js";
import { formatMetaMailboxBody } from "./lib/meta-mailbox-body.js";
import { enqueueMetaMessage } from "./lib/meta-session.js";
import { classifyConnectError, probeSocketLiveness, shouldListAsLive, shouldUnlinkOnGc } from "./lib/socket-probe.js";

// The `--entwurf-control` socket protocol (wire types + the newline-JSON client) now lives
// in the ctx-free SSOT `lib/entwurf-control-rpc.ts` so the 5d entwurf_v2 production
// `sendOverSocket` dep can share it without importing this surface file. Re-export
// `SenderEnvelope` to keep this module's public surface unchanged for external importers.
export type { SenderEnvelope } from "./lib/entwurf-control-rpc.js";

const ENTWURF_FLAG = "entwurf-control";
const ENTWURF_SESSION_FLAG = "entwurf-session";
const ENTWURF_SEND_MESSAGE_FLAG = "entwurf-send-message";
const ENTWURF_SEND_MODE_FLAG = "entwurf-send-mode";
const ENTWURF_SEND_WAIT_FLAG = "entwurf-send-wait";
const ENTWURF_SEND_INCLUDE_SENDER_FLAG = "entwurf-send-include-sender-info";
const ENTWURF_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
const SESSION_MESSAGE_TYPE = "entwurf-message";
// Sender-side UI marker. Layer B (ACP path) emits a CustomMessage with this
// customType so the operator sees a first-class [entwurf sent →] box paired
// with the receive-side [entwurf received ⟵] box. The provider-level context
// filter in index.ts drops this customType before the LLM sees it — colocated
// with the emitter so sessions without --entwurf-control are still protected.
// Layer A (native path) reuses the same Box builder via renderSentMessage() but
// does NOT emit a CustomMessage; the native tool result already lives in the
// toolResult role and never enters LLM context as a user message.
const SENDER_INFO_PATTERN = /<sender_info>[\s\S]*?<\/sender_info>/g;

// ============================================================================
// RPC Types — moved to lib/entwurf-control-rpc.ts (ctx-free SSOT, imported above)
// ============================================================================

// ============================================================================
// Server State
// ============================================================================

interface SocketState {
	server: net.Server | null;
	socketPath: string | null;
	context: ExtensionContext | null;
}

// ============================================================================
// Utilities
// ============================================================================

const STATUS_KEY = "entwurf-control";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function getSocketPath(sessionId: string): string {
	return path.join(ENTWURF_DIR, `${sessionId}${SOCKET_SUFFIX}`);
}

function isSafeSessionId(sessionId: string): boolean {
	return !sessionId.includes("/") && !sessionId.includes("\\") && !sessionId.includes("..") && sessionId.length > 0;
}

async function ensureControlDir(): Promise<void> {
	await fs.mkdir(ENTWURF_DIR, { recursive: true });
}

async function removeSocket(socketPath: string | null): Promise<void> {
	if (!socketPath) return;
	try {
		await fs.unlink(socketPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "ENOENT") {
			throw error;
		}
	}
}

// Sweep stale `.sock` entries left behind by hard-killed sessions or stale
// alias-era artifacts. Runs once per startControlServer call. We only touch
// entries that are demonstrably dead — a live peer's socket survives.
async function gcStaleSockets(): Promise<void> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(ENTWURF_DIR, { withFileTypes: true });
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			// Pre-0.5 alias symlinks (`<name>.alias`) are no longer used.
			// Drop them on encounter so the directory stays clean.
			await fs.unlink(path.join(ENTWURF_DIR, entry.name)).catch(() => {});
			continue;
		}
		if (!entry.name.endsWith(SOCKET_SUFFIX)) continue;
		const fullPath = path.join(ENTWURF_DIR, entry.name);
		// F3: reclaim ONLY a demonstrably dead socket. A timeout / unknown-error
		// probe is indeterminate (a live socket may have stalled under load) and
		// MUST survive the sweep — unlinking it permanently splits that live
		// session's identity. shouldUnlinkOnGc(indeterminate|alive) === false.
		const liveness = await probeSocketLiveness(fullPath);
		if (!shouldUnlinkOnGc(liveness)) continue;
		await fs.unlink(fullPath).catch(() => {});
	}
}

// Listing wrapper over the shared three-valued probe: a session is "alive" for
// listing/reachability only on a positive connect (shouldListAsLive). An
// indeterminate probe is hidden from listings but — unlike GC above — never
// unlinked, so it can reappear once the stall clears.
async function isSocketAlive(socketPath: string): Promise<boolean> {
	return shouldListAsLive(await probeSocketLiveness(socketPath));
}

type LiveSessionInfo = {
	sessionId: string;
	socketPath: string;
};

type EnrichedSession = LiveSessionInfo & {
	cwd?: string;
	modelId?: string;
	modelProvider?: string;
	idle?: boolean;
	infoError?: string;
};

function abbreviateHome(cwd: string | undefined): string {
	if (!cwd) return "(unknown)";
	const home = os.homedir();
	if (cwd === home) return "~";
	if (cwd.startsWith(`${home}${path.sep}`)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

async function getLiveSessions(): Promise<LiveSessionInfo[]> {
	await ensureControlDir();
	const entries = await fs.readdir(ENTWURF_DIR, { withFileTypes: true });
	const sessions: LiveSessionInfo[] = [];

	for (const entry of entries) {
		if (!entry.name.endsWith(SOCKET_SUFFIX)) continue;
		const socketPath = path.join(ENTWURF_DIR, entry.name);
		const alive = await isSocketAlive(socketPath);
		if (!alive) continue;
		const sessionId = entry.name.slice(0, -SOCKET_SUFFIX.length);
		if (!isSafeSessionId(sessionId)) continue;
		sessions.push({ sessionId, socketPath });
	}

	sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
	return sessions;
}

// Enrich each live session with cwd/model/idle by RPC-querying its socket.
// Per-session failures are surfaced as `infoError` so the operator sees
// exactly which session is unreachable instead of silently dropping it.
async function getLiveSessionsWithInfo(): Promise<EnrichedSession[]> {
	const sessions = await getLiveSessions();
	const enriched: EnrichedSession[] = [];
	for (const session of sessions) {
		try {
			const result = await sendRpcCommand(session.socketPath, { type: "get_info" }, { timeout: 1500 });
			if (!result.response.success) {
				enriched.push({
					...session,
					infoError: result.response.error ?? "get_info failed",
				});
				continue;
			}
			const data = result.response.data as
				| {
						cwd?: string;
						model?: { id?: string; provider?: string } | null;
						idle?: boolean;
				  }
				| undefined;
			enriched.push({
				...session,
				cwd: data?.cwd,
				modelId: data?.model?.id,
				modelProvider: data?.model?.provider,
				idle: data?.idle,
			});
		} catch (e) {
			enriched.push({
				...session,
				infoError: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return enriched;
}

function writeResponse(socket: net.Socket, response: RpcResponse): void {
	try {
		socket.write(`${JSON.stringify(response)}\n`);
	} catch {
		// Socket may be closed
	}
}

function parseCommand(line: string): { command?: RpcCommand; error?: string } {
	try {
		const parsed = JSON.parse(line) as RpcCommand;
		if (!parsed || typeof parsed !== "object") {
			return { error: "Invalid command" };
		}
		if (typeof parsed.type !== "string") {
			return { error: "Missing command type" };
		}
		return { command: parsed };
	} catch (error) {
		return { error: error instanceof Error ? error.message : "Failed to parse command" };
	}
}

// ============================================================================
// Message Extraction
// ============================================================================

interface ExtractedMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

function getLastAssistantMessage(ctx: ExtensionContext): ExtractedMessage | undefined {
	const branch = ctx.sessionManager.getBranch();

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "message") {
			const msg = entry.message;
			if ("role" in msg && msg.role === "assistant") {
				const textParts = msg.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text);
				if (textParts.length > 0) {
					return {
						role: "assistant",
						content: textParts.join("\n"),
						timestamp: msg.timestamp,
					};
				}
			}
		}
	}
	return undefined;
}

function getFirstEntryId(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getEntries();
	if (entries.length === 0) return undefined;
	const root = entries.find((e) => e.parentId === null);
	return root?.id ?? entries[0]?.id;
}

function extractTextContent(content: string | Array<TextContent | { type: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function stripSenderInfo(text: string): string {
	return text.replace(SENDER_INFO_PATTERN, "").trim();
}

// Sender envelope — what the <sender_info> JSON inside an entwurf-message carries.
//
// Addressing is sessionId-only (see header). Envelope fields are display-only —
// they never feed address resolution. The fully attributed shape lets the
// operator immediately see WHO sent (agentId, sessionId), FROM WHERE (cwd),
// and WHEN (timestamp). cwd anchors "which 담당자 is this" to the physical
// workspace rather than a free-form alias. agentId is the single identity
// field ("pi-shell-acp/<model>"); different school × model = different agent,
// never split into two fields.
//
// wants_reply is an etiquette marker (default false). It is NOT a transport
// contract — no wait, no polling, no delivery tracking. The sender is saying
// "this is a conversational message, please respond when you can"; the
// receiver renders a small "(wants reply)" badge so the human at either end
// can see it at a glance. Default false because most peer messages are
// notifications/handoffs/forwards — an always-true default would degrade
// into ack spam. The receiving model decides whether to reply based on the
// message itself, not on this flag; the flag only surfaces intent.
//
// Envelope fields (sessionId / agentId / cwd / timestamp) are mandatory at
// send time. A missing envelope field means wiring is broken (no
// PI_AGENT_ID inject from acp-bridge.ts, no PI_SESSION_ID from
// entwurf-control, MCP child detached from pi process.env, …). Crash-loud:
// throw at entwurf_send, reject at handleCommand("send"). wants_reply is
// not part of the wiring check — its absence just means "no etiquette
// marker", which is the default and not an error. Silent fallback for
// envelope fields is banned — see AGENTS.md Code Principle "Never warn. Throw."
interface SenderInfo {
	sessionId?: string;
	agentId?: string;
	cwd?: string;
	timestamp?: string; // ISO 8601 UTC; rendered in KST
	wants_reply?: boolean;
	origin?: "pi-session" | "external-mcp" | "meta-session";
	replyable?: boolean;
}

function parseSenderInfo(text: string): SenderInfo | null {
	const match = text.match(/<sender_info>([\s\S]*?)<\/sender_info>/);
	if (!match) return null;
	const raw = match[1].trim();
	if (!raw) return null;

	if (raw.startsWith("{")) {
		try {
			const parsed = JSON.parse(raw) as {
				sessionId?: unknown;
				agentId?: unknown;
				cwd?: unknown;
				timestamp?: unknown;
				wants_reply?: unknown;
				origin?: unknown;
				replyable?: unknown;
				// Legacy field — pre-rename transcripts may carry reply_requested
				// in the JSON. Accept as fallback so old payloads still render
				// the badge correctly. Removed from the send-side schema.
				reply_requested?: unknown;
			};
			const pickString = (v: unknown): string | undefined => {
				if (typeof v !== "string") return undefined;
				const t = v.trim();
				return t.length > 0 ? t : undefined;
			};
			const wantsReplyRaw =
				typeof parsed.wants_reply === "boolean"
					? parsed.wants_reply
					: typeof parsed.reply_requested === "boolean"
						? parsed.reply_requested
						: undefined;
			const originRaw = pickString(parsed.origin);
			const info: SenderInfo = {
				sessionId: pickString(parsed.sessionId),
				agentId: pickString(parsed.agentId),
				cwd: pickString(parsed.cwd),
				timestamp: pickString(parsed.timestamp),
				wants_reply: wantsReplyRaw,
				origin:
					originRaw === "pi-session" || originRaw === "external-mcp" || originRaw === "meta-session"
						? originRaw
						: undefined,
				replyable: typeof parsed.replyable === "boolean" ? parsed.replyable : undefined,
			};
			// Return only when at least one field carries a value; otherwise let
			// the caller render the unadorned label rather than a phantom header.
			if (
				info.sessionId ||
				info.agentId ||
				info.cwd ||
				info.timestamp ||
				info.wants_reply !== undefined ||
				info.origin ||
				info.replyable !== undefined
			) {
				return info;
			}
		} catch {
			// Ignore JSON parse errors, fall back to legacy parsing.
		}
	}

	// Legacy: pre-envelope notes left bare "session <uuid>" in the payload.
	// Keep parsing so old transcripts still render the sender id.
	const legacyIdMatch = raw.match(/session\s+([a-f0-9-]{6,})/i);
	if (legacyIdMatch) {
		return { sessionId: legacyIdMatch[1] };
	}

	return null;
}

// Build a sender envelope for messages originating from the local pi session.
// Used by every caller-side send path (mcp tool, /entwurf-send slash command,
// --entwurf-send-message startup flag). Returns undefined when any field
// cannot be resolved — pi-native callers should fall back to body-less sends
// rather than synthesize partial envelopes that would render as "(unknown ...)"
// at the receiver. The MCP-side bridge (mcp/pi-tools-bridge entwurf_send) is
// strict — it throws when its own env wiring is incomplete — because it
// represents the public transparency contract.
//
// agentId preference order:
//   1. PI_AGENT_ID env (injected by pi-shell-acp acp-bridge.ts as "pi-shell-acp/<model>")
//   2. `<ctx.model.provider>/<ctx.model.id>` reconstructed from the live pi context
//   3. undefined → envelope omitted
function buildLocalSenderEnvelope(ctx: ExtensionContext): SenderEnvelope | undefined {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!sessionId) return undefined;
	const cwd = ctx.cwd;
	if (!cwd) return undefined;
	const envAgent = process.env.PI_AGENT_ID?.trim();
	const ctxAgent = ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const agentId = envAgent && envAgent.length > 0 ? envAgent : ctxAgent;
	if (!agentId) return undefined;
	return {
		sessionId,
		agentId,
		cwd,
		timestamp: new Date().toISOString(),
	};
}

// Format a UTC ISO timestamp as `YYYY-MM-DD HH:MM:SS KST`. We avoid pulling
// Intl into the hot render path — it's heavy and locale-fragile — and instead
// compute KST manually (UTC+9, no DST). Returns the raw input unchanged when
// the parse fails so the operator at least sees the original string.
function formatTimestampKst(iso: string | undefined): string | undefined {
	if (!iso) return undefined;
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return iso;
	const kst = new Date(ms + 9 * 60 * 60 * 1000);
	const pad = (n: number) => n.toString().padStart(2, "0");
	const y = kst.getUTCFullYear();
	const mo = pad(kst.getUTCMonth() + 1);
	const d = pad(kst.getUTCDate());
	const h = pad(kst.getUTCHours());
	const mi = pad(kst.getUTCMinutes());
	const s = pad(kst.getUTCSeconds());
	return `${y}-${mo}-${d} ${h}:${mi}:${s} KST`;
}

const renderSessionMessage: MessageRenderer = (message, { expanded }, theme) => {
	const rawContent = extractTextContent(message.content);
	const senderInfo = parseSenderInfo(rawContent);
	let text = stripSenderInfo(rawContent);
	if (!text) text = "(no content)";

	if (!expanded) {
		const lines = text.split("\n");
		if (lines.length > 5) {
			text = `${lines.slice(0, 5).join("\n")}\n...`;
		}
	}

	// Build the header lines. Missing envelope fields are rendered as
	// "(unknown ...)" so wiring breaks are visible rather than hidden —
	// transparency over silence.
	//
	// The label is "[entwurf received ⟵]" with a left-pointing arrow so the
	// receiving operator immediately sees the directionality (this is an
	// incoming message). The corresponding sender-side surface in
	// mcp/pi-tools-bridge/entwurf_send renders "[entwurf sent →]" — same
	// transport, opposite arrows, no confusion about who-said-what when the
	// transcript is read end-to-end.
	//
	// wants_reply defaults to false (etiquette marker, not protocol contract).
	// We show the badge only when the sender explicitly set it true; an
	// undefined or false value omits the badge entirely. This keeps routine
	// peer messages quiet and reserves the badge for messages where the sender
	// genuinely wants a conversational response back.
	const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
	const labelBase = theme.fg("customMessageLabel", `\x1b[1m[entwurf received ⟵]\x1b[22m`);

	if (senderInfo) {
		const kst = formatTimestampKst(senderInfo.timestamp) ?? "(unknown time)";
		const replyBadge = senderInfo.wants_reply === true ? "  (wants reply)" : "";
		const headerLine = `${labelBase} ${theme.fg("dim", `${kst}${replyBadge}`)}`;
		box.addChild(new Text(headerLine, 0, 0));

		const agentId = senderInfo.agentId ?? "(unknown agent)";
		const cwd = senderInfo.cwd ? abbreviateHome(senderInfo.cwd) : "(unknown cwd)";
		const originBadge =
			senderInfo.origin === "external-mcp"
				? "  [external MCP]"
				: senderInfo.origin === "meta-session"
					? "  [meta-session]"
					: "";
		box.addChild(new Text(theme.fg("dim", `from: ${agentId} @ ${cwd}${originBadge}`), 0, 0));

		const sessionId = senderInfo.sessionId ?? "(unknown sessionId)";
		const replyable = senderInfo.replyable === false ? "  (non-replyable)" : "";
		box.addChild(new Text(theme.fg("dim", `sessionId: ${sessionId}${replyable}`), 0, 0));
	} else {
		box.addChild(new Text(labelBase, 0, 0));
	}

	box.addChild(new Spacer(1));
	box.addChild(
		new Markdown(text, 0, 0, getMarkdownTheme(), {
			color: (value: string) => theme.fg("customMessageText", value),
		}),
	);
	return box;
};

// Sender-side payload — what renderSentMessage needs to draw the [entwurf sent →]
// box. Carried verbatim by both Layer A (native renderResult) and Layer B
// (CustomMessage details for ACP path). All four envelope fields are intentionally
// echoed in the box even though the sender is "this same session" — operators
// reading a busy multi-session transcript should be able to verify at a glance
// which 담당자 is on the wire (cwd) and which model identity (agentId) actually
// signed the message, without scrolling up to find the session header.
//
// timestamp is captured at execute() / send-emit time, not at render time, so
// re-renders (resize, expand toggle) keep showing the moment the message was
// actually delivered rather than drifting forward to "now".
//
// wants_reply mirrors the receive-side etiquette badge. Native schema does not
// yet expose it (see registerSessionTool's entwurfSendParameters); leave undefined
// from the native call site until the schema grows the field.
interface SentBoxData {
	to: string; // target sessionId
	from?: string; // sender agentId, e.g. "pi-shell-acp/claude-opus-4-8"
	cwd?: string; // sender cwd (raw, abbreviateHome applied at render)
	timestamp?: string; // ISO 8601 UTC; rendered in KST
	mode?: string; // "steer" | "follow_up" | string passed through
	wants_reply?: boolean;
	deliveredAs?: string; // RPC echo — surfaces when receiver remapped (e.g. queued as followUp)
	body: string; // message text the operator sent
}

// Visual mirror of renderSessionMessage. Same Box / Markdown / theme tokens —
// the two boxes must share the customMessageBg / customMessageLabel /
// customMessageText surface so they are pixel-equivalent in any theme. The
// only deliberate visual differences are:
//   - label: [entwurf sent →]   vs  [entwurf received ⟵]
//   - "to:" leads, "from:" follows  vs  "from:" only
//   - mode: line                  (no equivalent on receive side — receiver
//                                   doesn't see how the sender queued it)
//
// `expanded` truncates the body the same way as renderSessionMessage so a
// large send shows the same preview shape as a large receive. operators
// reading the transcript should not need different mental models.
const buildSentMessageBox = (data: SentBoxData, expanded: boolean, theme: Theme): Container => {
	let body = data.body || "(no content)";
	if (!expanded) {
		const lines = body.split("\n");
		if (lines.length > 5) {
			body = `${lines.slice(0, 5).join("\n")}\n...`;
		}
	}

	const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
	const labelBase = theme.fg("customMessageLabel", `\x1b[1m[entwurf sent →]\x1b[22m`);

	// Header line: label + KST + optional (wants reply) badge — matches the
	// receive-side header layout 1:1.
	const kst = formatTimestampKst(data.timestamp) ?? "(unknown time)";
	const replyBadge = data.wants_reply === true ? "  (wants reply)" : "";
	const headerLine = `${labelBase} ${theme.fg("dim", `${kst}${replyBadge}`)}`;
	box.addChild(new Text(headerLine, 0, 0));

	// to: <sessionId>  — target peer
	box.addChild(new Text(theme.fg("dim", `to:   ${data.to || "(unknown sessionId)"}`), 0, 0));

	// from: <agentId> @ <cwd>  — self identity. Shown even though it's "us"
	// because in a multi-session human-greeted topology the operator is
	// switching between several pi sessions and needs to confirm which one
	// signed this send.
	const fromAgent = data.from ?? "(unknown agent)";
	const fromCwd = data.cwd ? abbreviateHome(data.cwd) : "(unknown cwd)";
	box.addChild(new Text(theme.fg("dim", `from: ${fromAgent} @ ${fromCwd}`), 0, 0));

	// mode: <mode>[ → deliveredAs]  — show RPC remap when it differs from
	// what the caller asked for (e.g. caller said "steer" but receiver was
	// idle so it became a direct prompt). Silent when they agree.
	if (data.mode) {
		const remap = data.deliveredAs && data.deliveredAs !== data.mode ? theme.fg("muted", ` → ${data.deliveredAs}`) : "";
		box.addChild(new Text(theme.fg("dim", `mode: ${data.mode}${remap}`), 0, 0));
	}

	box.addChild(new Spacer(1));
	box.addChild(
		new Markdown(body, 0, 0, getMarkdownTheme(), {
			color: (value: string) => theme.fg("customMessageText", value),
		}),
	);
	return box;
};

// CustomMessageRenderer adapter for Layer B (ACP path). The CustomMessage
// carries the SentBoxData under `details` (set by index.ts streamShellAcp
// when a completed mcp__pi-tools-bridge__entwurf_send is observed). `content`
// holds the raw message body too, but we prefer details.body because the
// content channel may have been routed through string-only persistence and
// trimmed.
const renderSentMessage: MessageRenderer = (message, { expanded }, theme) => {
	const details = (message.details ?? {}) as Partial<SentBoxData>;
	const fallbackBody = extractTextContent(message.content);
	const data: SentBoxData = {
		to: details.to ?? "(unknown sessionId)",
		from: details.from,
		cwd: details.cwd,
		timestamp: details.timestamp,
		mode: details.mode,
		wants_reply: details.wants_reply,
		deliveredAs: details.deliveredAs,
		body: details.body ?? fallbackBody,
	};
	return buildSentMessageBox(data, expanded, theme);
};

// ============================================================================
// Command Handlers
// ============================================================================

async function handleCommand(
	pi: ExtensionAPI,
	state: SocketState,
	command: RpcCommand,
	socket: net.Socket,
): Promise<void> {
	const id = "id" in command && typeof command.id === "string" ? command.id : undefined;
	const respond = (success: boolean, commandName: string, data?: unknown, error?: string) => {
		writeResponse(socket, { type: "response", command: commandName, success, data, error, id });
	};

	const ctx = state.context;
	if (!ctx) {
		respond(false, command.type, undefined, "Session not ready");
		return;
	}

	// Abort
	if (command.type === "abort") {
		ctx.abort();
		respond(true, "abort");
		return;
	}

	// Get last message
	if (command.type === "get_message") {
		const message = getLastAssistantMessage(ctx);
		if (!message) {
			respond(true, "get_message", { message: null });
			return;
		}
		respond(true, "get_message", { message });
		return;
	}

	// Get session metadata (cwd, model, idle) — used by /entwurf-sessions enrichment.
	if (command.type === "get_info") {
		const sessionId = ctx.sessionManager.getSessionId();
		const modelInfo = ctx.model ? { id: ctx.model.id, provider: ctx.model.provider } : null;
		respond(true, "get_info", {
			sessionId,
			cwd: ctx.cwd,
			model: modelInfo,
			idle: ctx.isIdle(),
		});
		return;
	}

	// Clear session
	if (command.type === "clear") {
		if (!ctx.isIdle()) {
			respond(false, "clear", undefined, "Session is busy - wait for turn to complete");
			return;
		}

		const firstEntryId = getFirstEntryId(ctx);
		if (!firstEntryId) {
			respond(false, "clear", undefined, "No entries in session");
			return;
		}

		const currentLeafId = ctx.sessionManager.getLeafId();
		if (currentLeafId === firstEntryId) {
			respond(true, "clear", { cleared: true, alreadyAtRoot: true });
			return;
		}

		if (command.summarize) {
			// Summarization requires navigateTree which we don't have direct access to
			// Return an error for now - the caller should clear without summarize
			// or use a different approach
			respond(false, "clear", undefined, "Clear with summarization not supported via RPC - use summarize=false");
			return;
		}

		// Access internal session manager to rewind (type assertion to access non-readonly methods)
		try {
			const sessionManager = ctx.sessionManager as unknown as { rewindTo(id: string): void };
			sessionManager.rewindTo(firstEntryId);
			respond(true, "clear", { cleared: true, targetId: firstEntryId });
		} catch (error) {
			respond(false, "clear", undefined, error instanceof Error ? error.message : "Clear failed");
		}
		return;
	}

	// Send message
	if (command.type === "send") {
		const message = command.message;
		if (typeof message !== "string" || message.trim().length === 0) {
			respond(false, "send", undefined, "Missing message");
			return;
		}

		// Validate sender envelope when present. All four fields are mandatory —
		// any single absence is a wiring break (no PI_AGENT_ID, no PI_SESSION_ID,
		// detached MCP child, …) and must surface immediately rather than render
		// as "(unknown ...)" on the receiver side. Transparency over silence.
		//
		// When sender is omitted entirely we accept the send (a fallback for
		// non-bridge paths or future surfaces that haven't been migrated yet) but
		// the renderer will just show the bare label — the operator will notice
		// the missing header. The pi-tools-bridge entwurf_send already throws
		// when its env is incomplete, so the common bridge path never reaches
		// this `sender === undefined` branch.
		const sender = command.sender;
		if (sender !== undefined) {
			const missing: string[] = [];
			if (!sender || typeof sender !== "object") {
				respond(false, "send", undefined, "sender must be an object");
				return;
			}
			if (typeof sender.sessionId !== "string" || sender.sessionId.trim().length === 0) missing.push("sessionId");
			if (typeof sender.agentId !== "string" || sender.agentId.trim().length === 0) missing.push("agentId");
			if (typeof sender.cwd !== "string" || sender.cwd.trim().length === 0) missing.push("cwd");
			if (typeof sender.timestamp !== "string" || sender.timestamp.trim().length === 0) missing.push("timestamp");
			if (missing.length > 0) {
				respond(false, "send", undefined, `sender envelope missing required field(s): ${missing.join(", ")}`);
				return;
			}
		}

		// wants_reply defaults to false (etiquette marker, not transport contract).
		// It surfaces a "(wants reply)" badge on the receiver render so the
		// human/agent at either end sees that the sender wants a conversational
		// response; there is no wait, no poll, no delivery tracking. Most peer
		// messages (notifications, handoff packets, status pings) leave this
		// unset — an always-true default would degrade into ack spam. Whether
		// the receiver actually replies is decided by the message body, not by
		// this flag.
		const wantsReply = typeof command.wants_reply === "boolean" ? command.wants_reply : false;

		// Synthesize <sender_info> JSON at the receiver side. Caller code paths
		// (pi-tools-bridge entwurf_send, registerControlSendTool, runStartupControlSend)
		// pass the envelope structurally and never touch the message body — the
		// canonical XML-style payload is constructed here once. We emit
		// wants_reply only when the sender explicitly set it true; an undefined
		// or false value omits the field entirely so the receiver renders nothing.
		const senderInfoBlock = sender
			? `\n\n<sender_info>${JSON.stringify({
					sessionId: sender.sessionId,
					agentId: sender.agentId,
					cwd: sender.cwd,
					timestamp: sender.timestamp,
					...(sender.origin ? { origin: sender.origin } : {}),
					...(typeof sender.replyable === "boolean" ? { replyable: sender.replyable } : {}),
					...(wantsReply ? { wants_reply: true } : {}),
				})}</sender_info>`
			: "";

		const mode = command.mode ?? "steer";
		const isIdle = ctx.isIdle();
		const customMessage = {
			customType: SESSION_MESSAGE_TYPE,
			content: message + senderInfoBlock,
			display: true,
		};

		// Crash-loud: a pi.sendMessage throw (queue refusal, internal invariant
		// violation, …) used to fall through unhandled and silently drop the
		// connection — the caller would see only a vague timeout. We catch and
		// surface the failure on the RPC channel so the sender knows the message
		// did NOT enter the receiver's queue.
		try {
			if (isIdle) {
				pi.sendMessage(customMessage, { triggerTurn: true });
			} else {
				pi.sendMessage(customMessage, {
					triggerTurn: true,
					deliverAs: mode === "follow_up" ? "followUp" : "steer",
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			respond(false, "send", undefined, `pi.sendMessage failed: ${msg}`);
			return;
		}

		respond(true, "send", {
			delivered: true,
			deliveredAs: isIdle ? "direct" : mode === "follow_up" ? "followUp" : "steer",
			wants_reply: wantsReply,
		});
		return;
	}

	// Spawn async resume — Phase B Step 2. Calls the shared launcher in
	// lib/entwurf-async.ts with this control extension's pi ExtensionAPI;
	// completion lands in the parent pi session as a followUp message via
	// `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`,
	// identical to what the native entwurf_resume tool does. Lets the MCP
	// bridge surface (Step 3) dispatch async resumes by delegating to this
	// RPC instead of cloning the launcher body. "this bridge is not a
	// second harness" invariant: the launcher stays in one place; both
	// surfaces (native tool + MCP-via-RPC) reach the same code path.
	if (command.type === "spawn_async_resume") {
		const sessionId = command.sessionId;
		const prompt = command.prompt;
		if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
			respond(false, "spawn_async_resume", undefined, "Missing sessionId");
			return;
		}
		if (typeof prompt !== "string" || prompt.trim().length === 0) {
			respond(false, "spawn_async_resume", undefined, "Missing prompt");
			return;
		}
		try {
			const ack = await spawnEntwurfResumeAsync(
				{ sessionId, prompt, host: command.host },
				{
					appendActiveEntry: (data) => pi.appendEntry(ENTWURF_ENTRY_TYPE, data),
					// Best-effort: the RPC-driven async resume (ACP parents) delivers its
					// completion from proc.on("close") just like the native tool; if the
					// parent ctx went stale by then, drop instead of crashing. Same race,
					// same guard — see makeBestEffortDeliverCompletion.
					deliverCompletion: makeBestEffortDeliverCompletion((message) =>
						pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" }),
					),
				},
			);
			respond(true, "spawn_async_resume", {
				sessionId: ack.details.sessionId,
				runId: ack.details.runId,
				sessionFile: ack.details.sessionFile,
				pid: ack.details.pid,
				text: ack.text,
			});
		} catch (err) {
			respond(false, "spawn_async_resume", undefined, err instanceof Error ? err.message : String(err));
		}
		return;
	}

	// Defensive fallback. After the exhaustive RpcCommand chain above the
	// `command` local is narrowed to `never` at the type level, but at runtime
	// we may still receive a JSON object whose `type` is a string we don't
	// recognise (peer-protocol drift, malformed client). Cast through a
	// runtime-only shape so we still surface the unknown command name.
	const unknownType = (command as unknown as { type?: string }).type ?? "unknown";
	respond(false, unknownType, undefined, `Unsupported command: ${unknownType}`);
}

// ============================================================================
// Server Management
// ============================================================================

async function createServer(pi: ExtensionAPI, state: SocketState, socketPath: string): Promise<net.Server> {
	const server = net.createServer((socket) => {
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
				if (!line) continue;

				const parsed = parseCommand(line);
				if (parsed.error) {
					writeResponse(socket, {
						type: "response",
						command: "parse",
						success: false,
						error: `Failed to parse command: ${parsed.error}`,
					});
					continue;
				}

				// handleCommand is async; without explicit catch the rejection floats
				// silently and the client only sees a 5-minute timeout (no response,
				// no jsonl persist trace on the receiver). Surface any handler
				// failure as an explicit error response so callers can distinguish
				// "handler exploded" from "wait timed out". Parallel execution
				// across the same connection is preserved — we do not await —
				// because current RPC commands are single-response operations and
				// do not require strict per-socket serialization. If a future
				// multi-command dependency appears, add an explicit per-socket
				// command queue rather than awaiting in this data handler — awaiting
				// here would serialize subsequent commands on the same socket and
				// tangle teardown ordering during socket close.
				const commandName = parsed.command?.type ?? "unknown";
				void handleCommand(pi, state, parsed.command!, socket).catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					writeResponse(socket, {
						type: "response",
						command: commandName,
						success: false,
						error: `handler failed: ${message}`,
					});
				});
			}
		});
	});

	// Wait for server to start listening, with error handling
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});

	return server;
}

// The RPC client `sendRpcCommand` + `RpcClientOptions` now live in
// lib/entwurf-control-rpc.ts (imported above) — see the RPC Types note for why.

async function startControlServer(pi: ExtensionAPI, state: SocketState, ctx: ExtensionContext): Promise<void> {
	await ensureControlDir();
	await gcStaleSockets();
	const sessionId = ctx.sessionManager.getSessionId();
	const socketPath = getSocketPath(sessionId);

	if (state.socketPath === socketPath && state.server) {
		state.context = ctx;
		return;
	}

	await stopControlServer(state);
	await removeSocket(socketPath);

	state.context = ctx;
	state.socketPath = socketPath;
	state.server = await createServer(pi, state, socketPath);
}

async function stopControlServer(state: SocketState): Promise<void> {
	if (!state.server) {
		await removeSocket(state.socketPath);
		state.socketPath = null;
		return;
	}

	const socketPath = state.socketPath;
	state.socketPath = null;
	await new Promise<void>((resolve) => state.server?.close(() => resolve()));
	state.server = null;
	await removeSocket(socketPath);
}

function updateStatus(ctx: ExtensionContext | null, enabled: boolean): void {
	if (!ctx?.hasUI) return;
	if (!enabled) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	// Screwdriver (🪛) label, NOT the word "entwurf" — the status label is a UI
	// affordance for the resident session and must not be confused with the
	// `entwurf` session-name tag (the entwurf_resume marker). The garden id shows
	// only once the session file exists (= first assistant turn = model locked);
	// before that it reads `🪛 ready` (model still changeable). See
	// computeResidentStatusLabel.
	const sessionId = ctx.sessionManager.getSessionId();
	const sessionFile = ctx.sessionManager.getSessionFile();
	const sessionFileExists = !!sessionFile && existsSync(sessionFile);
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", computeResidentStatusLabel({ sessionId, sessionFileExists })));
}

/**
 * Set the resident session's garden name ONCE, on the first turn that has
 * written the session file. Spawn-only-name rule: a session already carrying a
 * canonical garden name (resume) is left untouched. The name uses the live
 * `ctx.model` (registry-free via buildGardenSessionName) with the `control` tag
 * — never `entwurf`, so the resident session is not resumable as an Entwurf
 * child. Title slug is the cwd basename (home → `home`); a Korean first message
 * would ASCII-slugify to `untitled`, so cwd is the stable choice.
 */
function maybeSetResidentName(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!isValidSessionId(sessionId)) return; // non-garden id is handled (shutdown) by the guard
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile || !existsSync(sessionFile)) return; // file not written yet (pre first assistant turn)
	const existing = ctx.sessionManager.getSessionName();
	const parsedExisting = existing ? parseSessionName(existing) : null;
	if (parsedExisting) {
		// A resident session must never carry the `entwurf` tag: that tag is the
		// entwurf_resume marker. Also refuse a canonical name whose id mirror
		// disagrees with the header id. These are invariant breaches, not cosmetic
		// naming choices.
		if (parsedExisting.sessionId !== sessionId || parsedExisting.tags.includes("entwurf")) {
			process.stderr.write(`[entwurf-control] corrupt resident session name: ${existing}\n`);
			process.exit(1);
		}
		return; // already garden-named (resume) — do not re-set
	}
	const provider = ctx.model?.provider;
	const model = ctx.model?.id;
	if (!provider || !model) return; // model not resolved yet — a later turn will catch it
	const cwd = ctx.cwd || process.cwd();
	const cwdSlug = cwd === os.homedir() ? "home" : path.basename(cwd) || "home";
	try {
		pi.setSessionName(
			buildGardenSessionName({ sessionId, provider, model, rawTitle: cwdSlug, tags: [RESIDENT_SESSION_TAG] }),
		);
	} catch (err) {
		// Odd ctx.model chars (slash/`--`) would throw — log, never crash the
		// resident session over a display name.
		process.stderr.write(
			`[entwurf-control] resident garden name not set: ${err instanceof Error ? err.message : String(err)}\n`,
		);
	}
}

function updateSessionEnv(ctx: ExtensionContext | null, enabled: boolean): void {
	if (!enabled) {
		delete process.env.PI_SESSION_ID;
		return;
	}
	if (!ctx) return;
	process.env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
}

// Extension factories run before extension flag values are hydrated into runtime.flagValues,
// so we inspect argv directly when deciding whether to register tools at load time.
function wasBooleanFlagPassed(flagName: string): boolean {
	const flag = `--${flagName}`;
	return process.argv.slice(2).includes(flag);
}

function shouldRegisterControlTools(pi: ExtensionAPI): boolean {
	return pi.getFlag(ENTWURF_FLAG) === true || wasBooleanFlagPassed(ENTWURF_FLAG);
}

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerFlag(ENTWURF_FLAG, {
		description: "Enable per-session control socket under ~/.pi/entwurf-control",
		type: "boolean",
	});
	pi.registerFlag(ENTWURF_SESSION_FLAG, {
		description: "Target session id (garden id or pi-assigned uuid) for startup control send",
		type: "string",
	});
	pi.registerFlag(ENTWURF_SEND_MESSAGE_FLAG, {
		description: "Message to send to --entwurf-session at startup",
		type: "string",
	});
	pi.registerFlag(ENTWURF_SEND_MODE_FLAG, {
		description: "Startup send mode: steer or follow_up",
		type: "string",
		default: "steer",
	});
	pi.registerFlag(ENTWURF_SEND_WAIT_FLAG, {
		description:
			"Deprecated startup send wait mode. Only 'message_processed' is accepted (no-op for backward compat); " +
			"'turn_end' is refused at startup with an error report — entwurf_send is fire-and-forget.",
		type: "string",
	});
	pi.registerFlag(ENTWURF_SEND_INCLUDE_SENDER_FLAG, {
		description: "Include <sender_info> in startup messages (advanced; default: false)",
		type: "boolean",
	});

	let cliSendHandled = false;

	const state: SocketState = {
		server: null,
		socketPath: null,
		context: null,
	};

	pi.registerMessageRenderer(SESSION_MESSAGE_TYPE, renderSessionMessage);
	// Layer B (ACP path) sender-side UI box. Registered unconditionally — even
	// in a session that is not exposing a control socket (no `--entwurf-control`),
	// an ACP backend may still use the MCP `entwurf_send` to message OTHER
	// sessions. The renderer is needed here for the [entwurf sent →] box to
	// appear in this session's transcript when it sends.
	pi.registerMessageRenderer(ENTWURF_SENT_MESSAGE_TYPE, renderSentMessage);

	// Cached session list from the most recent /entwurf-sessions invocation.
	// /entwurf-send uses it to resolve numeric indices like `1` or `[1]`.
	let lastDisplayedSessions: EnrichedSession[] = [];

	if (shouldRegisterControlTools(pi)) {
		registerSessionTool(pi, state);
		registerListSessionsTool(pi);
	}
	registerControlSessionsCommand(pi, (sessions) => {
		lastDisplayedSessions = sessions;
	});
	registerEntwurfSendCommand(pi, state, () => lastDisplayedSessions);
	registerGardenNewCommand(pi);

	// Session-replacement identity invariant (0.9.0): under --entwurf-control you
	// cannot birth or enter a non-garden resident session IN-PROCESS. /new, /fork,
	// /clone, RPC new_session, ctx.newSession and keybindings all mint a pi
	// uuidv7 (no --session-id reaches an in-process switch, and the pre-switch
	// hook result carries only { cancel } — it cannot inject an id, which is
	// launch-fixed). Without this, such a mint reaches the session_start garden
	// guard and hard-exits the WHOLE pi process — a terrible UX for a routine
	// /new. So cancel the mint at the pre-event and point at the garden launcher.
	const refuseInProcessMint = (ctx: ExtensionContext, what: string, why: string) => {
		// Lead with the remedy: a TUI notify can truncate a long line, so the
		// actionable alternative (/gnew) must come BEFORE the technical why and the
		// shell-launcher fallback — otherwise a blocked /new looks like a dead end.
		const msg =
			`[entwurf-control] ${what} is blocked under --entwurf-control. ` +
			`Use /gnew (or /garden-new) for a same-terminal fresh garden session. ` +
			`(${why}) ` +
			`To launch/resume from a shell, use the garden launcher (pia / pit / pihome — they pass --session-id), ` +
			`or run pi --session-id "$(run.sh new-session-id)" --entwurf-control ...`;
		// stderr ALWAYS — the durable record even if the TUI swallows the notify.
		process.stderr.write(`${msg}\n`);
		if (ctx.hasUI) ctx.ui.notify(`🪛 ${msg}`, "error");
	};

	const refreshServer = async (ctx: ExtensionContext) => {
		const enabled = pi.getFlag(ENTWURF_FLAG) === true;
		if (!enabled) {
			await stopControlServer(state);
			updateStatus(ctx, false);
			updateSessionEnv(ctx, false);
			return;
		}
		// Garden-native enforcement (0.9.0): a resident --entwurf-control session
		// MUST have a garden header id. pi assigns a uuidv7 when the launcher did
		// not pass --session-id, which means this session was not born through the
		// garden launcher. No back-compat path. A bare throw in this session_start
		// handler is swallowed by the extension runner (runner.ts try/catch →
		// emitError), so escalate explicitly: refuse the control server, do not
		// leak a uuid into PI_SESSION_ID, loud-notify, and shut pi down.
		const sessionId = ctx.sessionManager.getSessionId();
		try {
			assertGardenNativeSessionId(sessionId);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			// stderr ALWAYS: process.exit truncates TUI rendering, so this is the
			// durable record of why the session refused to start.
			process.stderr.write(`[entwurf-control] ${reason}\n`);
			if (ctx.hasUI) ctx.ui.notify(`🪛 ${reason}`, "error");
			// ctx.shutdown() alone does NOT stop the in-flight startup — verified
			// live: the model turn still ran (26k tokens) after a session_start
			// guard that only called shutdown. Hard-exit so a non-garden
			// --entwurf-control session cannot proceed at all: no turn, no socket
			// (the guard returns before startControlServer), no PI_SESSION_ID leak.
			// "보이면 바로 터진다." The guard runs before agent_start, so exiting
			// here means the model is never invoked.
			process.exit(1);
		}
		await startControlServer(pi, state, ctx);
		updateStatus(ctx, true);
		updateSessionEnv(ctx, true);
		// On a warm start (reload/resume) the file may already exist — set the
		// garden name now; on a fresh start it's a no-op until the first turn_end.
		maybeSetResidentName(pi, ctx);
	};

	// session_start is the unified post-event for the whole session lifecycle
	// in pi-coding-agent 0.70.x: it fires with reason "startup" | "reload" |
	// "new" | "resume" | "fork", which covers the original session_switch and
	// session_fork cases that earlier pi versions exposed as separate events.
	// Previous code subscribed to "session_switch" and "session_fork" — those
	// names do not exist in the current ExtensionAPI typing, so the handlers
	// were dead. The typecheck-exclude on this file kept that decay invisible.
	// Don't reintroduce them without first confirming the events exist.
	pi.on("session_start", async (_event, ctx) => {
		await refreshServer(ctx);
		if (!cliSendHandled) {
			cliSendHandled = true;
			await maybeHandleStartupControlSend(pi, ctx);
		}
	});

	// Pre-switch guard — cancel an in-process resident mint BEFORE session_start
	// fires, so the hard guard never has to hard-exit the process. Covers every
	// entry point (slash, RPC, keybinding, ctx.newSession) because pi routes them
	// all through AgentSessionRuntime.{newSession,switchSession} → emitBeforeSwitch.
	// Only active under --entwurf-control; plain sessions keep /new and /resume
	// unrestricted.
	pi.on("session_before_switch", async (event, ctx) => {
		if (pi.getFlag(ENTWURF_FLAG) !== true) return {};
		if (event.reason === "new") {
			refuseInProcessMint(
				ctx,
				"/new (in-process new session)",
				"an in-process new session gets a non-garden uuid the garden guard rejects.",
			);
			return { cancel: true };
		}
		if (event.reason === "resume" && event.targetSessionFile) {
			// Pre-cancel a resume INTO a non-garden (legacy uuid) session so it fails
			// friendly here rather than hard-exiting at the session_start guard. A
			// garden target passes through; an unreadable header is left to the
			// session_start backstop.
			let targetId: string | null = null;
			try {
				targetId = readSessionHeader(event.targetSessionFile)?.id ?? null;
			} catch {
				targetId = null;
			}
			if (targetId) {
				try {
					assertGardenNativeSessionId(targetId);
				} catch {
					refuseInProcessMint(ctx, "resume", `the target session id "${targetId}" is not garden-native.`);
					return { cancel: true };
				}
			}
		}
		return {};
	});

	// Fork/clone always mints a fresh uuid child — never garden-native in-process.
	pi.on("session_before_fork", async (_event, ctx) => {
		if (pi.getFlag(ENTWURF_FLAG) !== true) return {};
		refuseInProcessMint(
			ctx,
			"/fork (session fork/clone)",
			"a forked session gets a non-garden uuid the garden guard rejects.",
		);
		return { cancel: true };
	});

	pi.on("session_shutdown", async () => {
		updateStatus(state.context, false);
		updateSessionEnv(state.context, false);
		await stopControlServer(state);
	});

	// turn_end is subscribed ONLY for the resident-session garden lifecycle (0.9.0):
	// the first assistant turn writes the session file, which (a) flips the status
	// label from `🪛 ready` to `🪛 <gardenId>` (file-exists = model-locked signal)
	// and (b) is when the now-locked model lets us set the resident garden name.
	// This is NOT a send/delivery channel — send-is-throw still holds (the send RPC
	// ack remains the entire delivery contract); this handler never sends.
	pi.on("turn_end", async (_event, ctx) => {
		if (pi.getFlag(ENTWURF_FLAG) !== true) return;
		maybeSetResidentName(pi, ctx);
		updateStatus(ctx, true);
	});
}

// ============================================================================
// Tool: entwurf_send
// ============================================================================

function registerSessionTool(pi: ExtensionAPI, state: SocketState): void {
	// The schema (runtime) and the params type (compile-time) describe the
	// same contract. We write BOTH explicitly: the schema feeds the agent
	// runtime (Description / validation), the type feeds the execute body
	// (`params: EntwurfSendParams`). Schema-to-type inference is then NOT
	// taken — that inference is what blows TS2589 ("Type instantiation
	// excessively deep") inside pi.registerTool when the schema mixes
	// Type.Object with several Optional<TUnsafe<...>> from StringEnum.
	//
	// Revisit conditions for collapsing back to inferred params (i.e. drop
	// `EntwurfSendParams` and let `params` be derived from the schema):
	//   1. pi-coding-agent ships a registerTool overload taking
	//      ToolDefinition<TSchema, ...> directly (no TParams generic), OR
	//      a non-generic helper that returns it. The exported `defineTool`
	//      currently keeps TParams generic so it does not help.
	//   2. typebox 1.x / pi-ai narrows StringEnum's return from
	//      TUnsafe<T[number]> to a leaner type that does not push
	//      Type.Object's inferred shape past TypeScript's recursion budget.
	// When either lands, drop the explicit `EntwurfSendParams` and the
	// any-cast below in one step so the schema regains single-source
	// status for both runtime and types.
	const entwurfSendParameters = Type.Object({
		sessionId: Type.String({ description: "Target session id (garden id or pi-assigned uuid)" }),
		action: Type.Optional(
			StringEnum(["send", "get_message", "clear"] as const, {
				description: "Action to perform (default: send)",
				default: "send",
			}),
		),
		message: Type.Optional(Type.String({ description: "Message to send (required for action=send)" })),
		mode: Type.Optional(
			StringEnum(["steer", "follow_up"] as const, {
				description: "Delivery mode for send: steer (immediate) or follow_up (after task)",
				default: "steer",
			}),
		),
	});

	type EntwurfSendParams = {
		sessionId: string;
		action?: "send" | "get_message" | "clear";
		message?: string;
		mode?: "steer" | "follow_up";
	};

	const registerTool = pi.registerTool as (def: any) => void;

	registerTool({
		name: "entwurf_send",
		label: "Send To Session",
		description: `Interact with another running pi session via its control socket.

Actions:
- send: Send a message (default). Requires 'message'.
- get_message: Get the most recent assistant message.
- clear: Rewind the target session.

Target:
- sessionId: id of the session — a garden id or a pi-assigned uuid (required). Use entwurf_peers to discover live sessions.

For action=send:
- mode: steer (immediate) or follow_up (after task).

Send-is-throw: every send is fire-and-forget at the delivery boundary. The
RPC ack confirms the receiver enqueued the message (= message_processed
semantics) and the contract ends there. If the caller needs a result it owns,
prefer entwurf(mode=async) + entwurf_resume. If a peer should reply, say so in
the message body and let the receiver send a separate entwurf_send back.

Messages include sender session info for replies.`,
		parameters: entwurfSendParameters,
		async execute(
			_toolCallId: string,
			params: EntwurfSendParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		) {
			const action = params.action ?? "send";
			const sessionId = params.sessionId?.trim();

			if (!sessionId) {
				return {
					content: [{ type: "text", text: "Missing session id" }],
					isError: true,
					details: { error: "Missing session id" },
				};
			}
			if (!isSafeSessionId(sessionId)) {
				return {
					content: [{ type: "text", text: "Invalid session id" }],
					isError: true,
					details: { error: "Invalid session id" },
				};
			}

			const targetSessionId = sessionId;
			const displayTarget = sessionId;
			const socketPath = getSocketPath(targetSessionId);

			try {
				// Handle each action
				if (action === "get_message") {
					const result = await sendRpcCommand(socketPath, { type: "get_message" });
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					const data = result.response.data as { message?: ExtractedMessage };
					if (!data?.message) {
						return {
							content: [{ type: "text", text: "No assistant message found in session" }],
							details: result,
						};
					}
					return {
						content: [{ type: "text", text: data.message.content }],
						details: { message: data.message },
					};
				}

				if (action === "clear") {
					const result = await sendRpcCommand(socketPath, { type: "clear", summarize: false }, { timeout: 10000 });
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed to clear: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					const data = result.response.data as { cleared?: boolean; alreadyAtRoot?: boolean };
					const msg = data?.alreadyAtRoot ? "Session already at root" : "Session cleared";
					return {
						content: [{ type: "text", text: msg }],
						details: data,
					};
				}

				// action === "send"
				if (!params.message || params.message.trim().length === 0) {
					return {
						content: [{ type: "text", text: "Missing message for send action" }],
						isError: true,
						details: { error: "Missing message" },
					};
				}

				// Envelope path: sender metadata travels in the RPC `sender`
				// field; the receiver synthesizes the canonical <sender_info> JSON
				// from it. Body stays clean. When the local pi context cannot supply
				// a complete envelope (missing model, etc.) we send without one and
				// the receiver renders a bare label rather than partial header — see
				// buildLocalSenderEnvelope for the policy.
				const sender = state.context ? buildLocalSenderEnvelope(state.context) : undefined;

				const sendCommand: RpcSendCommand = {
					type: "send",
					message: params.message,
					mode: params.mode ?? "steer",
					sender,
				};

				// Send-is-throw — one RPC, one ack. The send RPC ack already
				// represents "receiver enqueued the message" (message_processed
				// semantics); there is no longer a turn_end wait surface.
				// `delivered: true` in details is what renderResult keys on to
				// draw the [entwurf sent →] box together with the sender envelope.
				let result: Awaited<ReturnType<typeof sendRpcCommand>>;
				try {
					result = await sendRpcCommand(socketPath, sendCommand);
				} catch (connErr) {
					// Transport 2 (fallback): no LIVE control socket → deliver to the
					// target's meta-bridge mailbox if it is a garden citizen (e.g. a
					// native Claude Code session: a meta-record but no socket of its
					// own). garden-id is the universal address — a pi session must be
					// able to reply to a Claude citizen, not only to other pi peers.
					// Mirrors the MCP bridge entwurf_send's two-transport surface.
					//
					// Fall back ONLY when the connect error proves there is no live
					// socket (ENOENT/ECONNREFUSED → classifyConnectError "dead"). A
					// timeout/indeterminate socket may be alive-but-stalled, so we
					// surface the error rather than risk a double delivery. get_message
					// / clear never reach here — fallback is send-only by construction.
					const code = (connErr as NodeJS.ErrnoException).code;
					if (classifyConnectError(code) !== "dead") throw connErr;
					try {
						const mailboxSender: SenderEnvelope | undefined = sender
							? { ...sender, origin: "pi-session", replyable: true }
							: undefined;
						const enq = enqueueMetaMessage({
							gardenId: targetSessionId,
							body: mailboxSender ? formatMetaMailboxBody(mailboxSender, params.message, false) : params.message,
						});
						return {
							content: [
								{
									type: "text",
									text: `Message delivered to meta-bridge mailbox for ${enq.gardenId} (no live control socket; doorbell wake)`,
								},
							],
							details: {
								sender: mailboxSender ?? sender,
								delivered: true,
								via: "meta-mailbox",
								messagePath: enq.messagePath,
							},
						};
					} catch (metaErr) {
						const metaMsg = metaErr instanceof Error ? metaErr.message : String(metaErr);
						const connMsg = connErr instanceof Error ? connErr.message : String(connErr);
						return {
							content: [
								{
									type: "text",
									text:
										`Failed: "${targetSessionId}" is neither a live pi control socket ` +
										`(${connMsg}) nor a meta-bridge garden citizen (${metaMsg}).`,
								},
							],
							isError: true,
							details: { error: metaMsg, connectError: connMsg },
						};
					}
				}
				if (!result.response.success) {
					return {
						content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
						isError: true,
						// Error path: no sender envelope injection — the
						// [entwurf sent →] box is reserved for actual sends.
						details: result,
					};
				}

				return {
					content: [{ type: "text", text: `Message delivered to session ${displayTarget || targetSessionId}` }],
					details: {
						...(result.response.data as Record<string, unknown> | undefined),
						sender,
						delivered: true,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [{ type: "text", text: `Failed: ${message}` }],
					isError: true,
					details: { error: message },
				};
			}
		},

		renderCall(args: EntwurfSendParams, theme: { fg: (k: string, s: string) => string; bold: (s: string) => string }) {
			const action = args.action ?? "send";
			// sessionId-only addressing — alias surface is gone, and
			// renderCall is the operator's first peek at where this tool is
			// pointing, so we render the raw UUID (truncated) and never look
			// up a name that no longer exists.
			const sessionRef = args.sessionId ?? "...";
			const shortSessionRef = sessionRef.length > 12 ? sessionRef.slice(0, 8) + "..." : sessionRef;

			// Build the header line
			let header = theme.fg("toolTitle", theme.bold("→ session "));
			header += theme.fg("accent", shortSessionRef);

			// Add action-specific info
			if (action === "send") {
				const mode = args.mode ?? "steer";
				header += theme.fg("muted", ` (${mode})`);
			} else {
				header += theme.fg("muted", ` (${action})`);
			}

			// For send action, show the message
			if (action === "send" && args.message) {
				const msg = args.message;
				const preview = msg.length > 80 ? msg.slice(0, 80) + "..." : msg;
				// Handle multi-line messages
				const firstLine = preview.split("\n")[0];
				const hasMore = preview.includes("\n") || msg.length > 80;
				return new Text(header + "\n  " + theme.fg("dim", `"${firstLine}${hasMore ? "..." : ""}"`), 0, 0);
			}

			return new Text(header, 0, 0);
		},

		renderResult(
			result: AgentToolResult<unknown>,
			{ expanded }: ToolRenderResultOptions,
			theme: Theme,
			ctx?: { args?: EntwurfSendParams },
		) {
			const details = result.details as Record<string, unknown> | undefined;
			// `isError` is a runtime-only property: pi-agent-core tracks it
			// alongside the AgentToolResult and the interactive harness spreads
			// it onto the result object before handing it to the renderer
			// (`{ ...event.result, isError }`). It is intentionally NOT in the
			// public AgentToolResult<T> type, so we read it through a runtime
			// cast and fall back to our own convention of `details.error`.
			const runtimeIsError = (result as { isError?: boolean }).isError === true;
			const detailsError = typeof details?.error === "string" ? details.error : undefined;
			const isError = runtimeIsError || detailsError !== undefined;

			// Error case
			if (isError) {
				const firstContent = result.content[0];
				const fallbackText =
					firstContent?.type === "text" ? (firstContent as { type: "text"; text: string }).text : "Unknown error";
				const errorMsg = detailsError ?? fallbackText;
				return new Text(theme.fg("error", "✗ ") + theme.fg("error", errorMsg), 0, 0);
			}

			// Detect action from details structure
			const hasMessage = details && "message" in details && details.message;
			const hasCleared = details && "cleared" in details;

			// get_message result with message
			if (hasMessage) {
				const message = details.message as ExtractedMessage;
				const icon = theme.fg("success", "✓");

				if (expanded) {
					const container = new Container();
					container.addChild(new Text(icon + theme.fg("muted", " Message received"), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme()));
					return container;
				}

				// Collapsed view - show preview
				const preview = message.content.length > 200 ? message.content.slice(0, 200) + "..." : message.content;
				const lines = preview.split("\n").slice(0, 5);
				let text = icon + theme.fg("muted", " Message received");
				text += "\n" + theme.fg("toolOutput", lines.join("\n"));
				if (message.content.split("\n").length > 5 || message.content.length > 200) {
					text += "\n" + theme.fg("dim", "(Ctrl+O to expand)");
				}
				return new Text(text, 0, 0);
			}

			// clear result
			if (hasCleared) {
				const alreadyAtRoot = details.alreadyAtRoot as boolean | undefined;
				const icon = theme.fg("success", "✓");
				const msg = alreadyAtRoot ? "Session already at root" : "Session cleared";
				return new Text(icon + " " + theme.fg("muted", msg), 0, 0);
			}

			// send result — single ack path, send-is-throw.
			//
			// First-class [entwurf sent →] box. Mirrors the receive-side
			// [entwurf received ⟵] customMessage region so directionality is
			// unambiguous in a busy multi-session transcript. We pull input args
			// (sessionId, message, mode) from `ctx.args` — ToolRenderContext
			// surfaces them per the pi-coding-agent ToolDefinition signature
			// (extensions/types.ts:467-472) — and the sender envelope from
			// `details.sender` which execute() populates from
			// buildLocalSenderEnvelope(state.context).
			//
			// The execute() success content[0].text ("Message delivered to
			// session ...") is intentionally still returned for the LLM as the
			// tool's textual result; only the operator-facing render is
			// upgraded. No LLM context pollution because the toolResult role
			// stays the toolResult role.
			if (details && "delivered" in details) {
				const sender = details.sender as
					| { agentId?: string; cwd?: string; sessionId?: string; timestamp?: string }
					| undefined;
				const args = ctx?.args;
				const data: SentBoxData = {
					to: args?.sessionId ?? "(unknown sessionId)",
					from: sender?.agentId,
					cwd: sender?.cwd,
					timestamp: sender?.timestamp,
					mode: args?.mode,
					deliveredAs: typeof details.deliveredAs === "string" ? details.deliveredAs : undefined,
					// wants_reply: native schema does not expose this field yet
					// — see registerSessionTool's entwurfSendParameters. Will
					// activate automatically once the schema grows it.
					body: args?.message ?? "(no message in args)",
				};
				return buildSentMessageBox(data, expanded, theme);
			}

			// Fallback - just show the text content
			const text = result.content[0];
			const content = text?.type === "text" ? text.text : "(no output)";
			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", content), 0, 0);
		},
	});
}

// ============================================================================
// Tool: entwurf_peers
// ============================================================================

function registerListSessionsTool(pi: ExtensionAPI): void {
	// Same TS2589 workaround as registerSessionTool — see the comment block
	// in that function for the revisit conditions.
	const registerTool = pi.registerTool as (def: any) => void;
	registerTool({
		name: "entwurf_peers",
		label: "List Sessions",
		description:
			"List live sessions that expose a control socket. Returns sessionIds only — addressing is sessionId-only (no name aliases). Use this for discovery; for the current session id in shell/bash use $PI_SESSION_ID.",
		parameters: Type.Object({}),
		async execute(
			_toolCallId: string,
			_params: Record<string, never>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const sessions = await getLiveSessions();

			if (sessions.length === 0) {
				return {
					content: [{ type: "text", text: "No live sessions found." }],
					details: { sessions: [] },
				};
			}

			const lines = sessions.map((session) => `- ${session.sessionId}`);

			return {
				content: [{ type: "text", text: `Live sessions:\n${lines.join("\n")}` }],
				details: { sessions },
			};
		},
	});
}

type StartupControlSendOptions = {
	target: string;
	message: string;
	mode: "steer" | "follow_up";
	includeSenderInfo: boolean;
};

function normalizeMode(raw: string): "steer" | "follow_up" | null {
	const value = raw.trim().toLowerCase();
	if (value === "steer") return "steer";
	if (value === "follow_up" || value === "follow-up" || value === "followup") return "follow_up";
	return null;
}

function getStringFlag(pi: ExtensionAPI, name: string): string | undefined {
	const value = pi.getFlag(name);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseStartupControlSendOptions(pi: ExtensionAPI): { options?: StartupControlSendOptions; error?: string } {
	const target = getStringFlag(pi, ENTWURF_SESSION_FLAG);
	const message = getStringFlag(pi, ENTWURF_SEND_MESSAGE_FLAG);

	if (!target && !message) {
		return {};
	}
	if (target && !message) {
		return { error: `Missing --${ENTWURF_SEND_MESSAGE_FLAG} (required with --${ENTWURF_SESSION_FLAG})` };
	}
	if (!target && message) {
		return { error: `Missing --${ENTWURF_SESSION_FLAG} (required with --${ENTWURF_SEND_MESSAGE_FLAG})` };
	}

	const rawMode = getStringFlag(pi, ENTWURF_SEND_MODE_FLAG) ?? "steer";
	const mode = normalizeMode(rawMode);
	if (!mode) {
		return { error: `Invalid --${ENTWURF_SEND_MODE_FLAG}: ${rawMode}. Use steer|follow_up.` };
	}

	// Send-is-throw cleanup (2026-05-18): the only wait surface the bridge
	// exposed was message_processed (delivery ack — same as the default send)
	// and turn_end (await sibling's turn completion — pi-shell-acp identity
	// violation). The flag is kept for backward compat at the CLI level so
	// existing scripts do not break, but:
	//   - --entwurf-send-wait turn_end          → refuse the startup send with
	//     an explicit error report. Do not silently demote to message_processed;
	//     the user explicitly asked for a contract we no longer honor and that
	//     intent must surface. The error flows through reportStartupControlSend
	//     (same path as any other invalid arg in this parser), so the pi
	//     session itself continues — only the one-shot startup send is dropped.
	//   - --entwurf-send-wait message_processed → accepted as no-op (the
	//     default already has message_processed semantics).
	const rawWait = getStringFlag(pi, ENTWURF_SEND_WAIT_FLAG);
	if (rawWait) {
		const value = rawWait.trim().toLowerCase();
		if (value === "turn_end" || value === "turn-end") {
			return {
				error:
					`--${ENTWURF_SEND_WAIT_FLAG}=turn_end is no longer supported. ` +
					`entwurf_send is fire-and-forget (send-is-throw). ` +
					`If you need a caller-owned result, use entwurf(mode=async) + entwurf_resume; ` +
					`if a peer should reply, say so in the message body and let the receiver send back.`,
			};
		}
		if (value !== "message_processed" && value !== "message-processed") {
			return {
				error:
					`Invalid --${ENTWURF_SEND_WAIT_FLAG}: ${rawWait}. ` +
					`Only 'message_processed' is accepted (deprecated no-op for backward compat).`,
			};
		}
		// Accepted; no-op. The default send path already gives message_processed
		// semantics (RPC ack = receiver enqueued the message).
	}

	const includeSenderInfo = pi.getFlag(ENTWURF_SEND_INCLUDE_SENDER_FLAG) === true;

	return {
		options: {
			target: target!,
			message: message!,
			mode,
			includeSenderInfo,
		},
	};
}

function reportStartupControlSend(
	ctx: ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	if (level === "error") {
		console.error(message);
		return;
	}
	console.log(message);
}

async function maybeHandleStartupControlSend(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const parsed = parseStartupControlSendOptions(pi);
	if (!parsed.options) {
		if (parsed.error) {
			reportStartupControlSend(ctx, parsed.error, "error");
		}
		return;
	}

	const { target, message, mode, includeSenderInfo } = parsed.options;
	if (!isSafeSessionId(target)) {
		reportStartupControlSend(ctx, `Invalid target session id: ${target} (sessionId-only — no name aliases)`, "error");
		return;
	}
	const targetSessionId = target;

	const socketPath = getSocketPath(targetSessionId);
	const alive = await isSocketAlive(socketPath);
	if (!alive) {
		reportStartupControlSend(ctx, `Target session not reachable: ${target}`, "error");
		return;
	}

	// --entwurf-send-include-sender-info is an opt-in toggle for the startup
	// CLI path so existing scripts that explicitly disable the header keep
	// behaving identically. When enabled, the sender envelope is
	// built from local context (sessionId / agentId / cwd / timestamp) and
	// passed structurally — the receiver synthesizes the <sender_info> JSON. No
	// body mangling here either.
	const sender = includeSenderInfo ? buildLocalSenderEnvelope(ctx) : undefined;

	const sendCommand: RpcSendCommand = {
		type: "send",
		message,
		mode,
		sender,
	};

	// Single send path, send-is-throw. The RPC ack confirms the receiver
	// enqueued the message (= message_processed semantics). We surface that
	// as "Message delivered to ${target}" — chosen so existing tooling that
	// greps for /message processed|delivered/ (e.g. session-messaging-smoke.sh)
	// keeps passing after the wait_until cleanup.
	try {
		const result = await sendRpcCommand(socketPath, sendCommand, { timeout: 30000 });
		if (!result.response.success) {
			reportStartupControlSend(ctx, `Failed to send: ${result.response.error ?? "unknown error"}`, "error");
			return;
		}
		reportStartupControlSend(ctx, `Message delivered to ${target}`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "unknown error";
		reportStartupControlSend(ctx, `Failed to send to ${target}: ${msg}`, "error");
	}
}

function registerControlSessionsCommand(pi: ExtensionAPI, setSessions: (sessions: EnrichedSession[]) => void): void {
	pi.registerCommand("entwurf-sessions", {
		description: "List controllable sessions (from entwurf-control sockets)",
		handler: async (_args, ctx) => {
			if (pi.getFlag(ENTWURF_FLAG) !== true) {
				if (ctx.hasUI) {
					ctx.ui.notify("Entwurf control not enabled — relaunch pi with --entwurf-control", "warning");
				}
				return;
			}

			const sessions = await getLiveSessionsWithInfo();
			setSessions(sessions);

			const currentSessionId = ctx.sessionManager.getSessionId();

			if (sessions.length === 0) {
				pi.sendMessage(
					{
						customType: "entwurf-sessions",
						content: "No live sessions found.",
						display: true,
					},
					{ triggerTurn: false },
				);
				return;
			}

			const lines: string[] = ["Controllable sessions:", ""];
			sessions.forEach((s, idx) => {
				const current = s.sessionId === currentSessionId ? "  (current)" : "";
				const idShort = `${s.sessionId.slice(0, 8)}…${s.sessionId.slice(-4)}`;
				lines.push(`[${idx + 1}] ${idShort}${current}`);
				if (s.infoError) {
					lines.push(`    error: ${s.infoError}`);
				} else {
					lines.push(`    cwd:   ${abbreviateHome(s.cwd)}`);
					const modelLabel =
						s.modelProvider && s.modelId ? `${s.modelProvider}/${s.modelId}` : (s.modelId ?? "(unknown)");
					lines.push(`    model: ${modelLabel}`);
					const idleLabel = s.idle === undefined ? "?" : s.idle ? "yes" : "no  (turn in progress)";
					lines.push(`    idle:  ${idleLabel}`);
				}
				lines.push("");
			});

			pi.sendMessage(
				{
					customType: "entwurf-sessions",
					content: lines.join("\n").trimEnd(),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}

// Resolve a `/entwurf-send` target into the concrete socket.
// Accepts: numeric index ("1", "[1]") or sessionId.
function resolveSendTarget(
	raw: string,
	cached: EnrichedSession[],
): { sessionId: string; socketPath: string; label: string } | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { error: "Missing target" };

	const idxMatch = trimmed.match(/^\[?\s*(\d+)\s*\]?$/);
	if (idxMatch) {
		if (cached.length === 0) {
			return {
				error: "No cached session list. Run /entwurf-sessions first to populate indices.",
			};
		}
		const idx = Number.parseInt(idxMatch[1], 10) - 1;
		if (idx < 0 || idx >= cached.length) {
			return { error: `Index ${idx + 1} out of range (1..${cached.length})` };
		}
		const s = cached[idx];
		return {
			sessionId: s.sessionId,
			socketPath: s.socketPath,
			label: `${s.sessionId.slice(0, 8)}…`,
		};
	}

	if (isSafeSessionId(trimmed)) {
		return {
			sessionId: trimmed,
			socketPath: getSocketPath(trimmed),
			label: `${trimmed.slice(0, 8)}…`,
		};
	}

	return { error: `Cannot resolve target: ${raw}` };
}

// /gnew (+ /garden-new) — birth a NEW garden-native session IN-PROCESS, same
// terminal, without the uuid that /new would mint. Builtin /new stays blocked
// under --entwurf-control (it cannot be made garden-native: the pre-switch hook
// result carries only { cancel }, no id injection). /gnew instead pre-creates an
// empty garden-native session file and ctx.switchSession()es into it: switchSession
// runs SessionManager.open(file), which reads the garden header id BEFORE
// session_start, so the backend/bridge identity (PI_SESSION_ID, control socket,
// ACP stream sessionId) binds to the garden id from the first moment — no torn
// identity. The whole path runs at 0 tokens (it's a command, not a model turn) and
// is headless-testable via RPC `prompt "/gnew"` (session.prompt intercepts the
// leading slash → the registered command handler, whose ctx has switchSession).
function registerGardenNewCommand(pi: ExtensionAPI): void {
	const register = (name: string) => {
		pi.registerCommand(name, {
			description: "Birth a NEW garden-native session in-process (garden id; --entwurf-control safe)",
			handler: async (_args, ctx) => {
				if (pi.getFlag(ENTWURF_FLAG) !== true) {
					if (ctx.hasUI) {
						ctx.ui.notify(`/${name} only applies under --entwurf-control — relaunch with the flag`, "warning");
					}
					return;
				}
				// Never replace the session mid-turn.
				await ctx.waitForIdle();

				let created: { sessionId: string; sessionFile: string } | undefined;
				try {
					created = createGardenSessionFile({
						cwd: ctx.cwd,
						sessionDir: ctx.sessionManager.getSessionDir(),
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					process.stderr.write(`[entwurf-control] /${name} could not create garden session file: ${msg}\n`);
					if (ctx.hasUI) ctx.ui.notify(`🪛 garden-new failed: ${msg}`, "error");
					return;
				}

				try {
					const result = await ctx.switchSession(created.sessionFile);
					if (result.cancelled) {
						// A garden header should pass the pre-switch guard, so a cancel is
						// unexpected — remove the orphan rather than leave litter, and report.
						removeUnadoptedGardenSessionFile(created.sessionFile, created.sessionId);
						process.stderr.write(`[entwurf-control] /${name} switch cancelled for ${created.sessionId}\n`);
						if (ctx.hasUI) ctx.ui.notify("🪛 garden-new switch cancelled", "warning");
						return;
					}
				} catch (err) {
					// Switch threw (e.g. cwd vanished): the file we wrote is an unadopted
					// orphan — clean it up. try/catch keeps the failure path leak-free.
					removeUnadoptedGardenSessionFile(created.sessionFile, created.sessionId);
					const msg = err instanceof Error ? err.message : String(err);
					process.stderr.write(`[entwurf-control] /${name} switch failed for ${created.sessionId}: ${msg}\n`);
					if (ctx.hasUI) ctx.ui.notify(`🪛 garden-new switch failed: ${msg}`, "error");
					return;
				}
				// Switch succeeded → the session is REPLACED. `ctx` now refers to the old
				// session and must not be touched; the new session's name, control socket
				// and PI_SESSION_ID are bound by the session_start handler on the garden id.
				// The 🪛 status bar flipping to the new id is the confirmation. Return now.
			},
		});
	};
	register("gnew");
	register("garden-new");
}

function registerEntwurfSendCommand(pi: ExtensionAPI, state: SocketState, getSessions: () => EnrichedSession[]): void {
	pi.registerCommand("entwurf-send", {
		description: "Send a message to another entwurf session — /entwurf-send <index|sessionId> <message>",
		handler: async (args, ctx) => {
			if (pi.getFlag(ENTWURF_FLAG) !== true) {
				if (ctx.hasUI) {
					ctx.ui.notify("Entwurf control not enabled — relaunch pi with --entwurf-control", "warning");
				}
				return;
			}

			const trimmed = (args ?? "").trim();
			if (!trimmed) {
				if (ctx.hasUI) {
					ctx.ui.notify("Usage: /entwurf-send <index|sessionId> <message>", "warning");
				}
				return;
			}

			const splitIdx = trimmed.search(/\s/);
			if (splitIdx === -1) {
				if (ctx.hasUI) {
					ctx.ui.notify("Missing message body", "warning");
				}
				return;
			}
			const rawTarget = trimmed.slice(0, splitIdx);
			const message = trimmed.slice(splitIdx + 1).trim();
			if (!message) {
				if (ctx.hasUI) {
					ctx.ui.notify("Empty message body", "warning");
				}
				return;
			}

			const resolved = resolveSendTarget(rawTarget, getSessions());
			if ("error" in resolved) {
				if (ctx.hasUI) {
					ctx.ui.notify(resolved.error, "error");
				}
				return;
			}

			// Envelope path — see buildLocalSenderEnvelope above. The
			// /entwurf-send slash command is a human-initiated peer message, so
			// we always attempt to attach the envelope (no opt-out toggle here);
			// when local context can't supply every field we send without one.
			const sender = state.context ? buildLocalSenderEnvelope(state.context) : undefined;

			// Default mode: follow_up — human-initiated peer message lands after
			// the target's current turn instead of yanking it mid-stream.
			const result = await sendRpcCommand(resolved.socketPath, {
				type: "send",
				message,
				mode: "follow_up",
				sender,
			});
			if (!result.response.success) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Failed to send to ${resolved.label}: ${result.response.error ?? "unknown error"}`, "error");
				}
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(`Sent to ${resolved.label} (follow_up)`, "info");
			}
		},
	});
}
