// ACP plugin — ACP session_notification → pi event stream mapper (S2c).
//
// Translates the ACP backend's streaming notifications into pi's
// AssistantMessageEvent protocol (text/thinking blocks + tool/permission
// notices + usage), maintaining a running `partial: AssistantMessage`.
//
// Single-dialect collapse (NEXT §스코프 + oracle F): the 0.11.0 event-mapper
// reconciled three backend dialects (Claude rawOutput=array / Codex
// CallToolResult / Gemini content[]) plus an entwurf_v2 sent-box custom promotion.
// This lane collapsed that to ONE dialect (rawOutput=array) and dropped the
// entwurf/gemini/codex special-casing.
//
// This module is COMMON layer, not a claude module: the cortex landing reused THIS
// FILE with no adapter branch and no edit, and the CP2 LIVE turn ran through it.
// (That is a fact about this mapper only — the landing did touch other common files,
// e.g. backend.ts's overlay call site.) The collapse is therefore a standing bet,
// not a proof: a future backend whose session_notification dialect differs from
// rawOutput=array reopens this file rather than forking it per backend.
//
// CRITICAL boundary (GPT S2c Q3): an ACP `tool_call` / `tool_call_update` is
// rendered as an INFORMATIONAL TEXT NOTICE, never a structured pi `toolcall_*`
// event. The ACP child already executes its own tools (Claude Code side); a
// structured pi ToolCall would signal pi's agent loop to RE-EXECUTE it. Tools
// surface honestly in the transcript as `[tool:*]` notices instead. Thinking
// (`agent_thought_chunk`) IS structured — pi never executes thinking.

import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";

const NOTICE_TITLE_MAX = 80;
const NOTICE_SUMMARY_MAX = 160;
/** #163 M2: a result preview shows at most this many lines and UTF-8 bytes of output. */
const PREVIEW_MAX_LINES = 5;
const PREVIEW_MAX_BYTES = 400;

/** Identity fields for the running assistant message. */
export interface AcpStreamIdentity {
	api: string;
	provider: string;
	model: string;
}

type ObservedToolState = {
	title: string;
	status?: string;
	/** #163 M3: the compaction line for this call was already shown. */
	compactionShown?: boolean;
};

export type AcpPiStreamState = {
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	openTextIndex?: number;
	openThinkingIndex?: number;
	/** When false, tool/permission notices are suppressed (kept terse for smokes). */
	showToolNotifications?: boolean;
	/**
	 * #163: no notice of any kind — tool, permission, display-only or lifecycle. Set only for
	 * Pi's one-shot summary turn. Pi stores that summary as `contentText(response.content)`,
	 * which joins every text block (pi-ai `dist/utils/text.js`) without reading a signature,
	 * so a notice here would become part of the summary the session file keeps.
	 */
	quiet?: boolean;
	observedTools?: Map<string, ObservedToolState>;
	/**
	 * RAW, UNINTERPRETED observations from this turn's `usage_update` notifications
	 * — carried beside the pi message, never folded into it here.
	 *
	 * The mapper is COMMON layer and deliberately assigns no meaning to either
	 * number: what `cost.amount` is CUMULATIVE OVER, and whether that even holds
	 * for a non-claude backend, is a per-backend measurement. backend.ts seals them
	 * only for a backend whose adapter declares `sealsTurnAccounting` (#93).
	 *
	 * Last write wins, never a sum: both are latest session-level observations, and
	 * one turn can legitimately see several (claude emits one per `result` message,
	 * including a sub-agent's own — read at claude-agent-acp 0.79.0
	 * `dist/acp-agent.js:3504-3519`), each carrying that result's current values.
	 */
	observedSessionCostUsd?: number;
	observedContextOccupancyTokens?: number;
};

/** A zeroed pi Usage block. */
function zeroUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/**
 * Build a fresh stream state with an empty running AssistantMessage. The caller
 * (streamSimple) pushes the `start` event, drives notifications through
 * applyAcpSessionUpdate, then finalize + done.
 */
