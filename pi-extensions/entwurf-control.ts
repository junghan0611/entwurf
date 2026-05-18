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
 * - Subscribe to turn_end events for async coordination
 *
 * Once loaded the extension registers a `entwurf_send` tool that allows
 * the AI to communicate with other pi sessions programmatically.
 *
 * Usage:
 *   pi --entwurf-control
 *
 * One-shot startup send:
 *   pi -p --entwurf-control --entwurf-session <session-id> --entwurf-send-message <text>
 *     [--entwurf-send-mode steer|follow_up] [--entwurf-send-wait turn_end|message_processed]
 *     [--entwurf-send-include-sender-info]
 *   (startup send is one-way by default; use --entwurf-send-wait turn_end to capture response on stdout)
 *
 * Addressing is sessionId-only. The UUIDv7 sessionId is the only stable
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
 *   - { type: "subscribe", event: "turn_end" }
 *
 *   Responses are JSON objects with { type: "response", command, success, data?, error? }
 *   Events are JSON objects with { type: "event", event, data?, subscriptionId? }
 */

import { promises as fs } from "node:fs";
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
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { ENTWURF_SENT_MESSAGE_TYPE } from "../protocol.js";

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
// RPC Types
// ============================================================================

interface RpcResponse {
	type: "response";
	command: string;
	success: boolean;
	error?: string;
	data?: unknown;
	id?: string;
}

interface RpcEvent {
	type: "event";
	event: string;
	data?: unknown;
	subscriptionId?: string;
}

// Unified command structure
//
// `sender` carries the transparency envelope (agentId / sessionId / cwd /
// timestamp). All four fields are mandatory whenever `sender` is present —
// see handleCommand("send") for the reject path. `wants_reply` is a separate
// etiquette marker (NOT part of the envelope), default false — see
// handleCommand("send") + parseSenderInfo and the SenderInfo block below for
// the full semantics: human-conversation hint only, no wait, no polling, no
// delivery tracking. `<sender_info>` JSON synthesis happens at the receiver
// side so callers never have to mangle the message body; pi-tools-bridge
// passes the envelope through and the receiving pi prepends the canonical
// XML-style payload before handing the customMessage to pi.sendMessage.
export interface SenderEnvelope {
	sessionId: string;
	agentId: string;
	cwd: string;
	timestamp: string; // ISO 8601 UTC
	origin?: "pi-session" | "external-mcp";
	replyable?: boolean;
}

interface RpcSendCommand {
	type: "send";
	message: string;
	mode?: "steer" | "follow_up";
	sender?: SenderEnvelope;
	wants_reply?: boolean;
	id?: string;
}

interface RpcGetMessageCommand {
	type: "get_message";
	id?: string;
}

interface RpcClearCommand {
	type: "clear";
	summarize?: boolean;
	id?: string;
}

interface RpcAbortCommand {
	type: "abort";
	id?: string;
}

interface RpcSubscribeCommand {
	type: "subscribe";
	event: "turn_end";
	id?: string;
}

interface RpcGetInfoCommand {
	type: "get_info";
	id?: string;
}

type RpcCommand =
	| RpcSendCommand
	| RpcGetMessageCommand
	| RpcClearCommand
	| RpcAbortCommand
	| RpcSubscribeCommand
	| RpcGetInfoCommand;

// ============================================================================
// Subscription Management
// ============================================================================

interface TurnEndSubscription {
	socket: net.Socket;
	subscriptionId: string;
}

interface SocketState {
	server: net.Server | null;
	socketPath: string | null;
	context: ExtensionContext | null;
	turnEndSubscriptions: TurnEndSubscription[];
	// Monotonic turnIndex of the most recent turn_end fired while this extension
	// was loaded. Used as a baseline so that a `wait_until=turn_end` subscriber
	// ignores the turn that was already running when it subscribed.
	// Undefined until the first turn_end fires.
	lastTurnIndex?: number;
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
		const alive = await isSocketAlive(fullPath);
		if (alive) continue;
		await fs.unlink(fullPath).catch(() => {});
	}
}

async function isSocketAlive(socketPath: string): Promise<boolean> {
	return await new Promise((resolve) => {
		const socket = net.createConnection(socketPath);
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 300);

		const cleanup = (alive: boolean) => {
			clearTimeout(timeout);
			socket.removeAllListeners();
			resolve(alive);
		};

		socket.once("connect", () => {
			socket.end();
			cleanup(true);
		});
		socket.once("error", () => {
			cleanup(false);
		});
	});
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

