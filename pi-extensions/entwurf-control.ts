/**
 * Session Control Extension — entwurf owned.
 *
 * Ingested from Armin Ronacher's `agent-stuff` (Apache 2.0) —
 *   https://github.com/mitsuhiko/agent-stuff (extensions/control.ts)
 * The AI-summarization `get_summary` command was dropped during ingest so
 * this file no longer depends on `@earendil-works/pi-ai.complete`. Model-routed
 * summarization belongs to consumer skills, not to the entwurf-control
 * protocol surface that entwurf publishes.
 *
 * Why this lives here (not in consumer dotfiles): entwurf's public
 * bridge surface (`mcp/entwurf-bridge.entwurf_v2`, `entwurf_peers`)
 * depends at runtime on pi sessions exposing the v2 control surface and
 * control socket. Bundling it here removes a hidden dependency on a private
 * consumer repo and makes entwurf installable as a public package without
 * extra setup.
 *
 * Enables inter-session communication via Unix domain sockets. When enabled
 * with the `--entwurf-control` flag, each pi session upserts its meta-record and
 * creates a control socket at `~/.pi/entwurf-control/<gardenId>.sock` — the
 * RECORD's garden id, not pi's session id (#50 C2) — that accepts JSON-RPC
 * commands.
 *
 * Features:
 * - Attach this pi session to its meta-record at session_start (#50 C2) and key
 *   the control socket on the record's gardenId.
 * - Maintain the resident control socket used by the v2 live-send path (the
 *   INBOUND half: a send lands here and enters this session through pi.sendMessage).
 * - Hand the Entwurf verbs (`entwurf_v2`, `entwurf_peers`, `entwurf_fresh_call`,
 *   `entwurf_resume_call`, `entwurf_callback`, `entwurf_self`) to Pi's built-in MCP by
 *   registering the compiled entwurf-bridge with the born gardenId as its explicit
 *   identity carrier (#125). The model calls them as `mcp__entwurf-bridge__<verb>`;
 *   there are no native copies (see lib/entwurf-mcp-server.ts).
 *
 * Send-is-throw still applies at the control-socket protocol layer: a `send` RPC
 * ack confirms the receiver enqueued the message (`message_processed` semantics)
 * and does not wait for a peer turn result. Public v1 send surfaces were removed;
 * callers use `entwurf_v2`, whose decider chooses control-socket send / mailbox / native-push.
 *
 * Usage:
 *   pi --entwurf-control      (no id injection: pi owns its id, the record owns
 *                              the address)
 *
 * Addressing is garden-id-only. The garden id comes from this session's
 * meta-record (pi's own session id is the record's `nativeSessionId`, never an
 * address); alias / sessionName surfaces are deliberately not exposed. Use
 * entwurf_peers to discover citizens; pass the gardenId to entwurf_v2. Note that this is independent
 * of agent-config's --session-control extension, which lives under
 * ~/.pi/session-control/ and may keep its own alias surface.
 *
 * Environment:
 *   Sets PI_SESSION_ID / PI_AGENT_ID when enabled, allowing child processes to discover
 *   the current session.
 *
 * RPC Protocol:
 *   Commands are newline-delimited JSON objects with a `type` field:
 *   - { type: "send", message: "...", mode?: "steer"|"follow_up" }
 *   - { type: "get_message" }
 *   - { type: "get_info" }
 *   - { type: "clear", summarize?: boolean }
 *   - { type: "abort" }
 *   Responses are JSON objects with { type: "response", command, success, data?, error? }
 *   (No event channel — the turn_end subscribe surface was removed with the
 *    Send-is-throw cleanup; see note above.)
 */

import { existsSync, promises as fs } from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, MessageRenderer } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
	type CompactionGuard,
	compactionSendReject,
	createCompactionGuard,
	noteCompactionBefore,
	noteCompactionTerminal,
} from "./lib/compaction-send-guard.js";
import { sendReceiptBoundary } from "./lib/control-send-receipt.js";
import { CONTROL_SOCKET_SUFFIX, defaultControlSocketDir } from "./lib/control-socket-path.js";
import {
	attachAcceptedSocketDisconnectPolicy,
	formatSenderInfoBlock,
	type RpcCommand,
	type RpcResponse,
} from "./lib/entwurf-control-rpc.js";
import { computeResidentStatusLabel } from "./lib/entwurf-core.js";
import {
	buildEntwurfMcpServerConfig,
	ENTWURF_MCP_SERVER_NAME,
	entwurfBridgeCompiledEntry,
} from "./lib/entwurf-mcp-server.js";
import { probeSocketLiveness, shouldUnlinkOnGc } from "./lib/socket-probe.js";

