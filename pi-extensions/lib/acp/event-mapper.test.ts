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
 *
 * #163 adds three display-only lines (ff08d4 approval 2026-11-14), each signed so andenken
 * `control-v1` drops it whatever its text and neither replay nor the reuse signature sees it:
 * M1 names a running call once its title is known, M2 previews a finished call's output, M3 puts
 * the backend's own compaction in numbers. Output and compaction frames follow claude-agent-acp
 * 0.107.0 as read (`tool-calls/renderer.js:294-303`, `content.js:72`, `reporters/compaction.js`).
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
			`[tool:running] ${COMMAND}`,
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
		expect(running).toHaveLength(2);
		for (const line of running) expect(line).toMatchObject({ textSignature: LIFECYCLE_NOTICE_SIGNATURE });
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

const signed = (output: AssistantMessage) =>
	output.content.flatMap((c) => (c.type === "text" && c.textSignature === LIFECYCLE_NOTICE_SIGNATURE ? [c.text] : []));

describe("what is running, once it is known (#163 M1)", () => {
	it("[QK:ACP-TOOL-TITLE-SHOWN] a title-only update names the command on one display-only running line", async () => {
		const { output } = await drive([START, TITLE]);
		expect(texts(output)).toEqual(["[tool:start] Terminal", `[tool:running] ${COMMAND}`]);
		expect(signed(output).map((t) => t.trim())).toEqual([`[tool:running] ${COMMAND}`]);
	});

	it("[QK:ACP-TOOL-TITLE-ONCE] a title that arrives with a beat shows the beat alone, not a second line", async () => {
		const titledBeat = { ...beat(30, "in_progress"), title: COMMAND };
		const { output } = await drive([START, titledBeat]);
		expect(texts(output)).toEqual(["[tool:start] Terminal", `[tool:running] ${COMMAND} — 30s`]);
	});

	it("[QK:ACP-TOOL-TITLE-REPEAT-SILENT] a repeated title, or one that arrives with the terminal status, adds no running line", async () => {
		const repeated = await drive([START, TITLE, TITLE]);
		expect(texts(repeated.output).filter((t) => t.startsWith("[tool:running]"))).toHaveLength(1);
		const terminal = await drive([START, { ...DONE, title: COMMAND }]);
		expect(texts(terminal.output).filter((t) => t.startsWith("[tool:running]"))).toEqual([]);
	});
});

const finished = (status: "completed" | "failed", text: string) => ({
	sessionUpdate: "tool_call_update",
	toolCallId: ID,
	status,
	content: [{ type: "content", content: { type: "text", text } }],
	_meta: { claudeCode: { toolName: "Bash" } },
});
const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const previewOf = (output: AssistantMessage) => signed(output).find((t) => t.startsWith("\n[tool:output]"));

describe("a short look at what a finished tool returned (#163 M2)", () => {
	it("[QK:ACP-TOOL-OUTPUT-PREVIEW] a success shows the head of its output under the done line, display-only", async () => {
		const out = lines("tick", 8).join("\n");
		const { output } = await drive([START, TITLE, finished("completed", `\`\`\`console\n${out}\n\`\`\``)]);
		expect(previewOf(output)).toBe(`\n[tool:output] ${COMMAND}\n${lines("tick", 5).join("\n")}\n…\n`);
		// It follows the done line, which stays unsigned for replay as before.
		const all = texts(output);
		expect(all.indexOf(`[tool:output] ${COMMAND}\n${lines("tick", 5).join("\n")}\n…`)).toBe(all.length - 1);
		expect(all.at(-2)?.startsWith(`[tool:done] ${COMMAND} — `)).toBe(true);
		// One short line is already on the done line; the tool stream switch hides the preview too.
		expect(previewOf((await drive([START, TITLE, finished("completed", "ok")])).output)).toBeUndefined();
		expect(previewOf((await drive([START, TITLE, finished("completed", out)], false)).output)).toBeUndefined();
	});

	it("[QK:ACP-TOOL-OUTPUT-FAILURE-TAIL] a failure shows the tail, where stderr and the exit status end up", async () => {
		const out = ["Exit code 2", ...lines("stdout", 6), "fatal: the actual reason"].join("\n");
		const { output } = await drive([START, TITLE, finished("failed", `\`\`\`\n${out}\n\`\`\``)]);
		expect(previewOf(output)).toBe(
			`\n[tool:output] ${COMMAND}\n…\n${["stdout 3", "stdout 4", "stdout 5", "stdout 6", "fatal: the actual reason"].join("\n")}\n`,
		);
	});

	it("[QK:ACP-TOOL-OUTPUT-BOUNDED] a preview never exceeds its byte budget, whatever the line lengths", async () => {
		const wide = Array.from({ length: 3 }, (_, i) => `${i}${"가".repeat(250)}`).join("\n");
		const { output } = await drive([START, TITLE, finished("completed", wide)]);
		const preview = previewOf(output) ?? "";
		const body = preview.slice(`\n[tool:output] ${COMMAND}\n`.length, -1);
		expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(400);
		expect(body.endsWith("…")).toBe(true);
	});
});

const COMPACT_ID = "compact-1";
const compactStart = {
	sessionUpdate: "tool_call",
	toolCallId: COMPACT_ID,
	title: "Compact conversation",
	kind: "think",
	status: "in_progress",
	_meta: { claudeCode: { toolName: "compact" } },
};
const compactEnd = (status: "completed" | "failed", rawOutput: Record<string, unknown>) => ({
	sessionUpdate: "tool_call_update",
	toolCallId: COMPACT_ID,
	status,
	rawOutput,
	_meta: { claudeCode: { toolName: "compact" } },
});
const acpLines = (output: AssistantMessage) =>
	signed(output)
		.map((t) => t.trim())
		.filter((t) => t.startsWith("[acp: compaction"));

describe("the backend's own compaction, in numbers (#163 M3)", () => {
	it("[QK:ACP-COMPACTION-LINE] a finished compaction shows trigger, tokens before and after, and duration", async () => {
		const { output } = await drive(
			[
				compactStart,
				compactEnd("completed", { trigger: "automatic", preTokens: 812_345, postTokens: 43_210, durationMs: 3_100 }),
			],
			false,
		);
		expect(acpLines(output)).toEqual(["[acp: compaction automatic 812k→43k in 3.1s]"]);
	});

	it("[QK:ACP-COMPACTION-ONCE] one line per compaction: whichever terminal update carries the facts first, an enriching repeat adds none", async () => {
		const twice = await drive([
			compactStart,
			compactEnd("completed", { trigger: "automatic", preTokens: 812_345 }),
			compactEnd("completed", { trigger: "automatic", preTokens: 812_345, postTokens: 43_210 }),
		]);
		expect(acpLines(twice.output)).toEqual(["[acp: compaction automatic 812k]"]);
	});

	it("[QK:ACP-COMPACTION-FAILED] a compaction that reports an error says failed", async () => {
		const { output } = await drive([
			compactStart,
			compactEnd("failed", { trigger: "automatic", preTokens: 1_250_000, error: "prompt is too long" }),
		]);
		expect(acpLines(output)).toEqual(["[acp: compaction automatic failed 1.3M]"]);
	});
});