export function createAcpStreamState(
	stream: AssistantMessageEventStream,
	identity: AcpStreamIdentity,
	opts?: { showToolNotifications?: boolean; timestamp?: number },
): AcpPiStreamState {
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: identity.api,
		provider: identity.provider,
		model: identity.model,
		usage: zeroUsage(),
		// Seed, not a verdict. pi 0.83 added "pending" for exactly this: a partial
		// streaming message has not observed a terminal reason yet, and every pi
		// provider seeds it here and treats a stream that ENDS still-pending as an
		// error rather than a successful stop. Seeding "stop" instead would
		// pre-claim success for the whole time the turn is in flight.
		stopReason: "pending",
		timestamp: opts?.timestamp ?? Date.now(),
	};
	return {
		stream,
		output,
		showToolNotifications: opts?.showToolNotifications ?? true,
	};
}

function getObservedTools(state: AcpPiStreamState): Map<string, ObservedToolState> {
	if (!state.observedTools) state.observedTools = new Map();
	return state.observedTools;
}

function closeThinkingBlock(state: AcpPiStreamState): void {
	if (state.openThinkingIndex == null) return;
	const index = state.openThinkingIndex;
	const block = state.output.content[index] as { thinking?: string };
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
	const block = state.output.content[index] as { text?: string };
	state.stream.push({ type: "text_end", contentIndex: index, content: block?.text ?? "", partial: state.output });
	state.openTextIndex = undefined;
}

function ensureTextBlock(state: AcpPiStreamState): number {
	if (state.openTextIndex != null) return state.openTextIndex;
	closeThinkingBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text: "" });
	state.openTextIndex = index;
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	return index;
}

function ensureThinkingBlock(state: AcpPiStreamState): number {
	if (state.openThinkingIndex != null) return state.openThinkingIndex;
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" });
	state.openThinkingIndex = index;
	state.stream.push({ type: "thinking_start", contentIndex: index, partial: state.output });
	return index;
}

/**
 * Emit a standalone one-line notice as its own text block. Used for tool /
 * permission events — informational, NOT structured tool calls.
 */
function pushNotice(state: AcpPiStreamState, text: string): void {
	if (state.quiet || !state.showToolNotifications || !text.trim()) return;
	closeThinkingBlock(state);
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text });
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	state.stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: state.output });
	state.stream.push({ type: "text_end", contentIndex: index, content: text, partial: state.output });
}

// #163: terminal escape sequences, the same range Pi strips from tool output before it shows it
// (pi-coding-agent 1.5.2 `dist/utils/ansi.js` `stripAnsi`, derived from chalk/ansi-regex, MIT,
// Copyright (c) Sindre Sorhus). OSC runs to its first terminator (BEL, ESC \\ or 0x9C); CSI and
// its relatives take optional parameters and one final byte. Pi does not export it from its
// package root, and this bridge imports Pi only by the root (`check-pi-import-surface`).
const ANSI_SEQUENCE = new RegExp(
	"(?:\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\u005C|\\u009C))|" +
		"(?:(?:\\u001B\\[|\\u009B)[<=>]|[\\u001B\\u009B][[\\]()#;?]*)(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]",
	"g",
);
// What is left that a terminal would act on: C0 except tab, LF and CR; DEL and C1; and
// U+FFF9..U+FFFB, which Pi also drops because they crash width measurement
// (`dist/utils/shell.js` `sanitizeBinaryOutput`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFF9-\uFFFB]/g;

/**
 * #163: no text that a backend or a tool's output supplies reaches the operator's terminal as a
 * control sequence. A window-title OSC 0 or a clipboard-write OSC 52 in a command's output would
 * otherwise pass straight through the notice line and the pi-tui renderer. Every notice text
 * goes through here: title, summary, preview and permission.
 */
function stripTerminalControls(text: string): string {
	return text.replace(ANSI_SEQUENCE, "").replace(CONTROL_CHARS, "");
}

/** Neutralize backtick fences (which would swallow following lines in chat renderers) and clip with an ellipsis. */
function fenceSafeClip(text: string, max: number): string {
	const fenceSafe = text.replace(/`{3,}/g, "[fence]").replace(/`/g, "'");
	if (fenceSafe.length <= max) return fenceSafe;
	return `${fenceSafe.slice(0, max - 1)}…`;
}

/**
 * Sanitize an inline fragment for the one-line `[tool:*]` / `[permission:*]`
 * notice surface: strip terminal controls, collapse whitespace, neutralize
 * backtick fences, truncate with ellipsis.
 */
export function sanitizeNoticeFragment(text: string | null | undefined, max: number): string {
	if (!text) return "";
	return fenceSafeClip(stripTerminalControls(text).replace(/\s+/g, " ").trim(), max);
}

