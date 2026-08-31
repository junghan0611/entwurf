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
	buildOmpBootstrapPayload,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	FRESH_CALL_RUNTIME,
	type FreshCallReceipt,
	type FreshCallResult,
	freshCall,
	isSafeFreshCallModel,
	MODEL_MAX_CHARS,
	OMP_BOOTSTRAP_FLAG,
	OMP_BOOTSTRAP_VERSION,
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
const COPILOT_MODEL = "gpt-5.6-terra";
const OMP_MODEL = "openai-codex/gpt-5.6-terra";

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
	/** The two shapes a launch composes. Three backends read `prompt`; omp reads the payload
	 * its own installed extension unpacks, and reads NOTHING else. */
	const COMPOSITION = { prompt: "PROMPT", bootstrapPayload: "PAYLOAD" } as const;
	const piArgs = buildBackendArgs("pi", COMPOSITION, PI_MODEL);
	const clArgs = buildBackendArgs("claude-code", COMPOSITION, CLAUDE_MODEL);

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

	const cpArgs = buildBackendArgs("copilot", COMPOSITION, COPILOT_MODEL);

	it("[QK:FRESHCALL-COPILOT-MANAGED-RUNTIME] copilot opens through entwurf's OWN managed invocation — runtime `entwurf`, verb `copilot` as the first forwarded token — never the bare vendor CLI, which would start without the EXTENSIONS flag and skip the extension scan SILENTLY", () => {
		expect(FRESH_CALL_RUNTIME.copilot).toBe("entwurf");
		expect(cpArgs[0]).toBe("copilot");
	});

	it("[QK:FRESHCALL-COPILOT-ARGV-INTERACTIVE] the prompt rides --interactive, never -p/--prompt — `-p` runs the prompt and EXITS, closing the window on a sibling that is supposed to stay open and be delivered to", () => {
		expect(cpArgs[1]).toBe("--interactive");
		expect(cpArgs[2]).toBe("PROMPT");
		expect(cpArgs).not.toContain("-p");
		expect(cpArgs).not.toContain("--prompt");
	});

	it("[QK:FRESHCALL-COPILOT-MODEL-ARGV] Copilot receives the caller's explicit model as the measured `--model`, value token pair instead of falling back to the launcher's injected `--model auto`", () => {
		const m = cpArgs.indexOf("--model");
		expect(m).toBeGreaterThan(0);
		expect(cpArgs[m + 1]).toBe(COPILOT_MODEL);
	});

	it("[QK:FRESHCALL-COPILOT-YOLO-POLICY] the policy token is the explicit `--yolo` — GLG's 2026-08-25 operator decision after the callback-only `--allow-tool` grant left the fresh sibling stopping on a confirmation prompt at every task tool. A narrowed grant here recreates that measured regression", () => {
		expect(cpArgs).toContain("--yolo");
		// The regression shape, pinned negatively: no --allow-tool token in ANY spelling, and in
		// particular not the callback-only grant the first cut shipped.
		const heads = cpArgs.map((a) => a.split("=")[0]);
		expect(heads).not.toContain("--allow-tool");
		expect(cpArgs).not.toContain("--allow-tool=entwurf-bridge(entwurf_v2)");
	});

	it("[QK:FRESHCALL-COPILOT-EXPLICIT-POLICY] the policy is STATED by the composition, not left to the launcher's injection — step 9 clause 2 requires explicit model/permission, and `--yolo` is a head scripts/copilot-launch.sh recognises as an operator-stated policy", () => {
		// The launcher injects its own --yolo only when the argv names NO policy; carrying the
		// token here keeps the fresh contract explicit instead of invisibly borrowing a default.
		const heads = cpArgs.map((a) => a.split("=")[0]);
		expect(heads).toContain("--yolo");
	});

	it("[QK:FRESHCALL-COPILOT-CALLBACK-TOOL] the Copilot callback tool is the MEASURED `<server>-<tool>` composition, not Claude Code's `mcp__server__tool` spelling — a copied dialect costs the whole first turn", () => {
		expect(FRESH_CALL_CALLBACK_TOOL.copilot).toBe("entwurf-bridge-entwurf_v2");
		expect(FRESH_CALL_CALLBACK_TOOL.copilot).not.toBe(FRESH_CALL_CALLBACK_TOOL["claude-code"]);
		expect(buildFreshCallPrompt({ backend: "copilot", task: TASK, callerGardenId: GID, nonce: NONCE })).toContain(
			"entwurf-bridge-entwurf_v2",
		);
	});

	it("no backend passes a shell string, a window name, a cwd or an env carrier", () => {
		for (const a of [...piArgs, ...clArgs, ...cpArgs]) expect(a).not.toMatch(/^-(n|c|e|b)$/);
	});

	const ompArgs = buildBackendArgs("omp", COMPOSITION, OMP_MODEL);

	it("[QK:FRESHCALL-OMP-BARE-RUNTIME] omp opens the BARE vendor — unlike copilot there is no launcher-only flag to manage, so inventing a managed verb would add a surface with nothing behind it", () => {
		expect(FRESH_CALL_RUNTIME.omp).toBe("omp");
		expect(ompArgs[0]).toBe(`--${OMP_BOOTSTRAP_FLAG}`);
	});

	it("[QK:FRESHCALL-OMP-ARGV-BOOTSTRAP-FLAG] omp carries the task on the fixed `--entwurf-bootstrap` flag and NO positional prompt — a positional prompt was measured on 2026-08-30 to start the turn ~830ms before the callback tool existed, and the sibling answered `ACK` with zero tool calls", () => {
		expect(ompArgs).toEqual([`--${OMP_BOOTSTRAP_FLAG}`, "PAYLOAD", "--model", OMP_MODEL, "--approval-mode", "yolo"]);
		// The positional slot is the regression, pinned negatively: argv[0] is a flag, and the
		// first-turn framing three other backends pass appears nowhere in this argv.
		expect(ompArgs[0]?.startsWith("--")).toBe(true);
		expect(ompArgs).not.toContain("PROMPT");
		expect(ompArgs).not.toContain("-p");
		expect(ompArgs).not.toContain("--print");
	});

	it("[QK:FRESHCALL-OMP-FLAG-IS-ONE-PURPOSE] the bootstrap flag is a single fixed name with a single value — never an env carrier, a command, or an arbitrary caller-shaped passthrough", () => {
		expect(OMP_BOOTSTRAP_FLAG).toBe("entwurf-bootstrap");
		// Exactly one occurrence, and its value is the payload rather than anything a caller
		// could aim somewhere else.
		expect(ompArgs.filter((a) => a.startsWith(`--${OMP_BOOTSTRAP_FLAG}`))).toHaveLength(1);
		const at = ompArgs.indexOf(`--${OMP_BOOTSTRAP_FLAG}`);
		expect(ompArgs[at + 1]).toBe("PAYLOAD");
		for (const a of ompArgs) expect(a).not.toMatch(/^-(e|c|n|b)$/);
	});

	it("[QK:FRESHCALL-OMP-PAYLOAD-SHAPE] the payload is the closed {v,target,nonce,task} object and carries no model, path, command or env name", () => {
		const raw = buildOmpBootstrapPayload({ callerGardenId: GID, nonce: NONCE, task: TASK });
		expect(JSON.parse(raw)).toEqual({ v: OMP_BOOTSTRAP_VERSION, target: GID, nonce: NONCE, task: TASK });
		expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["nonce", "target", "task", "v"]);
	});

	it("[QK:FRESHCALL-OMP-EXPLICIT-POLICY] the permission width is an explicit argv token even though omp's schema default is ALREADY yolo — a default that grants the same thing is exactly the drift step 9 clause 2 forbids, and nothing observable would fail if this token were dropped", () => {
		const policyAt = ompArgs.indexOf("--approval-mode");
		expect(policyAt).toBeGreaterThan(0);
		expect(ompArgs[policyAt + 1]).toBe("yolo");
	});

	it("[QK:FRESHCALL-OMP-CALLBACK-TOOL-DIALECT] omp's model-facing callback name drops the DIGIT from entwurf_v2 and underscores the server key — a sibling's spelling copied here costs the whole first turn", () => {
		expect(FRESH_CALL_CALLBACK_TOOL.omp).toBe("mcp__entwurf_bridge_entwurf_v");
		expect(FRESH_CALL_CALLBACK_TOOL.omp).not.toContain("entwurf_v2");
		expect(FRESH_CALL_CALLBACK_TOOL.omp).not.toBe(FRESH_CALL_CALLBACK_TOOL["claude-code"]);
		expect(buildFreshCallPrompt({ backend: "omp", task: TASK, callerGardenId: GID, nonce: NONCE })).toContain(
			"mcp__entwurf_bridge_entwurf_v",
		);
	});

	it("the four backends are the whole fixed set", () => {
		expect([...FRESH_CALL_BACKENDS].sort()).toEqual(["claude-code", "copilot", "omp", "pi"]);
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
		"copilot-birth-unit-missing",
		"copilot-mcp-hand-missing",
		"copilot-receive-unit-missing",
		"copilot-visible-identity-missing",
		"omp-agent-dir-ambiguous",
		"omp-birth-unit-missing",
		"omp-mcp-hand-missing",
		"omp-receive-unit-missing",
		"omp-visible-identity-missing",
		"omp-callback-tool-uncallable",
	] as const)("refusal renders as a named reason a caller can act on (%s)", (reason) => {
		const { text, isError } = renderFreshCall({ ok: false, reason });
		expect(isError).toBe(true);
		expect(text).toContain(reason);
		expect(text).toContain("No window was opened");
	});
});