// The `--entwurf-control` socket protocol (wire types + the newline-JSON client) now lives
// in the ctx-free SSOT `lib/entwurf-control-rpc.ts` so the 5d entwurf_v2 production
// `sendOverSocket` dep can share it without importing this surface file. Re-export
// `SenderEnvelope` to keep this module's public surface unchanged for external importers.
export type { SenderEnvelope } from "./lib/entwurf-control-rpc.js";

const ENTWURF_FLAG = "entwurf-control";
const EMACS_AGENT_SOCKET_FLAG = "emacs-agent-socket";
// Directory SOURCE is this adapter's own policy (HOME-derived); the path GRAMMAR
// comes from the `.js` leaf both runtime lanes can import.
const ENTWURF_DIR = defaultControlSocketDir(os.homedir());
const SESSION_MESSAGE_TYPE = "entwurf-message";
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
	compaction: CompactionGuard;
}

// The resident's GARDEN ADDRESS (#50 C2) — minted by this session's meta-record at
// session_start, never by pi. One pi process hosts one resident session, so a
// module-level binding is the same scope ENTWURF_DIR already has, and it lets the
// ctx-only surfaces (sender envelope, get_info) report the address without
// re-deriving it from pi's session id — which is now a DIFFERENT string (the record's
// `nativeSessionId`) and must never be published as an address. Null until the record
// is written, and cleared on shutdown.
let residentGardenId: string | null = null;

// ============================================================================
// Utilities
// ============================================================================

const STATUS_KEY = "entwurf-control";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
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
		if (!entry.name.endsWith(CONTROL_SOCKET_SUFFIX)) continue;
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

