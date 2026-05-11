import type { AssistantMessage, AssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { BridgePromptEvent } from "./acp-bridge.js";

// Backend-emitted notifications that flow through this mapper untransformed.
// The bridge does not filter or rewrite these — they reach pi as raw agent
// text or pass-through `_meta` payloads. Logged here so a future operator
// reading a transcript with one of these tokens does not assume the bridge
// injected it.
//
//  - claude-agent-acp 0.32.0+: `usage_update` notifications may carry
//    `_meta._claude/origin = { kind: "task-notification" | ... }`. Set when a
//    Claude session-level task-notification autonomously triggered an
//    assistant turn (the user did not prompt). The bridge passes `_meta`
//    through unchanged. Cost still lands in pi accounting via `usage_update`,
//    but the upstream stop_reason is suppressed for task-notification
//    followups so the user-visible turn lifecycle stays anchored to the
//    user prompt.
//
//  - codex-acp 0.13.0+: a new `ThreadGoalUpdated` event is forwarded as
//    plain agent text via `client.send_agent_text("Goal updated (active|paused|...): <objective>")`.
//    Reaches pi as ordinary streaming text, NOT a structured tool/state
//    event. Operators may see the literal string in transcripts.
//
//  - gemini-cli (post 0.42-nightly): when ACP approval mode changes mid-
//    session the binary emits an `agent_message_chunk` with the literal text
//    `[MODE_UPDATE] <approval_mode>`. The bridge's overlay admin-policy
//    pins the tool surface, so workflow-level mode changes are usually
//    operator-driven via the gemini UI; the text is informational, not
//    actionable, but it appears in pi transcripts as raw text.

type ObservedToolState = {
	title: string;
	status?: string;
	notifiedRunning?: boolean;
	// Captured at tool_call time. ACP backends carry the original MCP input
	// args here as `rawInput`; the bridge uses them later when the tool
	// completes (specifically for entwurf_send → SentBoxData) so the sender-side
	// box can show the same sessionId/message/mode the operator's model
	// actually invoked rather than re-parsing the result text.
	rawInput?: unknown;
	// gemini-cli ACP source-grounded fallback (see
	// ~/org/llmlog/20260511T152235--gemini-cli-acp-tool-call-실증__llmlog_pishellacp_gemini.org).
	// Gemini does not surface `rawInput`/`rawOutput` at all (repo grep: 0 hit)
	// — args ride in `tool_call.content[]` as an explanation JSON
	// (`safeJsonStringify(params)` per packages/core/src/tools/mcp-tool.ts:349-352)
	// and the result body rides in `tool_call_update.content[]`. We snapshot
	// the start-event `content` array here so the completed-event handler can
	// recover sessionId/message/wants_reply even when Claude/Codex-style
	// rawInput is absent. Claude/Codex paths leave this undefined.
	startContent?: unknown[];
};

// Payload handed to the entwurf-sent callback when the bridge observes a
// completed `mcp__pi-tools-bridge__entwurf_send`. Layer B uses this to drive
// pi.sendMessage({ customType: "entwurf-sent", ... }) from index.ts. Shape
// kept loose (all-optional except `to`) because different ACP backends may
// not surface every field — the renderer in entwurf-control.ts shows
// "(unknown ...)" placeholders for missing pieces, which is the deliberate
// transparency-over-silence policy of the receive-side box too.
export interface EntwurfSentObserved {
	to: string;
	from?: string;
	cwd?: string;
	timestamp?: string;
	mode?: string;
	wants_reply?: boolean;
	deliveredAs?: string;
	body: string;
}

export type AcpPiStreamState = {
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	openTextIndex?: number;
	openThinkingIndex?: number;
	showToolNotifications?: boolean;
	observedTools?: Map<string, ObservedToolState>;
	// Layer B sender-side UI hook. When set, a successful entwurf_send
	// observation is forwarded here instead of (or in addition to) the
	// `[tool:done]` notice. index.ts wires this to pi.sendMessage so the
	// transcript gets a first-class [entwurf sent →] customMessage box; when
	// unset (e.g. resume bootstrap, smoke harness), entwurf_send falls back
	// to ordinary tool log so the bridge still works headless. Fire-and-forget;
	// any throw is swallowed so a renderer fault does not break the agent turn.
	onEntwurfSent?: (observed: EntwurfSentObserved) => void;
	// Gemini ACP currently surfaces MCP invocation args as an agent_thought_chunk
	// JSON blob, then emits a textual `[tool:done] entwurf_send (...)` marker as
	// agent_message_chunk instead of a structured tool_call_update. Cache the
	// candidate args so the message-chunk fallback can still promote the send to
	// the same [entwurf sent →] customMessage box.
	geminiEntwurfSendArgsCandidate?: unknown;
	// Last `usage_update.size` reported by the ACP backend on this turn.
	// claude-agent-acp adjusts its `contextWindowSize` based on the per-result
	// `modelUsage` block, so backends can shift the reported size mid-session
	// (e.g. when a per-model tier swap kicks in). We carry this through to the
	// diagnostic line so audits show the size the backend actually claimed,
	// not just the static `model.contextWindow`.
	acpUsageSize?: number;
	// True once any `usage_update` notification with a numeric `used` field
	// has arrived. We track this as a boolean rather than checking
	// `totalTokens > 0` because `used = 0` is a legitimate value — codex-acp
	// uses `tokens_in_context_window().max(0)` (explicitly allows 0), and
	// fresh-session / pre-first-call edges can also report 0. Treating 0 as
	// "no usage_update" would silently fall back to the componentSum path
	// when the backend was actually telling us "occupancy is zero."
	acpUsageSeen?: boolean;
};

function getObservedTools(state: AcpPiStreamState): Map<string, ObservedToolState> {
	if (!state.observedTools) {
		state.observedTools = new Map();
	}
	return state.observedTools;
}

function closeThinkingBlock(state: AcpPiStreamState): void {
	if (state.openThinkingIndex == null) return;
	const index = state.openThinkingIndex;
	const block = state.output.content[index] as any;
	state.stream.push({
		type: "thinking_end",
		contentIndex: index,
		content: block?.thinking ?? "",
		partial: state.output,
	});
	state.openThinkingIndex = undefined;
}

function closeTextBlock(state: AcpPiStreamState): void {
	if (state.openTextIndex == null) return;
	const index = state.openTextIndex;
	const block = state.output.content[index] as any;
	state.stream.push({
		type: "text_end",
		contentIndex: index,
		content: block?.text ?? "",
		partial: state.output,
	});
	state.openTextIndex = undefined;
}

function ensureTextBlock(state: AcpPiStreamState): number {
	if (state.openTextIndex != null) return state.openTextIndex;
	closeThinkingBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text: "" } as any);
	state.openTextIndex = index;
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	return index;
}

