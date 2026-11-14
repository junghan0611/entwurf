import { describe, expect, it } from "vitest";
import { allCuratedModels, cortexAdapter, resolveAcpBackendAdapter } from "./backend-adapter.ts";
import { isCuratedAcpModelId } from "./model-ids.js";

describe("disabled Cortex ACP admission", () => {
	it("[QK:ACP-CORTEX-DISABLED] excludes legacy Cortex rows and refuses the reserved prefix without falling back to Claude", () => {
		const ids = ["cortex-auto", "cortex-claude-opus-5", "cortex-claude-sonnet-5", "cortex-openai-gpt-5.4"];
		const rows = allCuratedModels().map((row) => row.id);
		for (const id of ids) {
			expect(rows).not.toContain(id);
			expect(() => resolveAcpBackendAdapter(id)).toThrow(/cortex-acp-disabled/);
		}
		expect(() => resolveAcpBackendAdapter("CORTEX-unknown")).toThrow(/cortex-acp-disabled/);
		expect(resolveAcpBackendAdapter("claude-opus-5-5").adapter.backend).toBe("claude");
	});

	it("[QK:ACP-CORTEX-LEGACY-NOT-CURATED] excludes each retired Cortex model from the launch admission set", () => {
		for (const id of ["cortex-auto", "cortex-claude-opus-5", "cortex-claude-sonnet-5", "cortex-openai-gpt-5.4"]) {
			expect(isCuratedAcpModelId(id)).toBe(false);
		}
		expect(isCuratedAcpModelId("claude-opus-5-5")).toBe(true);
	});

	it("[QK:ACP-CORTEX-DIRECT-DISABLED] refuses the exported retired adapter before launch or overlay", () => {
		expect(cortexAdapter.curatedModels()).toEqual([]);
		expect(cortexAdapter.routeModel("cortex-auto")).toBeUndefined();
		expect(() => cortexAdapter.resolveLaunch({} as never)).toThrow(/cortex-acp-disabled/);
		expect(() => cortexAdapter.ensureOverlay({} as never)).toThrow(/cortex-acp-disabled/);
		expect(() => cortexAdapter.resolveAdapterSettings({} as never)).toThrow(/cortex-acp-disabled/);
	});
});
