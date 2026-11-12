/**
 * Pi's thinking level reaches Claude effort over ACP, set and read back before the prompt (#142).
 *
 * claude-agent-acp 0.106.0 offers an `effort` session config option (category `thought_level`)
 * with `default, low, medium, high, xhigh, max`. `[측정 2026-11-13]` authenticated, no prompt:
 * `high → low → max` each read back on one live session and `minimal` was refused `-32602`.
 *
 * Three subjects, each against an independent oracle:
 *   1. The curated rows' `thinkingLevelMap` → the menu pi itself builds. The oracle is pi's own
 *      `ModelRuntime.registerProvider` + `getSupportedThinkingLevels` / `clampThinkingLevel`, i.e.
 *      what the operator's thinking selector offers and where pi's normal clamp lands.
 *   2. The pure level → effort resolver and the set-effort readback. Our refusals must read as
 *      neither transient nor overflow under pi's real classifiers, so they never invite a replay.
 *   3. The real `streamAcpTurn` pipeline through its `AcpTurnDeps` seam with typed fakes: effort is
 *      set after the model and before the prompt on a new session, set again on a reused session
 *      only when it changes (keeping the conversation), and a refusal reaches no prompt.
 *
 * Module state is sandboxed as in backend.vendor-rejection.test.ts: HOME/XDG/PI_CODING_AGENT_DIR
 * point into a temp dir BEFORE the dynamic import.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	clampThinkingLevel,
	getSupportedThinkingLevels,
	isContextOverflow,
	isRetryableAssistantError,
	type Message,
	type Model,
	normalizeContext,
	type TranscriptContext,
	type Usage,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcpConnectionLike, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-thinking-"));
const SANDBOXED_ENV = [
	"HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
	"PI_CODING_AGENT_DIR",
	"PI_SESSION_ID",
	"PI_AGENT_ID",
	"CLAUDE_AGENT_ACP_COMMAND",
	"PI_EMACS_AGENT_SOCKET",
] as const;
const savedEnv = new Map<string, string | undefined>();

let backend: typeof import("./backend.ts");
let adapters: typeof import("./backend-adapter.ts");
let models: typeof import("./models.ts");
let config: typeof import("./config.ts");

beforeAll(async () => {
	for (const key of SANDBOXED_ENV) savedEnv.set(key, process.env[key]);
	const home = join(SANDBOX, "home");
	mkdirSync(home, { recursive: true });
	process.env.HOME = home;
	process.env.XDG_CONFIG_HOME = join(SANDBOX, "xdg-config");
	process.env.XDG_DATA_HOME = join(SANDBOX, "xdg-data");
	process.env.XDG_STATE_HOME = join(SANDBOX, "xdg-state");
	process.env.XDG_CACHE_HOME = join(SANDBOX, "xdg-cache");
	process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
	delete process.env.PI_SESSION_ID;
	delete process.env.PI_AGENT_ID;
	delete process.env.CLAUDE_AGENT_ACP_COMMAND;
	delete process.env.PI_EMACS_AGENT_SOCKET;
	backend = await import("./backend.ts");
	adapters = await import("./backend-adapter.ts");
	models = await import("./models.ts");
	config = await import("./config.ts");
});

afterAll(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(SANDBOX, { recursive: true, force: true });
});

const ALL_EFFORT = ["low", "medium", "high", "xhigh", "max"];

/** A sealed error message as pi's classifiers see it. */
function errorProbe(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "entwurf",
		provider: "entwurf",
		model: "claude-sonnet-5-5",
		usage: ZERO_USAGE,
		stopReason: "error",
		errorMessage,
		timestamp: 0,
	};
}

function assertNoReplay(errorMessage: string): void {
	expect(isRetryableAssistantError(errorProbe(errorMessage))).toBe(false);
	expect(isContextOverflow(errorProbe(errorMessage), 200_000)).toBe(false);
}

function thrown(fn: () => unknown): Error {
	try {
		fn();
	} catch (err) {
		return err as Error;
	}
	throw new Error("expected a throw");
}

async function rejected(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (err) {
		return err as Error;
	}
	throw new Error("expected a rejection");
}

