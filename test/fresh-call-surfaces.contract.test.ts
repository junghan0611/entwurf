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

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RRegex } from "rregex";
import { beforeAll, describe, expect, it } from "vitest";
import { CODEX_PREFLIGHT_HINT } from "../pi-extensions/lib/codex-fresh-preflight.ts";
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
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
		expect(mcpSrc).toMatch(/freshCall\(\{ backend, model, task, cwd, placement, callerGardenId \}\)/);
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
		expect(Object.keys(fresh.inputSchema?.properties ?? {}).sort()).toEqual([
			"backend",
			"cwd",
			"model",
			"placement",
			"task",
		]);
	});

	it("[QK:FRESHCALL-BACKEND-SET-SURFACE-PARITY] the MCP surface enum equals the composition's fixed set — a backend added to the module but not to the bridge is unreachable from every external host", () => {
		const expected = [...FRESH_CALL_BACKENDS].sort();
		const mcpEnum = (
			requireTool(mcpTools, "entwurf_fresh_call").inputSchema?.properties?.backend as { enum?: string[] } | undefined
		)?.enum;
		expect([...(mcpEnum ?? [])].sort()).toEqual(expected);
	});

	it("[QK:FRESHCALL-BACKEND-SET-SURFACE-PARITY-PI] the native pi surface enum equals the same fixed set — a backend missing only here is a capability no in-process pi session can name", () => {
		const expected = [...FRESH_CALL_BACKENDS].sort();
		const piEnum = (
			requireTool(piTools, "entwurf_fresh_call").parameters.properties?.backend as { enum?: string[] } | undefined
		)?.enum;
		expect([...(piEnum ?? [])].sort()).toEqual(expected);
	});

	/**
	 * The THIRD surface. `docs/adding-a-harness.md` step 9 names all three together — "native pi,
	 * the MCP bridge, and the operator skill" — but only the two schema surfaces were ever
	 * observed, so the skill's backend list was free to drift and did not even have a gate to
	 * drift against. A skill that offers three backends is not a cosmetic staleness: it is the
	 * document the operator reads to decide what can be opened, so a missing backend is
	 * unreachable in practice exactly the way a missing enum value is unreachable in schema.
	 *
	 * Source text is the only observation point here — a skill is prose consumed by a model, with
	 * no runtime to interrogate — so the assertion is deliberately anchored on the one line that
	 * states the contract rather than on any mention of a backend name anywhere in the file.
	 */
	it("[QK:FRESHCALL-BACKEND-SET-SURFACE-PARITY-SKILL] the operator skill offers the same fixed set — step 9 requires the same backends on all THREE public surfaces, and this one had no gate at all", () => {
		const skill = fs.readFileSync(path.join(REPO_DIR, ".claude/skills/entwurf-dev/SKILL.md"), "utf8");
		const line = skill.split(/\r?\n/).find((l) => l.includes("entwurf_fresh_call") && l.includes("backend"));
		expect(line, "the skill states its fresh-call backend contract on one line").toBeDefined();
		const offered = [...((line as string).match(/`([a-z-]+(?: \| [a-z-]+)+)`/)?.[1]?.split(" | ") ?? [])].sort();
		expect(offered).toEqual([...FRESH_CALL_BACKENDS].sort());
	});

	it("[QK:FRESHCALL-CLAUDE-SURFACE-IDENTITY] the MCP bridge resolves callerGardenId through the canonical authoritative self envelope — never a caller parameter, never raw env", () => {
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		const freshBlock = (mcpSrc.split('"entwurf_fresh_call",')[1] ?? "").split(
			"// ============================================================================\n// Main",
		)[0];
		expect(freshBlock).toMatch(
			/const self = await buildAuthoritativeSelfEnvelope\(\{ requestMeta: extra\._meta \}\);\s*callerGardenId = self\.envelope\.sessionId;/,
		);
		expect(freshBlock).not.toMatch(/process\.env\.PI_SESSION_ID/);
		// Derived from the composition's own set rather than retyped: this assertion exists to
		// prove the identity plumbing around the enum, not to be a second hand-maintained list.
		const enumLiteral = FRESH_CALL_BACKENDS.map((b) => `"${b}"`)
			.join(", ")
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		expect(freshBlock).toMatch(new RegExp(`backend:\\s*z\\s*\\n?\\s*\\.enum\\(\\[${enumLiteral}\\]\\)`));
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
		expect(Object.keys(fresh.parameters.properties ?? {}).sort()).toEqual([
			"backend",
			"cwd",
			"model",
			"placement",
			"task",
		]);
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
		expect(mcpSrc).toMatch(/freshCall\(\{ backend, model, task, cwd, placement, callerGardenId \}\)/);
		const piSrc = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/entwurf-control.ts"), "utf8");
		expect(piSrc).toMatch(/cwd:\s*params\.cwd/);
	});

	it("[QK:FRESHCALL-PLACEMENT-SURFACE-PARITY] both surfaces expose the SAME optional project seat — an object with the one required tmuxSession field, optional on each surface, the same nothing-is-created contract in the description, passed through verbatim to the one composition — so opening a sibling in the operator's project session cannot become a one-surface capability", () => {
		const mcpFresh = requireTool(mcpTools, "entwurf_fresh_call");
		const mcpPlacement = mcpFresh.inputSchema?.properties?.placement;
		expect(mcpPlacement, "tools/list carries a placement property").toBeDefined();
		expect(mcpPlacement?.type).toBe("object");
		expect(mcpFresh.inputSchema?.required).not.toContain("placement");
		const piFresh = requireTool(piTools, "entwurf_fresh_call");
		const piPlacement = piFresh.parameters.properties?.placement;
		expect(piPlacement, "registerTool carries a placement property").toBeDefined();
		expect(piFresh.parameters.required ?? []).not.toContain("placement");
		// The seat itself is the one required field of that object on BOTH surfaces: an empty
		// object would be a seat request naming no seat.
		for (const placement of [mcpPlacement, piPlacement]) {
			const inner = (placement as { properties?: Record<string, unknown> } | undefined)?.properties;
			expect(Object.keys(inner ?? {})).toEqual(["tmuxSession"]);
			expect((placement as { required?: string[] } | undefined)?.required).toEqual(["tmuxSession"]);
		}
		for (const desc of [String(mcpPlacement?.description ?? ""), String(piPlacement?.description ?? "")]) {
			expect(desc).toContain("EXISTING");
			expect(desc).toContain("Nothing is ever created");
			expect(desc).toContain("Independent of cwd");
		}
		// Both runtime descriptions state the refusal, so a caller cannot read "seat" as "create".
		for (const desc of [mcpFresh.description ?? "", piFresh.description]) {
			expect(desc).toContain("placement.tmuxSession");
			expect(desc).toContain("NOTHING is created");
		}
		// The pass-through halves stay structural asserts, same as the cwd parity above.
		const mcpSeatSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSeatSrc).toMatch(/freshCall\(\{ backend, model, task, cwd, placement, callerGardenId \}\)/);
		const piSeatSrc = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/entwurf-control.ts"), "utf8");
		expect(piSeatSrc).toMatch(/placement:\s*params\.placement/);
		// The THIRD surface, for the same reason the backend set is held on all three: the skill
		// is the document the operator reads to decide what can be opened, so a seat that is
		// missing there is unreachable in practice exactly as a missing schema property is.
		// Source text is the only observation point — a skill is prose with no runtime.
		const skill = fs.readFileSync(path.join(REPO_DIR, ".claude/skills/entwurf-dev/SKILL.md"), "utf8");
		// Anchored on the ONE bullet that states the seat contract, not on any mention of the
		// word anywhere in the file — the same discipline the backend-set skill assertion uses.
		const seatBullet = (skill.split(/^- `placement`/m)[1] ?? "").split(/^- /m)[0];
		expect(seatBullet, "the skill states its seat contract in one bullet").not.toBe("");
		expect(seatBullet).toContain("tmuxSession");
		// Both refusals, so the agent reading it cannot invent a repair (or a creation).
		expect(seatBullet).toContain("tmux-session-missing");
		expect(seatBullet).toContain("tmux-session-name-invalid");
		// And the call shape the skill tells the agent to send.
		expect(skill).toMatch(/\{backend, model, task, cwd\?, placement\?\}/);
	});

	/**
	 * The Codex capability preflight is the ONE preflight that cannot live in the composition:
	 * it performs a bounded app-server exchange, and `freshCall` is a synchronous leaf by
	 * contract. So it sits on the two PUBLIC surfaces instead — which means the ordering that
	 * every other backend gets for free (preflight inside the leaf, proven by the leaf's own
	 * cells) is here a property of two hand-written call sites, and nothing executed them.
	 *
	 * The argument is the same one the copilot/omp pre-mutation cells make: with NO tmux in the
	 * environment, a surface that skipped the preflight would answer `no-tmux-context` from the
	 * placement leaf. Hearing a CODEX capability reason instead proves the decision happened
	 * before placement — and placement is the last thing that runs before the one mutation.
	 * `CODEX_HOME` points at an empty directory so the answer is a capability reason on an
	 * installed host too, not only on one with no birth unit.
	 */
	function codexPreflightEnv(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-premutation-"));
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, CODEX_HOME: path.join(root, "codex") };
		for (const key of ["TMUX", "TMUX_PANE", "PI_SESSION_ID", "PI_AGENT_ID"]) delete env[key];
		return { env, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
	}

	const CODEX_REASONS = Object.keys(CODEX_PREFLIGHT_HINT);

	/** One real bridge boot plus one tools/call — the same process an MCP host talks to. */
	function callBridgeFreshCall(env: NodeJS.ProcessEnv): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn(path.join(REPO_DIR, "mcp", "entwurf-bridge", "start.sh"), { stdio: "pipe", env });
			let stdout = "";
			let stderr = "";
			let settled = false;
			const done = (fn: () => void): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				child.kill("SIGTERM");
				fn();
			};
			const timer = setTimeout(
				() => done(() => reject(new Error(`no tools/call answer in 20s\n${stderr.trim()}`))),
				20_000,
			);
			child.stderr.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
			child.on("exit", () => done(() => reject(new Error(`bridge exited early\n${stderr.trim()}`))));
			child.stdout.on("data", (d: Buffer) => {
				stdout += d.toString();
				for (const line of stdout.split("\n")) {
					if (!line.trim().startsWith("{")) continue;
					let msg: { id?: number; result?: { content?: Array<{ text?: string }> } };
					try {
						msg = JSON.parse(line);
					} catch {
						continue;
					}
					if (msg.id !== 2 || !msg.result) continue;
					done(() => resolve((msg.result?.content ?? []).map((c) => c.text ?? "").join("\n")));
					return;
				}
			});
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "entwurf-vitest-pilot", version: "0.0.0" } } })}\n`,
			);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "entwurf_fresh_call", arguments: { backend: "codex", model: "gpt-5.6", task: "pre-mutation contract cell — this must never reach tmux" } } })}\n`,
			);
		});
	}

	it("[QK:FRESHCALL-CODEX-PREMUTATION-MCP] the MCP surface answers a missing Codex capability BEFORE placement — with no tmux in its environment the reason is still the capability's, so no window can exist by the time the host reads it", async () => {
		const { env, cleanup } = codexPreflightEnv();
		try {
			const text = await callBridgeFreshCall(env);
			expect(text).not.toContain("no-tmux-context");
			expect(
				CODEX_REASONS.some((reason) => text.includes(reason)),
				`expected one of ${CODEX_REASONS.join("/")}, got: ${text}`,
			).toBe(true);
		} finally {
			cleanup();
		}
	}, 30_000);

	it("[QK:FRESHCALL-CODEX-PREMUTATION-PI] the native pi surface answers the same way — the preflight lives on BOTH call sites, so one of them losing it is one public door that opens a window before deciding", async () => {
		const piFresh = requireTool(piTools, "entwurf_fresh_call");
		const { env, cleanup } = codexPreflightEnv();
		const saved = { ...process.env };
		try {
			for (const key of Object.keys(process.env)) delete process.env[key];
			Object.assign(process.env, env);
			const result = await piFresh.execute("pre-mutation", {
				backend: "codex",
				model: "gpt-5.6",
				task: "pre-mutation contract cell — this must never reach tmux",
			});
			const text = result.content.map((c) => c.text ?? "").join("\n");
			expect(text).not.toContain("no-tmux-context");
			expect(
				CODEX_REASONS.some((reason) => text.includes(reason)),
				`expected one of ${CODEX_REASONS.join("/")}, got: ${text}`,
			).toBe(true);
		} finally {
			for (const key of Object.keys(process.env)) delete process.env[key];
			Object.assign(process.env, saved);
			cleanup();
		}
	}, 30_000);

	it("both peers surfaces stay facts-only and route creation to entwurf_fresh_call", () => {
		expect(requireTool(mcpTools, "entwurf_peers").description ?? "").toMatch(
			/facts-only[\s\S]{0,160}entwurf_fresh_call/,
		);
		expect(requireTool(piTools, "entwurf_peers").description).toMatch(/facts-only[\s\S]{0,120}entwurf_fresh_call/);
	});
});
