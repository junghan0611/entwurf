// Deterministic gate for the S2c ACP→pi event mapper + context conversion.
//
// Feeds synthetic ACP session_notification updates through the mapper and
// asserts the emitted pi AssistantMessageEvent sequence, including the critical
// boundary: ACP tool_call / tool_call_update render as TEXT NOTICES, never as
// structured toolcall_* events (the ACP child already executed the tool — a
// structured pi ToolCall would trigger re-execution). Also locks the S2c
// context→ACP-prompt conversion: transcript passthrough that excludes
// systemPrompt and never replays structured tools.
//
// Pure/deterministic — IN pnpm check.

import { strict as assert } from "node:assert";
import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { contextToAcpPrompt, contextTranscript } from "../pi-extensions/lib/acp/context.ts";
import {
	type AcpPiStreamState,
	applyAcpSessionUpdate,
	createAcpStreamState,
	finalizeAcpStreamState,
} from "../pi-extensions/lib/acp/event-mapper.ts";

const IDENTITY = { api: "entwurf", provider: "entwurf", model: "claude-sonnet-4-6" };

// Drive a set of synthetic updates through a fresh mapper and collect every
// emitted event (push is synchronous; the terminal done drains the queue).
async function drive(
	updates: Array<Record<string, unknown>>,
): Promise<{ events: AssistantMessageEvent[]; state: AcpPiStreamState }> {
	const stream = createAssistantMessageEventStream();
	const state = createAcpStreamState(stream, IDENTITY, { timestamp: 0 });
	stream.push({ type: "start", partial: state.output });
	for (const u of updates) applyAcpSessionUpdate(state, u);
	finalizeAcpStreamState(state);
	stream.push({ type: "done", reason: "stop", message: state.output });
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	return { events, state };
}

const types = (events: AssistantMessageEvent[]): string[] => events.map((e) => e.type);
const deltas = (events: AssistantMessageEvent[]): string[] =>
	events
		.filter((e): e is Extract<AssistantMessageEvent, { type: "text_delta" }> => e.type === "text_delta")
		.map((e) => e.delta);

// ---------------------------------------------------------------------------
// 1) agent_message_chunk → text_start / text_delta(s) / text_end
// ---------------------------------------------------------------------------
{
	const { events } = await drive([
		{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
		{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " world" } },
	]);
	assert.deepEqual(
		types(events),
		["start", "text_start", "text_delta", "text_delta", "text_end", "done"],
		"text chunk event sequence",
	);
	assert.deepEqual(deltas(events), ["Hello", " world"], "text deltas accumulate in order");
	const end = events.find((e) => e.type === "text_end") as Extract<AssistantMessageEvent, { type: "text_end" }>;
	assert.equal(end.content, "Hello world", "text_end carries the full accumulated text");
}

// ---------------------------------------------------------------------------
// 2) agent_thought_chunk → thinking_*; switching text↔thinking closes the prior
// ---------------------------------------------------------------------------
{
	const { events } = await drive([
		{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "pre" } },
		{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
		{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "post" } },
	]);
	assert.deepEqual(
		types(events),
		[
			"start",
			"text_start",
			"text_delta",
			"text_end",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		],
		"text→thinking→text closes each block before opening the next",
	);
	const tDelta = events.find((e) => e.type === "thinking_delta") as Extract<
		AssistantMessageEvent,
		{ type: "thinking_delta" }
	>;
	assert.equal(tDelta.delta, "hmm", "thinking delta carried through");
}