function writeEvent(socket: net.Socket, event: RpcEvent): void {
	try {
		socket.write(`${JSON.stringify(event)}\n`);
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
	origin?: "pi-session" | "external-mcp";
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
				origin: originRaw === "pi-session" || originRaw === "external-mcp" ? originRaw : undefined,
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
		const originBadge = senderInfo.origin === "external-mcp" ? "  [external MCP]" : "";
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
	from?: string; // sender agentId, e.g. "pi-shell-acp/claude-opus-4-7"
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

	// Subscribe to turn_end
	if (command.type === "subscribe") {
		if (command.event === "turn_end") {
			const subscriptionId = id ?? `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			state.turnEndSubscriptions.push({ socket, subscriptionId });

			const cleanup = () => {
				const idx = state.turnEndSubscriptions.findIndex((s) => s.subscriptionId === subscriptionId);
				if (idx !== -1) state.turnEndSubscriptions.splice(idx, 1);
			};
			socket.once("close", cleanup);
			socket.once("error", cleanup);

			// Baseline: if a subscriber comes in while a turn is already running, we must
			// not surface *that* turn_end back as "the result of my send" — it was in
			// flight before our send arrived. We hand the subscriber the latest
			// completed turnIndex we have seen so it can filter to turn_end events
			// with a strictly greater turnIndex.
			respond(true, "subscribe", {
				subscriptionId,
				event: "turn_end",
				baselineTurnIndex: state.lastTurnIndex,
			});
			return;
		}
		respond(false, "subscribe", undefined, `Unknown event type: ${command.event}`);
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
				// because per-command ordering is enforced by the client (subscribe
				// before send) and the server-side handlers themselves are
				// independent. If a future change requires strict per-connection
				// serialization, a per-socket command queue is the cleaner move
				// than awaiting in this data handler — awaiting here would
				// serialize subsequent commands on the same socket and tangle
				// teardown ordering during socket close.
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

interface RpcClientOptions {
	timeout?: number;
	waitForEvent?: "turn_end";
}

async function sendRpcCommand(
	socketPath: string,
	command: RpcCommand,
	options: RpcClientOptions = {},
): Promise<{ response: RpcResponse; event?: { message?: ExtractedMessage; turnIndex?: number } }> {
	const { timeout = 5000, waitForEvent } = options;

	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");

		const timeoutHandle = setTimeout(() => {
			socket.destroy(new Error("timeout"));
		}, timeout);

		let buffer = "";
		let response: RpcResponse | null = null;
		// turn_end correlation: set from the subscribe response. Any turn_end
		// with turnIndex <= baselineTurnIndex is the in-flight turn that was
		// already running when we subscribed and is NOT the answer to our send.
		let baselineTurnIndex: number | undefined;
		let baselineResolved = false;
		// settled guard: a single Promise can only be resolved or rejected
		// once. close/error/timeout/data can all race to terminate the RPC,
		// so every terminal path goes through doResolve/doReject which
		// short-circuits if we have already settled. Without this, the
		// natural close event that follows a clean resolve would try to
		// reject a settled promise (silent under V8) or — worse — duplicate
		// listeners would attempt to write on a destroyed socket.
		let settled = false;

		const doResolve = (value: {
			response: RpcResponse;
			event?: { message?: ExtractedMessage; turnIndex?: number };
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
			socket.end();
			resolve(value);
		};

		const doReject = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
			socket.destroy();
			reject(error);
		};

		socket.on("connect", () => {
			// Order matters for turn_end correlation.
			// Subscribe FIRST so the server registers us before it starts
			// processing the send (which triggers the turn whose turn_end
			// we want to catch). Writing send first opens a race where the
			// subscribe arrives too late and we miss the right turn_end,
			// or catch a stale turn_end from a turn that was already in
			// flight.
			if (waitForEvent === "turn_end") {
				const subscribeCmd: RpcSubscribeCommand = { type: "subscribe", event: "turn_end" };
				socket.write(`${JSON.stringify(subscribeCmd)}\n`);
			}
			socket.write(`${JSON.stringify(command)}\n`);
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
				if (!line) continue;

				try {
					const msg = JSON.parse(line);

					// Handle response
					if (msg.type === "response") {
						if (msg.command === "subscribe" && waitForEvent === "turn_end" && !baselineResolved) {
							// Capture baseline turnIndex from subscribe response so
							// we can filter out the pre-existing in-flight turn_end.
							const data = msg.data as { baselineTurnIndex?: number } | undefined;
							baselineTurnIndex = data?.baselineTurnIndex;
							baselineResolved = true;
							continue;
						}
						if (msg.command === command.type) {
							// If not waiting for event, we're done — resolve directly with msg
							// so the response value is statically non-null (avoids TS2322 on
							// the `response: RpcResponse | null` declaration). Only the
							// event-waiting branch needs to stash the response for later.
							if (!waitForEvent) {
								doResolve({ response: msg });
								return;
							}
							response = msg;
						}
						continue;
					}

					// Handle turn_end event
					if (msg.type === "event" && msg.event === "turn_end" && waitForEvent === "turn_end") {
						// Discard any turn_end whose turnIndex is not strictly
						// greater than the baseline we saw at subscribe time.
						// Those belong to the turn that was already running
						// before our send arrived.
						const eventTurnIndex = typeof msg.data?.turnIndex === "number" ? msg.data.turnIndex : undefined;
						if (
							baselineResolved &&
							typeof baselineTurnIndex === "number" &&
							typeof eventTurnIndex === "number" &&
							eventTurnIndex <= baselineTurnIndex
						) {
							continue;
						}

						if (!response) {
							doReject(new Error("Received event before response"));
							return;
						}
						doResolve({ response, event: msg.data || {} });
						return;
					}
				} catch {
					// Ignore parse errors, keep waiting
				}
			}
		});

		// Server closed the connection before any response arrived. Without
		// this branch the caller's only failure signal would be the
		// configured wait timeout (5s default, 5 minutes for
		// waitForEvent=turn_end), which is exactly the failure mode of the
		// 2026-05-18 receiver-side stuck incident. The settled guard makes
		// this a no-op when we already resolved cleanly — every successful
		// RPC ends with socket.end() and triggers a natural close.
		socket.on("close", () => {
			doReject(new Error("connection closed before response"));
		});

		socket.on("error", (error) => {
			doReject(error);
		});
	});
}

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
	state.turnEndSubscriptions = [];
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
	const sessionId = ctx.sessionManager.getSessionId();
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `entwurf ${sessionId}`));
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
		description: "Target session id (UUID) for startup control send",
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
		description: "Startup send wait mode: turn_end or message_processed",
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
		turnEndSubscriptions: [],
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

	const refreshServer = async (ctx: ExtensionContext) => {
		const enabled = pi.getFlag(ENTWURF_FLAG) === true;
		if (!enabled) {
			await stopControlServer(state);
			updateStatus(ctx, false);
			updateSessionEnv(ctx, false);
			return;
		}
		await startControlServer(pi, state, ctx);
		updateStatus(ctx, true);
		updateSessionEnv(ctx, true);
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

	pi.on("session_shutdown", async () => {
		updateStatus(state.context, false);
		updateSessionEnv(state.context, false);
		await stopControlServer(state);
	});

	// Fire turn_end events to subscribers
	pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext) => {
		// Track the latest turnIndex seen by this extension regardless of whether
		// anyone is subscribed — future subscribers need this as a baseline.
		state.lastTurnIndex = event.turnIndex;

		if (state.turnEndSubscriptions.length === 0) return;

		const lastMessage = getLastAssistantMessage(ctx);
		const eventData = { message: lastMessage, turnIndex: event.turnIndex };

		// Fire to all subscribers (one-shot)
		const subscriptions = [...state.turnEndSubscriptions];
		state.turnEndSubscriptions = [];

		for (const sub of subscriptions) {
			writeEvent(sub.socket, {
				type: "event",
				event: "turn_end",
				data: eventData,
				subscriptionId: sub.subscriptionId,
			});
		}
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
		sessionId: Type.String({ description: "Target session id (UUID)" }),
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
		wait_until: Type.Optional(
			StringEnum(["turn_end", "message_processed"] as const, {
				description:
					"Wait behavior for send. Prefer message_processed. turn_end is best-effort only; " +
					"prefer reply-back via entwurf_send or entwurf(mode=async) when you need a caller-owned result.",
			}),
		),
	});

	type EntwurfSendParams = {
		sessionId: string;
		action?: "send" | "get_message" | "clear";
		message?: string;
		mode?: "steer" | "follow_up";
		wait_until?: "turn_end" | "message_processed";
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
- sessionId: UUID of the session (required). Use entwurf_peers to discover live sessions.

For action=send:
- mode: steer (immediate) or follow_up (after task).
- wait_until=message_processed: queue ack only. Recommended.
- wait_until=turn_end: native-path best-effort only. Prefer reply-back via entwurf_send.

Use this tool for notification / peer messaging. If the caller needs a result it owns,
prefer entwurf(mode=async) + entwurf_resume instead.

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

				// Determine wait behavior
				if (params.wait_until === "message_processed") {
					// Just send and confirm delivery
					const result = await sendRpcCommand(socketPath, sendCommand);
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					return {
						content: [{ type: "text", text: "Message delivered to session" }],
						// `sender` is preserved on success so renderResult can
						// draw the [entwurf sent →] box with from / cwd / timestamp.
						// `delivered: true` is the marker renderResult uses to
						// distinguish "send result" from "get_message result".
						details: {
							...(result.response.data as Record<string, unknown> | undefined),
							sender,
							delivered: true,
						},
					};
				}

				if (params.wait_until === "turn_end") {
					// Send and wait for turn to complete
					const result = await sendRpcCommand(socketPath, sendCommand, {
						timeout: 300000, // 5 minutes
						waitForEvent: "turn_end",
					});

					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}

					const lastMessage = result.event?.message;
					if (!lastMessage) {
						return {
							content: [{ type: "text", text: "Turn completed but no assistant message found" }],
							details: { turnIndex: result.event?.turnIndex },
						};
					}

					return {
						content: [{ type: "text", text: lastMessage.content }],
						details: { message: lastMessage, turnIndex: result.event?.turnIndex },
					};
				}

				// No wait - just send
				const result = await sendRpcCommand(socketPath, sendCommand);
				if (!result.response.success) {
					return {
						content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
						isError: true,
						// Even on failure, the renderer needs to fall through to
						// the error path; no sender envelope inject here because
						// the [entwurf sent →] box is reserved for actual sends.

						details: result,
					};
				}

				return {
					content: [{ type: "text", text: `Message sent to session ${displayTarget || targetSessionId}` }],
					// Same shape as the message_processed branch above —
					// renderResult keys on `delivered` and reads `sender` to
					// draw the [entwurf sent →] box.
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
				const wait = args.wait_until;
				let info = theme.fg("muted", ` (${mode}`);
				if (wait) info += theme.fg("dim", `, wait: ${wait}`);
				info += theme.fg("muted", ")");
				header += info;
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
			const hasTurnIndex = details && "turnIndex" in details;

			// get_message or turn_end result with message
			if (hasMessage) {
				const message = details.message as ExtractedMessage;
				const icon = theme.fg("success", "✓");

				if (expanded) {
					const container = new Container();
					container.addChild(new Text(icon + theme.fg("muted", " Message received"), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme()));
					if (hasTurnIndex) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Turn #${details.turnIndex}`), 0, 0));
					}
					return container;
				}

				// Collapsed view - show preview
				const preview = message.content.length > 200 ? message.content.slice(0, 200) + "..." : message.content;
				const lines = preview.split("\n").slice(0, 5);
				let text = icon + theme.fg("muted", " Message received");
				if (hasTurnIndex) text += theme.fg("dim", ` (turn #${details.turnIndex})`);
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

			// send result (no wait or message_processed)
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
	waitUntil?: "turn_end" | "message_processed";
	includeSenderInfo: boolean;
};

