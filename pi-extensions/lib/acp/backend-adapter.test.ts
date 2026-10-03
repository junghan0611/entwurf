/**
 * The claude child launches with Claude Code's own background-task switch on (#125): the vendor
 * stops offering its Bash/Agent `run_in_background` option and stops auto-backgrounding on timeout
 * or turn abort. A process a command detaches on its own is outside that switch. The oracle below is
 * the literal key and value, never `CLAUDE_FOREGROUND_ONLY_ENV`, so a change to the constant cannot
 * move its own check.
 *
 * The claude adapter alone reads a vendor prompt rejection (#127): the `incomplete_tool_call`
 * vocabulary belongs to claude-agent-acp, so a capability check — not a backend-name branch in the
 * common loop — keeps it from capturing another backend's failures.
 */
import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { claudeAdapter, cortexAdapter, INCOMPLETE_TOOL_CALL_VERDICT } from "./backend-adapter.ts";
import { CLAUDE_CONFIG_OVERLAY_DIR } from "./overlay.ts";

describe("ACP launch env — claude foreground-only", () => {
	it("[QK:ACP-CLAUDE-FOREGROUND-ONLY] the claude child is launched with Claude Code's background-task switch on, beside its config overlay", () => {
		expect(claudeAdapter.launchEnvDefaults()).toEqual({
			CLAUDE_CONFIG_DIR: CLAUDE_CONFIG_OVERLAY_DIR,
			CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
		});
	});

	it("cortex launches with no such switch — the claude contract does not leak into another backend", () => {
		expect(cortexAdapter.launchEnvDefaults()).toEqual({});
	});
});

describe("ACP prompt rejection — claude-only capability", () => {
	it("[QK:ACP-PROMPT-REJECTION-CLAUDE-ONLY] only claude reads a vendor prompt rejection, and only the typed incomplete_tool_call one", () => {
		const data = { errorKind: "incomplete_tool_call" };
		const typed = new RequestError(
			-32603,
			"Internal error: Claude ended the turn without returning results for tool calls: t",
			data,
		);
		const read = claudeAdapter.readPromptRejection?.(typed);
		expect(read?.errorKind).toBe("incomplete_tool_call");
		expect(read?.verdict).toBe(INCOMPLETE_TOOL_CALL_VERDICT);
		expect(JSON.parse(read?.dataJson ?? "null")).toEqual(data);

		const refused: unknown[] = [
			new RequestError(-32603, "Internal error: no result"),
			new RequestError(-32603, "Internal error: no result", { errorKind: "no_result" }),
			new RequestError(-32603, "Internal error: odd data", "incomplete_tool_call"),
			new RequestError(-32000, "Authentication required", data),
			new Error(typed.message),
			{ name: "RequestError", code: -32603, message: typed.message, data },
		];
		for (const err of refused) expect(claudeAdapter.readPromptRejection?.(err)).toBeUndefined();

		// Non-wire data that passes the guard but cannot serialize is still recognised, and named.
		const cyclic: { errorKind: string; self?: unknown } = { errorKind: "incomplete_tool_call" };
		cyclic.self = cyclic;
		for (const nonWire of [cyclic, { errorKind: "incomplete_tool_call", tokens: BigInt(10) }]) {
			const named = claudeAdapter.readPromptRejection?.(new RequestError(-32603, typed.message, nonWire));
			expect(named?.dataJson).toBe("[unserializable: TypeError]");
			expect(named?.verdict).toBe(INCOMPLETE_TOOL_CALL_VERDICT);
		}

		// Structural only: cortex declares no reader, so backend.ts keeps its old path for every
		// cortex failure. No cortex runtime or LIVE behaviour is certified here.
		expect("readPromptRejection" in cortexAdapter).toBe(false);
	});
});