function ensureThinkingBlock(state: AcpPiStreamState): number {
	if (state.openThinkingIndex != null) return state.openThinkingIndex;
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as any);
	state.openThinkingIndex = index;
	state.stream.push({ type: "thinking_start", contentIndex: index, partial: state.output });
	return index;
}

function pushNotice(state: AcpPiStreamState, text: string): void {
	if (!state.showToolNotifications || !text.trim()) return;
	closeThinkingBlock(state);
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text: text } as any);
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	state.stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: state.output });
	state.stream.push({ type: "text_end", contentIndex: index, content: text, partial: state.output });
}

function firstTextItem(arr: unknown[]): string | undefined {
	for (const item of arr) {
		if (item && typeof item === "object" && (item as any).type === "text") {
			const text = String((item as any).text ?? "").trim();
			if (text) return text;
		}
		// ACP-normalized content shape: { type: "content", content: { type: "text", text: "..." } }
		if (item && typeof item === "object" && (item as any).type === "content") {
			const inner = (item as any).content;
			if (inner && typeof inner === "object" && inner.type === "text") {
				const text = String(inner.text ?? "").trim();
				if (text) return text;
			}
		}
	}
	return undefined;
}

// Robust extraction of MCP tool result text across the shapes ACP backends
// surface. Empirically observed (verified during 0.4.15 entwurf_send UX work):
//
//   Claude ACP: `update.rawOutput` is a `Array<{type:"text", text:"..."}>`
//               (the bridge unwraps MCP CallToolResult.content into rawOutput)
//   Codex ACP:  `update.rawOutput` is the full MCP CallToolResult object
//               `{content:[{type:"text",text:"..."}], isError?:bool}`
//   Gemini ACP: `update.rawOutput` may be missing entirely; the text result
//               can land in `update.content[]` as ACP's normalized
//               `{type:"content", content:{type:"text", text:"..."}}` shape
//
// Try all three shapes in order. Returns the first non-empty text. The earlier
// `firstTextContent` only handled shape 1 — that silently downgraded
// entwurf_send success boxes to plain `[tool:done]` lines on Codex/Gemini.
function firstTextContent(value: unknown): string | undefined {
	// Shape 1: array of text items (Claude ACP rawOutput)
	if (Array.isArray(value)) {
		const text = firstTextItem(value);
		if (text) return text;
	}
	if (!value || typeof value !== "object") return undefined;
	// Shape 2: MCP CallToolResult object (Codex ACP rawOutput)
	const inner = (value as any).content;
	if (Array.isArray(inner)) {
		const text = firstTextItem(inner);
		if (text) return text;
	}
	return undefined;
}

