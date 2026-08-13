/**
 * fresh-call public-surface contract — Cell 1 of the vitest pilot (issue #62).
 *
 * The escape that opened #62 passed every source-text gate: a zod `.regex()` whose
 * emitted JSON Schema `pattern` contained an unescaped `[` inside a character
 * class. JS RegExp accepts it; the host's Rust-family validator rejects the whole
 * tool definition with 400 `tools.N.custom.input_schema`, so EVERY session loading
 * the tool failed to open. Nothing here reads the schema out of source text:
 *
 *   - the MCP surface is observed from a REAL bridge boot → runtime tools/list —
 *     the same bytes an MCP host validates;
 *   - the pi surface is observed from the REAL extension's registerTool call —
 *     the same definition pi hands to provider conversion;
 *   - every emitted `pattern` must compile under a Rust-regex-family engine
 *     (rregex — the rust-lang/regex crate compiled to WASM), not just `new
 *     RegExp`, because that asymmetry IS the defect class;
 *   - every runtime description must fit the measured 2048-char host cap —
 *     truncation is invisible from inside (entwurf_v2 lost its whole INTENT
 *     contract that way).
 *
 * The remaining source-text asserts in this file are identity-authority
 * structural contracts (who supplies callerGardenId) with no runtime observation
 * point that would not risk a real launch; the three-kinds/three-fates table in
 * the issue keeps them static by design.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { RRegex } from "rregex";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type BridgeTool,
	bootBridgeAndListTools,
	capturePiToolDefinitions,
	HOST_DESCRIPTION_CAP,
	type PiToolDefinition,
	REPO_DIR,
	requireTool,
} from "./helpers/fresh-call-fixtures.ts";

/** Compile under the Rust regex family; return the engine's own message on failure
 * so a red names the host's reason, not ours. */
