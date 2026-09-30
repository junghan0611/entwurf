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
 *     the same bytes an MCP host validates. Since #125 it is the ONLY fresh-call
 *     surface: a pi session reaches it through Pi's built-in MCP, which hands the
 *     tools/list inputSchema to the provider verbatim (`[측정 2026-09-30, pi 0.99.1]`
 *     `extensions/mcp/tools.ts:232-237`), so there is no second, hand-written schema
 *     left to drift. Why the native-pi half was retired rather than kept in parity,
 *     and where that ownership and coverage boundary moved, is summarized in the
 *     public #125 checkpoint
 *     https://github.com/junghan0611/entwurf/issues/125#issuecomment-5906641374
 *     (a summary, not a per-claim table);
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
	HOST_DESCRIPTION_CAP,
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

beforeAll(async () => {
	mcpTools = await bootBridgeAndListTools();
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
		// The MCP surface passes ONE object to the composition ROOT (#116 C3): rail choice, Codex
		// preflight ordering and rendering live there, so this surface and pi's own cannot drift.
		// Two of its fields are surface-supplied codex caller facts (#95 lane B/C) that only this
		// surface can supply, and they ride the same object rather than a second call.
		expect(mcpSrc).toMatch(
			/dispatchFreshCall\(\{\s*backend,\s*model,\s*task,\s*cwd,\s*placement,\s*callerGardenId,\s*callerNativeSessionId,\s*callerCwd,\s*\}\)/,
		);
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

	/**
	 * The SECOND surface. `docs/adding-a-harness.md` step 9 names the public surfaces together — the
	 * MCP bridge (which every host, pi included since #125, reaches) and the operator skill — but
	 * only the schema surface was ever observed, so the skill's backend list was free to drift and
	 * did not even have a gate to drift against. A skill that offers three backends is not a cosmetic staleness: it is the
	 * document the operator reads to decide what can be opened, so a missing backend is
	 * unreachable in practice exactly the way a missing enum value is unreachable in schema.
	 *
	 * Source text is the only observation point here — a skill is prose consumed by a model, with
	 * no runtime to interrogate — so the assertion is deliberately anchored on the one line that
	 * states the contract rather than on any mention of a backend name anywhere in the file.
	 */
	it("[QK:FRESHCALL-BACKEND-SET-SURFACE-PARITY-SKILL] the operator skill offers the same fixed set — step 9 requires the same backends on every public surface, and this one had no gate at all", () => {
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

describe("the one fresh-call surface — contracts every caller relies on", () => {
	it("the runtime description carries the world map and contract literals", () => {
		const mcpDesc = requireTool(mcpTools, "entwurf_fresh_call").description ?? "";
		for (const desc of [mcpDesc]) {
			// "secrets", not the file-level "no secrets" literal the old gate matched:
			// that string lived in surrounding source, not in the rendered description a
			// model actually reads ("Do not put secrets in the task").
			for (const literal of [
				"LAUNCH receipt",
				"entwurf_peers only reports",
				"secrets",
				"Model is REQUIRED",
				"entwurf_v2",
				// #95 D1 retired the fixed `codex` home, so the shared literal is no longer a
				// room name. What the surface must still say is WHOSE session an omitted seat
				// follows — the caller's, never the backend being opened.
				"the CALLER",
			]) {
				expect(desc).toContain(literal);
			}
		}
	});

	it("[QK:FRESHCALL-CWD-SURFACE] the fresh-call surface exposes an optional cwd — present in the runtime schema, not required, the literal-path contract in its description, passed through verbatim to the one composition — so cross-repo fresh is reachable from every caller", () => {
		const mcpFresh = requireTool(mcpTools, "entwurf_fresh_call");
		const mcpCwd = mcpFresh.inputSchema?.properties?.cwd;
		expect(mcpCwd, "tools/list carries a cwd property").toBeDefined();
		expect(mcpCwd?.type).toBe("string");
		expect(mcpFresh.inputSchema?.required).not.toContain("cwd");
		for (const desc of [String(mcpCwd?.description ?? "")]) {
			expect(desc).toContain("ABSOLUTE");
			expect(desc).toContain("REQUESTED");
			expect(desc).toContain("no trim");
		}
		// The pass-through halves stay structural asserts, same as the model parameter above.
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		// The MCP surface passes ONE object to the composition ROOT (#116 C3): rail choice, Codex
		// preflight ordering and rendering live there, not in the surface.
		// Two of its fields are surface-supplied codex caller facts (#95 lane B/C) that only this
		// surface can supply, and they ride the same object rather than a second call.
		expect(mcpSrc).toMatch(
			/dispatchFreshCall\(\{\s*backend,\s*model,\s*task,\s*cwd,\s*placement,\s*callerGardenId,\s*callerNativeSessionId,\s*callerCwd,\s*\}\)/,
		);
	});

	it("[QK:FRESHCALL-PLACEMENT-SURFACE] the fresh-call surface exposes an optional project seat — an object with the one required tmuxSession field, optional, the nothing-is-created contract in its description, passed through verbatim to the one composition, and the same seat offered by the operator skill", () => {
		const mcpFresh = requireTool(mcpTools, "entwurf_fresh_call");
		const mcpPlacement = mcpFresh.inputSchema?.properties?.placement;
		expect(mcpPlacement, "tools/list carries a placement property").toBeDefined();
		expect(mcpPlacement?.type).toBe("object");
		expect(mcpFresh.inputSchema?.required).not.toContain("placement");
		// The seat itself is the one required field of that object: an empty object would be a
		// seat request naming no seat.
		for (const placement of [mcpPlacement]) {
			const inner = (placement as { properties?: Record<string, unknown> } | undefined)?.properties;
			expect(Object.keys(inner ?? {})).toEqual(["tmuxSession"]);
			expect((placement as { required?: string[] } | undefined)?.required).toEqual(["tmuxSession"]);
		}
		for (const desc of [String(mcpPlacement?.description ?? "")]) {
			expect(desc).toContain("EXISTING");
			expect(desc).toContain("Nothing is ever created");
			expect(desc).toContain("Independent of cwd");
			expect(desc).toContain("expert seat override");
			// The omitted-seat rule, stated for every caller. It is deliberately
			// about WHO CALLS rather than what is opened: #95 D1 retired the Codex-target home,
			// and the asymmetry it left behind is exactly what a stale description would keep
			// selling to a model.
			expect(desc).toContain("follows the CALLER, never the backend being opened");
		}
		// The Codex caller-pane rule is stated here for every caller; it only ever FIRES for a codex
		// caller, because only that sender carries a thread id (a pi-session sender reaching this
		// surface since #125 has none, so the anchor is never consulted for it).
		expect(String(mcpPlacement?.description ?? "")).toContain("a Codex CALLER opens beside its own TUI pane");
		// The runtime description states the refusal, so a caller cannot read "seat" as "create".
		for (const desc of [mcpFresh.description ?? ""]) {
			expect(desc).toContain("placement.tmuxSession");
			expect(desc).toContain("NOTHING is created");
			// ...and it may not still advertise the retired room (#95 D1).
			expect(desc).not.toContain("`codex` home");
		}
		// The pass-through stays a structural assert, same as the cwd contract above.
		const mcpSeatSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSeatSrc).toMatch(
			/dispatchFreshCall\(\{\s*backend,\s*model,\s*task,\s*cwd,\s*placement,\s*callerGardenId,\s*callerNativeSessionId,\s*callerCwd,\s*\}\)/,
		);
		// The SKILL surface, for the same reason the backend set is held there: the skill
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
		expect(seatBullet).toContain("Codex");
		expect(seatBullet).toContain("`codex`");
		// And the call shape the skill tells the agent to send.
		expect(skill).toMatch(/\{backend, model, task, cwd\?, placement\?\}/);
	});

	/**
	 * The Codex capability preflight is the ONE preflight that cannot live in the composition:
	 * it performs a bounded app-server exchange, and `freshCall` is a synchronous leaf by
	 * contract. So it sits OUTSIDE the leaf — which means the ordering that every other backend
	 * gets for free (preflight inside the leaf, proven by the leaf's own cells) is here a property
	 * of the call path a public surface drives, and it has to be executed to be believed.
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

	it("[QK:CODEX-CALLER-PREFLIGHT-SURFACE-WIRED] the CALLER-side capability question is asked in the shared dispatcher, gated on a codex caller with no explicit seat — a different axis from the target preflight beside it, supplied only for a codex sender", () => {
		// Two facts, and they are separate on purpose. FIRST: the root runs the caller check, and
		// only when the anchor will be consulted — a codex caller that named a placement never
		// reads a pane title, so refusing it for a missing `thread-id` would refuse an unused
		// capability. SECOND: it runs AFTER the target axis, because "entwurf cannot open a Codex
		// sibling here at all" is the more fundamental repair.
		const rootSrc = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/lib/fresh-call-dispatch.ts"), "utf8");
		expect(rootSrc).toContain(
			"targetMissing === null && request.callerNativeSessionId !== undefined && request.placement === undefined\n\t\t\t? codexCallerFreshPreflight(env)",
		);
		expect(rootSrc).toContain("const missing = targetMissing ?? callerMissing;");
		// The MCP surface is the only one that supplies the input the gate reads, because it is
		// the only surface a codex caller reaches entwurf through.
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSrc).toContain("callerNativeSessionId = self.codexThreadId;");
		// A pi session reaching this surface since #125 is a pi-session sender: it carries no
		// thread id, so `callerNativeSessionId` stays undefined and this check is never consulted
		// for it — the input is a fact of the codex sender, not of the surface.
	});

	it("[QK:FRESHCALL-CALLER-CWD-SURFACE] the codex caller's RECORD cwd rides the MCP surface under the SAME condition as its thread id — one resolved sender, two facts, and neither read separately; a pi caller supplies neither, because the bridge child it reaches runs in the pi session's own directory", () => {
		// WHY the bridge is the only surface that can supply this: it runs as the MCP child of
		// the operator-owned app-server, so `process.cwd()` there is the app-server's directory
		// and an omitted cwd would open every sibling of every Codex caller in the app-server's
		// repo (#95 lane C §1). The record is what says where that citizen actually is.
		const mcpSrc = fs.readFileSync(path.join(REPO_DIR, "mcp/entwurf-bridge/src/index.ts"), "utf8");
		expect(mcpSrc).toContain("callerCwd = self.codexThreadId === undefined ? undefined : self.envelope.cwd;");
		// It is NOT a second identity axis: the envelope's cwd is only the record's directory
		// when the reconciled sender is that codex citizen, so the guard is the thread id itself
		// rather than a separate lookup, an env read or a `_meta.workspaces` inspection.
		expect(mcpSrc).not.toMatch(/callerCwd\s*=\s*process\.cwd\(\)/);
		expect(mcpSrc).not.toContain("_meta.workspaces");
		// A pi caller gets neither: it is never a codex sender, and Pi's built-in MCP starts the
		// bridge child in the pi session's own cwd, so the child's process directory already IS the
		// caller's. That vendor fact is observed end to end by `check-pi-mcp-bridge` (#125), not here.
	});

	it("[QK:FRESHCALL-CODEX-PREMUTATION-MCP] the MCP surface carries Codex unchanged into the shared dispatcher, which answers a missing capability BEFORE placement — with no tmux in its environment the reason is still the capability's", async () => {
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

	it("the peers surface stays facts-only and routes creation to entwurf_fresh_call", () => {
		expect(requireTool(mcpTools, "entwurf_peers").description ?? "").toMatch(
			/facts-only[\s\S]{0,160}entwurf_fresh_call/,
		);
	});
});
