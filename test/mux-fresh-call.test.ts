/**
 * mux-fresh-call unit cells — vitest pilot lane (issue #62), migrated from
 * scripts/check-mux-fresh-call.ts. Everything here EXECUTES the composition; the
 * few remaining source-text reads are structural contracts (interface shape,
 * forbidden imports) that have no runtime observation point and are kept per the
 * issue's three-kinds/three-fates table.
 *
 * The two argv dialects are argv FACTS measured to fail the other way round: with
 * the flag before the prompt, pi opened a window and never ran a turn; with
 * `--allowedTools <tools...>` before the prompt, Claude Code swallowed the prompt
 * as an option value and did the same. That is why they are pinned, not described.
 *
 * The real-window axis stays with the manual baseline and smoke-mux-fresh-call-live;
 * the schema/host/provider axes live in the two contract test files beside this one.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildBackendArgs,
	buildFreshCallArgs,
	buildFreshCallPrompt,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	type FreshCallReceipt,
	type FreshCallResult,
	freshCall,
	isSafeFreshCallModel,
	MODEL_MAX_CHARS,
	renderFreshCall,
	TASK_MAX_CHARS,
} from "../pi-extensions/lib/mux-fresh-call.ts";
import type { Placement } from "../pi-extensions/lib/mux-placement.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GID = "20260805T000000-abcdef";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
const TASK = "summarise docs/mux-launch-rail.md";
const PI_MODEL = "entwurf/claude-sonnet-5";
const CLAUDE_MODEL = "claude-sonnet-5";

const read = (rel: string): string => fs.readFileSync(path.join(REPO_DIR, rel), "utf8");
const MODULE_SRC = read("pi-extensions/lib/mux-fresh-call.ts");

function reasonOf(result: FreshCallResult): string {
	if (result.ok) throw new Error("expected a refusal, got a launch receipt");
	return result.reason;
}

/** Hermetic executable `pi` on PATH, so refusal ordering past runtime resolution is
 * decidable without the developer host's real pi (GitHub's runner has none). */