// Detect whether a CallToolResult-shaped rawOutput is flagged as MCP-level
// error. ACP `tool_call_update.status` is the protocol-level outcome (the call
// returned without transport error), but the MCP tool itself can still report
// failure via `isError: true` in the result body. Used to gate the entwurf-sent
// box: status="completed" + isError=true means the bridge hit an error path
// (e.g. socket missing) and we want to fall through to the ordinary
// `[tool:done] — <error>` notice rather than promoting to a success box.
function rawOutputHasError(rawOutput: unknown): boolean {
	if (!rawOutput || typeof rawOutput !== "object") return false;
	return (rawOutput as any).isError === true;
}

function titleForTool(update: any, previousTitle?: string, toolCallId?: string): string {
	return String(update?.title ?? previousTitle ?? update?._meta?.claudeCode?.toolName ?? toolCallId ?? "Tool");
}

// Match the `entwurf_send` MCP tool across the three ACP backend naming
// conventions we currently support. Each backend formats the visible title
// differently — both the namespace prefix AND a possible trailing server
// label suffix:
//
//   Claude: mcp__pi-tools-bridge__entwurf_send                  (double underscore, dash in server, no suffix)
//   Codex:  mcp__pi_tools_bridge__.entwurf_send                 (double underscore + dot, underscore in server, no suffix)
//   Gemini: entwurf_send (pi-tools-bridge MCP Server)           (server label suffix in parens — discovered from real session)
//   (also Gemini registry name: mcp_pi-tools-bridge_entwurf_send — single underscore namespace)
//
// The earlier `endsWith` form silently dropped Gemini back to `[tool:start]` /
// `[tool:done]` because `entwurf_send` was followed by " (pi-tools-bridge MCP
// Server)" instead of being at the end of the string. Token-style matching
// fixes this — `entwurf_send` must appear as a complete identifier, not part
// of a longer name like `entwurf_send_v2` or `entwurf_sender`:
//
//   Leading boundary  : start-of-string OR any non-alphanumeric (so `_`, `-`,
//                       `.`, ` ` all count as separator — Claude double-`_`,
//                       Codex `__.`, Gemini single `_`, etc.)
//   Trailing boundary : end-of-string OR any non-word char (so space, `(`,
//                       `)`, `.` all count; `_` and alphanumerics are
//                       rejected so `entwurf_send_v2` and `entwurf_sender`
//                       are NOT mismatched as `entwurf_send`)
//
// We check both the visible `title` and Claude Code's `_meta.claudeCode.toolName`
// hint so a future backend that surfaces only one of those still resolves.
const ENTWURF_SEND_TOKEN = /(^|[^a-zA-Z0-9])entwurf_send($|[^a-zA-Z0-9_])/;
function isEntwurfSendTool(title: string, update?: any): boolean {
	const claudeName = update?._meta?.claudeCode?.toolName;
	const candidates = [title, claudeName].filter((v): v is string => typeof v === "string" && v.length > 0);
	return candidates.some((name) => ENTWURF_SEND_TOKEN.test(name));
}

