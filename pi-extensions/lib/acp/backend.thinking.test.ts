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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	const prompts: Array<{ sessionId: string; text: string }> = [];
	let pendingPrompt: (() => void) | undefined;
	// The connection handlers the backend registered — the producer side of session/update.
	let handlers: Parameters<AcpTurnDeps["createConnection"]>[1] | undefined;
	const hooks: { onPrompt?: () => void | Promise<void> } = {};
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
					return { agentInfo: { name: agentOf.get(child)?.name, version: agentOf.get(child)?.floor } };
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
					prompts.push({ sessionId: p.sessionId, text: p.prompt.map((b) => ("text" in b ? b.text : "")).join("\n") });
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
					return { stopReason: "end_turn" };
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

describe("ACP baseline — implemented wire rows (#171)", () => {
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