/**
 * #163: one line of an output preview. Unlike a notice fragment it keeps its indentation, so a
 * stack trace, YAML or a diff reads as it does in Pi: controls stripped, CR dropped and tabs
 * expanded to three spaces as Pi's tool renderer does (`dist/core/tools/render-utils.js`
 * `replaceTabs`), trailing space trimmed.
 */
function sanitizePreviewLine(line: string): string {
	return fenceSafeClip(
		stripTerminalControls(line).replace(/\r/g, "").replace(/\t/g, "   ").trimEnd(),
		PREVIEW_MAX_BYTES,
	);
}

function firstTextItem(arr: unknown[]): string | undefined {
	for (const item of arr) {
		if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
			const text = String((item as { text?: unknown }).text ?? "").trim();
			if (text) return text;
		}
		// ACP-normalized shape: { type:"content", content:{ type:"text", text } }
		if (item && typeof item === "object" && (item as { type?: string }).type === "content") {
			const inner = (item as { content?: { type?: string; text?: unknown } }).content;
			if (inner && typeof inner === "object" && inner.type === "text") {
				const text = String(inner.text ?? "").trim();
				if (text) return text;
			}
		}
	}
	return undefined;
}

/** Claude ACP rawOutput is an array of text items; tolerate a CallToolResult body too. */
function firstTextContent(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		const text = firstTextItem(value);
		if (text) return text;
	}
	if (!value || typeof value !== "object") return undefined;
	const inner = (value as { content?: unknown }).content;
	if (Array.isArray(inner)) {
		const text = firstTextItem(inner);
		if (text) return text;
	}
	return undefined;
}

/** MCP-level error flag on a CallToolResult-shaped rawOutput. */
function rawOutputHasError(rawOutput: unknown): boolean {
	if (!rawOutput || typeof rawOutput !== "object") return false;
	return (rawOutput as { isError?: unknown }).isError === true;
}

function titleForTool(update: Record<string, unknown>, previousTitle?: string): string {
	const meta = update?._meta as { claudeCode?: { toolName?: string } } | undefined;
	return String(update?.title ?? previousTitle ?? meta?.claudeCode?.toolName ?? update?.toolCallId ?? "Tool");
}

function isTerminalToolStatus(status: string | undefined): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