// Coerce ACP rawInput (typed as unknown by the ACP SDK because the MCP
// surface is provider-defined) into the shape entwurf_send actually publishes.
// Crash-quiet: missing fields fall through to the renderer which shows
// "(unknown ...)" so a backend that fails to forward rawInput still produces
// a visible box with a marker the operator can act on.
function coerceEntwurfSendArgs(rawInput: unknown): {
	sessionId?: string;
	message?: string;
	mode?: string;
	wants_reply?: boolean;
} {
	if (!rawInput || typeof rawInput !== "object") return {};
	const r = rawInput as Record<string, unknown>;
	const pickStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
	return {
		sessionId: pickStr(r.sessionId),
		message: pickStr(r.message),
		mode: pickStr(r.mode),
		wants_reply: typeof r.wants_reply === "boolean" ? r.wants_reply : undefined,
	};
}

function parseJsonObjectCandidate(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

// Gemini-only fallback. gemini-cli puts MCP invocation args on the start event
// as `tool_call.content[]` text — `safeJsonStringify(this.params)` per
// packages/core/src/tools/mcp-tool.ts:349-352 — instead of populating
// `rawInput`. We grep the cached start-event content array for the first text
// item that JSON-parses to an object, then run the same coercion as
// `coerceEntwurfSendArgs(rawInput)` so the box payload stays uniform across
// backends.
function extractEntwurfSendArgsFromStartContent(startContent: unknown[] | undefined): {
	sessionId?: string;
	message?: string;
	mode?: string;
	wants_reply?: boolean;
} {
	if (!startContent || startContent.length === 0) return {};
	for (const item of startContent) {
		// ACP normalized shape: { type: "content", content: { type: "text", text: "{...}" } }
		const text =
			item && typeof item === "object" && (item as any).type === "content"
				? String((item as any).content?.text ?? "").trim()
				: item && typeof item === "object" && (item as any).type === "text"
					? String((item as any).text ?? "").trim()
					: "";
		if (!text) continue;
		const candidate = parseJsonObjectCandidate(text);
		if (candidate) {
			return coerceEntwurfSendArgs(candidate);
		}
	}
	return {};
}

const GEMINI_ENTWURF_DONE_NOTICE = /(^|\n)\[tool:done\]\s+entwurf_send($|[^a-zA-Z0-9_])/;
function isGeminiEntwurfDoneNotice(text: string): boolean {
	return GEMINI_ENTWURF_DONE_NOTICE.test(text);
}

// Detect whether a result body smells like an `entwurf_send` failure. The MCP
// bridge returns errors as text content with `isError: true`, but the bridge
// path here only sees the text content; `[entwurf sent →]` body shape is the
// reliable success signature. We use this to keep the [tool:failed] surface
// alive on real failures even when entwurf_send notice suppression is on.
function looksLikeEntwurfSendSuccess(body: string | undefined): boolean {
	if (!body) return false;
	return body.includes("[entwurf sent →]") || body.includes("✓ delivered");
}

// Fallback for ACP backends that do not forward tool_call.rawInput. The MCP
// bridge's text result is stable enough to recover the visible fields (target,
// mode, preview, deliveredAs) without treating it as the primary source of
// truth. rawInput still wins when present because it carries the full message,
// not just the 5-line preview.
function parseEntwurfSentSummary(summary: string | undefined): {
	sessionId?: string;
	message?: string;
	mode?: string;
	wants_reply?: boolean;
	deliveredAs?: string;
} {
	if (!summary || !looksLikeEntwurfSendSuccess(summary)) return {};
	const lines = summary.split("\n");
	const pickLine = (prefix: string): string | undefined => {
		const line = lines.find((l) => l.trimStart().startsWith(prefix));
		return line ? line.trimStart().slice(prefix.length).trim() : undefined;
	};
	const modeRaw = pickLine("mode:");
	const mode = modeRaw?.replace(/\s+\(wants reply\)\s*$/, "").trim();
	const previewIndex = lines.findIndex((l) => l.trim() === "preview:");
	let message: string | undefined;
	if (previewIndex >= 0) {
		const previewLines: string[] = [];
		for (const line of lines.slice(previewIndex + 1)) {
			if (line.startsWith("✓ delivered")) break;
			previewLines.push(line.startsWith("    ") ? line.slice(4) : line);
		}
		message = previewLines.join("\n").trimEnd() || undefined;
	}
	const deliveredLine = lines.find((l) => l.startsWith("✓ delivered"));
	const deliveredAs = deliveredLine?.match(/\(([^)]+)\)/)?.[1];
	return {
		sessionId: pickLine("to:"),
		message,
		mode,
		wants_reply: modeRaw?.includes("(wants reply)"),
		deliveredAs,
	};
}

