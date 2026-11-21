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

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	isRecoverableLength,
	isRetryableAssistantError,
	type Message,
	type Model,
	normalizeContext,
	type TranscriptContext,
	type Usage,
} from "@earendil-works/pi-ai";
import { convertToLlm, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
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
let store: typeof import("./session-store.ts");

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
	store = await import("./session-store.ts");
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

describe("curated row order — pi's default model when no other auth exists", () => {
	it("[QK:ACP-ROWS-ANCHOR-FIRST] the first registered row is claude-opus-5-5, the other Claude rows follow, and the agy rows come after them", () => {
		// With no other auth pi takes the first row of the entwurf provider as its default model, so the
		// order is an operator-visible fact. The literal is the decision (opus first), not a copy of the code.
		expect(adapters.allCuratedModels().map((r) => r.id)).toEqual([
			"claude-opus-5-5",
			"claude-sonnet-5-5",
			"claude-fable-5-2",
			"agy-gemini-4-hydrogen",
			"agy-gemini-4-argon",
			"agy-gemini-3.8-flash",
		]);
	});
});

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
		expect(rows.map((r) => r.id).sort()).toEqual(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"].sort());
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

	it("disabled Cortex exposes no models or thinking capability", () => {
		expect(adapters.cortexAdapter.resolveThinking).toBeUndefined();
		expect(adapters.cortexAdapter.enforceThinking).toBeUndefined();
		expect(models.curatedCortexModels()).toEqual([]);
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

function makeFakeChild(events: string[] = []): AcpChildLike {
	const pipe = () => ({ destroy() {}, unref() {} });
	return {
		pid: undefined,
		exitCode: null,
		signalCode: null,
		stdin: pipe(),
		stdout: pipe(),
		stderr: { on() {}, destroy() {}, unref() {} },
		kill: (signal) => {
			events.push(`kill:${signal}`);
			return true;
		},
		unref() {},
		once() {},
	};
}

/** One backend world. `log` records every wire call in order: `set:<configId>=<value>` and `prompt`. */
function makeWorld(
	effortAnswer: (value: string) => string = (value) => value,
	effortGate?: { hold: boolean; waiting?: () => void; release?: () => void },
	promptGate?: { hold: boolean; waiting?: () => void },
) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: AcpChildLike[] = [];
	const log: string[] = [];
	const wire: string[] = [];
	const lifecycle: string[] = [];
	const prompts: Array<{ sessionId: string; text: string; blocks: string[] }> = [];
	let pendingPrompt: (() => void) | undefined;
	// The connection handlers the backend registered — the producer side of session/update.
	let handlers: Parameters<AcpTurnDeps["createConnection"]>[1] | undefined;
	const hooks: {
		onPrompt?: () => void | Promise<void>;
		stopReason?: AcpPromptResponse["stopReason"];
		/** Extra fields of each child's initialize answer, beside its agentInfo. */
		initialize?: Record<string, unknown>;
	} = {};
	// #168: these worlds take the bundled launches; an ambient operator override is cleared for this test and restored after it.
	for (const name of ["CLAUDE_AGENT_ACP_COMMAND", "AGY_ACP_COMMAND"]) {
		const ambient = process.env[name];
		if (ambient === undefined) continue;
		delete process.env[name];
		onTestFinished(() => {
			process.env[name] = ambient;
		});
	}
	// #168: each child answers initialize as the server its launch names; an unknown launch fails the world.
	const agentFor = (launch: { command: string }) =>
		launch.command === "agy"
			? adapters.AGY_ACP_AGENT
			: launch.command === process.execPath
				? adapters.CLAUDE_ACP_AGENT
				: (() => {
						throw new Error(`test world: unexpected ACP launch ${launch.command}`);
					})();
	const agentOf = new Map<unknown, Readonly<{ name: string; floor: string }>>();
	const deps: AcpTurnDeps = {
		spawnChild: (launch) => {
			const child = makeFakeChild(lifecycle);
			children.push(child);
			agentOf.set(child, agentFor(launch));
			return child;
		},
		createConnection: (child, registered) => {
			handlers = registered;
			return {
				initialize: async () => {
					wire.push("initialize");
					return {
						...hooks.initialize,
						agentInfo: { name: agentOf.get(child)?.name, version: agentOf.get(child)?.floor },
					};
				},
				newSession: async () => {
					wire.push("new");
					return { sessionId: `ACP-${children.length}` };
				},
				setSessionConfigOption: async (p: any) => {
					log.push(`set:${p.configId}=${p.value}`);
					// A driver that never answers the effort set — the window an abort can land in.
					if (p.configId === "effort" && effortGate?.hold) {
						// Unanswered unless the test releases it; the answer then echoes the requested value.
						return new Promise((resolve) => {
							effortGate.release = () => resolve({ configOptions: [{ id: "effort", currentValue: p.value }] });
							effortGate.waiting?.();
						});
					}
					return p.configId === "effort"
						? { configOptions: [{ id: "effort", currentValue: effortAnswer(p.value) }] }
						: { configOptions: [{ id: "model", currentValue: p.value }] };
				},
				prompt: async (p): Promise<AcpPromptResponse> => {
					const blocks = p.prompt.map((b) => ("text" in b ? b.text : ""));
					prompts.push({ sessionId: p.sessionId, text: blocks.join("\n"), blocks });
					log.push("prompt");
					wire.push("prompt");
					if (promptGate?.hold) {
						// A running turn that the agent ends itself once it receives session/cancel.
						return new Promise((resolve) => {
							pendingPrompt = () => resolve({ stopReason: "cancelled" });
							promptGate.waiting?.();
						});
					}
					await hooks.onPrompt?.();
					return { stopReason: hooks.stopReason ?? "end_turn" };
				},
				cancel: () => {
					log.push("cancel");
					pendingPrompt?.();
					pendingPrompt = undefined;
				},
				close: () => {
					lifecycle.push("close");
				},
			};
		},
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
	/** The agent speaks on the live session, whoever the backend currently routes that to. */
	const agentSays = (update: Record<string, unknown>) =>
		void handlers?.sessionUpdate({ sessionId: `ACP-${children.length}`, update } as never);
	const requestPermission = (req: Parameters<NonNullable<typeof handlers>["requestPermission"]>[0]) => {
		if (!handlers) throw new Error("connection handlers not registered");
		return handlers.requestPermission(req);
	};
	return { deps, children, log, wire, lifecycle, prompts, agentSays, hooks, requestPermission };
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

async function reuseAbortDuringEffort(sessionId: string, deferAbort: boolean): Promise<void> {
	const gate: { hold: boolean; waiting?: () => void } = { hold: false };
	const world = makeWorld(undefined, gate);
	await runTurn(world, transcript("first"), sessionId, "high");
	const controller = new AbortController();
	gate.hold = true;
	// The operator presses ESC while the driver has not answered the effort set yet.
	// Already aborted when the effort wait begins, or (deferred) an abort that arrives while it waits.
	gate.waiting = deferAbort ? () => void setTimeout(() => controller.abort(), 0) : () => controller.abort();
	const started = Date.now();
	const events: AssistantMessageEvent[] = [];
	const opts = { sessionId: sessionId, reasoning: "low", signal: controller.signal } as Parameters<
		typeof backend.streamAcpTurn
	>[2];
	let shown = "";
	for await (const event of backend.streamAcpTurn(sonnet(), transcript("first", "second"), opts, world.deps)) {
		events.push(event);
		if (event.type === "text_delta") shown += event.delta;
	}
	const settledMs = Date.now() - started;
	expect(shown).toContain(`[acp: ${backend.ACP_CANCEL_CLOSED_NOTICE}]`);
	const sealed = events.filter((e) => e.type === "done" || e.type === "error");
	expect(sealed).toHaveLength(1);
	expect(sealed[0].type === "error" && sealed[0].reason).toBe("aborted");
	// Bounded by the abort, not by the 30s bootstrap timeout.
	expect(settledMs).toBeLessThan(2_000);
	expect(world.log).toEqual(["set:model=claude-sonnet-5-5", "set:effort=high", "prompt", "set:effort=low"]);
	// The effort the driver holds is unknown, so the session is not reused.
	gate.hold = false;
	await runTurn(world, transcript("first", "second", "third"), sessionId, "low");
	expect(world.children).toHaveLength(2);
	expect(world.log.slice(4)).toEqual(["set:model=claude-sonnet-5-5", "set:effort=low", "prompt"]);
}

describe("streamAcpTurn — disabled Cortex configuration", () => {
	it("[QK:ACP-CORTEX-TURN-DISABLED] refuses a retired model before spawning a child", async () => {
		const world = makeWorld();
		const events: AssistantMessageEvent[] = [];
		const retired = { ...sonnet(), id: "cortex-auto" };
		for await (const event of backend.streamAcpTurn(
			retired,
			transcript("hello"),
			{ sessionId: "retired", reasoning: "low" },
			world.deps,
		))
			events.push(event);
		const sealed = events.find((event) => event.type === "error");
		expect(sealed && errorText(sealed)).toContain("cortex-acp-disabled");
		expect(world.children).toHaveLength(0);
	});

	it("[QK:ACP-CORTEX-CONFIG-DISABLED] rejects an explicitly selected Cortex backend before spawn while an inert legacy connection leaves Claude usable", async () => {
		const path = join(SANDBOX, "legacy-cortex-settings.json");
		const world = makeWorld();
		world.deps.loadConfig = (cwd, modelId, adapter) =>
			config.resolveProviderConfig({
				cwd,
				modelId,
				adapter,
				globalSettingsPath: path,
				projectSettingsPath: join(SANDBOX, "absent-cortex-project.json"),
			});
		writeFileSync(path, JSON.stringify({ entwurfProvider: { backend: "cortex", cortexConnection: "fixture" } }));
		const refused = await runTurn(world, transcript("hello"), "config-refused", "low");
		expect(errorText(refused)).toContain("cortex-acp-disabled");
		expect(world.children).toHaveLength(0);
		writeFileSync(path, JSON.stringify({ entwurfProvider: { cortexConnection: "fixture" } }));
		const accepted = await runTurn(world, transcript("hello"), "config-claude", "low");
		expect(accepted.type).toBe("done");
		expect(world.children).toHaveLength(1);
	});
});

describe("ACP initialize facts kept per child (#171 L1)", () => {
	it("[QK:ACP-L1-FACTS-STORED] the facts a child answered initialize with are kept for its session, and a reuse turn keeps the same ones", async () => {
		const world = makeWorld();
		world.hooks.initialize = {
			agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, fork: null } },
			authMethods: [{ id: "method-l1" }],
		};
		await runTurn(world, transcript("FACTS-ONE"), "facts-l1", "high");
		const facts = backend.readAcpAgentFacts("facts-l1");
		expect(facts).toEqual({
			agent: { name: adapters.CLAUDE_ACP_AGENT.name, version: adapters.CLAUDE_ACP_AGENT.floor },
			loadSession: true,
			sessionCapabilities: ["close", "resume"],
			authMethods: ["method-l1"],
		});
		await runTurn(world, transcript("FACTS-ONE", "FACTS-TWO"), "facts-l1", "high");
		expect(world.children).toHaveLength(1);
		expect(world.wire.filter((call) => call === "initialize")).toHaveLength(1);
		expect(backend.readAcpAgentFacts("facts-l1")).toBe(facts);
	});
});

describe("ACP reuse projected multi-user wire (#171)", () => {
	async function trailingUsers(id: string, first: string, second: string): Promise<void> {
		const world = makeWorld();
		await runTurn(world, transcript("seed"), id, "high");
		const base = transcript("seed", first);
		const context: TranscriptContext = {
			...base,
			messages: [
				...base.messages,
				{ role: "user", content: "  ", timestamp: 3 },
				{ role: "user", content: second, timestamp: 4 },
			],
		};
		const result = await runTurn(world, context, id, "high");
		expect(result.type).toBe("done");
		expect(world.children).toHaveLength(1);
		expect(world.prompts[1].sessionId).toBe(world.prompts[0].sessionId);
		expect(world.prompts[1].blocks).toEqual([first, second]);
	}
	it("[QK:ACP-DELTA-STEER-ALL] forwards both queued steer messages in order", async () => {
		await trailingUsers("delta-steer", "STEER-A-q7", "STEER-B-q7");
	});
	it("[QK:ACP-DELTA-FOLLOWUP-ALL] forwards both queued follow-up messages in order", async () => {
		await trailingUsers("delta-followup", "FOLLOW-A-q7", "FOLLOW-B-q7");
	});
	it("[QK:ACP-DELTA-BASH-NEXT] forwards bash output and the following human prompt", async () => {
		await trailingUsers("delta-bash", "Ran `echo BASH-OUTPUT`", "NEXT-U11-bash");
	});
	it("[QK:ACP-DELTA-MAX-TOKENS] after Pi omits a length-cut answer, the next prompt reaches the vendor and the cut prompt is sent again", async () => {
		const world = makeWorld();
		await runTurn(world, transcript("seed"), "delta-length", "high");
		world.hooks.stopReason = "max_tokens";
		const cut = await runTurn(world, transcript("seed", "BRAVO-q72"), "delta-length", "high");
		world.hooks.stopReason = "end_turn";
		if (cut.type !== "done") throw new Error(`length cut sealed as ${cut.type}`);
		expect(cut.reason).toBe("length");
		// Pi 1.5.2 treats this answer as a recoverable length stop (zero usage: output 0 < maxTokens,
		// pi-ai utils/overflow.js:177-178) and persists a context_edit with a null replacement for it
		// (agent-session.js:2533, :2564, :924). That edit, not the message projection, removes it:
		// convertToLlm keeps a length-stopped assistant.
		expect(isRecoverableLength(cut.message, sonnet().maxTokens)).toBe(true);
		const session = SessionManager.inMemory();
		for (const message of transcript("seed", "BRAVO-q72").messages) {
			if (message.role !== "system") session.appendMessage(message);
		}
		const cutId = session.appendMessage(cut.message);
		const project = () =>
			normalizeContext({ tools: PI_TOOLS, messages: convertToLlm(session.buildSessionContext().messages) });
		expect(project().messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "length" });
		session.appendContextEdit(cutId, null);
		session.appendMessage({ role: "user", content: "NEXT-U12-max-tokens", timestamp: 4 });
		const context = project();
		expect(context.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "user"]);
		await runTurn(world, context, "delta-length", "high");
		expect(world.children).toHaveLength(1);
		expect(world.prompts[2].sessionId).toBe(world.prompts[0].sessionId);
		expect(world.prompts[2].blocks).toEqual(["BRAVO-q72", "NEXT-U12-max-tokens"]);
	});
});

describe("ACP baseline — implemented wire rows (#171)", () => {
	async function assertDegraded(reuse: boolean): Promise<void> {
		const world = makeWorld();
		const badDir = join(SANDBOX, `l15-not-directory-${reuse}`);
		writeFileSync(badDir, "keep");
		const sessionId = `oracle-l15-${reuse}`;
		if (reuse) await runTurn(world, transcript("first"), sessionId, "high");
		// #171 L16: only the sealing write fails. The marker before the prompt must land, or the turn is
		// refused with nothing sent (decision 9); decision 3 governs the write after the answer.
		const recordDir = world.deps.sessionDir;
		world.hooks.onPrompt = () => {
			world.deps.sessionDir = badDir;
		};
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			const events: AssistantMessageEvent[] = [];
			for await (const event of backend.streamAcpTurn(
				sonnet(),
				reuse ? transcript("first", "second") : transcript("first"),
				{ sessionId, reasoning: "high" },
				world.deps,
			))
				events.push(event);
			expect(events.filter((e) => e.type === "done")).toHaveLength(1);
			expect(events.filter((e) => e.type === "error")).toHaveLength(0);
			expect(
				events
					.filter((e) => e.type === "text_delta")
					.map((e) => (e.type === "text_delta" ? e.delta : ""))
					.join(""),
			).toContain("session record not saved");
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("code=EEXIST"));
			expect(world.children).toHaveLength(1);
			// The clear failed, so this turn's marker still stands: a reconnect would stop once on it.
			const left = store.readSessionRecord(`pi:${sessionId}`, recordDir);
			expect(left.status === "found" && left.record.pendingDispatch).toMatchObject({ count: reuse ? 1 : 2 });
		} finally {
			stderr.mockRestore();
		}
	}

	it("[QK:ACP-ORACLE-L15-DEGRADED-NEW] a new turn visibly reports failed persistence and completes", async () => {
		await assertDegraded(false);
	});
	it("[QK:ACP-ORACLE-L15-DEGRADED-REUSE] a reuse turn visibly reports failed persistence and completes", async () => {
		await assertDegraded(true);
	});

	it("[QK:ACP-ORACLE-L3-NEW] initializes before one new session and one prompt", async () => {
		const world = makeWorld();
		const result = await runTurn(world, transcript("baseline"), "oracle-l3", "high");
		expect(result.type).toBe("done");
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
	});

	it("[QK:ACP-ORACLE-L4-PROMPT] maps a backend text update and seals its terminal response once", async () => {
		const world = makeWorld();
		world.hooks.onPrompt = () =>
			world.agentSays({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "oracle chunk" } });
		const events: AssistantMessageEvent[] = [];
		for await (const event of backend.streamAcpTurn(
			sonnet(),
			transcript("go"),
			{ sessionId: "oracle-l4", reasoning: "high" },
			world.deps,
		))
			events.push(event);
		expect(
			events
				.filter((e) => e.type === "text_delta")
				.map((e) => (e.type === "text_delta" ? e.delta : ""))
				.join(""),
		).toContain("oracle chunk");
		expect(events.filter((e) => e.type === "done")).toHaveLength(1);
		expect(world.prompts).toHaveLength(1);
	});

	it("[QK:ACP-ORACLE-L5-REUSE] keeps the session and sends only the new user delta", async () => {
		const world = makeWorld();
		await runTurn(world, transcript("FIRST-ORACLE"), "oracle-l5", "high");
		await runTurn(world, transcript("FIRST-ORACLE", "SECOND-ORACLE"), "oracle-l5", "high");
		expect(world.wire).toEqual(["initialize", "new", "prompt", "prompt"]);
		expect(world.prompts.map((p) => p.sessionId)).toEqual(["ACP-1", "ACP-1"]);
		expect(world.prompts[1].text).toContain("SECOND-ORACLE");
		expect(world.prompts[1].text).not.toContain("FIRST-ORACLE");
	});

	it("[QK:ACP-ORACLE-L6-CANCEL] cancels the running prompt once without replay", async () => {
		const gate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, undefined, gate);
		await runTurn(world, transcript("first"), "oracle-l6", "high");
		const { sealed } = await abortedTurn(world, gate, transcript("first", "second"), "oracle-l6");
		expect(sealed.type === "error" && sealed.reason).toBe("aborted");
		expect(world.log.filter((item) => item === "cancel")).toHaveLength(1);
		expect(world.prompts).toHaveLength(2);
	});

	it("[QK:ACP-ORACLE-L13-TEARDOWN] closes the connection before TERM and delayed KILL", async () => {
		const world = makeWorld();
		await runTurn(world, transcript("go"), "oracle-l13", "high");
		const dead = makeWorld();
		await runTurn(dead, transcript("go"), "oracle-l13-dead", "high");
		Object.assign(dead.children[0], { exitCode: 0 });
		vi.useFakeTimers();
		try {
			expect(backend.closeRetainedAcpSession("oracle-l13")).toBe(true);
			expect(world.lifecycle).toEqual(["close", "kill:SIGTERM"]);
			await vi.advanceTimersByTimeAsync(2_000);
			expect(world.lifecycle).toEqual(["close", "kill:SIGTERM", "kill:SIGKILL"]);
			expect(backend.closeRetainedAcpSession("oracle-l13-dead")).toBe(true);
			await vi.advanceTimersByTimeAsync(2_000);
			expect(dead.lifecycle).toEqual(["close"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("[QK:ACP-ORACLE-L13-PROCESS-GROUP] signals the negative child pid, not only the direct process", async () => {
		const world = makeWorld();
		await runTurn(world, transcript("go"), "oracle-l13-group", "high");
		Object.assign(world.children[0], { pid: 424242 });
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		vi.useFakeTimers();
		try {
			expect(backend.closeRetainedAcpSession("oracle-l13-group")).toBe(true);
			expect(kill).toHaveBeenCalledWith(-424242, "SIGTERM");
			await vi.advanceTimersByTimeAsync(2_000);
			expect(kill).toHaveBeenCalledWith(-424242, "SIGKILL");
		} finally {
			vi.useRealTimers();
			kill.mockRestore();
		}
	});

	it("[QK:ACP-ORACLE-L12-PERMISSION] chooses the first allow, otherwise first option, and cancels empty options", async () => {
		const world = makeWorld();
		const outcomes: unknown[] = [];
		world.hooks.onPrompt = async () => {
			for (const options of [
				[
					{ optionId: "deny", kind: "reject_once" },
					{ optionId: "allow", kind: "allow_always" },
				],
				[
					{ optionId: "deny-once", kind: "reject_once" },
					{ optionId: "allow-once", kind: "allow_once" },
				],
				[
					{ optionId: "first", kind: "reject_once" },
					{ optionId: "second", kind: "reject_always" },
				],
				[{ optionId: "unknown", kind: "vendor_unknown" }],
				[],
			])
				outcomes.push(await world.requestPermission({ options } as never));
		};
		const result = await runTurn(world, transcript("permission"), "oracle-l12", "high");
		expect(result.type).toBe("done");
		expect(outcomes).toEqual([
			{ outcome: { outcome: "selected", optionId: "allow" } },
			{ outcome: { outcome: "selected", optionId: "allow-once" } },
			{ outcome: { outcome: "selected", optionId: "first" } },
			{ outcome: { outcome: "selected", optionId: "unknown" } },
			{ outcome: { outcome: "cancelled" } },
		]);
	});
});

describe("the dispatch marker in the record (#171 L16)", () => {
	const keyOf = (sessionId: string) => `pi:${sessionId}`;
	const recordOf = (world: ReturnType<typeof makeWorld>, sessionId: string) =>
		store.readSessionRecord(keyOf(sessionId), world.deps.sessionDir);
	/** A record an earlier process left behind, at a session id no fake child mints. */
	function leaveRecord(
		world: ReturnType<typeof makeWorld>,
		sessionId: string,
		context: TranscriptContext,
		pendingDispatch: { start: number; count: number } | null,
	): void {
		const contextMessageSignatures = store.contextMessageSignatures(context);
		store.writeSessionRecord(
			store.buildSessionRecord(
				{
					sessionKey: keyOf(sessionId),
					acpSessionId: "OLD-ACP",
					cwd: process.cwd(),
					modelId: "claude-sonnet-5-5",
					bridgeConfigSignature: "earlier-process",
					contextMessageSignatures,
					pendingDispatch: pendingDispatch && { ...pendingDispatch, contextMessageSignatures },
				},
				"2026-11-21T00:00:00Z",
			),
			world.deps.sessionDir,
		);
	}
	/** One turn's seal and the notices it showed. */
	async function shownTurn(
		world: ReturnType<typeof makeWorld>,
		context: TranscriptContext,
		sessionId: string,
	): Promise<{ sealed: AssistantMessageEvent; shown: string }> {
		let shown = "";
		const sealed: AssistantMessageEvent[] = [];
		const opts = { sessionId, reasoning: "high" } as Parameters<typeof backend.streamAcpTurn>[2];
		for await (const event of backend.streamAcpTurn(sonnet(), context, opts, world.deps)) {
			if (event.type === "text_delta") shown += event.delta;
			if (event.type === "done" || event.type === "error") sealed.push(event);
		}
		expect(sealed).toHaveLength(1);
		return { sealed: sealed[0], shown };
	}
	function quietStderr() {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		onTestFinished(() => stderr.mockRestore());
		return stderr;
	}

	it("[QK:ACP-L16-MARKER-WRITTEN] when the prompt reaches the agent, the record names its range and holds no prompt text", async () => {
		const world = makeWorld();
		const atPrompt: Array<{ read: unknown; bytes: string }> = [];
		world.hooks.onPrompt = () => {
			const path = store.sessionRecordPath(keyOf("l16-mark"), world.deps.sessionDir);
			atPrompt.push({ read: recordOf(world, "l16-mark"), bytes: readFileSync(path, "utf8") });
		};
		const first = transcript("MARK-FIRST");
		const second = transcript("MARK-FIRST", "MARK-SECOND");
		await runTurn(world, first, "l16-mark", "high");
		await runTurn(world, second, "l16-mark", "high");
		expect(second.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
		expect(atPrompt.map((seen) => seen.read)).toMatchObject([
			{
				status: "found",
				record: {
					acpSessionId: "ACP-1",
					pendingDispatch: { start: 0, count: 2, contextMessageSignatures: store.contextMessageSignatures(first) },
				},
			},
			{
				status: "found",
				record: {
					acpSessionId: "ACP-1",
					pendingDispatch: { start: 3, count: 1, contextMessageSignatures: store.contextMessageSignatures(second) },
				},
			},
		]);
		for (const { bytes } of atPrompt) expect(bytes).not.toContain("MARK-");
	});

	it("[QK:ACP-L16-MARKER-CLEARED] the write that seals a turn clears its marker and advances the record", async () => {
		const world = makeWorld();
		const first = transcript("CLEAR-FIRST");
		const second = transcript("CLEAR-FIRST", "CLEAR-SECOND");
		await runTurn(world, first, "l16-clear", "high");
		expect(recordOf(world, "l16-clear")).toMatchObject({
			status: "found",
			record: { contextMessageSignatures: store.contextMessageSignatures(first), pendingDispatch: null },
		});
		await runTurn(world, second, "l16-clear", "high");
		expect(recordOf(world, "l16-clear")).toMatchObject({
			status: "found",
			record: { contextMessageSignatures: store.contextMessageSignatures(second), pendingDispatch: null },
		});
	});

	it("[QK:ACP-L16-WRITE-FAIL-ZERO-SENDS] a marker that cannot be written sends nothing and refuses the turn by name", async () => {
		const stderr = quietStderr();
		const badDir = join(SANDBOX, "l16-not-directory");
		writeFileSync(badDir, "keep");
		// A new session: spawned and opened, never prompted. The store fails after the reconnect read
		// (which found nothing) and before the marker — from the spawn on.
		const fresh = makeWorld();
		const spawn = fresh.deps.spawnChild;
		fresh.deps.spawnChild = (launch, cwd, extraEnv) => {
			fresh.deps.sessionDir = badDir;
			return spawn(launch, cwd, extraEnv);
		};
		const { sealed: refused, shown } = await shownTurn(fresh, transcript("NEVER-SENT"), "l16-writefail-new");
		// The sealed text is fixed; the store's code rides the notice (Pi's classifier reads errorMessage alone).
		expect(errorText(refused)).toBe(backend.ACP_DISPATCH_MARKER_NOT_SAVED);
		expect(shown).toContain("[acp: dispatch marker not saved (code=EEXIST)]");
		assertNoReplay(errorText(refused));
		expect(fresh.wire).toEqual(["initialize", "new"]);
		// A live session: the store fails between turns; the delta is not sent.
		const live = makeWorld();
		await runTurn(live, transcript("LIVE-FIRST"), "l16-writefail-reuse", "high");
		live.deps.sessionDir = badDir;
		const refusedLive = await runTurn(live, transcript("LIVE-FIRST", "NEVER-SENT"), "l16-writefail-reuse", "high");
		expect(errorText(refusedLive)).toBe(backend.ACP_DISPATCH_MARKER_NOT_SAVED);
		assertNoReplay(errorText(refusedLive));
		expect(live.prompts.map((prompt) => prompt.text).join("\n")).not.toContain("NEVER-SENT");
		expect(live.prompts).toHaveLength(1);
		expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("NEVER-SENT"));
		// An errno code can read as transient to Pi's classifier (EAI_AGAIN, ENOTFOUND, measured in #S26), so
		// neither authored refusal ever carries one in its sealed text, whatever the store said.
		const refusals = [
			[backend.ACP_DISPATCH_MARKER_NOT_SAVED, "dispatch marker not saved"],
			[backend.ACP_RECORD_UNREADABLE_MESSAGE, "session record unreadable"],
		] as const;
		for (const code of ["EEXIST", "EAI_AGAIN", "ENOTFOUND"]) {
			for (const [message, what] of refusals) {
				const refusal = backend.acpStoreRefusal(message, what, code);
				expect(refusal.errorMessage).toBe(message);
				assertNoReplay(refusal.errorMessage);
				expect(refusal.notice).toBe(`${what} (code=${code})`);
			}
		}
		for (const code of ["EAI_AGAIN", "ENOTFOUND"]) {
			expect(isRetryableAssistantError(errorProbe(`${backend.ACP_DISPATCH_MARKER_NOT_SAVED} (code=${code})`))).toBe(
				true,
			);
		}
	});

	it("[QK:ACP-L16-STANDING-ZERO-SENDS] a marker found on reconnect sends nothing, to the recorded session or a new one", async () => {
		const stderr = quietStderr();
		const world = makeWorld();
		const before = transcript("RAN-MAYBE", "ALSO-MAYBE");
		leaveRecord(world, "l16-standing", before, { start: 3, count: 1 });
		const { sealed, shown } = await shownTurn(
			world,
			transcript("RAN-MAYBE", "ALSO-MAYBE", "TYPED-NOW"),
			"l16-standing",
		);
		expect(errorText(sealed)).toBe(backend.ACP_DISPATCH_STOP_MESSAGE);
		assertNoReplay(errorText(sealed));
		expect(shown).toContain("[acp: messages [3,4) of 4 may have run]");
		expect(world.children).toHaveLength(0);
		expect(world.wire).toEqual([]);
		expect(world.prompts).toEqual([]);
		// The recorded id is told to the operator's log, never to the model or the classifier.
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("acpSessionId=OLD-ACP"));
		expect(errorText(sealed)).not.toContain("OLD-ACP");
	});

	it("[QK:ACP-L16-STOP-ONCE-THEN-NEW] the stop drops the record, and the next turn starts a new session", async () => {
		quietStderr();
		const world = makeWorld();
		leaveRecord(world, "l16-once", transcript("RAN-MAYBE"), { start: 0, count: 2 });
		const stopped = await shownTurn(world, transcript("RAN-MAYBE", "TYPED-NOW"), "l16-once");
		expect(stopped.sealed.type).toBe("error");
		expect(stopped.shown).toContain(`[acp: ${backend.ACP_RECORD_DROPPED_NOTICE}]`);
		expect(recordOf(world, "l16-once")).toEqual({ status: "missing" });
		const next = await shownTurn(world, transcript("RAN-MAYBE", "TYPED-NOW", "AFTER-STOP"), "l16-once");
		expect(next.sealed.type).toBe("done");
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
		expect(world.prompts.map((prompt) => prompt.sessionId)).toEqual(["ACP-1"]);
	});

	it("[QK:ACP-L16-PROMPT-FAIL-DROPS] a prompt that fails after its marker drops the record, so the next turn is new with no second stop", async () => {
		quietStderr();
		const fail = () => {
			throw new Error("fake agent: the prompt failed");
		};
		// The first prompt of a new session fails.
		const fresh = makeWorld();
		fresh.hooks.onPrompt = fail;
		const cutNew = await shownTurn(fresh, transcript("CUT-NEW"), "l16-fail-new");
		expect(cutNew.sealed.type).toBe("error");
		expect(cutNew.shown).toContain("[acp: messages [0,2) of 2 may have run]");
		expect(cutNew.shown).toContain(`[acp: ${backend.ACP_RECORD_DROPPED_NOTICE}]`);
		expect(recordOf(fresh, "l16-fail-new")).toEqual({ status: "missing" });
		fresh.hooks.onPrompt = undefined;
		expect((await runTurn(fresh, transcript("CUT-NEW", "NEXT"), "l16-fail-new", "high")).type).toBe("done");
		expect(fresh.wire).toEqual(["initialize", "new", "prompt", "initialize", "new", "prompt"]);
		// The prompt on a live session fails.
		const live = makeWorld();
		await runTurn(live, transcript("LIVE"), "l16-fail-reuse", "high");
		live.hooks.onPrompt = fail;
		const cutLive = await shownTurn(live, transcript("LIVE", "CUT-REUSE"), "l16-fail-reuse");
		expect(cutLive.sealed.type).toBe("error");
		expect(cutLive.shown).toContain("[acp: messages [3,4) of 4 may have run]");
		expect(recordOf(live, "l16-fail-reuse")).toEqual({ status: "missing" });
		live.hooks.onPrompt = undefined;
		expect((await runTurn(live, transcript("LIVE", "CUT-REUSE", "NEXT"), "l16-fail-reuse", "high")).type).toBe("done");
		expect(live.wire).toEqual(["initialize", "new", "prompt", "prompt", "initialize", "new", "prompt"]);
	});

	it("[QK:ACP-L16-UNRETAINED-DROPS] a marked turn that seals without keeping its session drops the record", async () => {
		const gate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, undefined, gate);
		const { sealed } = await abortedTurn(world, gate, transcript("CANCELLED-FIRST"), "l16-unretained");
		expect(sealed.type === "error" && sealed.reason).toBe("aborted");
		expect(recordOf(world, "l16-unretained")).toEqual({ status: "missing" });
		const next = await shownTurn(world, transcript("CANCELLED-FIRST", "AFTER"), "l16-unretained");
		expect(next.sealed.type).toBe("done");
		expect(next.shown).not.toContain("may have run");
		expect(world.wire).toEqual(["initialize", "new", "prompt", "initialize", "new", "prompt"]);
		// A teardown that throws after that drop is no second stop: no range is shown for a turn already sealed.
		const closeGate: { hold: boolean; waiting?: () => void } = { hold: false };
		const broken = makeWorld(undefined, undefined, closeGate);
		const create = broken.deps.createConnection;
		let closes = 0;
		broken.deps.createConnection = (child, handlers) => ({
			...create(child, handlers),
			// The teardown after the seal throws once; the catch's own close then succeeds.
			close: () => {
				if (closes++ === 0) throw new Error("fake agent: close failed after the seal");
			},
		});
		const closedBadly = await abortedTurn(broken, closeGate, transcript("CANCELLED-FIRST"), "l16-unretained-close");
		expect(closedBadly.sealed.type === "error" && closedBadly.sealed.reason).toBe("aborted");
		// The sealed message is the object Pi keeps; a late stop would append its notices to it after the seal.
		expect(JSON.stringify(closedBadly.sealed)).not.toContain("may have run");
		expect(recordOf(broken, "l16-unretained-close")).toEqual({ status: "missing" });
	});

	it("[QK:ACP-L16-UNREADABLE-REFUSES] a record that cannot be read refuses the turn before any spawn, and stays as evidence", async () => {
		const stderr = quietStderr();
		const world = makeWorld();
		const path = store.sessionRecordPath(keyOf("l16-unreadable"), world.deps.sessionDir);
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "evidence");
		const refused = await runTurn(world, transcript("NEVER-SENT"), "l16-unreadable", "high");
		expect(errorText(refused)).toBe(backend.ACP_RECORD_UNREADABLE_MESSAGE);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("code=EISDIR"));
		assertNoReplay(errorText(refused));
		expect(world.children).toHaveLength(0);
		expect(readFileSync(join(path, "keep"), "utf8")).toBe("evidence");
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining(`path=${path}`));
	});

	it("[QK:ACP-L16-TURN-SCOPED-NONE] a turn-scoped turn writes no record, neither a marker nor a seal", async () => {
		const world = makeWorld();
		world.deps.lifecyclePolicy = () => "turn-scoped";
		const atPrompt: unknown[] = [];
		world.hooks.onPrompt = () => {
			atPrompt.push(recordOf(world, "l16-turn-scoped"));
		};
		expect((await runTurn(world, transcript("ONE-SHOT"), "l16-turn-scoped", "high")).type).toBe("done");
		expect(atPrompt).toEqual([{ status: "missing" }]);
		expect(recordOf(world, "l16-turn-scoped")).toEqual({ status: "missing" });
	});

	// A read-only directory refuses the unlink; root ignores the mode, so this one does not run as root.
	it.skipIf(process.getuid?.() === 0)(
		"a drop that fails is said, keeps the marker, and the next turn stops on it again",
		async () => {
			const stderr = quietStderr();
			const world = makeWorld();
			leaveRecord(world, "l16-undroppable", transcript("RAN-MAYBE"), { start: 0, count: 2 });
			const recordDir = world.deps.sessionDir as string;
			chmodSync(recordDir, 0o500);
			onTestFinished(() => chmodSync(recordDir, 0o700));
			for (const attempt of [1, 2]) {
				const { sealed, shown } = await shownTurn(
					world,
					transcript("RAN-MAYBE", `TYPED-${attempt}`),
					"l16-undroppable",
				);
				expect(errorText(sealed)).toBe(backend.ACP_DISPATCH_STOP_MESSAGE);
				expect(shown).toContain(`[acp: ${backend.ACP_RECORD_NOT_DROPPED_NOTICE} (code=EACCES)]`);
			}
			expect(world.children).toHaveLength(0);
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("drop failed: code=EACCES"));
		},
	);
});

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

	it("[QK:ACP-THINKING-REUSE-ABORT] an abort already raised when a reuse turn starts waiting for a changed effort settles at once, sends no prompt, and the next turn opens a new session", async () => {
		await reuseAbortDuringEffort("th-reuse-abort", false);
	}, 40_000);

	it("[QK:ACP-THINKING-REUSE-ABORT-LATE] an abort that arrives while a reuse turn is waiting for a changed effort settles at once, sends no prompt, and the next turn opens a new session", async () => {
		await reuseAbortDuringEffort("th-reuse-abort-late", true);
	}, 40_000);

	it("no thinking level refuses by name before any process starts", async () => {
		const world = makeWorld();
		const sealed = await runTurn(world, transcript("go"), "th-none", undefined);
		expect(world.children).toHaveLength(0);
		expect(world.log).toEqual([]);
		expect(errorText(sealed)).toContain(adapters.ACP_THINKING_LEVEL_UNSUPPORTED);
		assertNoReplay(errorText(sealed));
	});
});