describe("curated Claude rows — pi's own thinking menu (#142)", () => {
	it("[QK:ACP-CLAUDE-THINKING-MENU] every curated row, registered through pi's ModelRuntime, offers low..max and pi's clamp lands off/minimal on low", async () => {
		const runtime = await ModelRuntime.create({
			authPath: join(SANDBOX, "oracle-auth.json"),
			modelsPath: null,
			modelsStorePath: join(SANDBOX, "oracle-models-store.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const rows = models.curatedClaudeModels();
		expect(rows.map((r) => r.id).sort()).toEqual(
			["claude-fable-5-1", "claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"].sort(),
		);
		runtime.registerProvider("acp-thinking-oracle", {
			baseUrl: "x",
			apiKey: "x",
			api: "acp-thinking-oracle",
			streamSimple: () => {
				throw new Error("the oracle never streams");
			},
			models: rows,
		});
		for (const row of rows) {
			const registered = runtime.getModel("acp-thinking-oracle", row.id);
			expect(registered, row.id).toBeDefined();
			if (!registered) continue;
			expect(getSupportedThinkingLevels(registered), row.id).toEqual(ALL_EFFORT);
			// pi's normal clamp — the UI path — never reaches the refusal below.
			expect(clampThinkingLevel(registered, "off"), row.id).toBe("low");
			expect(clampThinkingLevel(registered, "minimal"), row.id).toBe("low");
		}
	});

	it("keeps a level the registry marks unsupported, and hides xhigh/max the registry does not map", () => {
		expect(models.claudeAcpThinkingLevelMap({ high: null, xhigh: "xhigh" })).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: null,
			xhigh: "xhigh",
			max: null,
		});
		expect(models.claudeAcpThinkingLevelMap(undefined)).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		});
	});
});

describe("level → effort resolution and readback (#142)", () => {
	it("each supported level resolves to the effort value of the same name", () => {
		const map = models.claudeAcpThinkingLevelMap({ xhigh: "xhigh", max: "max" });
		for (const level of ALL_EFFORT) {
			expect(adapters.resolveClaudeEffort("claude-opus-5-5", level, map)).toBe(level);
		}
	});

	it("[QK:ACP-CLAUDE-THINKING-REFUSE-UNMAPPED] no level, an unsupported level and a non-effort map value refuse by name, as neither transient nor overflow", () => {
		const map = models.claudeAcpThinkingLevelMap({ xhigh: "xhigh", max: "max" });
		const cells: Array<{ label: string; reasoning: string | undefined; map: Record<string, string | null> }> = [
			{ label: "no level (off or unset)", reasoning: undefined, map },
			{ label: "minimal", reasoning: "minimal", map },
			{ label: "a map value that is not an effort", reasoning: "high", map: { ...map, high: "default" } },
		];
		for (const cell of cells) {
			const err = thrown(() => adapters.resolveClaudeEffort("claude-opus-5-5", cell.reasoning, cell.map));
			expect(err.message, cell.label).toContain(adapters.ACP_THINKING_LEVEL_UNSUPPORTED);
			expect(err.message, cell.label).toContain("the turn was not sent");
			assertNoReplay(err.message);
		}
		const none = thrown(() => adapters.resolveClaudeEffort("claude-opus-5-5", undefined, map));
		expect(none.message).toContain("indistinguishable");
	});

	it("[QK:ACP-CLAUDE-EFFORT-READBACK] the claude adapter sets `effort` and refuses an answer that does not read it back", async () => {
		const calls: unknown[] = [];
		const connection = (answer: (value: string) => unknown): AcpConnectionLike => ({
			initialize: async () => ({}),
			newSession: async () => ({}),
			prompt: async () => ({ stopReason: "end_turn" }),
			setSessionConfigOption: async (params: any) => {
				calls.push(params);
				return answer(params.value);
			},
		});
		const enforce = adapters.claudeAdapter.enforceThinking;
		expect(enforce).toBeDefined();
		if (!enforce) return;

		await enforce({
			connection: connection((value) => ({ configOptions: [{ id: "effort", currentValue: value }] })),
			acpSessionId: "S",
			modelId: "claude-opus-5-5",
			value: "high",
		});
		expect(calls).toEqual([{ sessionId: "S", configId: "effort", value: "high" }]);

		const answers: Array<{ label: string; answer: unknown }> = [
			{ label: "another value", answer: { configOptions: [{ id: "effort", currentValue: "default" }] } },
			{ label: "no effort option", answer: { configOptions: [{ id: "model", currentValue: "x" }] } },
			{ label: "no configOptions", answer: {} },
		];
		for (const cell of answers) {
			const err = await rejected(
				enforce({
					connection: connection(() => cell.answer),
					acpSessionId: "S",
					modelId: "claude-opus-5-5",
					value: "high",
				}),
			);
			expect(err.message, cell.label).toContain('effort "high"');
			assertNoReplay(err.message);
		}

		// The vendor's own refusal is wrapped by name and kept as the cause, never as the message.
		const vendor = new RequestError(-32602, "Invalid params");
		const err = await rejected(
			enforce({
				connection: {
					...connection(() => ({})),
					setSessionConfigOption: async () => {
						throw vendor;
					},
				},
				acpSessionId: "S",
				modelId: "claude-opus-5-5",
				value: "high",
			}),
		);
		expect(err.message).toContain("refused the set");
		expect((err as Error & { cause?: unknown }).cause).toBe(vendor);
		assertNoReplay(err.message);
	});

	it("cortex declares no thinking capability, so its turns keep their old behaviour", () => {
		expect(adapters.cortexAdapter.resolveThinking).toBeUndefined();
		expect(adapters.cortexAdapter.enforceThinking).toBeUndefined();
		for (const row of models.curatedCortexModels()) {
			expect((row as { thinkingLevelMap?: unknown }).thinkingLevelMap, row.id).toBeUndefined();
		}
	});
});