function renderToolUpdate(state: AcpPiStreamState, update: any): void {
	const toolCallId = String(update?.toolCallId ?? "");
	if (!toolCallId) return;
	const observedTools = getObservedTools(state);
	const previous = observedTools.get(toolCallId);
	const title = titleForTool(update, previous?.title, toolCallId);
	const status = typeof update?.status === "string" ? update.status : previous?.status;
	// Carry rawInput across tool_call → tool_call_update. ACP backends send
	// rawInput on the initial tool_call event (it's the MCP invocation args);
	// tool_call_update may or may not echo it. We snapshot it once and use it
	// at completion time for the entwurf-sent UI box. Falls back to whatever
	// the latest update echoes if the initial event didn't carry it.
	const rawInput = update?.rawInput ?? previous?.rawInput;
	// gemini-cli ACP fallback channel for MCP args. The start event's
	// `content[]` carries `safeJsonStringify(params)` (mcp-tool.ts:349-352)
	// when the backend doesn't fill rawInput. Capture it once here and reuse
	// in the completed branch — Gemini's `tool_call_update` doesn't echo the
	// content back, so the snapshot at start time is authoritative.
	const updateContent = Array.isArray(update?.content) ? (update.content as unknown[]) : undefined;
	const startContent = update.sessionUpdate === "tool_call" && updateContent ? updateContent : previous?.startContent;
	const next: ObservedToolState = {
		title,
		status,
		notifiedRunning: previous?.notifiedRunning,
		rawInput,
		startContent,
	};
	observedTools.set(toolCallId, next);

	const isEntwurfSend = isEntwurfSendTool(title, update);

	if (update.sessionUpdate === "tool_call") {
		// entwurf_send start is suppressed unconditionally — its UI is
		// promoted to the [entwurf sent →] customMessage box on completion,
		// and showing both would double-noise the transcript precisely on
		// the messages the operator already cares most about. Failures still
		// surface below via [tool:failed]; the customMessage box only covers
		// the success path.
		if (isEntwurfSend) return;
		pushNotice(state, `\n[tool:start] ${title}\n`);
		return;
	}

	if (update?._meta?.terminal_output && !previous?.notifiedRunning) {
		next.notifiedRunning = true;
		observedTools.set(toolCallId, next);
		pushNotice(state, `\n[tool:running] ${title}\n`);
	}

	if (status && status !== previous?.status) {
		// Try to recover a body summary from any ACP shape we know.
		// 1. rawOutput (Claude-style: array; Codex-style: CallToolResult object)
		// 2. update.content (Gemini-style: ACP normalized
		//    `[{type:"content", content:{type:"text", text:"..."}}]`)
		// firstTextContent already understands shape 1+2; shape 3 is what
		// Gemini emits per
		// ~/org/llmlog/20260511T152235--gemini-cli-acp-tool-call-실증__llmlog_pishellacp_gemini.org
		// finding 7 — `tool_call_update.content[].content.text` carries the
		// MCP `returnDisplay` string (the bridge's pre-formatted
		// `[entwurf sent →] ...` block).
		const summary = firstTextContent(update?.rawOutput) ?? firstTextContent(updateContent);
		if (status === "completed") {
			// Promote a completed entwurf_send to a customMessage box via the
			// pi.sendMessage callback wired in index.ts.
			//
			// Earlier this gate required `looksLikeEntwurfSendSuccess(summary)`
			// — i.e. the result text had to literally contain `[entwurf sent →]`
			// or `✓ delivered`. That worked for Claude (whose ACP unwraps the
			// MCP CallToolResult.content into rawOutput) but silently failed
			// for Codex (rawOutput is the wrapped object) and Gemini (rawOutput
			// often missing). The new gate uses ACP's own success signal:
			//
			//   1. tool name matches entwurf_send (matcher already verified)
			//   2. ACP `status === "completed"` (the call returned)
			//   3. MCP `rawOutput.isError !== true` (the bridge didn't textErr)
			//   4. either a body summary OR rawInput is present (so the box has
			//      at minimum a target sessionId + message to render)
			//
			// summary is preferred for the body when present (the bridge wrote
			// the canonical `[entwurf sent →] ...` block and we re-parse it
			// for delivery details). When absent, args from rawInput are the
			// authoritative source — the bridge's send wouldn't have reached
			// "completed" without them.
			const isError = rawOutputHasError(update?.rawOutput);
			// Args resolution priority (per gemini-cli source audit):
			// 1. ACP `rawInput` (Claude/Codex carry MCP args here)
			// 2. cached start-event `tool_call.content[]` text JSON (Gemini —
			//    `safeJsonStringify(params)` from mcp-tool.ts:349-352)
			// 3. parser-recovered fields from the bridge's `[entwurf sent →]`
			//    summary block (last-ditch — works when both above missed)
			const argsFromRawInput = coerceEntwurfSendArgs(rawInput);
			const argsFromGemini = argsFromRawInput.sessionId
				? { sessionId: undefined, message: undefined, mode: undefined, wants_reply: undefined }
				: extractEntwurfSendArgsFromStartContent(startContent);
			const args = {
				sessionId: argsFromRawInput.sessionId ?? argsFromGemini.sessionId,
				message: argsFromRawInput.message ?? argsFromGemini.message,
				mode: argsFromRawInput.mode ?? argsFromGemini.mode,
				wants_reply: argsFromRawInput.wants_reply ?? argsFromGemini.wants_reply,
			};
			const parsed = parseEntwurfSentSummary(summary);
			// Gate: matcher confirms tool, ACP says completed, MCP didn't textErr.
			// We deliberately do NOT also require args/summary presence — Gemini
			// has been observed to drop both rawInput and rawOutput, and falling
			// back to `[tool:done]` text would defeat the entire issue #8 design
			// (sender-side visual parity with `[entwurf received ⟵]`). Better to
			// render the box with "(unknown ...)" placeholder fields than to
			// silently downgrade the success to a tool log line. The renderer
			// already shows "(unknown sessionId)" / "(unknown agent)" /
			// "(unknown cwd)" honestly when fields are missing — same
			// transparency-over-silence convention as the receive-side header.
			if (isEntwurfSend && state.onEntwurfSent && !isError) {
				const observed = {
					to: args.sessionId ?? parsed.sessionId ?? "",
					mode: args.mode ?? parsed.mode,
					wants_reply: args.wants_reply ?? parsed.wants_reply,
					deliveredAs: parsed.deliveredAs,
					body: args.message ?? parsed.message ?? summary ?? "",
				};
				if (!observed.to && !observed.body) {
					// Do not create an empty late customMessage. Let the ordinary
					// [tool:done] notice surface so the operator at least sees the
					// backend's raw behavior.
					pushNotice(state, `\n[tool:done] ${title}${summary ? ` — ${summary.slice(0, 160)}` : ""}\n`);
					return;
				}
				try {
					state.onEntwurfSent({
						...observed,
						// from / cwd / timestamp come from index.ts (the
						// ExtensionContext has the live agentId + cwd; the MCP
						// bridge also writes them into `summary` but the
						// ExtensionContext snapshot is more authoritative).
					});
				} catch {
					// Renderer fault must not break the agent turn. Fall
					// through to ordinary [tool:done] notice as a visible
					// signal that the UI promotion failed.
					pushNotice(state, `\n[tool:done] ${title}${summary ? ` — ${summary.slice(0, 160)}` : ""}\n`);
				}
				return;
			}
			pushNotice(state, `\n[tool:done] ${title}${summary ? ` — ${summary.slice(0, 160)}` : ""}\n`);
		} else if (status === "failed") {
			pushNotice(state, `\n[tool:failed] ${title}${summary ? ` — ${summary.slice(0, 160)}` : ""}\n`);
		} else if (status === "cancelled") {
			pushNotice(state, `\n[tool:cancelled] ${title}\n`);
		}
	}
}