describe("copilot capability preflight, decided before any window exists (step 9 clause 3)", () => {
	/**
	 * A host with an executable `entwurf` on PATH and a sandbox HOME/XDG, and deliberately NO
	 * tmux. That combination is the whole argument: if the answer is a capability reason rather
	 * than `no-tmux-context`, the decision provably happened before placement — and placement is
	 * the last thing that runs before the single mutation.
	 */
	function withCopilotHost<T>(run: (fx: { env: NodeJS.ProcessEnv; birthHooks: string }) => T): T {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-fresh-copilot-"));
		try {
			const home = path.join(root, "home");
			const xdg = path.join(root, "xdg");
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin, { recursive: true });
			fs.writeFileSync(path.join(bin, "entwurf"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			fs.writeFileSync(path.join(bin, "entwurf-copilot-statusline"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

			const write = (file: string, value: unknown): void => {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, JSON.stringify(value));
			};
			const birthHooks = path.join(
				xdg,
				"entwurf/meta-bridge-copilot/.assembled/entwurf-meta-receive-copilot/hooks/hooks.json",
			);
			write(birthHooks, { hooks: {} });
			const mcpConfig = path.join(home, ".copilot/mcp-config.json");
			write(mcpConfig, { mcpServers: { "entwurf-bridge": {} } });
			write(path.join(xdg, "entwurf/copilot-mcp/install-state.json"), {
				managedConfigPath: mcpConfig,
				serverKey: "entwurf-bridge",
			});
			const receiveUnit = path.join(home, ".copilot/extensions/entwurf-receive");
			fs.mkdirSync(receiveUnit, { recursive: true });
			fs.writeFileSync(path.join(receiveUnit, "extension.mjs"), "");
			write(path.join(xdg, "entwurf/copilot-receive/install-state.json"), {
				unit: "entwurf-receive",
				path: receiveUnit,
			});
			write(path.join(home, ".copilot/settings.json"), {
				statusLine: { command: "entwurf-copilot-statusline" },
				footer: { showCustom: true },
			});
			return run({ env: { HOME: home, XDG_DATA_HOME: xdg, PATH: bin }, birthHooks });
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}

	const call = (env: NodeJS.ProcessEnv): FreshCallResult =>
		freshCall({ backend: "copilot", model: COPILOT_MODEL, task: TASK, callerGardenId: GID }, env);

	it("[QK:FRESHCALL-COPILOT-PREFLIGHT-PREMUTATION] a missing Copilot capability is answered BEFORE placement — with no tmux at all the reason is still the capability's, so no window can exist by the time the caller reads it", () => {
		withCopilotHost((fx) => {
			fs.rmSync(fx.birthHooks);
			expect(reasonOf(call(fx.env))).toBe("copilot-birth-unit-missing");
		});
	});

	it("a complete Copilot host is NOT refused by the preflight — it proceeds to the tmux question, which is the leaf's own no-tmux-context here", () => {
		withCopilotHost((fx) => {
			expect(reasonOf(call(fx.env))).toBe("no-tmux-context");
		});
	});

	it("[QK:FRESHCALL-COPILOT-PREFLIGHT-AFTER-RUNTIME] a host with no `entwurf` on PATH hears runtime-unresolved, not a capability reason — telling an operator to install a Copilot unit when they have no entwurf at all sends them to the wrong repair", () => {
		withCopilotHost((fx) => {
			fs.rmSync(fx.birthHooks);
			expect(reasonOf(call({ ...fx.env, PATH: "/nonexistent-path-for-this-cell" }))).toBe("runtime-unresolved");
		});
	});

	it("the preflight is COPILOT-only: a pi launch on the same bare host is never refused for a Copilot unit", () => {
		const outside = withPiRuntime((env) =>
			freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID }, env),
		);
		expect(reasonOf(outside)).toBe("no-tmux-context");
	});
});

describe("omp capability preflight, decided before any window exists (step 9 clauses 3-5)", () => {
	/**
	 * Same argument as the Copilot fixture above: an executable `omp` on PATH, a sandbox HOME,
	 * and deliberately NO tmux. A capability reason rather than `no-tmux-context` proves the
	 * decision happened before placement, which is the last thing to run before the mutation.
	 *
	 * The fixture writes the config as YAML text rather than through a serializer on purpose —
	 * the thing under test is a reader of the operator's hand-edited file, and a serializer would
	 * only ever produce the one shape the reader already handles.
	 */
	function withOmpHost<T>(
		run: (fx: { env: NodeJS.ProcessEnv; agentDir: string; writeConfig: (yaml: string) => void }) => T,
	): T {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-fresh-omp-"));
		try {
			const home = path.join(root, "home");
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin, { recursive: true });
			fs.writeFileSync(path.join(bin, "omp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

			const agentDir = path.join(home, ".omp", "agent");
			const extensions = path.join(agentDir, "extensions");
			fs.mkdirSync(path.join(extensions, "entwurf-meta-omp"), { recursive: true });
			fs.mkdirSync(path.join(extensions, "entwurf-receive-omp"), { recursive: true });
			fs.writeFileSync(
				path.join(agentDir, "mcp.json"),
				JSON.stringify({ mcpServers: { "entwurf-bridge": { command: "bash" } } }),
			);
			const writeConfig = (yaml: string): void => fs.writeFileSync(path.join(agentDir, "config.yml"), yaml);
			writeConfig("tools:\n  xdev: false\n");
			return run({ env: { HOME: home, PATH: bin }, agentDir, writeConfig });
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}

	const call = (env: NodeJS.ProcessEnv): FreshCallResult =>
		freshCall({ backend: "omp", model: OMP_MODEL, task: TASK, callerGardenId: GID }, env);

	it("a complete omp host is NOT refused by the preflight — it proceeds to the tmux question, which is the leaf's own no-tmux-context here", () => {
		withOmpHost((fx) => {
			expect(reasonOf(call(fx.env))).toBe("no-tmux-context");
		});
	});

	it("[QK:FRESHCALL-OMP-PREFLIGHT-PREMUTATION] a missing OMP capability is answered BEFORE placement — with no tmux at all the reason is still the capability's, so no window can exist by the time the caller reads it", () => {
		withOmpHost((fx) => {
			fs.rmSync(path.join(fx.agentDir, "extensions", "entwurf-meta-omp"), { recursive: true });
			expect(reasonOf(call(fx.env))).toBe("omp-birth-unit-missing");
		});
	});

	it("each of the four installed-unit axes refuses under its OWN name — an operator sent to the wrong installer is worse served than one told nothing", () => {
		withOmpHost((fx) => {
			fs.rmSync(path.join(fx.agentDir, "mcp.json"));
			expect(reasonOf(call(fx.env))).toBe("omp-mcp-hand-missing");
		});
		withOmpHost((fx) => {
			fs.rmSync(path.join(fx.agentDir, "extensions", "entwurf-receive-omp"), { recursive: true });
			expect(reasonOf(call(fx.env))).toBe("omp-receive-unit-missing");
		});
		withOmpHost((fx) => {
			fs.writeFileSync(path.join(fx.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { other: {} } }));
			expect(reasonOf(call(fx.env))).toBe("omp-mcp-hand-missing");
		});
	});

	it("[QK:FRESHCALL-OMP-XDEV-FAIL-CLOSED] the callback axis demands POSITIVE proof of `tools.xdev: false` — the vendor default is true and true is the broken state, so an absent file, an absent key and an unparseable config all refuse rather than assuming the host is fine", () => {
		for (const config of [null, "", "tools:\n  approvalMode: yolo\n", "tools:\n  xdev: true\n", "tools: [oops\n"]) {
			withOmpHost((fx) => {
				if (config === null) fs.rmSync(path.join(fx.agentDir, "config.yml"));
				else fx.writeConfig(config);
				expect(reasonOf(call(fx.env)), `config ${JSON.stringify(config)}`).toBe("omp-callback-tool-uncallable");
			});
		}
	});

	it("[QK:FRESHCALL-OMP-VISIBLE-IDENTITY-DEFAULT-TRUE] visible identity fails the OTHER way — showHookStatus defaults to TRUE, so only an explicit false refuses, and an absent key is a working status line rather than a missing one", () => {
		withOmpHost((fx) => {
			fx.writeConfig("tools:\n  xdev: false\nstatusLine:\n  showHookStatus: false\n");
			expect(reasonOf(call(fx.env))).toBe("omp-visible-identity-missing");
		});
		withOmpHost((fx) => {
			fx.writeConfig("tools:\n  xdev: false\nstatusLine:\n  separator: ascii\n");
			expect(reasonOf(call(fx.env))).toBe("no-tmux-context");
		});
	});

	it("[QK:FRESHCALL-OMP-AGENT-DIR-REFUSES-PI-KNOB] an inherited pi-shaped env knob is a REFUSAL, never a lookup — omp is a pi fork sharing those names, so a value in the environment does not say which harness it addresses and guessing would preflight a directory no live omp reads", () => {
		withOmpHost((fx) => {
			for (const knob of ["PI_CODING_AGENT_DIR", "PI_CONFIG_DIR"]) {
				expect(reasonOf(call({ ...fx.env, [knob]: "/some/where" })), knob).toBe("omp-agent-dir-ambiguous");
			}
			// PI_PROFILE alone is ambiguous; OMP_PROFILE beside it resolves the question.
			expect(reasonOf(call({ ...fx.env, PI_PROFILE: "work" }))).toBe("omp-agent-dir-ambiguous");
			expect(reasonOf(call({ ...fx.env, PI_PROFILE: "work", OMP_PROFILE: "work" }))).toBe("omp-birth-unit-missing");
		});
	});

	it("[QK:FRESHCALL-OMP-PREFLIGHT-AFTER-RUNTIME] a host with no `omp` on PATH hears runtime-unresolved, not a capability reason", () => {
		withOmpHost((fx) => {
			fs.rmSync(path.join(fx.agentDir, "extensions", "entwurf-meta-omp"), { recursive: true });
			expect(reasonOf(call({ ...fx.env, PATH: "/nonexistent-path-for-this-cell" }))).toBe("runtime-unresolved");
		});
	});

	it("the preflight is OMP-only: a pi launch on the same bare host is never refused for an OMP unit", () => {
		const outside = withPiRuntime((env) =>
			freshCall({ backend: "pi", model: PI_MODEL, task: TASK, callerGardenId: GID }, env),
		);
		expect(reasonOf(outside)).toBe("no-tmux-context");
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

	it("[QK:FRESHCALL-IDENTITY-SCRUB] every launch scrubs the inherited pi identity carrier at the seam, for EVERY backend — a tmux server started from a shell that exported PI_SESSION_ID hands that value to every window it opens, and the sibling's own MCP child would read the stale pair as its authoritative identity", () => {
		withCwdFixture(({ runtime }) => {
			for (const backend of FRESH_CALL_BACKENDS) {
				const args = buildFreshCallArgs(
					PLACEMENT,
					runtime,
					buildBackendArgs(backend, { prompt: "PROMPT", bootstrapPayload: "PAYLOAD" }, "m"),
				);
				for (const carrier of ["PI_SESSION_ID=", "PI_AGENT_ID="]) {
					const at = args.indexOf(carrier);
					expect(at, `${backend} scrubs ${carrier}`).toBeGreaterThan(0);
					expect(args[at - 1]).toBe("-e");
					// Before the -t target, so the assignment applies to the window being created.
					expect(at).toBeLessThan(args.indexOf("-t"));
				}
				// A fixed two-variable seam, never a general carrier: no other -e reaches tmux.
				expect(args.filter((a) => a === "-e")).toHaveLength(2);
			}
		});
	});

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
			expect(args.slice(0, c)).toEqual([
				"new-window",
				"-d",
				"-a",
				"-e",
				"PI_SESSION_ID=",
				"-e",
				"PI_AGENT_ID=",
				"-t",
				"$0:{end}",
			]);
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