function abbreviateHome(cwd: string | undefined): string {
	if (!cwd) return "(unknown)";
	const home = os.homedir();
	if (cwd === home) return "~";
	if (cwd.startsWith(`${home}${path.sep}`)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function writeResponse(socket: net.Socket, response: RpcResponse): void {
	try {
		socket.write(`${JSON.stringify(response)}\n`);
	} catch {
		// SYNCHRONOUS throws only — a destroyed stream lands here. This catch CANNOT see an
		// asynchronous stream error: an EPIPE on a peer that hung up arrives as an `error` event,
		// and `attachAcceptedSocketDisconnectPolicy`, installed on every accepted connection in
		// `createServer`, is what carries that half of the contract. Reading this catch as full
		// coverage is what let a late response kill a resident session.
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
// field ("entwurf/<model>"); different school × model = different agent,
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
// throw at entwurf_v2, reject at handleCommand("send"). wants_reply is
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
	// incoming message). There is no matching box on the sending side: the one
	// that used to be described here had zero producers and was removed (#120 P3).
	// A sender sees a TEXT receipt naming the acceptance boundary
	// (`entwurf-v2-surface.ts`), which is the honest thing to show — a box would
	// claim the message was rendered into someone's transcript, and only the
	// receiver can say that.
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

	// Get session metadata (cwd, model, idle) for the control RPC surface.
	if (command.type === "get_info") {
		// Report the GARDEN address (#50 C2) — what a caller passes back to entwurf_v2.
		const sessionId = residentGardenId;
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
		// the missing header. The entwurf-bridge entwurf_v2 already throws
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

		const compactionReject = compactionSendReject(state.compaction, {
			idle: ctx.isIdle(),
			hasAgentSignal: ctx.signal !== undefined,
		});
		if (compactionReject) {
			respond(false, "send", undefined, compactionReject);
			return;
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
		// (entwurf-bridge entwurf_v2 — the one caller-side surface since #125)
		// pass the envelope structurally and never touch the message body — the
		// canonical XML-style payload is the shared formatSenderInfoBlock SSOT
		// (#50 C3: this is the ONE renderer since the visible-first cut removed the
		// dormant spawn-resume rail that used to append the same block to a resume
		// prompt — a future VISIBLE resume must render through it, not beside it).
		const senderInfoBlock = sender ? formatSenderInfoBlock(sender, wantsReply) : "";

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

		// #120 P2: the receiver reports the BOUNDARY it actually observed — `sent` for an idle
		// direct trigger, `queued-steer` / `queued-follow-up` for the two in-process queues — and
		// nothing else. The bare `delivered:true` that used to lead this payload is GONE rather
		// than kept for compatibility: it was equally true of all three states and therefore said
		// nothing, which is the bare `delivered` DELIVERY.md refuses by name. The `deliveredAs`
		// beside it had no consumer at all. Skew is safe in both directions without a translator —
		// an old sender keys on `response.success` and never reads `data`, and a new sender reads
		// an old receiver's payload as `accepted-unknown-boundary`, the honest name for an
		// acceptance it cannot classify.
		respond(true, "send", {
			boundary: sendReceiptBoundary({ idle: isIdle, mode }),
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
		// FIRST — before setEncoding, before the data handler, and before any response can be
		// written back. The policy itself (and why this process died without it) lives with the
		// rest of the wire protocol in lib/entwurf-control-rpc.ts.
		attachAcceptedSocketDisconnectPolicy(socket);
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

async function startControlServer(
	pi: ExtensionAPI,
	state: SocketState,
	ctx: ExtensionContext,
	socketPath: string,
): Promise<void> {
	await ensureControlDir();
	await gcStaleSockets();

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

function updateStatus(ctx: ExtensionContext | null, enabled: boolean, gardenId: string | null): void {
	if (!ctx?.hasUI) return;
	if (!enabled || !gardenId) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	// Screwdriver (🪛) label, NOT the word "entwurf" — the status label is a UI
	// affordance for the resident session and must not be confused with the
	// `entwurf` session-name tag (the Entwurf resume marker). The GARDEN id shows
	// only once the session file exists (= first assistant turn = model locked);
	// before that it reads `🪛 ready` (model still changeable). See
	// computeResidentStatusLabel.
	const sessionFile = ctx.sessionManager.getSessionFile();
	const sessionFileExists = !!sessionFile && existsSync(sessionFile);
	ctx.ui.setStatus(
		STATUS_KEY,
		ctx.ui.theme.fg("dim", computeResidentStatusLabel({ sessionId: gardenId, sessionFileExists })),
	);
}

// The resident session NAME is pi's (LOCKED PROTOCOL 2, #50 C2). The garden-name
// mirror that used to be set here — `buildGardenSessionName` + the `control` tag,
// the `entwurf`-tag crash, and the v2-resume-marker exemption that authorized it —
// is GONE with the id it mirrored. A name was a second place the address lived; the
// record is the only one now, so there is nothing left to keep in sync and nothing
// to crash over. (The dormant-resume authorization that leaned on the `entwurf` tag
// moved to record existence, and that resume rail has since been withdrawn entirely;
// the record-authoritative remainder lives in resume-launch-identity.ts.)

function updateSessionEnv(ctx: ExtensionContext | null, enabled: boolean, gardenId: string | null): void {
	if (!enabled || !gardenId) {
		delete process.env.PI_SESSION_ID;
		delete process.env.PI_AGENT_ID;
		return;
	}
	if (!ctx) return;
	// PI_SESSION_ID carries the GARDEN address, not pi's session id: it is the
	// canonical sender carrier every child MCP process reads back (`entwurf_self`),
	// and an address a peer cannot route to is worse than none.
	process.env.PI_SESSION_ID = gardenId;
	if (ctx.model?.provider && ctx.model?.id) {
		process.env.PI_AGENT_ID = `${ctx.model.provider}/${ctx.model.id}`;
	} else {
		delete process.env.PI_AGENT_ID;
	}
}

/**
 * Hand this born citizen's verbs to Pi's built-in MCP (#125): the compiled entwurf-bridge, with the
 * record gardenId as its EXPLICIT identity carrier. Pi owns the child from here — it spawns it,
 * and closes it on session_shutdown — so there is deliberately no unregister anywhere in this file.
 * Re-registering on the next session_start (/new, resume, reload) replaces this registration with
 * the NEW record's id. A missing compiled entry is a named failure: there is no TypeScript fallback.
 */
function registerEntwurfMcpServer(pi: ExtensionAPI, ctx: ExtensionContext, gardenId: string): void {
	const compiledEntry = entwurfBridgeCompiledEntry(import.meta.dirname);
	if (!existsSync(compiledEntry)) {
		throw new Error(
			`[entwurf-control] compiled entwurf-bridge missing at ${compiledEntry} — build it (\`pnpm run build-bridge\`); ` +
				"the pi session keeps its garden address and control socket but has no Entwurf verbs until then",
		);
	}
	pi.registerMcpServer(
		ENTWURF_MCP_SERVER_NAME,
		buildEntwurfMcpServerConfig({
			gardenId,
			agentId: ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			compiledEntry,
			nodePath: process.execPath,
		}),
	);
}

// Read a string-valued CLI flag straight from argv. Handles `--flag value` and
// `--flag=value`. Used as the argv fallback for the emacs socket flag because the
// env application runs without a flag-hydration guarantee.
function getStringFlagFromArgv(flagName: string): string | undefined {
	const flag = `--${flagName}`;
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === flag) {
			const next = argv[i + 1];
			return next && !next.startsWith("--") ? next.trim() || undefined : undefined;
		}
		if (arg.startsWith(`${flag}=`)) {
			return arg.slice(flag.length + 1).trim() || undefined;
		}
	}
	return undefined;
}

// `--emacs-agent-socket <name>` exports PI_EMACS_AGENT_SOCKET so this session's
// own Bash/emacsclient calls (and any child process that inherits this env)
// target the right Emacs server socket — e.g. `emacsclient -s "$PI_EMACS_AGENT_SOCKET"`.
// v2-only revival: the original ACP path injected this into the ACP child's spawn
// env (acp-bridge.ts); with no ACP child on this branch, the consumer IS this pi
// resident, so we set process.env directly — symmetric with updateSessionEnv's
// PI_SESSION_ID/PI_AGENT_ID. Resolved pi.getFlag-first, argv fallback, and applied
// independently of --entwurf-control (the original flag was entwurf-control-agnostic).
function applyEmacsAgentSocketEnv(pi: ExtensionAPI): void {
	const fromFlag = pi.getFlag(EMACS_AGENT_SOCKET_FLAG);
	const socket =
		typeof fromFlag === "string" && fromFlag.trim() ? fromFlag.trim() : getStringFlagFromArgv(EMACS_AGENT_SOCKET_FLAG);
	if (socket) {
		process.env.PI_EMACS_AGENT_SOCKET = socket;
	} else {
		delete process.env.PI_EMACS_AGENT_SOCKET;
	}
}

/**
 * The one-line answer to "I installed entwurf, why is nothing here?" (#116 M3-b3 F).
 *
 * `[관측: GLG, 날것 PC, 2026-09-17]` a herdr plugin install wires this extension into pi at USER
 * scope, so it loads in EVERY pi session on the host — but citizenship is argv-gated on purpose, so
 * a plain `pi` has no garden id, no socket and no tools. From the outside those two facts are
 * indistinguishable from "the install did nothing", and the operator has no reason to guess at a
 * flag nobody showed them. This says it once, at exactly the moment they are looking at the wrong
 * thing.
 *
 * UI ONLY, AND THAT IS THE CONTRACT. The refusal path below writes stderr ALWAYS because a control
 * surface that failed to come up is a durable fault. This is not that: it is an ordinary,
 * deliberate state. Writing it to stderr would put a sentence into every `pi -p …` pipeline and
 * every script on the host to tell a human something no human is reading there.
 *
 * WHETHER TO SPEAK IS NOT DECIDED HERE. It is `decideUncitizenedNotice` in the self-address fence,
 * reached by the same non-literal dynamic import as its sibling — and that placement is a repair,
 * not taste. `[측정 2026-09-17, 독립 검수 + 재현]` while the three conditions were `if`s at this
 * call site and the gate pinned them with a source regex, two mutants walked through green: moving
 * the call into the CITIZEN branch, and deleting the once-latch. A regex sees that a call exists;
 * it cannot see which branch it sits in or how often it fires. So the call is now UNCONDITIONAL and
 * carries `controlEnabled` as a fact — the branch is gone, and what is left is a truth table.
 */
let uncitizenedNoticeShown = false;
async function noticeUncitizenedSession(ctx: ExtensionContext, controlEnabled: boolean): Promise<void> {
	const self = (await import(ENTWURF_SELF_ADDRESS_MODULE)) as unknown as EntwurfSelfAddressModule;
	if (!self.decideUncitizenedNotice({ controlEnabled, hasUI: ctx.hasUI, alreadyShown: uncitizenedNoticeShown })) {
		return;
	}
	uncitizenedNoticeShown = true;
	ctx.ui.notify(
		"🪛 entwurf is installed here, but this session is not a garden citizen — start pi with " +
			"--entwurf-control for a garden id, a control socket and the entwurf tools.",
		"info",
	);
}

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerFlag(ENTWURF_FLAG, {
		description: "Enable per-session control socket under ~/.pi/entwurf-control",
		type: "boolean",
	});
	pi.registerFlag(EMACS_AGENT_SOCKET_FLAG, {
		description: "Optional Emacs server socket name for agent Emacs operations (exported as PI_EMACS_AGENT_SOCKET)",
		type: "string",
	});
	const state: SocketState = {
		server: null,
		socketPath: null,
		context: null,
		compaction: createCompactionGuard(),
	};

	pi.registerMessageRenderer(SESSION_MESSAGE_TYPE, renderSessionMessage);

	// The in-process mint refusals (`/new`, `/fork`, `/clone`, RPC new_session) are
	// GONE with the id grammar they defended (#50 C2). They existed because pi mints a
	// uuidv7 for an in-process session and the garden guard hard-exited on a non-garden
	// id — so a routine `/new` would have killed the whole pi process. Neither half is
	// true any more: pi's id is now just `nativeSessionId`, and a fresh in-process
	// session simply attaches as a new citizen at its session_start. `/gnew` went with
	// them (there is nothing left for it to pre-create), and pi's own `/new` / `/resume`
	// are pi's again — LOCKED PROTOCOL 2.

	/**
	 * Establish this session's garden ADDRESS (record upsert) and stand its socket up
	 * on that address. The record decides create-vs-attach on `(backend:"pi",
	 * nativeSessionId)`, so a reload/resume of the same pi session re-attaches to the
	 * SAME gardenId — the address does not move under peers that already hold it.
	 *
	 * A failure here is fatal to the control surface, never cosmetic: no address means
	 * no routable socket, so refuse the server, leak nothing into PI_SESSION_ID, and say
	 * why. This replaces the garden-id hard exit — the failing condition changed from
	 * "the launcher didn't inject an id" to "the store could not give this session an
	 * address", which is a real infrastructure fault (unreadable store, duplicate native
	 * id) rather than a launch-style mismatch. A store the live schema cannot read lands
	 * here naming the fresh-cut command — the honest reading of "this host has not cut
	 * its generation yet".
	 */
	const refreshServer = async (ctx: ExtensionContext) => {
		// --emacs-agent-socket is independent of --entwurf-control: export it
		// before the control-server branch so an Emacs frontend works even in a
		// non-control session.
		applyEmacsAgentSocketEnv(pi);
		const enabled = pi.getFlag(ENTWURF_FLAG) === true;
		await noticeUncitizenedSession(ctx, enabled);
		if (!enabled) {
			await stopControlServer(state);
			residentGardenId = null;
			updateStatus(ctx, false, null);
			updateSessionEnv(ctx, false, null);
			return;
		}
		let birth: PiCitizenBirth;
		try {
			birth = await birthResidentCitizen(ctx);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			// stderr ALWAYS: the TUI may swallow a notify, and this is the durable
			// record of why the control surface refused to come up.
			process.stderr.write(`[entwurf-control] no garden address for this session: ${reason}\n`);
			if (ctx.hasUI) ctx.ui.notify(`🪛 no garden address: ${reason}`, "error");
			await stopControlServer(state);
			residentGardenId = null;
			updateStatus(ctx, false, null);
			updateSessionEnv(ctx, false, null);
			return;
		}
		residentGardenId = birth.gardenId;
		// An unreadable record can no longer be skipped: the strict upsert throws
		// before writing, so a dirty store lands in the catch above — loud stderr
		// naming the fresh-cut command, control server refused. There is no mixed
		// store to warn about; the store is either clean or this session has no
		// address.
		await startControlServer(pi, state, ctx, birth.socketPath);
		// Identity before UI (#125): the carrier env and the MCP registration that carries the
		// born gardenId are both made before any status rendering, so a visual failure can never
		// leave a born citizen without its identity carrier or its verbs.
		updateSessionEnv(ctx, true, birth.gardenId);
		registerEntwurfMcpServer(pi, ctx, birth.gardenId);
		updateStatus(ctx, true, birth.gardenId);
	};

	/** Upsert the record for the CURRENT pi session. Reached through the non-literal
	 * dynamic import fence (the seam lives in the `.ts`-extension lane). */
	const birthResidentCitizen = async (ctx: ExtensionContext): Promise<PiCitizenBirth> => {
		const mod = (await import(PI_CITIZEN_BIRTH_MODULE)) as unknown as PiCitizenBirthModule;
		// getSessionFile() names the path pi WILL use, whether or not anything is on
		// disk yet — pi writes the file only at the first assistant turn. Recording
		// the path before the file exists plants a phantom resume target that later
		// masks the precise "no turn yet" resume refusal (F7), so only a transcript
		// that is actually on disk is recorded.
		const sessionFile = ctx.sessionManager.getSessionFile();
		const transcriptPath = sessionFile && existsSync(sessionFile) ? sessionFile : undefined;
		const model = ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
		return mod.birthPiCitizen({
			nativeSessionId: ctx.sessionManager.getSessionId(),
			cwd: ctx.cwd || process.cwd(),
			// undefined KEEPS a recorded value: a fresh start must not clear a known transcript.
			model,
			transcriptPath,
			controlSocketDir: ENTWURF_DIR,
		});
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
		noteCompactionTerminal(state.compaction);
		await refreshServer(ctx);
	});

	pi.on("session_before_compact", () => {
		noteCompactionBefore(state.compaction);
	});
	pi.on("session_compact", () => {
		noteCompactionTerminal(state.compaction);
	});
	pi.on("session_compact_failed", () => {
		noteCompactionTerminal(state.compaction);
	});

	// No session_before_switch / session_before_fork guards: `/new`, `/fork`, `/clone`
	// and RPC session replacement are pi's own again (#50 C2). Each replacement fires
	// session_start, which attaches the new pi session to its own record — the socket
	// simply rebinds to the new address. There is no id to police at the pre-event.

	pi.on("session_shutdown", async () => {
		noteCompactionTerminal(state.compaction);
		updateStatus(state.context, false, null);
		updateSessionEnv(state.context, false, null);
		residentGardenId = null;
		await stopControlServer(state);
	});

	// turn_end refreshes the RECORD, not a name (#50 C2). pi writes the session file
	// at the first assistant turn and the model is locked by then, so this is where
	// `transcriptPath` (the resume target) and `model` become known — an idempotent
	// attach on the same `nativeSessionId`, so the gardenId never moves. It also
	// flips the 🪛 label from `ready` to the garden id (file-exists = model locked).
	// This is NOT a send/delivery channel — send-is-throw still holds; it never sends.
	pi.on("turn_end", async (_event, ctx) => {
		if (pi.getFlag(ENTWURF_FLAG) !== true) return;
		try {
			const birth = await birthResidentCitizen(ctx);
			residentGardenId = birth.gardenId;
			updateStatus(ctx, true, birth.gardenId);
		} catch (err) {
			// The address already exists (session_start established it); a failed
			// refresh must not take the live socket down mid-session. Report and keep
			// serving on the address we hold.
			process.stderr.write(
				`[entwurf-control] meta-record refresh failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			updateStatus(ctx, true, residentGardenId);
		}
	});
}

// ============================================================================
// Fence seams
// ============================================================================
// entwurf-self-address.ts is a `.ts`-extension fence lib, so this root-tsc emit surface reaches
// it through a NON-LITERAL dynamic import behind a local interface (a static `.ts` import would be
// TS5097). Only the not-a-citizen notice decision is consumed here; a pi sender's replyability is
// the bridge's to compute now that the verbs live there (#125).
const ENTWURF_SELF_ADDRESS_MODULE = "./lib/entwurf-self-address.ts";
// The #50 C2 attach seam. Same fence, same reason: it is a lib→lib VALUE importer
// (upsertMetaSession) carrying an explicit `.ts` extension, which the emit-capable
// root program cannot resolve — so it is reached by a NON-LITERAL dynamic import.
const PI_CITIZEN_BIRTH_MODULE = "./lib/pi-citizen-birth.ts";

/** The birth result this surface consumes. Mirrors `lib/pi-citizen-birth.ts`'s
 * `PiCitizenBirth` — the local contract that keeps the fence out of root tsc. */
interface PiCitizenBirth {
	gardenId: string;
	action: "create" | "attach";
	recordPath: string;
	socketPath: string;
}

interface PiCitizenBirthModule {
	birthPiCitizen(input: {
		nativeSessionId: string;
		cwd: string;
		model?: string | null;
		transcriptPath?: string | null;
		sessionsDir?: string;
		controlSocketDir: string;
	}): PiCitizenBirth;
}

interface EntwurfSelfAddressModule {
	decideUncitizenedNotice: (facts: { controlEnabled: boolean; hasUI: boolean; alreadyShown: boolean }) => boolean;
}