/** Run one turn that the operator aborts once its prompt is on the wire; returns the seal and what was shown. */
async function abortedTurn(
	world: ReturnType<typeof makeWorld>,
	gate: { hold: boolean; waiting?: () => void },
	context: TranscriptContext,
	sessionId: string,
): Promise<{ sealed: AssistantMessageEvent; shown: string }> {
	const controller = new AbortController();
	gate.hold = true;
	gate.waiting = () => controller.abort();
	const opts = { sessionId, reasoning: "high", signal: controller.signal } as Parameters<
		typeof backend.streamAcpTurn
	>[2];
	let shown = "";
	const sealed: AssistantMessageEvent[] = [];
	for await (const event of backend.streamAcpTurn(sonnet(), context, opts, world.deps)) {
		if (event.type === "text_delta") shown += event.delta;
		if (event.type === "done" || event.type === "error") sealed.push(event);
	}
	gate.hold = false;
	expect(sealed).toHaveLength(1);
	return { sealed: sealed[0], shown };
}

describe("streamAcpTurn — what a cancel leaves, told to the operator (#142)", () => {
	it("[QK:ACP-CANCEL-NOTICE-REUSE-KEPT] a reuse turn the agent ends on session/cancel keeps the live session, and says so", async () => {
		const gate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, undefined, gate);
		await runTurn(world, transcript("first"), "cx-reuse", "high");
		const { sealed, shown } = await abortedTurn(world, gate, transcript("first", "second"), "cx-reuse");
		expect(sealed.type === "error" && sealed.reason).toBe("aborted");
		expect(shown).toContain(`[acp: ${backend.ACP_CANCEL_KEPT_NOTICE}]`);
		expect(shown).not.toContain(backend.ACP_CANCEL_CLOSED_NOTICE);
		await runTurn(world, transcript("first", "second", "third"), "cx-reuse", "high");
		expect(world.children).toHaveLength(1);
		expect(world.log).toEqual([
			"set:model=claude-sonnet-5-5",
			"set:effort=high",
			"prompt",
			"prompt",
			"cancel",
			"prompt",
		]);
	});

	it("[QK:ACP-CANCEL-NOTICE-NEW-CLOSED] a cancelled first turn closes its session, says the next message opens a new one, and the next message does", async () => {
		const gate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, undefined, gate);
		const { sealed, shown } = await abortedTurn(world, gate, transcript("first"), "cx-new");
		expect(sealed.type === "error" && sealed.reason).toBe("aborted");
		expect(shown).toContain(`[acp: ${backend.ACP_CANCEL_CLOSED_NOTICE}]`);
		expect(shown).not.toContain(backend.ACP_CANCEL_KEPT_NOTICE);
		await runTurn(world, transcript("first", "second"), "cx-new", "high");
		expect(world.children).toHaveLength(2);
	});

	it("a turn nobody cancelled shows neither notice", async () => {
		const world = makeWorld();
		const first = await noticesOf(world, transcript("first"), "cx-none", "high");
		const second = await noticesOf(world, transcript("first", "second"), "cx-none", "high");
		for (const text of [first, second]) {
			expect(text).not.toContain(backend.ACP_CANCEL_KEPT_NOTICE);
			expect(text).not.toContain(backend.ACP_CANCEL_CLOSED_NOTICE);
		}
	});
});

