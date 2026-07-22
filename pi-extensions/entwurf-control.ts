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
 * with the `--entwurf-control` flag, each pi session creates a control socket
 * at `~/.pi/entwurf-control/<session-id>.sock` that accepts JSON-RPC commands.
 *
 * Features:
 * - Register the canonical `entwurf_v2` dispatch tool for existing garden citizens.
 * - Expose `entwurf_peers` facts and `/entwurf-sessions` for operator inspection.
 * - Maintain the resident control socket used by v2 live-send / spawn-bg paths.
 * - Keep `/gnew` garden-native in-process session birth.
 *
 * Send-is-throw still applies at the control-socket protocol layer: a `send` RPC
 * ack confirms the receiver enqueued the message (`message_processed` semantics)
 * and does not wait for a peer turn result. Public v1 send surfaces were removed;
 * callers use `entwurf_v2`, whose decider chooses send / spawn-bg / mailbox.
 *
 * Usage:
 *   pi --session-id <garden-id> --entwurf-control
 *
 * Addressing is sessionId-only. The sessionId (a garden id for
 * garden-native sessions, or a pi-assigned uuidv7 otherwise) is the only stable
 * identity a peer needs; alias / sessionName surfaces are deliberately not
 * exposed. Use entwurf_peers (or /entwurf-sessions) to discover live
 * sessions; pass the sessionId to entwurf_v2. Note that this is independent
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