function withPiRuntime<T>(run: (env: NodeJS.ProcessEnv) => T): T {
	const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-fresh-call-runtime-"));
	try {
		fs.writeFileSync(path.join(runtimeDir, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		return run({ PATH: runtimeDir });
	} finally {
		fs.rmSync(runtimeDir, { recursive: true, force: true });
	}
}

describe("argv dialects", () => {
	const piArgs = buildBackendArgs("pi", "PROMPT", PI_MODEL);
	const clArgs = buildBackendArgs("claude-code", "PROMPT", CLAUDE_MODEL);

	it("[QK:FRESHCALL-PI-ARGV-PROMPT-FIRST] pi argv is the prompt FIRST, then --entwurf-control — the flag-first order was measured to open a window whose turn never ran", () => {
		expect(piArgs[0]).toBe("PROMPT");
		expect(piArgs[1]).toBe("--entwurf-control");
	});

	it("[QK:FRESHCALL-PI-MODEL-ARGV] pi receives the caller's explicit canonical model instead of resolving an ambient default", () => {
		expect(piArgs.includes(PI_MODEL) || piArgs.includes(`--model=${PI_MODEL}`)).toBe(true);
	});

	it("[QK:FRESHCALL-PI-MODEL-DIALECT] pi receives the measured `--model`, value tokens — unlike Claude Code, Pi rejects the equals form", () => {
		expect(piArgs).toEqual(["PROMPT", "--entwurf-control", "--model", PI_MODEL]);
	});

	it("[QK:FRESHCALL-CLAUDE-ARGV-EQUALS-FORM] claude-code argv is the prompt then a SINGLE --allowedTools=<tool> token — the space form is variadic and was measured to eat the prompt", () => {
		expect(clArgs[0]).toBe("PROMPT");
		expect(clArgs[1]).toBe(`--allowedTools=${FRESH_CALL_CALLBACK_TOOL["claude-code"]}`);
		expect(clArgs[1]).not.toContain(" ");
		expect(clArgs).not.toContain("--allowedTools");
	});

	it("[QK:FRESHCALL-CLAUDE-MODEL-ARGV] Claude Code receives the caller's explicit model as one CLI token instead of resolving its ambient Opus default", () => {
		expect(clArgs).toHaveLength(3);
		expect(clArgs[2]).toBe(`--model=${CLAUDE_MODEL}`);
	});

	it("neither backend passes a shell string, a window name, a cwd or an env carrier", () => {
		for (const a of [...piArgs, ...clArgs]) expect(a).not.toMatch(/^-(n|c|e|b)$/);
	});

	it("the two backends are the whole fixed set", () => {
		expect([...FRESH_CALL_BACKENDS].sort()).toEqual(["claude-code", "pi"]);
	});
});

describe("first-turn framing", () => {
	const prompt = buildFreshCallPrompt({ backend: "pi", task: TASK, callerGardenId: GID, nonce: NONCE });

	it("[QK:FRESHCALL-CALLBACK-PRECEDES-TASK] the framing puts the callback instruction BEFORE the task, so a sibling that stalls in the task has already named itself", () => {
		const callbackAt = prompt.indexOf("FIRST ACTION");
		const taskAt = prompt.indexOf(TASK);
		expect(callbackAt).toBeGreaterThanOrEqual(0);
		expect(taskAt).toBeGreaterThan(callbackAt);
	});

	it("carries the caller garden id and the exact nonce", () => {
		expect(prompt).toContain(GID);
		expect(prompt).toContain(NONCE);
	});

	it("names the backend's own callback tool (native entwurf_v2 vs the MCP-namespaced one)", () => {
		expect(prompt).toContain("entwurf_v2");
		expect(buildFreshCallPrompt({ backend: "claude-code", task: TASK, callerGardenId: GID, nonce: NONCE })).toContain(
			FRESH_CALL_CALLBACK_TOOL["claude-code"],
		);
	});

	it("forbids the three detours that were measured to produce a confidently wrong self-report", () => {
		expect(prompt).toMatch(/environment variables/);
		expect(prompt).toMatch(/entwurf_self/);
		expect(prompt).toMatch(/MCP\s*\n?server yourself|start an MCP/);
	});
});

describe("refusals, before any mutation", () => {
	const noTmux = {} as NodeJS.ProcessEnv;

	it("a null caller identity is named, never defaulted — the sibling would have nowhere to call home", () => {
		expect(reasonOf(freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: null }, noTmux))).toBe(
			"caller-identity-unavailable",
		);
	});

	it("identity is checked BEFORE the tmux context, so an anonymous caller never learns whether tmux was there", () => {
		expect(reasonOf(freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: "" }, noTmux))).toBe(
			"caller-identity-unavailable",
		);
	});

	it("model is required and validated before runtime or tmux mutation", () => {
		expect(reasonOf(freshCall({ backend: "pi", model: " ", task: TASK, callerGardenId: GID }, noTmux))).toBe(
			"model-empty",
		);
		expect(reasonOf(freshCall({ backend: "pi", model: "sonnet;split", task: TASK, callerGardenId: GID }, noTmux))).toBe(
			"model-invalid",
		);
		expect(MODEL_MAX_CHARS).toBe(200);
		expect(isSafeFreshCallModel("claude-sonnet-5[1m]")).toBe(true);
		expect(isSafeFreshCallModel("openai-codex/gpt-5.6-terra")).toBe(true);
	});

	it("an empty (or whitespace-only) task is refused", () => {
		expect(reasonOf(freshCall({ backend: "pi", model: PI_MODEL, task: "   \n ", callerGardenId: GID }, noTmux))).toBe(
			"task-empty",
		);
	});

	it(`a task over ${TASK_MAX_CHARS} chars is refused at the interface, not truncated`, () => {
		expect(TASK_MAX_CHARS).toBe(16000);
		expect(
			reasonOf(
				freshCall(
					{ backend: "pi", model: PI_MODEL, task: "x".repeat(TASK_MAX_CHARS + 1), callerGardenId: GID },
					noTmux,
				),
			),
		).toBe("task-too-long");
	});

	it("outside tmux the reason is the leaf's own no-tmux-context, not a fallback launch", () => {
		const outside = withPiRuntime((env) =>
			freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID }, env),
		);
		expect(reasonOf(outside)).toBe("no-tmux-context");
	});

	it.each([
		"caller-identity-unavailable",
		"model-empty",
		"model-invalid",
		"task-empty",
		"task-too-long",
		"cwd-not-absolute",
		"cwd-format-token",
		"cwd-missing",
		"cwd-not-directory",
		"no-tmux-context",
	] as const)("refusal renders as a named reason a caller can act on (%s)", (reason) => {
		const { text, isError } = renderFreshCall({ ok: false, reason });
		expect(isError).toBe(true);
		expect(text).toContain(reason);
		expect(text).toContain("No window was opened");
	});
});