describe("streamAcpTurn — a reuse turn's stream opens with its own prompt (#142)", () => {
	const lateChunk = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "LATE-A" } };
	const lateUsage = { sessionUpdate: "usage_update", used: 777_777, size: 1_000_000 };

	async function turnB(world: ReturnType<typeof makeWorld>, sessionId: string) {
		let shown = "";
		const sealed: AssistantMessageEvent[] = [];
		const opts = { sessionId, reasoning: "low" } as Parameters<typeof backend.streamAcpTurn>[2];
		for await (const event of backend.streamAcpTurn(
			sonnet(),
			transcript("first", "second", "third"),
			opts,
			world.deps,
		)) {
			if (event.type === "text_delta") shown += event.delta;
			if (event.type === "done" || event.type === "error") sealed.push(event);
		}
		expect(sealed).toHaveLength(1);
		if (sealed[0].type !== "done") throw new Error(`turn B did not complete: ${errorText(sealed[0])}`);
		return { shown, message: sealed[0].message };
	}

	it("[QK:ACP-REUSE-LATE-UPDATE-PRE-PROMPT] an update arriving while turn B sets effort, before B's prompt is sent, is never shown or sealed as B's", async () => {
		const effortGate: { hold: boolean; waiting?: () => void; release?: () => void } = { hold: false };
		const promptGate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, effortGate, promptGate);
		await runTurn(world, transcript("first"), "late-pre", "high");
		const { shown: a } = await abortedTurn(world, promptGate, transcript("first", "second"), "late-pre");
		expect(a).toContain(backend.ACP_CANCEL_KEPT_NOTICE);
		// A producer that keeps speaking for the cancelled turn A after answering it — here while B waits on its effort set.
		effortGate.hold = true;
		effortGate.waiting = () => {
			world.agentSays(lateChunk);
			world.agentSays(lateUsage);
			queueMicrotask(() => effortGate.release?.());
		};
		const { shown, message } = await turnB(world, "late-pre");
		expect(world.log.slice(-2)).toEqual(["set:effort=low", "prompt"]);
		expect(shown).not.toContain("LATE-A");
		expect(JSON.stringify(message.content)).not.toContain("LATE-A");
		expect(message.usage.totalTokens).not.toBe(777_777);
		expect(world.children).toHaveLength(1);
	});

	it("turn B's own output, once its prompt is out, still reaches its stream and its seal", async () => {
		const effortGate: { hold: boolean; waiting?: () => void; release?: () => void } = { hold: false };
		const world = makeWorld(undefined, effortGate);
		await runTurn(world, transcript("first", "second"), "late-own", "high");
		world.hooks.onPrompt = () => {
			world.agentSays({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "B-OWN" } });
			world.agentSays(lateUsage);
		};
		const { shown, message } = await turnB(world, "late-own");
		expect(shown).toContain("B-OWN");
		// Reached the seal at all; the occupancy rule itself is check-acp-usage-accounting's.
		expect(message.usage.totalTokens).toBeGreaterThan(0);
		expect(world.children).toHaveLength(1);
	});
});