import { existsSync, promises as fs, readFileSync } from "node:fs";
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
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { ENTWURF_SENT_MESSAGE_TYPE } from "../protocol.js";
import {
	CONTROL_SOCKET_SUFFIX,
	controlSocketPathIn,
	defaultControlSocketDir,
	gardenIdFromSocketFilename,
} from "./lib/control-socket-path.js";
import {
	fetchControlSocketRuntimeInfo,
	formatRuntimeModel,
	type RpcCommand,
	type RpcResponse,
	type SenderEnvelope,
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
import { isV2ResumeResidentAuthorized } from "./lib/entwurf-v2-resume-marker.js";
import { probeSocketLiveness, shouldListAsLive, shouldUnlinkOnGc } from "./lib/socket-probe.js";

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
	return controlSocketPathIn(ENTWURF_DIR, sessionId);
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
		const sessionId = gardenIdFromSocketFilename(entry.name);
		if (sessionId === null) continue;
		const socketPath = path.join(ENTWURF_DIR, entry.name);
		const alive = await isSocketAlive(socketPath);
		if (!alive) continue;
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
			// Shared parse/RPC SSOT (lib/entwurf-control-rpc.ts) — a `!success` reply
			// throws there, so it lands in the same catch and surfaces as `infoError`
			// (behavior-preserving: the message is still `response.error ?? "get_info failed"`).
			const info = await fetchControlSocketRuntimeInfo(session.socketPath, { timeout: 1500 });
			enriched.push({
				...session,
				cwd: info.cwd,
				modelId: info.modelId,
				modelProvider: info.modelProvider,
				idle: info.idle,
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

// Build a sender envelope for messages originating from the local pi session.
// Used by every caller-side send path (the mcp + pi-native entwurf_v2
// surfaces). Returns undefined when any field
// cannot be resolved — pi-native callers should fall back to body-less sends
// rather than synthesize partial envelopes that would render as "(unknown ...)"
// at the receiver. The MCP-side bridge (mcp/entwurf-bridge entwurf_v2) is
// strict — it throws when its own env wiring is incomplete — because it
// represents the public transparency contract.
//
// agentId preference order:
//   1. PI_AGENT_ID env (set by updateSessionEnv as `<ctx.model.provider>/<ctx.model.id>`)
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
	// mcp/entwurf-bridge/entwurf_v2 renders "[entwurf sent →]" — same
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
	from?: string; // sender agentId, e.g. "entwurf/claude-opus-4-8"
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
// when a completed mcp__entwurf-bridge__entwurf_v2 is observed). `content`
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
		// (entwurf-bridge entwurf_v2, the pi-native entwurf_v2 senderProvider via buildLocalSenderEnvelope)
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
	// `entwurf` session-name tag (the Entwurf resume marker). The garden id shows
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
 * canonical garden name (resume) is left untouched. New operator residents are
 * named with the `control` tag, never `entwurf`. Existing `entwurf`-tagged names
 * are accepted ONLY for a sessionId-bound v2 spawn-bg resume child (an authorized
 * Entwurf child resident, left unchanged so it stays re-resumable) — see the tag
 * branch below. Title slug is the cwd basename (home → `home`); a Korean first
 * message would ASCII-slugify to `untitled`, so cwd is the stable choice.
 */
function maybeSetResidentName(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!isValidSessionId(sessionId)) return; // non-garden id is handled (shutdown) by the guard
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile || !existsSync(sessionFile)) return; // file not written yet (pre first assistant turn)
	const existing = ctx.sessionManager.getSessionName();
	const parsedExisting = existing ? parseSessionName(existing) : null;
	if (parsedExisting) {
		// A canonical name whose id mirror disagrees with the header id is an invariant
		// breach — always a crash (never a cosmetic naming choice).
		if (parsedExisting.sessionId !== sessionId) {
			process.stderr.write(`[entwurf-control] corrupt resident session name: ${existing}\n`);
			process.exit(1);
		}
		// The `entwurf` tag is the Entwurf resume marker. An OPERATOR resident must never carry
		// it (it would advertise a live citizen as also dormant-resumable). The ONE exception is
		// a v2 spawn-bg resume promoting a dormant Entwurf session to a live resident: that child
		// SHOULD keep its `entwurf` tag (so it is re-resumable once it dies), and is authorized by
		// the sessionId-bound env marker its production launcher planted. Keep the name unchanged.
		if (parsedExisting.tags.includes("entwurf")) {
			if (isV2ResumeResidentAuthorized(sessionId)) return; // authorized Entwurf child resident
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
		delete process.env.PI_AGENT_ID;
		return;
	}
	if (!ctx) return;
	process.env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
	if (ctx.model?.provider && ctx.model?.id) {
		process.env.PI_AGENT_ID = `${ctx.model.provider}/${ctx.model.id}`;
	} else {
		delete process.env.PI_AGENT_ID;
	}
}

// Extension factories run before extension flag values are hydrated into runtime.flagValues,
// so we inspect argv directly when deciding whether to register tools at load time.
function wasBooleanFlagPassed(flagName: string): boolean {
	const flag = `--${flagName}`;
	return process.argv.slice(2).includes(flag);
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
// own Bash/emacsclient calls (and any spawn-bg child that inherits this env)
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
	pi.registerFlag(EMACS_AGENT_SOCKET_FLAG, {
		description: "Optional Emacs server socket name for agent Emacs operations (exported as PI_EMACS_AGENT_SOCKET)",
		type: "string",
	});
	const state: SocketState = {
		server: null,
		socketPath: null,
		context: null,
	};

	pi.registerMessageRenderer(SESSION_MESSAGE_TYPE, renderSessionMessage);
	// Layer B (ACP path) sender-side UI box. Registered unconditionally — even
	// in a session that is not exposing a control socket (no `--entwurf-control`),
	// an ACP backend may still use the MCP `entwurf_v2` to message OTHER
	// sessions. The renderer is needed here for the [entwurf sent →] box to
	// appear in this session's transcript when it sends.
	pi.registerMessageRenderer(ENTWURF_SENT_MESSAGE_TYPE, renderSentMessage);

	if (shouldRegisterControlTools(pi)) {
		registerListSessionsTool(pi);
		registerEntwurfV2Tool(pi);
	}
	registerControlSessionsCommand(pi, () => {});
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
		// --emacs-agent-socket is independent of --entwurf-control: export it
		// before the control-server branch so an Emacs frontend works even in a
		// non-control session.
		applyEmacsAgentSocketEnv(pi);
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
// Tool: entwurf_v2 (5d-3a) — the unified v2 dispatch verb
// ============================================================================
//
// The v2 runner + production deps live in the `.ts`-extension fence (excluded from
// this emit-capable root program). A STATIC import would pull the fence's literal
// `.ts` imports into root tsc → TS5097. So we reach the surface adapter via a
// NON-LITERAL dynamic import: root tsc cannot statically resolve a string-const
// specifier, and the strip-types runtime loads the `.ts` fence entry fine. The
// local interface below is the only contract this file knows about the fence — the
// `EntwurfV2RunResult` union stays behind `runAndRenderEntwurfV2FromSurface`, which
// hands back just `{ text, isError }`.
const ENTWURF_V2_SURFACE_MODULE = "./lib/entwurf-v2-surface.ts";

// SE-1 (slice 2e-a): a pi-session sender's `replyable` is a FACT (does its canonical
// control socket actually exist?), not env presence. entwurf-self-address.ts is a
// `.ts`-extension fence lib, so this root-tsc emit surface reaches it the SAME way as the
// v2 surface / mailbox guard — a NON-LITERAL dynamic import behind a local interface.
const ENTWURF_SELF_ADDRESS_MODULE = "./lib/entwurf-self-address.ts";
const ENTWURF_FACT_PROVIDER_MODULE = "./lib/entwurf-fact-provider.ts";
const ENTWURF_PEERS_RENDER_MODULE = "./lib/entwurf-peers-render.ts";
const META_SESSION_MODULE = "./lib/meta-session.ts";

type SelfAddressabilityFn = (facts: {
	origin: "pi-session" | "meta-session" | "external-mcp";
	socketAlive?: boolean;
	socketPathComputable?: boolean;
	recordBacked?: boolean;
	ownerAlive?: boolean;
	watchArmed?: boolean;
}) => { replyable: boolean; socketState: "alive" | "expected" | "none"; reason: string };

interface EntwurfSelfAddressModule {
	computeSelfAddressability: SelfAddressabilityFn;
}

/**
 * Decorate a local pi sender envelope with its HONEST replyability (SE-1 slice 2e-a).
 * The old code hardcoded replyability to true from env presence; a pi session running
 * without --entwurf-control has a session id but no control socket, so a reply silently fails.
 * Route the v2 senderProvider through the shared computeSelfAddressability truth table:
 * replyable ⟺ the canonical socket exists (existsSync
 * — slice-1 level, NOT a listener probe; deeper liveness is a separate hardening slice).
 */
function decoratePiSenderAddressability(sender: SenderEnvelope, compute: SelfAddressabilityFn): SenderEnvelope {
	const self = compute({
		origin: "pi-session",
		socketAlive: existsSync(getSocketPath(sender.sessionId)),
		socketPathComputable: true,
	});
	return { ...sender, origin: "pi-session", replyable: self.replyable };
}

interface EntwurfV2SurfaceModule {
	runAndRenderEntwurfV2FromSurface(
		params: {
			target: string;
			intent: "fire-and-forget" | "owned-outcome";
			mode?: "steer" | "follow_up";
			wants_reply?: boolean;
			message: string;
		},
		opts: {
			senderProvider: () => SenderEnvelope | undefined;
			agentDir?: string;
			prefixRoots?: readonly string[];
		},
	): Promise<{ text: string; isError: boolean }>;
}

function registerEntwurfV2Tool(pi: ExtensionAPI): void {
	const entwurfV2Parameters = Type.Object({
		target: Type.String({ description: "Target garden id (use entwurf_peers to discover)" }),
		intent: StringEnum(["fire-and-forget", "owned-outcome"] as const, {
			description:
				"fire-and-forget = send/reply/hand-off to a LIVE or meta-session target (set wants_reply for an answer); " +
				"owned-outcome = wake a DORMANT pi via spawn-bg resume ONLY — on a live target it is rejected " +
				"(owned-live-no-autosend) and never auto-converted",
		}),
		message: Type.String({
			description:
				"Message / prompt to dispatch. Hard cap 16000 chars; for larger payloads send a file/artifact path plus digest.",
			maxLength: 16000,
		}),
		mode: Type.Optional(
			StringEnum(["steer", "follow_up"] as const, {
				description: "Delivery mode for a live send: steer (immediate) or follow_up (after task)",
			}),
		),
		wants_reply: Type.Optional(Type.Boolean({ description: "Human-conversation reply hint (default false)" })),
	});

	type EntwurfV2Params = {
		target: string;
		intent: "fire-and-forget" | "owned-outcome";
		message: string;
		mode?: "steer" | "follow_up";
		wants_reply?: boolean;
	};

	const registerTool = pi.registerTool as (def: any) => void;

	registerTool({
		name: "entwurf_v2",
		label: "Dispatch (v2)",
		description: `CANONICAL delivery surface for a garden id. When you have a garden id and want to
reach whoever it names — message / reply / hand-off — use THIS verb. A garden id alone does not
reveal whether the target is a live pi session, a dormant pi session, or a Claude Code meta-session,
and entwurf_v2 is the one surface that reads that and routes correctly (so "when unsure which
transport, use entwurf_v2"). It dispatches to EXISTING targets; brand-new sibling creation is deferred
to a later v2 lane. Dispatch to a garden citizen through the unified entwurf_v2 verb: the 5b decider
picks the transport (live control-socket send / spawn-bg resume / meta-mailbox enqueue) from the
target's liveness + your intent, runs it under the v2 lock policy (pi paths take a per-target lock;
the mailbox path is lock-free, guarded by active-receiver deliverability), and reports one outcome
(delivered / rejected / lock-retained / delivered-but-lock-dirty).

- target: the garden id of the citizen to reach (required).
- intent: fire-and-forget (a send with no owned result) or owned-outcome (you own the result).
- message: the message/prompt to dispatch (required).
- mode: steer or follow_up for a live send (optional).
- wants_reply: reply hint for a live send (optional, default false).

CHOOSING INTENT (picking wrong is rejected, never auto-fixed): to message / reply / hand off a peer
that entwurf_peers shows as liveness=alive (a live pi OR a socket-citizen), use intent: fire-and-forget
— it routes to the live control-socket; set wants_reply:true if you need an answer (wants_reply is NOT
owned-outcome). For a meta-session (liveness=unsupported, e.g. Claude Code), replies are ALSO
fire-and-forget (→ mailbox). owned-outcome is ONLY for waking a DORMANT pi citizen (spawn-bg resume);
on a live target it is rejected as owned-live-no-autosend, on an unsupported backend as
backend-liveness-unsupported, and is NEVER auto-converted — so pick the right intent up front.

The decider — not this surface — chooses the transport.`,
		parameters: entwurfV2Parameters,
		async execute(
			_toolCallId: string,
			params: EntwurfV2Params,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const target = params.target?.trim();
			if (!target) {
				return { content: [{ type: "text", text: "entwurf_v2: missing target" }], isError: true };
			}
			if (!isSafeSessionId(target)) {
				return { content: [{ type: "text", text: "entwurf_v2: invalid target garden id" }], isError: true };
			}
			if (!params.message?.trim()) {
				return { content: [{ type: "text", text: "entwurf_v2: missing message" }], isError: true };
			}

			try {
				// The reply-address envelope for this pi session, decorated with its HONEST
				// replyability (SE-1 2e-a: socket existsSync, not a hardcoded true). ONE provider
				// feeds the control-socket RPC sender AND the meta-mailbox body sender (see
				// entwurf-v2-production). Built per-call so the timestamp is the dispatch moment;
				// computeSelfAddressability is loaded once here (sync senderProvider can't await).
				const selfMod = (await import(ENTWURF_SELF_ADDRESS_MODULE)) as unknown as EntwurfSelfAddressModule;
				const senderProvider = (): SenderEnvelope | undefined => {
					const s = buildLocalSenderEnvelope(ctx);
					return s ? decoratePiSenderAddressability(s, selfMod.computeSelfAddressability) : undefined;
				};
				const mod = (await import(ENTWURF_V2_SURFACE_MODULE)) as unknown as EntwurfV2SurfaceModule;
				const rendered = await mod.runAndRenderEntwurfV2FromSurface(
					{
						target,
						intent: params.intent,
						message: params.message,
						mode: params.mode,
						wants_reply: params.wants_reply,
					},
					// agentDir / prefixRoots intentionally omitted here: the surface adapter falls back
					// to the ENTWURF_PREFIX_ROOTS env SSOT for prefixRoots (5d-4); agentDir stays undefined.
					{ senderProvider },
				);
				return {
					content: [{ type: "text", text: rendered.text }],
					isError: rendered.isError,
					details: { isError: rendered.isError },
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `entwurf_v2 error: ${msg}` }],
					isError: true,
					details: { error: msg },
				};
			}
		},
	});
}

// ============================================================================
// Tool: entwurf_peers
// ============================================================================

interface EntwurfFactProviderModule {
	listEntwurfFacts(params: {
		metaEntries: readonly string[];
		readRecord: (filename: string) => string;
		socket: { dir: string };
	}): Promise<unknown>;
}

interface EntwurfPeersRenderModule {
	renderEntwurfPeers(result: unknown, controlDir: string): { text: string; payload: unknown };
}

interface MetaSessionModule {
	defaultMetaSessionsDir(): string;
}

async function renderEntwurfPeersForSurface(): Promise<{ text: string; payload: unknown }> {
	const meta = (await import(META_SESSION_MODULE)) as unknown as MetaSessionModule;
	const sessionsDir = meta.defaultMetaSessionsDir();
	let metaEntries: string[] = [];
	try {
		metaEntries = (await fs.readdir(sessionsDir)).filter((name) => name.endsWith(".meta.json"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}

	const provider = (await import(ENTWURF_FACT_PROVIDER_MODULE)) as unknown as EntwurfFactProviderModule;
	const result = await provider.listEntwurfFacts({
		metaEntries,
		readRecord: (filename) => readFileSync(path.join(sessionsDir, filename), "utf8"),
		// Same socket axis as the legacy live-session scan, but merged with the
		// meta-record rail by listEntwurfFacts so meta-mailbox citizens are discoverable too.
		socket: { dir: ENTWURF_DIR },
	});
	const render = (await import(ENTWURF_PEERS_RENDER_MODULE)) as unknown as EntwurfPeersRenderModule;
	return render.renderEntwurfPeers(result, ENTWURF_DIR);
}

function registerListSessionsTool(pi: ExtensionAPI): void {
	// Same TS2589 workaround as registerSessionTool — see the comment block
	// in that function for the revisit conditions.
	const registerTool = pi.registerTool as (def: any) => void;
	registerTool({
		name: "entwurf_peers",
		label: "List Garden Citizens",
		description:
			"List the entwurf fact surface across BOTH rails: garden citizens from meta-records (including active self-fetch meta receivers such as claude-code) and record-less control sockets, each with liveness. A legacy `sessions` projection is retained for alive pi control-socket sessions only. Pair with entwurf_v2 to address a peer by garden id; this surface reports facts, never per-row routing verbs.",
		parameters: Type.Object({}),
		async execute(
			_toolCallId: string,
			_params: Record<string, never>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const { text, payload } = await renderEntwurfPeersForSurface();
				return {
					content: [{ type: "text", text }],
					details: payload,
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `entwurf_peers error: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	});
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
					const modelLabel = formatRuntimeModel({ modelId: s.modelId, modelProvider: s.modelProvider }) ?? "(unknown)";
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

// /gnew (+ /garden-new) — birth a NEW garden-native session IN-PROCESS, same
// terminal, without the uuid that /new would mint. Builtin /new stays blocked
// under --entwurf-control (it cannot be made garden-native: the pre-switch hook
// result carries only { cancel }, no id injection). /gnew instead pre-creates an
// empty garden-native session file and ctx.switchSession()es into it: switchSession
// runs SessionManager.open(file), which reads the garden header id BEFORE
// session_start, so the backend/bridge identity (PI_SESSION_ID, control socket,
// backend sessionId) binds to the garden id from the first moment — no torn
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