function rustCompileError(pattern: string): string | null {
	try {
		new RRegex(pattern);
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

function patternsOf(schema: Record<string, unknown> | undefined, at: string): Array<{ at: string; pattern: string }> {
	const found: Array<{ at: string; pattern: string }> = [];
	if (!schema || typeof schema !== "object") return found;
	for (const [key, value] of Object.entries(schema)) {
		const here = `${at}.${key}`;
		if (key === "pattern" && typeof value === "string") found.push({ at, pattern: value });
		else if (value && typeof value === "object" && !Array.isArray(value))
			found.push(...patternsOf(value as Record<string, unknown>, here));
		else if (Array.isArray(value))
			value.forEach((v, i) => {
				if (v && typeof v === "object") found.push(...patternsOf(v as Record<string, unknown>, `${here}[${i}]`));
			});
	}
	return found;
}

let mcpTools: BridgeTool[];
let piTools: PiToolDefinition[];

beforeAll(async () => {
	[mcpTools, piTools] = await Promise.all([bootBridgeAndListTools(), capturePiToolDefinitions()]);
});

describe("MCP surface — real bridge boot → runtime tools/list", () => {
	it("the bridge boots and registers entwurf_fresh_call beside the v2 world map", () => {
		const names = mcpTools.map((t) => t.name);
		expect(names).toContain("entwurf_fresh_call");
		expect(names).toContain("entwurf_v2");
		expect(names).toContain("entwurf_peers");
	});

	it("[QK:FRESHCALL-CLAUDE-MODEL-SCHEMA] MCP requires model in its RUNTIME schema (present, required, bounded) and passes that exact parameter to the composition", () => {
		const fresh = requireTool(mcpTools, "entwurf_fresh_call");
		const model = fresh.inputSchema?.properties?.model;
		expect(model, "tools/list carries a model property").toBeDefined();
		expect(model?.type).toBe("string");
		expect(model?.minLength).toBe(1);
		expect(model?.maxLength).toBe(200);
		expect(typeof model?.pattern).toBe("string");
		expect(fresh.inputSchema?.required).toContain("model");
		// The pass-through half has no observation point short of a real launch; the
		// call shape stays a structural assert.
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSrc).toMatch(/freshCall\(\{ backend, model, task, cwd, callerGardenId \}\)/);
	});

	it("[QK:FRESHCALL-MODEL-PATTERN-HOST-VALID] every pattern the bridge emits on tools/list compiles under a Rust-regex-family engine — JS acceptance is not host acceptance", () => {
		const all = mcpTools.flatMap((t) => patternsOf(t.inputSchema as Record<string, unknown>, t.name ?? "?"));
		expect(all.length, "at least the fresh-call model pattern is emitted").toBeGreaterThan(0);
		for (const { at, pattern } of all) {
			const err = rustCompileError(pattern);
			expect(err, `${at} pattern ${JSON.stringify(pattern)} must compile under Rust regex: ${err ?? ""}`).toBeNull();
		}
	});

	it("every runtime tool description fits the 2048-char host cap, and fresh_call's is substantial", () => {
		for (const t of mcpTools) {
			expect(t.description ?? "", `${t.name} description`).not.toHaveLength(0);
			expect(
				(t.description ?? "").length,
				`${t.name} description must fit the host cap (truncation is invisible from inside)`,
			).toBeLessThan(HOST_DESCRIPTION_CAP);
		}
		expect((requireTool(mcpTools, "entwurf_fresh_call").description ?? "").length).toBeGreaterThan(400);
	});

	it("the runtime schema exposes NO identity or nonce parameter — exactly backend, model, task and the optional cwd", () => {
		const fresh = requireTool(mcpTools, "entwurf_fresh_call");
		expect(Object.keys(fresh.inputSchema?.properties ?? {}).sort()).toEqual(["backend", "cwd", "model", "task"]);
	});

	it("[QK:FRESHCALL-CLAUDE-SURFACE-IDENTITY] the MCP bridge resolves callerGardenId through the canonical authoritative self envelope — never a caller parameter, never raw env", () => {
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		const freshBlock = (mcpSrc.split('"entwurf_fresh_call",')[1] ?? "").split(
			"// ============================================================================\n// Main",
		)[0];
		expect(freshBlock).toMatch(
			/const self = await buildAuthoritativeSelfEnvelope\(\);\s*callerGardenId = self\.envelope\.sessionId;/,
		);
		expect(freshBlock).not.toMatch(/process\.env\.PI_SESSION_ID/);
		expect(freshBlock).toMatch(/backend:\s*z\s*\n?\s*\.enum\(\["pi", "claude-code"\]\)/);
		expect(freshBlock).not.toMatch(/callerGardenId:\s*z\./);
		expect(freshBlock).not.toMatch(/nonce:\s*z\./);
	});
});

describe("pi surface — real extension registration capture", () => {
	it("[QK:FRESHCALL-PI-MODEL-SCHEMA] native pi requires model in its RUNTIME schema (present, required, bounded) and passes that exact parameter to the composition", () => {
		const fresh = requireTool(piTools, "entwurf_fresh_call");
		const model = fresh.parameters.properties?.model;
		expect(model, "registerTool carries a model property").toBeDefined();
		expect(model?.minLength).toBe(1);
		expect(model?.maxLength).toBe(200);
		expect(typeof model?.pattern).toBe("string");
		expect(fresh.parameters.required).toContain("model");
		const piSrc = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/entwurf-control.ts"), "utf8");
		expect(piSrc).toMatch(/model:\s*params\.model/);
	});

	it("the registered pattern compiles under the Rust regex family and the runtime description fits the host cap", () => {
		const fresh = requireTool(piTools, "entwurf_fresh_call");
		const all = patternsOf(fresh.parameters as unknown as Record<string, unknown>, "entwurf_fresh_call");
		expect(all.length).toBeGreaterThan(0);
		for (const { at, pattern } of all) {
			const err = rustCompileError(pattern);
			expect(err, `${at} pattern ${JSON.stringify(pattern)} must compile under Rust regex: ${err ?? ""}`).toBeNull();
		}
		expect(fresh.description.length).toBeGreaterThan(400);
		expect(fresh.description.length).toBeLessThan(HOST_DESCRIPTION_CAP);
	});

	it("[QK:FRESHCALL-PI-SURFACE-IDENTITY] native pi supplies callerGardenId from its own resident closure — no identity/nonce parameter, and env carriers are ignored even when present", async () => {
		const fresh = requireTool(piTools, "entwurf_fresh_call");
		expect(Object.keys(fresh.parameters.properties ?? {}).sort()).toEqual(["backend", "cwd", "model", "task"]);
		// Behavioral discrimination, mutation-safe by construction: the model is
		// INVALID, so even a mutant that steals an id from env can never reach tmux —
		// it would answer model-invalid, while the resident-closure control (null in
		// this harness: session_start never ran) refuses identity FIRST.
		const before = process.env.PI_SESSION_ID;
		process.env.PI_SESSION_ID = "20260101T000000-feed00";
		try {
			const result = await fresh.execute("t1", { backend: "pi", model: "not a model", task: "noop" });
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text ?? "").toContain("caller-identity-unavailable");
			expect(result.content[0]?.text ?? "").not.toContain("model-invalid");
		} finally {
			if (before === undefined) delete process.env.PI_SESSION_ID;
			else process.env.PI_SESSION_ID = before;
		}
	});
});