describe("optional cwd — cross-repo fresh placement (#73)", () => {
	const PLACEMENT: Placement = {
		serverPid: "4242",
		sessionId: "$0",
		windowId: "@1",
		windowIndex: "1",
		paneId: "%1",
		panePid: "4243",
	};

	/** Directory fixtures plus a hermetic executable runtime, because `buildFreshCallArgs`
	 * proves the runtime is real before any argv exists. */
	function withCwdFixture<T>(
		run: (fx: { runtime: string; realDir: string; spaceDir: string; filePath: string; tmp: string }) => T,
	): T {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-fresh-call-cwd-"));
		try {
			const realDir = path.join(tmp, "project");
			const spaceDir = path.join(tmp, "with space");
			const filePath = path.join(tmp, "a-file");
			fs.mkdirSync(realDir);
			fs.mkdirSync(spaceDir);
			fs.writeFileSync(filePath, "");
			const binDir = path.join(tmp, "bin");
			fs.mkdirSync(binDir);
			const runtime = path.join(binDir, "pi");
			fs.writeFileSync(runtime, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			return run({ runtime, realDir, spaceDir, filePath, tmp });
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}

	it("[QK:FRESHCALL-CWD-OMITTED-NO-CARRIER] an omitted cwd emits no -c, and the exact empty string means the SAME omit — the argv keeps the pre-#73 shape and the sibling starts in the caller's own directory", () => {
		withCwdFixture(({ runtime }) => {
			const args = buildFreshCallArgs(PLACEMENT, runtime, ["PROMPT"]);
			expect(args).not.toContain("-c");
			expect(buildFreshCallArgs(PLACEMENT, runtime, ["PROMPT"], undefined)).toEqual(args);
		});
		// "" is an omit, never a classification candidate: with a hermetic runtime on PATH and
		// no tmux, the refusal must be the leaf's no-tmux-context, not cwd-not-absolute.
		const result = withPiRuntime((env) =>
			freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID, cwd: "" }, env),
		);
		expect(reasonOf(result)).toBe("no-tmux-context");
	});

	it("[QK:FRESHCALL-CWD-ARGV] a valid absolute directory reaches tmux as exactly one `-c <dir>` at the resume-symmetric token position — after the -t target, before -P -F", () => {
		withCwdFixture(({ runtime, realDir }) => {
			const args = buildFreshCallArgs(PLACEMENT, runtime, ["PROMPT"], realDir);
			const c = args.indexOf("-c");
			expect(args.slice(0, c)).toEqual(["new-window", "-d", "-a", "-t", "$0:{end}"]);
			expect(args[c + 1]).toBe(realDir);
			expect(args[c + 2]).toBe("-P");
			expect(args.filter((a) => a === "-c")).toHaveLength(1);
		});
	});

	it("[QK:FRESHCALL-CWD-REFUSED-PREMUTATION] all four cwd refusals are decided BEFORE any mutation — even with no tmux and no runtime on PATH the named reason is the cwd's, so no window can exist by the time it is answered", () => {
		withCwdFixture(({ filePath, tmp }) => {
			const call = (cwd: string): string =>
				reasonOf(freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID, cwd }, {}));
			expect(call("relative/project")).toBe("cwd-not-absolute");
			expect(call(path.join(tmp, "#{pane_id}"))).toBe("cwd-format-token");
			expect(call(path.join(tmp, "deleted-project"))).toBe("cwd-missing");
			expect(call(filePath)).toBe("cwd-not-directory");
		});
	});

	it("a cwd that classification refuses can never be built into argv either — the builder re-checks rather than trusting its caller", () => {
		withCwdFixture(({ runtime, tmp }) => {
			expect(() => buildFreshCallArgs(PLACEMENT, runtime, ["PROMPT"], path.join(tmp, "#x"))).toThrow(
				/cwd-format-token/,
			);
		});
	});

	it("whitespace stays measured-OK through the fresh consumer: a directory with spaces arrives intact, while a lone space is a real UNTRIMMED value refused as not absolute — nothing repairs a path into a different directory", () => {
		withCwdFixture(({ runtime, spaceDir }) => {
			const args = buildFreshCallArgs(PLACEMENT, runtime, ["PROMPT"], spaceDir);
			expect(args[args.indexOf("-c") + 1]).toBe(spaceDir);
		});
		expect(reasonOf(freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID, cwd: " " }, {}))).toBe(
			"cwd-not-absolute",
		);
	});

	it("[QK:FRESHCALL-CWD-RECEIPT-REQUESTED] the receipt's cwd is the REQUESTED directory only — production freshCall assembles it into the receipt conditionally, and the renderer prints it exactly when the caller supplied one, labeled as a request, never an observed pane path", () => {
		// The production assembly half. freshCall cannot succeed without a real tmux (this repo
		// keeps no fake one), so the wiring that carries the requested cwd into the receipt is a
		// structural contract on the composition body — the renderer below would stay green on a
		// fixture receipt even if production stopped supplying the field.
		expect(MODULE_SRC).toContain("...(cwd === undefined ? {} : { cwd }),");
		const receipt: FreshCallReceipt = {
			serverPid: "1",
			sessionId: "$1",
			windowId: "@1",
			windowIndex: "2",
			paneId: "%1",
			panePid: "3",
			backend: "pi",
			model: PI_MODEL,
			runtimePath: "/usr/bin/pi",
			nonce: NONCE,
		};
		const without = renderFreshCall({ ok: true, receipt });
		expect(without.text).not.toMatch(/cwd:/);
		const withCwd = renderFreshCall({ ok: true, receipt: { ...receipt, cwd: "/repos/other-project" } });
		expect(withCwd.text).toContain("cwd:      /repos/other-project");
		expect(withCwd.text).toMatch(/requested start directory — not an observation/);
	});
});