// --- the real turn pipeline -----------------------------------------------------------------

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const PI_TOOLS = ["read", "bash", "edit", "write"].map((name) => ({
	name,
	description: "",
	parameters: obj({}, { open: true }),
}));

function sonnet(): Model<Api> {
	const row = models.curatedClaudeModels().find((r) => r.id === "claude-sonnet-5-5");
	if (!row) throw new Error("claude-sonnet-5-5 is not curated");
	return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
}

function transcript(...userTurns: string[]): TranscriptContext {
	const messages: Message[] = [];
	userTurns.forEach((text, i) => {
		messages.push({ role: "user", content: text, timestamp: i });
		if (i < userTurns.length - 1) {
			messages.push({
				role: "assistant",
				content: [{ type: "text", text: `reply ${i}` }],
				api: "entwurf",
				provider: "entwurf",
				model: "claude-sonnet-5-5",
				usage: ZERO_USAGE,
				stopReason: "stop",
				timestamp: i,
			});
		}
	});
	return normalizeContext({ tools: PI_TOOLS, messages });
}

function makeFakeChild(): AcpChildLike {
	const pipe = () => ({ destroy() {}, unref() {} });
	return {
		pid: undefined,
		exitCode: null,
		signalCode: null,
		stdin: pipe(),
		stdout: pipe(),
		stderr: { on() {}, destroy() {}, unref() {} },
		kill: () => true,
		unref() {},
		once() {},
	};
}

/** One backend world. `log` records every wire call in order: `set:<configId>=<value>` and `prompt`. */
function makeWorld(effortAnswer: (value: string) => string = (value) => value) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: AcpChildLike[] = [];
	const log: string[] = [];
	const deps: AcpTurnDeps = {
		spawnChild: () => {
			const child = makeFakeChild();
			children.push(child);
			return child;
		},
		createConnection: () => ({
			initialize: async () => ({}),
			newSession: async () => ({ sessionId: `ACP-${children.length}` }),
			setSessionConfigOption: async (p: any) => {
				log.push(`set:${p.configId}=${p.value}`);
				return p.configId === "effort"
					? { configOptions: [{ id: "effort", currentValue: effortAnswer(p.value) }] }
					: { configOptions: [{ id: "model", currentValue: p.value }] };
			},
			prompt: async (): Promise<AcpPromptResponse> => {
				log.push("prompt");
				return { stopReason: "end_turn" };
			},
			cancel: () => {},
			close: () => {},
		}),
		lifecyclePolicy: () => "process-scoped",
		loadConfig: (cwd, modelId, adapter) =>
			config.resolveProviderConfig({
				cwd,
				modelId,
				adapter,
				globalSettingsPath: join(SANDBOX, "absent-global-settings.json"),
				projectSettingsPath: join(SANDBOX, "absent-project-settings.json"),
			}),
		now: () => "2026-11-13T00:00:00Z",
		sessionDir,
		abortGraceMs: 40,
	};
	return { deps, children, log };
}

async function runTurn(
	world: ReturnType<typeof makeWorld>,
	context: TranscriptContext,
	sessionId: string,
	reasoning: string | undefined,
): Promise<AssistantMessageEvent> {
	const events: AssistantMessageEvent[] = [];
	const opts = { sessionId, reasoning } as Parameters<typeof backend.streamAcpTurn>[2];
	for await (const event of backend.streamAcpTurn(sonnet(), context, opts, world.deps)) events.push(event);
	const sealed = events.filter((e) => e.type === "done" || e.type === "error");
	expect(sealed).toHaveLength(1);
	return sealed[0];
}

