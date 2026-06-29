// ACP plugin — pi Context → ACP prompt conversion (S2c).
//
// S2c is spawn-per-turn: every streamSimple call spawns a fresh ACP session, so
// the backend has NO memory of prior turns. Sending only the last user message
// would silently drop multi-turn history — that is context loss, not a thin
// substrate. So this flattens the whole pi conversation into ONE text transcript
// and sends it as a single ACP user prompt block.
//
// S2c/S2d boundary (GPT S2c Q2): this is CONVERSATION TRANSCRIPT PASSTHROUGH, not
// rich-carrier identity injection. Deliberately EXCLUDED here (all S2d):
//   - `context.systemPrompt` — never read into the prompt or `_meta.systemPrompt`
//     (the billing carrier stays absent — NEXT §S2-scout 핀1);
//   - `~/AGENTS.md` / cwd AGENTS / bridge identity narrative;
//   - first-user-message augment + project-context de-dup;
//   - `context.tools` — the ACP child tool surface is the S2b
//     `_meta.claudeCode.options` SSOT, never re-sent here.
// Structured tool replay is also excluded: tool calls/results render as plain
// transcript text, never as ACP tool invocations (the child runs its own tools).

import type { AssistantMessage, Context, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

// MUST equal event-mapper.ts `LIFECYCLE_NOTICE_SIGNATURE` (the SSOT/producer).
// It is mirrored, not imported: the strip-types deterministic gates load these
// lib files by their `.ts` source and cannot resolve a cross-sibling VALUE
// import (`./event-mapper.js`) — the lib modules share TYPES only. The mirror is
// kept honest behaviorally by check-acp-session-reuse (a drift would leave the
// `[acp: …]` notices in the captured ACP prompt and fail the gate).
const LIFECYCLE_NOTICE_SIGNATURE = "entwurf:lifecycle-notice-v1";

/** An ACP text content block. */
export interface AcpTextBlock {
	type: "text";
	text: string;
}

function textFromUserOrToolContent(content: UserMessage["content"] | ToolResultMessage["content"]): string {
	if (typeof content === "string") return content;
	// Render text verbatim; images are NOT dropped silently — they leave a text
	// marker so the transcript honestly records an attachment the text-only S2c
	// transcript cannot carry (real ACP image passthrough is a later lane).
	return content
		.map((c) => {
			if (c.type === "text") return c.text;
			if (c.type === "image") return `[image omitted: ${c.mimeType ?? "unknown"}]`;
			return "";
		})
		.filter((s) => s !== "")
		.join("\n");
}

function textFromAssistantContent(content: AssistantMessage["content"]): string {
	// Assistant text only — thinking is omitted and tool calls are not replayed
	// (the ACP child executes its own tools; replaying structured calls would be
	// a lie). Tool RESULTS still appear via their own toolResult message below.
	return (
		content
			.filter((c): c is { type: "text"; text: string; textSignature?: string } => c.type === "text")
			// Drop S2f lifecycle progress notices (`[acp: …]`): display-only, stamped
			// with LIFECYCLE_NOTICE_SIGNATURE. Replaying them into a `new` rebuild's
			// full transcript would inject bridge-internal chatter into the ACP prompt.
			.filter((c) => c.textSignature !== LIFECYCLE_NOTICE_SIGNATURE)
			.map((c) => c.text)
			.join("")
	);
}

/** Render one pi message as a transcript line, or undefined to skip it. */
function renderMessage(message: Message): string | undefined {
	switch (message.role) {
		case "user": {
			const text = textFromUserOrToolContent(message.content).trim();
			return text ? `User: ${text}` : undefined;
		}
		case "assistant": {
			const text = textFromAssistantContent(message.content).trim();
			return text ? `Assistant: ${text}` : undefined;
		}
		case "toolResult": {
			const text = textFromUserOrToolContent(message.content).trim();
			const tag = message.isError ? "Tool error" : "Tool result";
			return text ? `${tag} (${message.toolName}): ${text}` : undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Flatten a pi Context into a single transcript string. Excludes
 * `context.systemPrompt` and `context.tools` by construction.
 */
export function contextTranscript(context: Context): string {
	const lines: string[] = [];
	for (const message of context.messages) {
		const line = renderMessage(message);
		if (line) lines.push(line);
	}
	return lines.join("\n\n");
}

/**
 * Convert a pi Context into the ACP `prompt` array (a single text block holding
 * the flattened transcript). Empty history yields an empty array — the caller
 * decides whether that is a hard error.
 */
export function contextToAcpPrompt(context: Context): AcpTextBlock[] {
	const transcript = contextTranscript(context);
	if (!transcript) return [];
	return [{ type: "text", text: transcript }];
}

/**
 * ACP session bootstrap path — the input that decides the prompt SCOPE (NEXT
 * §S2-scout 핀4). S2c was spawn-per-turn (always a fresh session), so this stays
 * `"new"` until S2d wires the session store that can actually produce the reuse
 * paths.
 */
export type AcpBootstrapPath = "new" | "reuse" | "resume" | "load";

/**
 * The latest user turn only — the first user message AFTER the last assistant
 * message. Ported from 0.11.0 `index.ts:732 extractPromptBlocks`: taking the
 * FIRST user of the trailing group (not `reverse().find()`) skips the
 * SessionStart hook user-message (`device=…, time_kst=…`) that pi appends AFTER
 * the real prompt. Images leave a text marker (S2c decision — real ACP image
 * passthrough is a later lane), never raw data.
 *
 * This is the prompt scope for a session that ALREADY holds the prior turns
 * (reuse/resume/load): re-sending the whole transcript there would duplicate
 * history the backend already remembers.
 */
export function latestUserDelta(context: Context): AcpTextBlock[] {
	let lastAssistantIdx = -1;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		if (context.messages[i].role === "assistant") {
			lastAssistantIdx = i;
			break;
		}
	}
	const latestUser = context.messages.slice(lastAssistantIdx + 1).find((m): m is UserMessage => m.role === "user");
	if (!latestUser) return [];
	// The delta IS the user's actual prompt — preserve its body verbatim (0.11.0
	// extractPromptBlocks sent it near-raw). Only the EMPTINESS test trims, so a
	// whitespace-only turn yields no block.
	const raw = textFromUserOrToolContent(latestUser.content);
	return raw.trim() ? [{ type: "text", text: raw }] : [];
}

/**
 * Build the ACP prompt array for a turn, scoping it by bootstrapPath (핀4):
 *   - `"new"` (incompatible rebuild included): a fresh ACP session holds NO
 *     history, so the whole transcript is the only history carrier (same as the
 *     S2c spawn-per-turn path). Delta-only here would lose history on
 *     rebuild/compaction/edited-history.
 *   - `"reuse" | "resume" | "load"`: the stateful ACP session already holds the
 *     prior turns, so send only the latest user delta — the whole transcript
 *     would duplicate remembered history.
 *
 * The delta-only SAFETY for resume/load is owned by the caller's
 * `contextMessageSignatures` prefix-compat gate (mismatch → fall back to
 * `"new"` + full transcript); this pure function only splits the scope.
 */
export function buildAcpPrompt(context: Context, bootstrapPath: AcpBootstrapPath): AcpTextBlock[] {
	switch (bootstrapPath) {
		case "new":
			return contextToAcpPrompt(context);
		case "reuse":
		case "resume":
		case "load":
			return latestUserDelta(context);
		default:
			// Fail-loud (핀4): a bad/unknown bootstrapPath must CRASH, never fall
			// through to delta-only. A silent delta on a path that should carry the
			// full transcript loses history — fail-OPEN toward the dangerous side.
			throw new Error(`buildAcpPrompt: unknown bootstrapPath ${JSON.stringify(bootstrapPath)}`);
	}
}
