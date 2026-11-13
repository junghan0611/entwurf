/**
 * #162 — a long ACP tool shows that it is still running.
 *
 * Measured on claude-agent-acp 0.106.0 (2026-11-13, `clientCapabilities: {}`): a
 * 120 s foreground Bash sent `tool_call` (title "Terminal"), a title update naming
 * the command, then progress beats at 30/60/90 s carrying only
 * `_meta.claudeCode.toolResponse.elapsedTimeSeconds` (the first one also
 * `status: "in_progress"`), and its stdout only with completion. Before this the
 * mapper rendered nothing between `[tool:start] Terminal` and the terminal notice.
 *
 * Oracle: the literal frames below are the measured wire shapes; the expected
 * lines are the notices the operator reads.
 */
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { applyAcpSessionUpdate, createAcpStreamState, finalizeAcpStreamState } from "./event-mapper.ts";

const LIFECYCLE_NOTICE_SIGNATURE = "entwurf:lifecycle-notice-v1";
const ID = "toolu_0175FsHwjCbqYr9QAemUSDng";
const COMMAND = "for i in $(seq 1 20); do echo tick $i; sleep 6; done";

const START = {
	sessionUpdate: "tool_call",
	toolCallId: ID,
	title: "Terminal",
	kind: "execute",
	status: "pending",
	content: [],
	rawInput: {},
	_meta: { claudeCode: { toolName: "Bash" } },
};
const TITLE = {
	sessionUpdate: "tool_call_update",
	toolCallId: ID,
	title: COMMAND,
	rawInput: { command: COMMAND },
	_meta: { claudeCode: { toolName: "Bash" } },
};
const beat = (elapsedTimeSeconds: number, status?: string) => ({
	sessionUpdate: "tool_call_update",
	toolCallId: ID,
	...(status ? { status } : {}),
	_meta: { claudeCode: { toolName: "Bash", toolResponse: { elapsedTimeSeconds } } },
});
const DONE = {
	sessionUpdate: "tool_call_update",
	toolCallId: ID,
	status: "completed",
	content: [{ type: "content", content: { type: "text", text: "tick 1" } }],
	rawOutput: "tick 1",
};

async function drive(
	updates: Array<Record<string, unknown>>,
	showToolNotifications = true,
): Promise<{ output: AssistantMessage; events: AssistantMessageEvent[] }> {
	const stream = createAssistantMessageEventStream();
	const state = createAcpStreamState(
		stream,
		{ api: "entwurf", provider: "entwurf", model: "m" },
		{
			timestamp: 0,
			showToolNotifications,
		},
	);
	stream.push({ type: "start", partial: state.output });
	for (const u of updates) applyAcpSessionUpdate(state, u);
	finalizeAcpStreamState(state);
	stream.push({ type: "done", reason: "stop", message: state.output });
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	return { output: state.output, events };
}

const texts = (output: AssistantMessage) => output.content.flatMap((c) => (c.type === "text" ? [c.text.trim()] : []));

describe("ACP tool progress beats (#162)", () => {
	it("renders each measured beat as a running line naming the command, between start and done", async () => {
		const { output, events } = await drive([START, TITLE, beat(30, "in_progress"), beat(60), beat(90), DONE]);
		expect(texts(output)).toEqual([
			"[tool:start] Terminal",
			`[tool:running] ${COMMAND} — 30s`,
			`[tool:running] ${COMMAND} — 1m`,
			`[tool:running] ${COMMAND} — 1m30s`,
			`[tool:done] ${COMMAND} — tick 1`,
		]);
		// Streamed as it happens, not only on the final message.
		expect(events.filter((e) => e.type === "text_delta").map((e) => e.delta.trim())).toContain(
			`[tool:running] ${COMMAND} — 30s`,
		);
	});

	it("keeps the running lines display-only: out of replay and the reuse signature", async () => {
		const { output } = await drive([START, TITLE, beat(30, "in_progress"), DONE]);
		const running = output.content.filter((c) => c.type === "text" && c.text.includes("[tool:running]"));
		expect(running).toHaveLength(1);
		expect(running[0]).toMatchObject({ textSignature: LIFECYCLE_NOTICE_SIGNATURE });
		const start = output.content.find((c) => c.type === "text" && c.text.includes("[tool:start]"));
		expect(start).not.toHaveProperty("textSignature");
	});

	it("is suppressed with the tool stream, and silent for a beat after a terminal status", async () => {
		const quiet = await drive([START, beat(30, "in_progress")], false);
		expect(texts(quiet.output)).toEqual([]);
		const late = await drive([START, DONE, beat(30)]);
		expect(texts(late.output).filter((t) => t.startsWith("[tool:running]"))).toEqual([]);
	});
});