describe("the two receipts stay apart", () => {
	it("[QK:FRESHCALL-RECEIPT-WITHOUT-CORRELATION] freshCall answers SYNCHRONOUSLY and its receipt type carries no callback/garden-id/delivered field — the correlation receipt arrives later on the caller's own inbound surface", () => {
		const returned = withPiRuntime((env) =>
			freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID }, env),
		);
		expect(returned).not.toBeInstanceOf(Promise);
		expect(MODULE_SRC).toMatch(/export interface FreshCallReceipt extends WindowHandle \{[^}]*\}/);
		expect(MODULE_SRC).not.toMatch(
			/export interface FreshCallReceipt extends WindowHandle \{[^}]*(callback|gardenId|delivered|siblingId)/,
		);
	});

	const rendered = renderFreshCall({
		ok: true,
		receipt: {
			serverPid: "1",
			sessionId: "$1",
			windowId: "@1",
			windowIndex: "2",
			paneId: "%1",
			panePid: "3",
			backend: "pi",
			model: PI_MODEL,
			runtimePath: "/usr/bin/pi",
			nonce: NONCE,
		},
	});

	it("the success text DENIES delivery in words, so a caller cannot read 'launched' as 'delivered'", () => {
		expect(rendered.isError).toBe(false);
		expect(rendered.text).toMatch(/does NOT mean/);
		expect(rendered.text).toMatch(/LAUNCH receipt/);
	});

	it("the text says nothing is polling and points at the visible window instead", () => {
		expect(rendered.text).toMatch(/Nothing is polling/);
		expect(rendered.text).toMatch(/window is visible/);
	});

	it("no watcher: the module schedules nothing after the mutation — no timer, no loop, nothing awaited", () => {
		// Word-matching would fail on the receipt's own prose ("Nothing is polling for
		// it"), which is the opposite of the defect. Look for the scheduling APIs a
		// watcher would actually need.
		const code = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/setTimeout|setInterval|setImmediate|while\s*\(|for\s*\(;;|await\s/);
	});
});

describe("module boundaries (structural contracts, source-text by design)", () => {
	it("the composition itself never reads env or a store for the caller id — it is given one or it refuses", () => {
		expect(MODULE_SRC).not.toMatch(/process\.env\.PI_SESSION_ID|readMetaIdentity|resolveTrustedMetaSender/);
	});

	it("the placement leaf still takes no prompt/command/backend — fresh-call builds its own argv on top of it", () => {
		const leaf = read("pi-extensions/lib/mux-placement.ts");
		expect(leaf.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")).not.toMatch(
			/prompt|task|backend/i,
		);
	});

	it("fresh-call does not import entwurf delivery — it only names the callback tool in prose the sibling reads", () => {
		expect(MODULE_SRC).not.toMatch(/from "\.\/entwurf-/);
	});

	it("[QK:FRESHCALL-CWD-CALLER-ONLY] the caller is the ONLY cwd authority — the module imports no store, peers surface or resume record to find a directory, never reads process.cwd, and classifies through the shared classify-tmux-cwd leaf", () => {
		expect(MODULE_SRC).not.toMatch(
			/meta-session|entwurf-peers|mux-resume-call|readAddressableMetaIdentity|process\.cwd/,
		);
		expect(MODULE_SRC).toMatch(/from "\.\/classify-tmux-cwd\.ts"/);
	});
});