describe("one grammar, two surfaces", () => {
	it("the emitted model patterns are byte-identical across the MCP and pi surfaces — the original defect was two hand-written copies disagreeing", () => {
		const mcpModel = requireTool(mcpTools, "entwurf_fresh_call").inputSchema?.properties?.model;
		const piModel = requireTool(piTools, "entwurf_fresh_call").parameters.properties?.model;
		expect(mcpModel?.pattern).toBeDefined();
		expect(mcpModel?.pattern).toBe(piModel?.pattern);
		expect(mcpModel?.minLength).toBe(piModel?.minLength);
		expect(mcpModel?.maxLength).toBe(piModel?.maxLength);
	});

	it("both runtime descriptions carry the same world map and contract literals", () => {
		const mcpDesc = requireTool(mcpTools, "entwurf_fresh_call").description ?? "";
		const piDesc = requireTool(piTools, "entwurf_fresh_call").description;
		for (const desc of [mcpDesc, piDesc]) {
			// "secrets", not the file-level "no secrets" literal the old gate matched:
			// that string lived in surrounding source, not in the rendered description a
			// model actually reads ("Do not put secrets in the task").
			for (const literal of [
				"LAUNCH receipt",
				"entwurf_peers only reports",
				"secrets",
				"Model is REQUIRED",
				"entwurf_v2",
			]) {
				expect(desc).toContain(literal);
			}
		}
	});

	it("[QK:FRESHCALL-CWD-SURFACE-PARITY] both surfaces expose the SAME optional cwd — present in each runtime schema, required by neither, same literal-path contract in the description, passed through verbatim to the one composition — so cross-repo fresh cannot become a one-surface customs gap", () => {
		const mcpFresh = requireTool(mcpTools, "entwurf_fresh_call");
		const mcpCwd = mcpFresh.inputSchema?.properties?.cwd;
		expect(mcpCwd, "tools/list carries a cwd property").toBeDefined();
		expect(mcpCwd?.type).toBe("string");
		expect(mcpFresh.inputSchema?.required).not.toContain("cwd");
		const piFresh = requireTool(piTools, "entwurf_fresh_call");
		const piCwd = piFresh.parameters.properties?.cwd;
		expect(piCwd, "registerTool carries a cwd property").toBeDefined();
		expect(piFresh.parameters.required ?? []).not.toContain("cwd");
		for (const desc of [String(mcpCwd?.description ?? ""), String(piCwd?.description ?? "")]) {
			expect(desc).toContain("ABSOLUTE");
			expect(desc).toContain("REQUESTED");
			expect(desc).toContain("no trim");
		}
		// The pass-through halves stay structural asserts, same as the model parameter above.
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSrc).toMatch(/freshCall\(\{ backend, model, task, cwd, callerGardenId \}\)/);
		const piSrc = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/entwurf-control.ts"), "utf8");
		expect(piSrc).toMatch(/cwd:\s*params\.cwd/);
	});

	it("both peers surfaces stay facts-only and route creation to entwurf_fresh_call", () => {
		expect(requireTool(mcpTools, "entwurf_peers").description ?? "").toMatch(
			/facts-only[\s\S]{0,160}entwurf_fresh_call/,
		);
		expect(requireTool(piTools, "entwurf_peers").description).toMatch(/facts-only[\s\S]{0,120}entwurf_fresh_call/);
	});
});