/** The adapter's progress-beat elapsed seconds, or undefined when this update is not a beat. */
function elapsedSecondsOf(update: Record<string, unknown>): number | undefined {
	const meta = update?._meta as { claudeCode?: { toolResponse?: { elapsedTimeSeconds?: unknown } } } | undefined;
	const value = meta?.claudeCode?.toolResponse?.elapsedTimeSeconds;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatElapsed(seconds: number): string {
	const whole = Math.floor(seconds);
	if (whole < 60) return `${whole}s`;
	const rest = whole % 60;
	return rest === 0 ? `${Math.floor(whole / 60)}m` : `${Math.floor(whole / 60)}m${rest}s`;
}

/**
 * Render an ACP tool_call / tool_call_update as a text notice (NEVER a
 * structured toolcall — the ACP child already executed it).
 */
function renderToolUpdate(state: AcpPiStreamState, update: Record<string, unknown>): void {
	const toolCallId = String(update?.toolCallId ?? "");
	if (!toolCallId) return;
	const observedTools = getObservedTools(state);
	const previous = observedTools.get(toolCallId);
	const title = titleForTool(update, previous?.title);
	const status = typeof update?.status === "string" ? (update.status as string) : previous?.status;
	const updateContent = Array.isArray(update?.content) ? (update.content as unknown[]) : undefined;

	if (update.sessionUpdate === "tool_call") {
		const observed: ObservedToolState = { title, status };
		observedTools.set(toolCallId, observed);
		pushNotice(state, `\n[tool:start] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n`);
		// The adapter opens a compaction it saw only at its end as one terminal `tool_call`.
		if (isTerminalToolStatus(status)) pushCompactionLine(state, update, observed);
		return;
	}

	// tool_call_update. A running tool's only mid-flight signal is the SDK's
	// `tool_progress` beat, which the adapter forwards WITHOUT any client
	// capability as `_meta.claudeCode.toolResponse.elapsedTimeSeconds` (#162,
	// measured 2026-11-13 on claude-agent-acp 0.106.0 with `clientCapabilities: {}`:
	// a 120 s foreground Bash produced beats at 30/60/90 s, the first one also
	// carrying `status: "in_progress"`). It carries no stdout: the adapter sends a
	// foreground command's output only with its completion, even to a client that
	// declares `_meta.terminal_output` (measured the same day). So the honest
	// mid-flight line is liveness plus elapsed time, never partial output. It is
	// display-only, like a lifecycle notice: elapsed beats depend on wall time, so
	// they stay out of transcript replay and the reuse-compat signature.
	const elapsed = elapsedSecondsOf(update);
	const running = !isTerminalToolStatus(status) && !isTerminalToolStatus(previous?.status);
	// #163 M1: what is running, once it is known. The first `tool_call` is sent before the input
	// has streamed, so a Bash call opens as "Terminal" (claude-agent-acp 0.107.0
	// `tool-calls/reporters/bash.js:22`) and the command arrives later as a title-only update.
	// One display-only line names it. A beat in the same update already names the title, so
	// that update shows the beat alone; a repeated title shows nothing.
	if (
		running &&
		elapsed === undefined &&
		previous !== undefined &&
		typeof update.title === "string" &&
		sanitizeNoticeFragment(update.title, NOTICE_TITLE_MAX) !== sanitizeNoticeFragment(previous.title, NOTICE_TITLE_MAX)
	) {
		pushDisplayOnlyNotice(state, `\n[tool:running] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n`);
	}
	if (elapsed !== undefined && running) {
		pushDisplayOnlyNotice(
			state,
			`\n[tool:running] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)} — ${formatElapsed(elapsed)}\n`,
		);
	}
	if (status && status !== previous?.status) {
		const summary = firstTextContent(update?.rawOutput) ?? firstTextContent(updateContent);
		const suffix = summary ? ` — ${sanitizeNoticeFragment(summary, NOTICE_SUMMARY_MAX)}` : "";
		const failed = status !== "completed" || rawOutputHasError(update?.rawOutput);
		if (status === "completed") {
			const label = rawOutputHasError(update?.rawOutput) ? "tool:failed" : "tool:done";
			pushNotice(state, `\n[${label}] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		} else if (status === "failed") {
			pushNotice(state, `\n[tool:failed] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		} else if (status === "cancelled") {
			pushNotice(state, `\n[tool:cancelled] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		}
		if (isTerminalToolStatus(status) && summary) {
			const preview = previewOf(summary, failed);
			if (preview) {
				pushDisplayOnlyNotice(
					state,
					`\n[tool:output] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n${preview}\n`,
				);
			}
		}
	}

	const observed: ObservedToolState = { title, status, compactionShown: previous?.compactionShown };
	observedTools.set(toolCallId, observed);
	if (isTerminalToolStatus(status)) pushCompactionLine(state, update, observed);
}

/** The output inside one wrapping code fence; the adapter sends a command's output as "```console\n…\n```". */
function unfence(text: string): string {
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
	return fenced ? fenced[1] : text;
}

/** Keep `text` within `maxBytes` UTF-8 bytes, cutting at a character boundary from the head or the tail. */
function clipBytes(text: string, maxBytes: number, fromTail: boolean): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	const chars = Array.from(text);
	if (fromTail) chars.reverse();
	const kept: string[] = [];
	let bytes = Buffer.byteLength("…", "utf8");
	for (const ch of chars) {
		const size = Buffer.byteLength(ch, "utf8");
		if (bytes + size > maxBytes) break;
		kept.push(ch);
		bytes += size;
	}
	if (fromTail) kept.reverse();
	return fromTail ? `…${kept.join("")}` : `${kept.join("")}…`;
}

/**
 * #163 M2: a short look at what a finished tool returned, as Pi shows a tool's output. At most
 * PREVIEW_MAX_LINES lines and PREVIEW_MAX_BYTES bytes, each line passed through the notice
 * sanitizer. A failure shows the TAIL, where a command's stderr and its exit status end up
 * (`stdout` then `stderr`, `reporters/bash.js`); a success shows the head. Nothing when the whole
 * output already fits on the terminal notice's one line.
 */
function previewOf(raw: string, failed: boolean): string | undefined {
	const lines = unfence(raw)
		.split("\n")
		.map((line) => sanitizePreviewLine(line));
	while (lines.length > 0 && lines[0] === "") lines.shift();
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	if (lines.length === 0) return undefined;
	if (lines.length === 1 && lines[0].length <= NOTICE_SUMMARY_MAX) return undefined;
	const omitted = lines.length > PREVIEW_MAX_LINES;
	const shown = failed ? lines.slice(-PREVIEW_MAX_LINES) : lines.slice(0, PREVIEW_MAX_LINES);
	if (omitted) {
		if (failed) shown.unshift("…");
		else shown.push("…");
	}
	return clipBytes(shown.join("\n"), PREVIEW_MAX_BYTES, failed);
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

/**
 * #163 M3: the backend's own compaction, in numbers. claude-agent-acp reports it as a synthetic
 * tool call whose `_meta.claudeCode.toolName` is "compact", and gives a client without the AIR
 * extension the facts as `rawOutput: {trigger, preTokens, postTokens?, durationMs?, error?}`
 * (0.107.0 `tool-calls/reporters/compaction.js` `finished`, `context-compaction.js:366-376`). One
 * lifecycle line per compaction, whichever terminal update carries the facts first; a field that
 * is absent is left out. Shown like the other `[acp: …]` lines, whatever the tool-notice setting.
 */
function pushCompactionLine(
	state: AcpPiStreamState,
	update: Record<string, unknown>,
	observed: ObservedToolState,
): void {
	if (observed.compactionShown) return;
	const meta = update?._meta as { claudeCode?: { toolName?: unknown } } | undefined;
	if (meta?.claudeCode?.toolName !== "compact") return;
	const facts = update?.rawOutput as
		| { trigger?: unknown; preTokens?: unknown; postTokens?: unknown; durationMs?: unknown; error?: unknown }
		| undefined;
	if (!facts || typeof facts !== "object" || Array.isArray(facts)) return;
	const parts = ["compaction"];
	if (typeof facts.trigger === "string" && facts.trigger) parts.push(facts.trigger);
	if (facts.error !== undefined && facts.error !== null && facts.error !== "") parts.push("failed");
	const pre = typeof facts.preTokens === "number" ? formatTokens(facts.preTokens) : undefined;
	const post = typeof facts.postTokens === "number" ? formatTokens(facts.postTokens) : undefined;
	if (pre && post) parts.push(`${pre}→${post}`);
	else if (pre) parts.push(pre);
	if (typeof facts.durationMs === "number" && facts.durationMs >= 0) {
		const seconds = facts.durationMs / 1000;
		parts.push(`in ${seconds < 60 ? `${seconds.toFixed(1)}s` : formatElapsed(seconds)}`);
	}
	if (parts.length === 1) return;
	observed.compactionShown = true;
	pushAcpLifecycleNotice(state, parts.join(" "));
}

/** Push a permission-decision notice (informational text, not a tool call). */
export function pushPermissionNotice(state: AcpPiStreamState, title: string, decision: string): void {
	pushNotice(state, `\n[permission:${decision}] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n`);
}

/**
 * The textSignature marker stamped on lifecycle progress notices (S2f). It is
 * what lets the transcript flatten (context.ts) and the reuse-compat signature
 * (session-store.ts) EXCLUDE these blocks: a lifecycle notice is display-only —
 * it must never replay into an ACP prompt nor perturb a reuse signature, whether
 * present or absent. Without the marker the "output-side only" claim is L0 hope.
 */
export const LIFECYCLE_NOTICE_SIGNATURE = "entwurf:lifecycle-notice-v1";

/**
 * A tool notice that is display-only: suppressed with the tool stream
 * (`showToolNotifications`), and stamped with LIFECYCLE_NOTICE_SIGNATURE so it
 * never replays into an ACP prompt nor perturbs the reuse-compat signature.
 */
function pushDisplayOnlyNotice(state: AcpPiStreamState, text: string): void {
	if (state.quiet || !state.showToolNotifications) return;
	closeThinkingBlock(state);
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text, textSignature: LIFECYCLE_NOTICE_SIGNATURE });
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	state.stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: state.output });
	state.stream.push({ type: "text_end", contentIndex: index, content: text, partial: state.output });
}

/**
 * Push a one-line ACP turn-lifecycle progress notice (`[acp: …]`) as its own
 * text block, stamped with LIFECYCLE_NOTICE_SIGNATURE. Two ways it differs from
 * tool/permission notices:
 *   1. It IGNORES `showToolNotifications`. Turn progress is ALWAYS visible — a
 *      silent bootstrap (overlay → spawn → init → newSession → setModel → first
 *      token) reads as a hang. Only the verbose tool stream is suppressible.
 *   2. The marker keeps it display-only — out of the transcript replay and the
 *      reuse-compat signature (the two consumers filter on the signature).
 */
export function pushAcpLifecycleNotice(state: AcpPiStreamState, text: string): void {
	if (state.quiet) return;
	const line = `\n[acp: ${sanitizeNoticeFragment(text, NOTICE_TITLE_MAX)}]\n`;
	closeThinkingBlock(state);
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text: line, textSignature: LIFECYCLE_NOTICE_SIGNATURE });
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	state.stream.push({ type: "text_delta", contentIndex: index, delta: line, partial: state.output });
	state.stream.push({ type: "text_end", contentIndex: index, content: line, partial: state.output });
}

/**
 * Apply one ACP `session_notification` update to the stream state. Unknown
 * update kinds are ignored (forward-compatible).
 */
export function applyAcpSessionUpdate(
	state: AcpPiStreamState,
	update: Record<string, unknown> | null | undefined,
): void {
	if (!update || typeof update !== "object") return;

	switch (update.sessionUpdate) {
		case "agent_message_chunk": {
			const content = update.content as { type?: string; text?: unknown } | undefined;
			if (content?.type !== "text") return;
			const delta = String(content.text ?? "");
			if (!delta) return;
			const index = ensureTextBlock(state);
			(state.output.content[index] as { text: string }).text += delta;
			state.stream.push({ type: "text_delta", contentIndex: index, delta, partial: state.output });
			break;
		}
		case "agent_thought_chunk": {
			const content = update.content as { type?: string; text?: unknown } | undefined;
			if (content?.type !== "text") return;
			const delta = String(content.text ?? "");
			if (!delta) return;
			const index = ensureThinkingBlock(state);
			(state.output.content[index] as { thinking: string }).thinking += delta;
			state.stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: state.output });
			break;
		}
		case "tool_call":
		case "tool_call_update": {
			renderToolUpdate(state, update);
			break;
		}
		case "usage_update": {
			// `used` is OCCUPANCY-shaped — the backend's post-turn context size, not
			// the prompt response's turn aggregate. Claude sends `lastAssistantTotalUsage`
			// as `used` (read at claude-agent-acp 0.79.0
			// `dist/acp-agent.js:3934-3945`), after constructing that scalar from the
			// latest assistant snapshot (`:3916-3929`). pi reads `usage.totalTokens` as
			// exactly that occupancy (`calculateContextTokens(usage) = usage.totalTokens
			// || input + output + cacheRead + cacheWrite`, read at pi-coding-agent
			// `dist/core/compaction/compaction.js:86-88`). The assignment below is the
			// raw observation; backend.ts seals the measured occupancy and relays the
			// turn aggregate separately on `usage.acp`, never onto pi's four fields.
			if (typeof update.used === "number") {
				state.output.usage.totalTokens = update.used;
				state.observedContextOccupancyTokens = update.used;
			}
			// `cost.amount` is a running SESSION total on the claude backend, so
			// assigning it to a TURN field is wrong wherever an adapter has measured
			// that (#93: pi sums per-message cost, which inflated a long session
			// 10-18x). It stays here for a backend whose adapter has NOT measured its
			// semantics — for those, this coarse assignment is the pre-#93 behaviour
			// and changing it would be an unmeasured claim. backend.ts OVERWRITES
			// this field authoritatively (from the baseline diff) for every turn of a
			// backend that HAS sealsTurnAccounting, so the cumulative can never reach
			// an operator's dashboard as a turn cost on that path.
			const cost = update.cost as { amount?: unknown } | undefined;
			if (typeof cost?.amount === "number") {
				state.output.usage.cost.total = cost.amount;
				state.observedSessionCostUsd = cost.amount;
			}
			break;
		}
		default:
			break;
	}
}

/** Close any open text/thinking block. Call before pushing the terminal done. */
export function finalizeAcpStreamState(state: AcpPiStreamState): void {
	closeThinkingBlock(state);
	closeTextBlock(state);
}