describe("ACP rows declare only the input the rail delivers (#142 landing review)", () => {
	it("[QK:ACP-ROWS-TEXT-ONLY-INPUT] every supported ACP row declares text input only — an image block becomes a marker, never raw bytes", () => {
		const rows = adapters.allCuratedModels();
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(row.input, row.id).toEqual(["text"]);
	});
});

describe("server admission before any session (#168)", () => {
	/** A world whose server answers initialize as claude-agent-acp one patch below the floor. */
	function belowFloorWorld() {
		const world = makeWorld();
		const wire: string[] = [];
		const inner = world.deps.createConnection;
		world.deps.createConnection = (child, handlers) => {
			const connection = inner(child, handlers);
			return {
				...connection,
				initialize: async () => ({ agentInfo: { name: "@agentclientprotocol/claude-agent-acp", version: "0.107.2" } }),
				newSession: async (p: never) => {
					wire.push("newSession");
					return connection.newSession(p);
				},
			};
		};
		return { world, wire, restore: () => (world.deps.createConnection = inner) };
	}

	it("[QK:ACP-AGENT-ADMIT-BEFORE-SESSION] a server below its floor is refused after initialize: no session, no set, no prompt, and the child is not kept", async () => {
		const { world, wire, restore } = belowFloorWorld();
		const sealed = await runTurn(world, transcript("go"), "admit-below", "high");
		expect(errorText(sealed)).toContain("acp-claude-version-unsupported");
		expect(errorText(sealed)).toContain('"0.107.2"');
		expect(wire).toEqual([]);
		expect(world.log).toEqual([]);
		// The refused child is not retained: the next turn of the same Pi session spawns a new one.
		restore();
		const admitted = await runTurn(world, transcript("go"), "admit-below", "high");
		expect(admitted.type).toBe("done");
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-AGENT-ADMIT-NOT-TRANSIENT] the refusal reads as neither transient nor overflow to pi, so pi does not replay it", async () => {
		const { world } = belowFloorWorld();
		const sealed = await runTurn(world, transcript("go"), "admit-not-transient", "high");
		assertNoReplay(errorText(sealed));
	});
});