function renderPermissionEvent(
	state: AcpPiStreamState,
	event: Extract<BridgePromptEvent, { type: "permission_request" }>,
): void {
	const title = String((event.request as any)?.toolCall?.title ?? "Tool");
	const outcome = (event.response as any)?.outcome;
	let decision = "cancelled";
	if (outcome?.outcome === "selected") {
		const optionId = String(outcome.optionId ?? "");
		const options = Array.isArray((event.request as any)?.options)
			? ((event.request as any).options as Array<{ optionId?: unknown; kind?: unknown }>)
			: [];
		const chosen = options.find((option) => option.optionId === optionId);
		const kind = typeof chosen?.kind === "string" ? chosen.kind : undefined;
		if (kind === "allow_once" || kind === "allow_always") {
			decision = "approved";
		} else if (kind === "reject_once" || kind === "reject_always") {
			decision = "rejected";
		} else {
			// Fallback to the raw optionId for observability. ACP optionId strings
			// are backend-defined; guessing by substring ("allow" / "reject")
			// repeats the same matcher class of bug that broke Gemini tool titles.
			decision = optionId || "selected";
		}
	}
	pushNotice(state, `\n[permission:${decision}] ${title}\n`);
}

function applyAcpSessionUpdate(state: AcpPiStreamState, update: any): void {
	if (!update || typeof update !== "object") return;

	switch (update.sessionUpdate) {
		case "agent_message_chunk": {
			if (update.content?.type !== "text") return;
			const delta = String(update.content.text ?? "");
			if (!delta) return;
			// Gemini ACP fallback: MCP tool completion can arrive as ordinary
			// assistant text (`[tool:done] entwurf_send (...)`) rather than a
			// structured tool_call_update. Promote that marker to the same custom
			// sender box and suppress the textual tool log. The actual post-tool
			// assistant prose, if any, arrives in later chunks and remains visible.
			if (isGeminiEntwurfDoneNotice(delta)) {
				const args = coerceEntwurfSendArgs(state.geminiEntwurfSendArgsCandidate);
				state.geminiEntwurfSendArgsCandidate = undefined;
				// Only promote when we actually recovered the invocation args. An
				// empty post-stream [entwurf sent →] box is worse than the original
				// Gemini text notice because it appears late and with unknown fields.
				// If Gemini did not expose args, fall through and render the textual
				// notice normally.
				if (args.sessionId || args.message) {
					state.onEntwurfSent?.({
						to: args.sessionId ?? "",
						mode: args.mode,
						wants_reply: args.wants_reply,
						body: args.message ?? "",
					});
					return;
				}
			}
			const index = ensureTextBlock(state);
			const block = state.output.content[index] as any;
			block.text += delta;
			state.stream.push({
				type: "text_delta",
				contentIndex: index,
				delta,
				partial: state.output,
			});
			break;
		}
		case "agent_thought_chunk": {
			if (update.content?.type !== "text") return;
			const delta = String(update.content.text ?? "");
			if (!delta) return;
			const candidate = parseJsonObjectCandidate(delta);
			const candidateArgs = coerceEntwurfSendArgs(candidate);
			if (candidateArgs.sessionId && candidateArgs.message) {
				state.geminiEntwurfSendArgsCandidate = candidate;
			}
			const index = ensureThinkingBlock(state);
			const block = state.output.content[index] as any;
			block.thinking += delta;
			state.stream.push({
				type: "thinking_delta",
				contentIndex: index,
				delta,
				partial: state.output,
			});
			break;
		}
		case "tool_call":
		case "tool_call_update": {
			renderToolUpdate(state, update);
			break;
		}
		case "usage_update": {
			if (typeof update.used === "number") {
				state.output.usage.totalTokens = update.used;
				state.acpUsageSeen = true;
			}
			if (typeof update.size === "number") {
				state.acpUsageSize = update.size;
			}
			if (typeof update.cost?.amount === "number") {
				state.output.usage.cost.total = update.cost.amount;
			}
			break;
		}
		default:
			break;
	}
}

export function applyBridgePromptEvent(state: AcpPiStreamState, event: BridgePromptEvent): void {
	if (event.type === "session_notification") {
		applyAcpSessionUpdate(state, event.notification.update as any);
		return;
	}
	if (event.type === "permission_request") {
		renderPermissionEvent(state, event);
	}
}

export function finalizeAcpStreamState(state: AcpPiStreamState): void {
	closeThinkingBlock(state);
	closeTextBlock(state);
}