function normalizeMode(raw: string): "steer" | "follow_up" | null {
	const value = raw.trim().toLowerCase();
	if (value === "steer") return "steer";
	if (value === "follow_up" || value === "follow-up" || value === "followup") return "follow_up";
	return null;
}

function normalizeWaitUntil(raw: string): "turn_end" | "message_processed" | null {
	const value = raw.trim().toLowerCase();
	if (value === "turn_end" || value === "turn-end") return "turn_end";
	if (value === "message_processed" || value === "message-processed") return "message_processed";
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

	const rawWait = getStringFlag(pi, ENTWURF_SEND_WAIT_FLAG);
	let waitUntil: "turn_end" | "message_processed" | undefined;
	if (rawWait) {
		const normalized = normalizeWaitUntil(rawWait);
		if (!normalized) {
			return {
				error: `Invalid --${ENTWURF_SEND_WAIT_FLAG}: ${rawWait}. Use turn_end|message_processed.`,
			};
		}
		waitUntil = normalized;
	}

	const includeSenderInfo = pi.getFlag(ENTWURF_SEND_INCLUDE_SENDER_FLAG) === true;

	return {
		options: {
			target: target!,
			message: message!,
			mode,
			waitUntil,
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

	const { target, message, mode, waitUntil, includeSenderInfo } = parsed.options;
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

	try {
		if (waitUntil === "turn_end") {
			const result = await sendRpcCommand(socketPath, sendCommand, {
				timeout: 300000,
				waitForEvent: "turn_end",
			});
			if (!result.response.success) {
				reportStartupControlSend(ctx, `Failed to send: ${result.response.error ?? "unknown error"}`, "error");
				return;
			}
			const lastMessage = result.event?.message;
			if (!lastMessage?.content) {
				reportStartupControlSend(ctx, `Message delivered to ${target}; turn completed without assistant output.`);
				return;
			}
			if (ctx.hasUI) {
				pi.sendMessage(
					{
						customType: "control-send",
						content: `Startup response from ${target}:\n\n${lastMessage.content}`,
						display: true,
					},
					{ triggerTurn: false },
				);
			} else {
				console.log(lastMessage.content);
			}
			return;
		}

		const result = await sendRpcCommand(socketPath, sendCommand, { timeout: 30000 });
		if (!result.response.success) {
			reportStartupControlSend(ctx, `Failed to send: ${result.response.error ?? "unknown error"}`, "error");
			return;
		}

		const waitLabel = waitUntil === "message_processed" ? " (message processed)" : "";
		reportStartupControlSend(ctx, `Message sent to ${target}${waitLabel}`);
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
