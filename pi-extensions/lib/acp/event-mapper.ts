// ACP plugin — ACP session_notification → pi event stream mapper (S2c).
//
// Translates the ACP backend's streaming notifications into pi's
// AssistantMessageEvent protocol (text/thinking blocks + tool/permission
// notices + usage), maintaining a running `partial: AssistantMessage`.
//
// Claude-only collapse (NEXT §스코프 + oracle F): the 0.11.0 event-mapper
// reconciled three backend dialects (Claude rawOutput=array / Codex
// CallToolResult / Gemini content[]) plus an entwurf_v2 sent-box custom promotion.
// This lane drives ONLY claude-agent-acp, so the dialect collapses to one
// (rawOutput=array) and the entwurf/gemini/codex special-casing is dropped.
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

/** Identity fields for the running assistant message. */
export interface AcpStreamIdentity {
	api: string;
	provider: string;
	model: string;
}

type ObservedToolState = {
	title: string;
	status?: string;
	notifiedRunning?: boolean;
};

export type AcpPiStreamState = {
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	openTextIndex?: number;
	openThinkingIndex?: number;
	/** When false, tool/permission notices are suppressed (kept terse for smokes). */
	showToolNotifications?: boolean;
	observedTools?: Map<string, ObservedToolState>;
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
		stopReason: "stop",
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
	if (!state.showToolNotifications || !text.trim()) return;
	closeThinkingBlock(state);
	closeTextBlock(state);
	const index = state.output.content.length;
	state.output.content.push({ type: "text", text });
	state.stream.push({ type: "text_start", contentIndex: index, partial: state.output });
	state.stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: state.output });
	state.stream.push({ type: "text_end", contentIndex: index, content: text, partial: state.output });
}

/**
 * Sanitize an inline fragment for the one-line `[tool:*]` / `[permission:*]`
 * notice surface: collapse whitespace, neutralize backtick fences (which would
 * otherwise swallow following lines in chat renderers), truncate with ellipsis.
 */
export function sanitizeNoticeFragment(text: string | null | undefined, max: number): string {
	if (!text) return "";
	const collapsed = text.replace(/\s+/g, " ").trim();
	const fenceSafe = collapsed.replace(/`{3,}/g, "[fence]").replace(/`/g, "'");
	if (fenceSafe.length <= max) return fenceSafe;
	return `${fenceSafe.slice(0, max - 1)}…`;
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
	const meta = update?._meta as { terminal_output?: unknown } | undefined;

	let notifiedRunning = previous?.notifiedRunning;

	if (update.sessionUpdate === "tool_call") {
		observedTools.set(toolCallId, { title, status, notifiedRunning });
		pushNotice(state, `\n[tool:start] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n`);
		return;
	}

	// tool_call_update
	if (meta?.terminal_output && !notifiedRunning) {
		notifiedRunning = true;
		pushNotice(state, `\n[tool:running] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}\n`);
	}

	if (status && status !== previous?.status) {
		const summary = firstTextContent(update?.rawOutput) ?? firstTextContent(updateContent);
		const suffix = summary ? ` — ${sanitizeNoticeFragment(summary, NOTICE_SUMMARY_MAX)}` : "";
		if (status === "completed") {
			const label = rawOutputHasError(update?.rawOutput) ? "tool:failed" : "tool:done";
			pushNotice(state, `\n[${label}] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		} else if (status === "failed") {
			pushNotice(state, `\n[tool:failed] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		} else if (status === "cancelled") {
			pushNotice(state, `\n[tool:cancelled] ${sanitizeNoticeFragment(title, NOTICE_TITLE_MAX)}${suffix}\n`);
		}
	}

	observedTools.set(toolCallId, { title, status, notifiedRunning });
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
			// S2c maps COARSE ACP usage only: `used` is occupancy-shaped and does
			// not split cleanly into pi's input/output/cache fields, so we fill
			// totalTokens + cost.total and leave the rest zero. Richer accounting
			// is a later lane (S2e/PR-polish).
			if (typeof update.used === "number") state.output.usage.totalTokens = update.used;
			const cost = update.cost as { amount?: unknown } | undefined;
			if (typeof cost?.amount === "number") state.output.usage.cost.total = cost.amount;
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