// ---------------------------------------------------------------------------
// 3) tool_call / tool_call_update → TEXT NOTICE, never structured toolcall_*
// ---------------------------------------------------------------------------
{
	const { events, state } = await drive([
		{ sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash" },
		{
			sessionUpdate: "tool_call_update",
			toolCallId: "t1",
			status: "completed",
			rawOutput: [{ type: "text", text: "result body" }],
		},
	]);
	// The hard invariant: zero structured tool-call events.
	for (const t of types(events)) {
		assert.ok(!t.startsWith("toolcall"), `tool events must NOT surface as structured toolcall_* (saw ${t})`);
	}
	const noticeText = deltas(events).join("");
	assert.match(noticeText, /\[tool:start\] Bash/, "tool_call renders a [tool:start] notice");
	assert.match(
		noticeText,
		/\[tool:done\] Bash — result body/,
		"completed tool_call_update renders a [tool:done] notice with summary",
	);
	// The running message must contain only text content blocks (no ToolCall).
	for (const c of state.output.content) {
		assert.equal((c as { type: string }).type, "text", "notices land as text content, never a ToolCall");
	}
}

// ---------------------------------------------------------------------------
// 3b) MCP-level error (isError) on a completed call → [tool:failed]
// ---------------------------------------------------------------------------
{
	const { events } = await drive([
		{ sessionUpdate: "tool_call", toolCallId: "t2", title: "Write" },
		{
			sessionUpdate: "tool_call_update",
			toolCallId: "t2",
			status: "completed",
			rawOutput: { isError: true, content: [{ type: "text", text: "nope" }] },
		},
	]);
	const noticeText = deltas(events).join("");
	assert.match(noticeText, /\[tool:failed\] Write — nope/, "isError completed call renders [tool:failed]");
}

// ---------------------------------------------------------------------------
// 3c) cancelled status → [tool:cancelled]
// ---------------------------------------------------------------------------
{
	const { events } = await drive([
		{ sessionUpdate: "tool_call", toolCallId: "t3", title: "Bash" },
		{ sessionUpdate: "tool_call_update", toolCallId: "t3", status: "cancelled" },
	]);
	const noticeText = deltas(events).join("");
	assert.match(noticeText, /\[tool:cancelled\] Bash/, "cancelled tool_call_update renders [tool:cancelled]");
}

// ---------------------------------------------------------------------------
// 4) usage_update → mutates the running message usage
// ---------------------------------------------------------------------------
{
	const { state } = await drive([{ sessionUpdate: "usage_update", used: 1234, cost: { amount: 0.05 } }]);
	assert.equal(state.output.usage.totalTokens, 1234, "usage_update.used → totalTokens");
	assert.equal(state.output.usage.cost.total, 0.05, "usage_update.cost.amount → cost.total");
}

// ---------------------------------------------------------------------------
// 5) notice suppression — showToolNotifications:false drops tool notices
// ---------------------------------------------------------------------------
{
	const stream = createAssistantMessageEventStream();
	const state = createAcpStreamState(stream, IDENTITY, { timestamp: 0, showToolNotifications: false });
	stream.push({ type: "start", partial: state.output });
	applyAcpSessionUpdate(state, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash" });
	finalizeAcpStreamState(state);
	stream.push({ type: "done", reason: "stop", message: state.output });
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	assert.deepEqual(types(events), ["start", "done"], "suppressed notices emit no text events");
}

// ---------------------------------------------------------------------------
// 6) context conversion — transcript passthrough, no systemPrompt, single block
// ---------------------------------------------------------------------------
{
	const context: Context = {
		systemPrompt: "SECRET-SYSTEM-PROMPT-DO-NOT-LEAK",
		tools: [{ name: "x", description: "d", parameters: {} as never }],
		messages: [
			{ role: "user", content: "first question", timestamp: 0 },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "an answer" },
					{ type: "toolCall", id: "c1", name: "Bash", arguments: {} },
				],
				api: "x",
				provider: "x",
				model: "x",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			},
			{
				role: "toolResult",
				toolCallId: "c1",
				toolName: "Bash",
				content: [{ type: "text", text: "tool body" }],
				isError: false,
				timestamp: 0,
			},
			{
				role: "user",
				content: [
					{ type: "image", data: "BASE64IMAGEDATA", mimeType: "image/png" },
					{ type: "text", text: "follow up" },
				],
				timestamp: 0,
			},
		],
	};
	const transcript = contextTranscript(context);
	assert.ok(!transcript.includes("SECRET-SYSTEM-PROMPT"), "transcript must NOT leak context.systemPrompt");
	assert.ok(!transcript.includes("private reasoning"), "transcript must NOT include assistant thinking");
	assert.match(transcript, /User: first question/, "includes prior user turn");
	assert.match(transcript, /Assistant: an answer/, "includes assistant text");
	assert.match(transcript, /Tool result \(Bash\): tool body/, "includes tool result as plain text");
	assert.match(transcript, /follow up/, "includes the last user turn");
	// image content is NOT silently dropped — it leaves a marker, never raw data.
	assert.match(transcript, /\[image omitted: image\/png\]/, "image content leaves a text marker");
	assert.ok(!transcript.includes("BASE64IMAGEDATA"), "raw image data must never enter the transcript");

	const prompt = contextToAcpPrompt(context);
	assert.equal(prompt.length, 1, "prompt is a single text block");
	assert.equal(prompt[0].type, "text", "prompt block is text");
	assert.equal(prompt[0].text, transcript, "prompt text equals the transcript");

	assert.deepEqual(contextToAcpPrompt({ messages: [] }), [], "empty history → empty prompt array");
}

console.log(
	"[check-acp-event-mapper] ok — text/thinking block lifecycle, tool_call→text-notice (no structured toolcall_*), " +
		"isError→[tool:failed], cancelled→[tool:cancelled], usage mutation, notice suppression, and context transcript " +
		"passthrough (no systemPrompt/thinking, image marker not silent-drop, single block)",
);
