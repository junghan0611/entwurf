/**
 * #142 — what a rebuilt ACP session is told about a turn the operator aborted.
 *
 * Measured on the real vendor (first-turn ESC, 2026-11-13): a cancelled turn whose
 * Bash had already appended a line reached the next, NEW session only as the
 * vendor's rejection text, and that session concluded the command had not run.
 * pi already knows the turn was aborted (`stopReason: "aborted"`); the full
 * transcript must keep that fact, and add nothing else. A reused session gets the
 * user delta only — its own record already holds the interruption.
 *
 * Oracle: the literal transcript lines this module renders; no backend runs.
 */
import { type AssistantMessage, type Message, normalizeContext, type Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ABORTED_TURN_STATUS, buildAcpPrompt } from "./context.ts";

const LIFECYCLE_NOTICE_SIGNATURE = "entwurf:lifecycle-notice-v1";

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(stopReason: AssistantMessage["stopReason"], content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "entwurf",
		provider: "entwurf",
		model: "claude-opus-5-5",
		usage: ZERO_USAGE,
		stopReason,
		timestamp: 1,
	};
}

const notice = (text: string) => ({ type: "text" as const, text, textSignature: LIFECYCLE_NOTICE_SIGNATURE });
const said = (text: string) => ({ type: "text" as const, text });

function rebuild(...messages: Message[]): string {
	const blocks = buildAcpPrompt(normalizeContext({ tools: [], messages }), "new");
	expect(blocks).toHaveLength(1);
	return blocks[0].text;
}

const userRun: Message = { role: "user", content: "run the command", timestamp: 0 };
const userNext: Message = { role: "user", content: "change of plan", timestamp: 2 };

describe("aborted assistant turns in a rebuilt transcript (#142)", () => {
	it("[QK:ACP-REBUILD-ABORTED-STATUS] an aborted turn keeps its own text verbatim and gains the status line; notices stay out", () => {
		const cut = assistant("aborted", [
			notice("\n[acp: sending prompt]\n"),
			said("[tool:start] Terminal\n\n[tool:failed] echo start >> count.log — The tool use was rejected"),
			notice("\n[acp: stopped — changes already made stay; next message opens a new session]\n"),
		]);
		const text = rebuild(userRun, cut, userNext);
		expect(text).toBe(
			[
				"User: run the command",
				`Assistant: [tool:start] Terminal\n\n[tool:failed] echo start >> count.log — The tool use was rejected\n${ABORTED_TURN_STATUS}`,
				"User: change of plan",
			].join("\n\n"),
		);
		expect(text).not.toContain("[acp:");
	});

	it("[QK:ACP-REBUILD-ABORTED-EMPTY] an aborted turn that left no text still states the cut", () => {
		const text = rebuild(userRun, assistant("aborted", [notice("\n[acp: sending prompt]\n")]), userNext);
		expect(text).toBe(
			["User: run the command", `Assistant: ${ABORTED_TURN_STATUS}`, "User: change of plan"].join("\n\n"),
		);
	});

	it("completed, errored and length-cut turns carry no status line, and an empty one is still skipped", () => {
		for (const stopReason of ["stop", "error", "length", "toolUse"] as const) {
			const text = rebuild(userRun, assistant(stopReason, [said("done")]), userNext);
			expect(text).toBe(["User: run the command", "Assistant: done", "User: change of plan"].join("\n\n"));
		}
		expect(rebuild(userRun, assistant("stop", [notice("\n[acp: sending prompt]\n")]), userNext)).toBe(
			["User: run the command", "User: change of plan"].join("\n\n"),
		);
	});

	it("a reused session receives only the latest user text, never the status line", () => {
		const messages: Message[] = [userRun, assistant("aborted", [said("[tool:failed] rejected")]), userNext];
		const blocks = buildAcpPrompt(normalizeContext({ tools: [], messages }), "reuse");
		expect(blocks).toEqual([{ type: "text", text: "change of plan" }]);
	});

	it("the system prompt still never reaches the rebuilt transcript", () => {
		const context = normalizeContext({
			systemPrompt: "SYSTEM-SECRET",
			tools: [],
			messages: [userRun, assistant("aborted", [said("cut")]), userNext],
		});
		const text = buildAcpPrompt(context, "new")[0].text;
		expect(text).not.toContain("SYSTEM-SECRET");
		expect(text).toContain(ABORTED_TURN_STATUS);
	});
});