/** The lifecycle notices a turn showed the operator, in order. */
async function noticesOf(
	world: ReturnType<typeof makeWorld>,
	context: TranscriptContext,
	sessionId: string,
	reasoning: string,
): Promise<string> {
	let text = "";
	const opts = { sessionId, reasoning } as Parameters<typeof backend.streamAcpTurn>[2];
	for await (const event of backend.streamAcpTurn(sonnet(), context, opts, world.deps)) {
		if (event.type === "text_delta") text += event.delta;
	}
	return text;
}

function errorText(event: AssistantMessageEvent): string {
	if (event.type !== "error") throw new Error(`expected an error seal, got ${event.type}`);
	return event.error.errorMessage ?? "";
}

describe("streamAcpTurn — effort on the live session (#142)", () => {
	it("[QK:ACP-THINKING-NEW-SET] a new session sets the model, then the effort, then prompts", async () => {
		const world = makeWorld();
		const sealed = await runTurn(world, transcript("go"), "th-new", "high");
		expect(sealed.type).toBe("done");
		expect(world.log).toEqual(["set:model=claude-sonnet-5-5", "set:effort=high", "prompt"]);
	});

	it("[QK:ACP-THINKING-READBACK-NOTICE] the operator sees the effort the driver read back: on a new session, and on reuse only when it changed", async () => {
		const world = makeWorld();
		const first = await noticesOf(world, transcript("first"), "th-notice", "high");
		const same = await noticesOf(world, transcript("first", "second"), "th-notice", "high");
		const changed = await noticesOf(world, transcript("first", "second", "third"), "th-notice", "max");
		expect(first).toContain("[acp: effort high read back]");
		expect(first.indexOf("[acp: effort high read back]")).toBeLessThan(first.indexOf("[acp: session ready"));
		expect(same).not.toContain("[acp: effort");
		expect(changed).toContain("[acp: effort max read back]");
		expect(changed.indexOf("[acp: effort max read back]")).toBeLessThan(changed.indexOf("[acp: sending prompt]"));
	});

	it("a refused effort answer shows no read-back notice", async () => {
		const world = makeWorld(() => "default");
		const text = await noticesOf(world, transcript("go"), "th-notice-refused", "high");
		expect(text).not.toContain("[acp: effort");
	});

	it("[QK:ACP-THINKING-REUSE-SET] a reused session keeps its conversation: the same level sets nothing, a changed level is set before the prompt", async () => {
		const world = makeWorld();
		await runTurn(world, transcript("first"), "th-reuse", "high");
		await runTurn(world, transcript("first", "second"), "th-reuse", "high");
		await runTurn(world, transcript("first", "second", "third"), "th-reuse", "low");
		expect(world.children).toHaveLength(1);
		expect(world.log).toEqual([
			"set:model=claude-sonnet-5-5",
			"set:effort=high",
			"prompt",
			"prompt",
			"set:effort=low",
			"prompt",
		]);
	});

	it("a mismatched effort answer fails before the prompt; our text (empty stderr tail) reads as neither transient nor overflow", async () => {
		const world = makeWorld(() => "default");
		const sealed = await runTurn(world, transcript("go"), "th-mismatch", "high");
		expect(world.log).toEqual(["set:model=claude-sonnet-5-5", "set:effort=high"]);
		assertNoReplay(errorText(sealed));
	});

	it("a mismatched answer on reuse fails before the prompt and drops the session", async () => {
		let answer = (value: string) => value;
		const world = makeWorld((value) => answer(value));
		await runTurn(world, transcript("first"), "th-reuse-mismatch", "high");
		answer = () => "default";
		const sealed = await runTurn(world, transcript("first", "second"), "th-reuse-mismatch", "low");
		expect(world.log.at(-1)).toBe("set:effort=low");
		assertNoReplay(errorText(sealed));
		answer = (value) => value;
		await runTurn(world, transcript("first", "second", "third"), "th-reuse-mismatch", "low");
		expect(world.children).toHaveLength(2);
	});

	it("no thinking level refuses by name before any process starts", async () => {
		const world = makeWorld();
		const sealed = await runTurn(world, transcript("go"), "th-none", undefined);
		expect(world.children).toHaveLength(0);
		expect(world.log).toEqual([]);
		expect(errorText(sealed)).toContain(adapters.ACP_THINKING_LEVEL_UNSUPPORTED);
		assertNoReplay(errorText(sealed));
	});
});
