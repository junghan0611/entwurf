/**
 * The claude child launches with Claude Code's own background-task switch on (#125): the vendor
 * stops offering its Bash/Agent `run_in_background` option and stops auto-backgrounding on timeout
 * or turn abort. A process a command detaches on its own is outside that switch. The oracle below is
 * the literal key and value, never `CLAUDE_FOREGROUND_ONLY_ENV`, so a change to the constant cannot
 * move its own check.
 */
import { describe, expect, it } from "vitest";
import { claudeAdapter, cortexAdapter } from "./backend-adapter.ts";
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
