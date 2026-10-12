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
 *
 * The claude adapter reads its set-model answer back before the prompt (#128). The rows below are
 * the shape claude-agent-acp 0.85.1 answered on 2026-10-12, copied as literals so a change to the
 * adapter's declared names cannot move its own oracle. No vendor runtime is certified here.
 */
import { RequestError } from "@agentclientprotocol/sdk";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
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

describe("ACP set-model readback — claude", () => {
	// Measured 0.85.1 rows (a subset): two alias rows, the exact Fable row, and the rows a wrong
	// resolution could land on.
	const MEASURED_ROWS = [
		{ value: "default", name: "Default (recommended)", description: "Opus 5.5" },
		{ value: "opus", name: "Opus 5.5", description: "For complex work and everyday tasks" },
		{ value: "claude-fable-5-1", name: "Fable 5.1", description: "For your toughest challenges" },
		{ value: "sonnet", name: "Sonnet 5.5", description: "Most efficient for simpler tasks" },
		{ value: "claude-sonnet-5", name: "Sonnet 5", description: "Efficient for routine tasks" },
		{ value: "claude-opus-5", name: "Opus 5", description: "Best for everyday, complex tasks" },
	];
	const answer = (currentValue: unknown, options: unknown[] = MEASURED_ROWS) => ({
		configOptions: [{ id: "model", type: "select", currentValue, options }],
	});
	const enforce = async (nativeModelId: string, response: unknown) => {
		const sent: unknown[] = [];
		const connection = {
			setSessionConfigOption: async (params: unknown) => {
				sent.push(params);
				return response;
			},
		} as never;
		await claudeAdapter.enforceModel({ connection, acpSessionId: "S", modelId: nativeModelId, nativeModelId });
		return sent;
	};

	it("[QK:ACP-CLAUDE-SET-MODEL-READBACK] enforceModel refuses an answer that does not name the requested model", async () => {
		expect(await enforce("claude-fable-5-1", answer("claude-fable-5-1"))).toEqual([
			{ sessionId: "S", configId: "model", value: "claude-fable-5-1" },
		]);
		const refused: Array<[string, unknown]> = [
			["claude-fable-5-1", {}],
			["claude-fable-5-1", undefined],
			["claude-fable-5-1", { configOptions: [{ id: "effort", currentValue: "claude-fable-5-1" }] }],
			["claude-fable-5-1", answer("claude-fable-5")],
			["claude-fable-5-1", answer(undefined)],
			["claude-sonnet-5-5", answer("claude-sonnet-5")],
			["claude-opus-5-5", answer("default")],
		];
		for (const [id, response] of refused) {
			const failure = await enforce(id, response).then(
				() => undefined,
				(err: unknown) => err,
			);
			expect(failure, `${id} answered ${JSON.stringify(response)}`).toBeInstanceOf(Error);
			const message = (failure as Error).message;
			expect(message).toContain(JSON.stringify(id));
			// A refusal we author must not invite pi's blind replay of the whole prompt.
			expect(isRetryableAssistantError({ stopReason: "error", errorMessage: message } as never)).toBe(false);
		}
	});

	it("[QK:ACP-CLAUDE-SET-MODEL-ALIAS-EXACT] an alias answer is accepted only as the row measured for the requested id, value and name", async () => {
		await enforce("claude-sonnet-5-5", answer("sonnet"));
		await enforce("claude-opus-5-5", answer("opus"));
		const grouped = [{ group: "all", name: "All", options: MEASURED_ROWS }];
		await enforce("claude-opus-5-5", answer("opus", grouped));
		// The alias value under another generation's name; the 5.5 name on a row that is not the
		// alias (the default row, a retired id, the other alias); or answering the other id.
		const renamed = (value: string, name: string) =>
			MEASURED_ROWS.map((row) => (row.value === value ? { ...row, name } : row));
		for (const [id, response] of [
			["claude-sonnet-5-5", answer("sonnet", renamed("sonnet", "Sonnet 6"))],
			["claude-sonnet-5-5", answer("sonnet", [])],
			["claude-sonnet-5-5", answer("default", renamed("default", "Sonnet 5.5"))],
			["claude-sonnet-5-5", answer("claude-sonnet-5", renamed("claude-sonnet-5", "Sonnet 5.5"))],
			["claude-sonnet-5-5", answer("opus", renamed("opus", "Sonnet 5.5"))],
			["claude-opus-5-5", answer("sonnet")],
			["claude-fable-5-1", answer("opus")],
		] as const) {
			await expect(enforce(id, response), `${id} answered ${JSON.stringify(response)}`).rejects.toThrow(
				/does not name the requested model/,
			);
		}
	});
});
