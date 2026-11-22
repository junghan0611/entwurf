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

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import { entriesOf, fakePiHost } from "../../../scripts/lib/acp-fake-pi-session.ts";
import type { AcpConnectionLike, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";
import { acquireHolderLease, holderLeasePath, type LeaseProbe } from "./holder-lease.ts";
import { ACP_STOPS } from "./stop-texts.ts";

// #171 step 8: the Pi session a resident turn reads, kept in step with each call.
const piHost = fakePiHost();

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
let birth: typeof import("./birth-reservation.ts");

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
	backend = piHost.wrap(await import("./backend.ts"));
	birth = await import("./birth-reservation.ts");
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

/** The fake child, with the one thing a test may do to it: end it as its own exit would. */
type FakeChild = AcpChildLike & { exit(code: number | null, signal?: NodeJS.Signals): void };

function makeFakeChild(events: string[] = []): FakeChild {
	const pipe = () => ({ destroy() {}, unref() {} });
	const listeners: Array<(...args: unknown[]) => void> = [];
	const child: FakeChild = {
		pid: undefined,
		exitCode: null,
		signalCode: null,
		exit(code, signal) {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.exitCode = code;
			child.signalCode = signal ?? null;
			for (const listener of listeners.splice(0)) listener(code, signal ?? null);
		},
		stdin: pipe(),
		stdout: pipe(),
		stderr: { on() {}, destroy() {}, unref() {} },
		// A signalled process ends: not at once, and not before the caller has finished what it was doing.
		kill: (signal) => {
			events.push(`kill:${signal}`);
			setImmediate(() => child.exit(null, typeof signal === "string" ? signal : "SIGTERM"));
			return true;
		},
		unref() {},
		once(event: string, listener: (...args: unknown[]) => void) {
			if (event === "exit") listeners.push(listener);
		},
	};
	return child;
}

/** One backend world. `log` records every wire call in order: `set:<configId>=<value>` and `prompt`. */
function makeWorld(
	effortAnswer: (value: string) => string = (value) => value,
	effortGate?: { hold: boolean; waiting?: () => void; release?: () => void },
	promptGate?: { hold: boolean; waiting?: () => void },
) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: FakeChild[] = [];
	const log: string[] = [];
	const wire: string[] = [];
	const lifecycle: string[] = [];
	const prompts: Array<{ sessionId: string; text: string; blocks: string[] }> = [];
	/** The params of every `session/resume`, in order. */
	const resumes: Array<Record<string, unknown>> = [];
	let pendingPrompt: (() => void) | undefined;
	// The connection handlers the backend registered — the producer side of session/update.
	let handlers: Parameters<AcpTurnDeps["createConnection"]>[1] | undefined;
	const hooks: {
		onPrompt?: () => void | Promise<void>;
		/** The stop reason of each answer; `null` answers with none at all. */
		stopReason?: AcpPromptResponse["stopReason"] | null;
		/** The send itself throws, before any promise exists. */
		refuseSend?: Error;
		/** The child ends in the same tick as its answer, after it. */
		exitAfterAnswer?: number;
		/** Runs when `session/resume` arrives; what it throws is the agent's refusal. */
		onResume?: (params: Record<string, unknown>) => void | Promise<void>;
		onClose?: (params: { sessionId: string }) => void | Promise<void>;
		/** The answer to `session/resume`; an empty object when unset. */
		resumeAnswer?: { sessionId?: string } | null;
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
						// What the measured agents answer: sessions can be resumed.
						agentCapabilities: { sessionCapabilities: { resume: {} } },
						...hooks.initialize,
						agentInfo: { name: agentOf.get(child)?.name, version: agentOf.get(child)?.floor },
					};
				},
				newSession: async () => {
					wire.push("new");
					return { sessionId: `ACP-${children.length}` };
				},
				resumeSession: async (p) => {
					wire.push("resume");
					resumes.push(p as Record<string, unknown>);
					await hooks.onResume?.(p as Record<string, unknown>);
					return hooks.resumeAnswer === undefined ? {} : hooks.resumeAnswer;
				},
				closeSession: async (p) => {
					wire.push(`close:${p.sessionId}`);
					await hooks.onClose?.(p);
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
				prompt: (p): Promise<AcpPromptResponse> => {
					if (hooks.refuseSend) throw hooks.refuseSend;
					if (hooks.exitAfterAnswer === undefined) return answer(p);
					// Settled first, then the exit, with nothing between them: the turn's continuation finds
					// its answer in hand and its child already gone.
					const code = hooks.exitAfterAnswer;
					return new Promise((resolve, reject) => {
						answer(p).then((response) => {
							resolve(response);
							(child as FakeChild).exit(code);
						}, reject);
					});
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
			async function answer(p: Parameters<AcpConnectionLike["prompt"]>[0]): Promise<AcpPromptResponse> {
				{
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
					return (hooks.stopReason === null ? {} : { stopReason: hooks.stopReason ?? "end_turn" }) as AcpPromptResponse;
				}
			}
		},
		lifecyclePolicy: () => "process-scoped",
		sessionReader: piHost.sessionReader,
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
		birthDir: `${sessionDir}-births`,
		holderDir: `${sessionDir}-holders`,
		abortGraceMs: 40,
	};
	/** The agent speaks on the live session, whoever the backend currently routes that to. */
	const agentSays = (update: Record<string, unknown>) =>
		void handlers?.sessionUpdate({ sessionId: `ACP-${children.length}`, update } as never);
	const requestPermission = (req: Parameters<NonNullable<typeof handlers>["requestPermission"]>[0]) => {
		if (!handlers) throw new Error("connection handlers not registered");
		return handlers.requestPermission(req);
	};
	return { deps, children, log, wire, lifecycle, prompts, resumes, agentSays, hooks, requestPermission, sessionDir };
}

async function runTurn(
	world: ReturnType<typeof makeWorld>,
	context: TranscriptContext,
	sessionId: string,
	reasoning: string | undefined,
	more: { options?: Record<string, unknown>; deps?: Partial<AcpTurnDeps> } = {},
): Promise<AssistantMessageEvent> {
	const events: AssistantMessageEvent[] = [];
	const opts = { sessionId, reasoning, ...more.options } as Parameters<typeof backend.streamAcpTurn>[2];
	const deps = more.deps ? { ...world.deps, ...more.deps } : world.deps;
	for await (const event of backend.streamAcpTurn(sonnet(), context, opts, deps)) events.push(event);
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

/** The `[acp: …]` notices an error seal carries, in order. */
function sealedNotices(event: AssistantMessageEvent): string[] {
	if (event.type !== "error") throw new Error(`expected an error seal, got ${event.type}`);
	return event.error.content.flatMap((block) => (block.type === "text" ? [block.text.trim()] : []));
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
	expect(shown).toContain(`[acp: ${backend.ACP_CANCEL_UNSENT_NOTICE}]`);
	const sealed = events.filter((e) => e.type === "done" || e.type === "error");
	expect(sealed).toHaveLength(1);
	expect(sealed[0].type === "error" && sealed[0].reason).toBe("aborted");
	// Bounded by the abort, not by the 30s bootstrap timeout.
	expect(settledMs).toBeLessThan(2_000);
	expect(world.log).toEqual(["set:model=claude-sonnet-5-5", "set:effort=high", "prompt", "set:effort=low"]);
	// Nothing was sent, so the live session is kept; the next turn sends the unsent input with its own (#171 step 8).
	gate.hold = false;
	const next = await runTurn(world, transcript("first", "second", "third"), sessionId, "low");
	expect(next.type).toBe("done");
	expect(world.children).toHaveLength(1);
	expect(world.prompts.at(-1)?.blocks).toEqual(["second", "third"]);
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
	it("[QK:ACP-DELTA-MAX-TOKENS] after Pi hides a length-cut answer the next turn stops: the session is kept and nothing is sent twice", async () => {
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
		// The branch holds the cut answer and the edit that hides it; the context shows neither. What the
		// session holds of the cut prompt cannot be told from here, so the turn stops and the session stays.
		piHost.setBranch("delta-length", session.getBranch());
		const stopped = await runTurn(world, context, "delta-length", "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.changed.text);
		// What stops it is the edit itself: an entry after the last answer that is neither an input nor a turn.
		expect(sealedNotices(stopped).join("\n")).toContain("a context_edit entry after the last answer");
		expect(world.children).toHaveLength(1);
		expect(world.prompts).toHaveLength(2);
		expect(world.lifecycle).toEqual([]);
	});
	it("[QK:ACP-COMPACT-KEEPS-SESSION] after a Pi compaction the same session gets the next input alone, whether Pi kept the last answer or only its summary", async () => {
		// `closed`: Pi's session_compact handler closed the agent (acp-provider.ts), so the turn is an attach.
		for (const [kept, closed] of [
			[true, false],
			[false, false],
			[true, true],
			[false, true],
		]) {
			const world = makeWorld();
			const id = `compact-keeps-${kept}-${closed}`;
			const first = await runTurn(world, transcript("seed"), id, "high");
			if (first.type !== "done") throw new Error(`first turn sealed as ${first.type}`);
			const session = SessionManager.inMemory();
			session.appendMessage({ role: "user", content: "seed", timestamp: 0 });
			const answerId = session.appendMessage(first.message);
			session.appendCompaction("SUMMARY-OF-SEED", kept ? answerId : null, 1000);
			session.appendMessage({ role: "user", content: "AFTER-COMPACTION", timestamp: 2 });
			const context = normalizeContext({
				tools: PI_TOOLS,
				messages: convertToLlm(session.buildSessionContext().messages),
			});
			expect(context.messages.map((m) => m.role)).toEqual(
				kept ? ["system", "user", "assistant", "user"] : ["system", "user", "user"],
			);
			piHost.setBranch(id, session.getBranch());
			if (closed) expect(backend.closeRetainedAcpSession(id)).toBe(true);
			const next = await runTurn(world, context, id, "high");
			expect(next.type, `${kept} ${closed}`).toBe("done");
			// One vendor session in all, and the summary is Pi's: it is never on the wire.
			expect(world.wire).toEqual(
				closed
					? ["initialize", "new", "prompt", "initialize", "resume", "prompt"]
					: ["initialize", "new", "prompt", "prompt"],
			);
			expect(world.prompts[1]).toMatchObject({ sessionId: world.prompts[0].sessionId, blocks: ["AFTER-COMPACTION"] });
		}
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
					writer: { name: "earlier-agent", version: "0.0.1" },
					firstPrompt: pendingDispatch ? "dispatched" : "sealed",
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
	/**
	 * What follows a prompt whose outcome is unknown and whose answer said so. A first prompt: every
	 * later turn stops. A later one: the session is resumed and is sent the new input alone.
	 */
	function afterUnknown(
		world: ReturnType<typeof makeWorld>,
		next: AssistantMessageEvent,
		sessionId: string,
		reuse: boolean,
	): void {
		if (!reuse) {
			expect(errorText(next), sessionId).toBe(ACP_STOPS.firstUnknown.text);
			expect(world.children, sessionId).toHaveLength(1);
			return;
		}
		expect(next.type, sessionId).toBe("done");
		expect(world.children, sessionId).toHaveLength(2);
		expect(
			world.wire.filter((w) => w === "new"),
			sessionId,
		).toHaveLength(1);
		expect(world.prompts.at(-1), sessionId).toMatchObject({ sessionId: "ACP-1", blocks: ["NEXT"] });
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
		// A birth: the store fails once the child is spawned, so the id `session/new` answers cannot be kept.
		// Nothing is asked of that session, and the turn after it stops instead of opening a second one.
		const fresh = makeWorld();
		const spawn = fresh.deps.spawnChild;
		fresh.deps.spawnChild = (launch, cwd, extraEnv) => {
			fresh.deps.sessionDir = badDir;
			return spawn(launch, cwd, extraEnv);
		};
		const { sealed: refused, shown } = await shownTurn(fresh, transcript("NEVER-SENT"), "l16-writefail-new");
		// The sealed text is fixed; the store's code rides the notice (Pi's classifier reads errorMessage alone).
		expect(errorText(refused)).toBe(ACP_STOPS.idSave.text);
		expect(shown).toContain("[acp: session id not saved (code=EEXIST)]");
		assertNoReplay(errorText(refused));
		expect(fresh.wire).toEqual(["initialize", "new"]);
		expect(fresh.log).toEqual([]);
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

	it("[QK:ACP-STORED-SESSION-NO-SECOND-NEW] a stored session that cannot be resumed is not replaced: every turn stops, nothing is spawned, and the record stays byte for byte", async () => {
		const stderr = quietStderr();
		for (const [name, marker] of [
			["sealed", null],
			["marked", { start: 3, count: 1 }],
		] as const) {
			const world = makeWorld();
			const id = `stored-${name}`;
			leaveRecord(world, id, transcript("RAN-MAYBE", "ALSO-MAYBE"), marker);
			const path = store.sessionRecordPath(keyOf(id), world.deps.sessionDir);
			const before = readFileSync(path, "utf8");
			for (const typed of ["TYPED-NOW", "TYPED-AGAIN"]) {
				const { sealed } = await shownTurn(world, transcript("RAN-MAYBE", "ALSO-MAYBE", typed), id);
				expect(errorText(sealed), name).toBe(ACP_STOPS.config.text);
				assertNoReplay(errorText(sealed));
				expect(errorText(sealed)).not.toContain("OLD-ACP");
			}
			expect(world.children, name).toHaveLength(0);
			expect(world.wire, name).toEqual([]);
			expect(readFileSync(path, "utf8"), name).toBe(before);
		}
		// A record that is not valid, and one written before the marker existed: kept as found, no birth.
		const world = makeWorld();
		const invalid = store.sessionRecordPath(keyOf("stored-invalid"), world.deps.sessionDir);
		mkdirSync(world.deps.sessionDir as string, { recursive: true });
		writeFileSync(invalid, "{not json");
		expect(errorText(await runTurn(world, transcript("X"), "stored-invalid", "high"))).toBe(ACP_STOPS.invalid.text);
		expect(readFileSync(invalid, "utf8")).toBe("{not json");
		const v1 = store.sessionRecordPath(keyOf("stored-v1"), world.deps.sessionDir);
		writeFileSync(v1, JSON.stringify({ version: 1, acpSessionId: "V1-ACP" }));
		expect(errorText(await runTurn(world, transcript("X"), "stored-v1", "high"))).toBe(ACP_STOPS.version.text);
		expect(readFileSync(v1, "utf8")).toBe(JSON.stringify({ version: 1, acpSessionId: "V1-ACP" }));
		expect(world.children).toHaveLength(0);
		expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("TYPED-NOW"));
	});

	it("[QK:ACP-HISTORY-WITHOUT-RECORD-STOPS] ACP answers in the Pi session with no record and no reservation stop the turn: a fork is not a birth", async () => {
		const world = makeWorld();
		// The fake Pi session holds what the context holds: two completed Entwurf answers.
		const forked = await runTurn(world, transcript("PARENT-ONE", "PARENT-TWO", "IN-THE-FORK"), "fork-child", "high");
		expect(errorText(forked)).toBe(ACP_STOPS.noRecord.text);
		expect(sealedNotices(forked)).toContain(`[acp: next: ${ACP_STOPS.noRecord.exit}]`);
		expect(world.children).toHaveLength(0);
		// Control: the same session id with no ACP history is a birth. The stop above left only a failed turn.
		piHost.setBranch("fork-child", entriesOf(transcript("IN-THE-FORK").messages));
		expect((await runTurn(world, transcript("IN-THE-FORK"), "fork-child", "high")).type).toBe("done");
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
	});

	it("[QK:ACP-LIVE-INCOMPATIBLE-KEPT] a live session that cannot take a turn is kept, not replaced: the turn stops, and the conversation it holds continues", async () => {
		const world = makeWorld();
		const id = "live-kept";
		await runTurn(world, transcript("first"), id, "high");
		// Another conversation under the same Pi session id: the prefix this session answered is gone.
		const elsewhere = await runTurn(world, transcript("SOMETHING-ELSE", "second"), id, "high");
		expect(errorText(elsewhere)).toBe(ACP_STOPS.changed.text);
		// Another model for the same session.
		const opts = { sessionId: id, reasoning: "high" } as Parameters<typeof backend.streamAcpTurn>[2];
		const row = models.curatedClaudeModels().find((r) => r.id !== "claude-sonnet-5-5");
		if (!row) throw new Error("no second curated model");
		const other = { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
		let switched: AssistantMessageEvent | undefined;
		for await (const event of backend.streamAcpTurn(other, transcript("first", "second"), opts, world.deps)) {
			switched = event;
		}
		if (!switched) throw new Error("no seal");
		expect(errorText(switched)).toBe(ACP_STOPS.model.text);
		expect(world.children).toHaveLength(1);
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
		expect(world.lifecycle).toEqual([]);
	});

	it("[QK:ACP-BIRTH-RECORD-BEFORE-SETUP] the id session/new answers is recorded before anything else is asked of the session, with its writer and where its first prompt stands", async () => {
		const seen: unknown[] = [];
		const id = "birth-record";
		let world: ReturnType<typeof makeWorld>;
		const read = () => recordOf(world, id);
		world = makeWorld((value) => {
			seen.push(read());
			return value;
		});
		world.hooks.onPrompt = () => void seen.push(read());
		await runTurn(world, transcript("BORN"), id, "high");
		seen.push(read());
		const facts = { acpSessionId: "ACP-1", writer: { name: adapters.CLAUDE_ACP_AGENT.name } };
		expect(seen).toMatchObject([
			// At the effort set: the session exists, nothing was sent.
			{ status: "found", record: { ...facts, firstPrompt: "pending", pendingDispatch: null } },
			// While the first prompt runs.
			{ status: "found", record: { ...facts, firstPrompt: "dispatched", pendingDispatch: { start: 0, count: 2 } } },
			// Sealed.
			{ status: "found", record: { ...facts, firstPrompt: "sealed", pendingDispatch: null } },
		]);
		expect((seen[0] as { record: { writer: { version: string } } }).record.writer.version).toBe(
			adapters.CLAUDE_ACP_AGENT.floor,
		);
	});

	it("[QK:ACP-BIRTH-RESERVED-BEFORE-NEW] the reservation is on disk when session/new is called, and a birth that failed there is never tried again", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "birth-reserved";
		const create = world.deps.createConnection;
		const reservedAtNew: boolean[] = [];
		let fail = true;
		world.deps.createConnection = (child, handlers) => {
			const connection = create(child, handlers);
			return {
				...connection,
				newSession: async (params) => {
					reservedAtNew.push(birth.birthReserved(keyOf(id), world.deps.birthDir));
					if (fail) throw new Error("fake agent: session/new lost its answer");
					return connection.newSession(params);
				},
			};
		};
		expect(birth.birthReserved(keyOf(id), world.deps.birthDir)).toBe(false);
		expect((await runTurn(world, transcript("FIRST"), id, "high")).type).toBe("error");
		expect(reservedAtNew).toEqual([true]);
		expect(recordOf(world, id)).toEqual({ status: "missing" });
		// The answer may have existed. No second session/new, in this turn or any later one.
		fail = false;
		for (const typed of ["AGAIN", "AND-AGAIN"]) {
			const stopped = await runTurn(world, transcript(typed), id, "high");
			expect(errorText(stopped)).toBe(ACP_STOPS.intent.text);
			assertNoReplay(errorText(stopped));
		}
		expect(reservedAtNew).toEqual([true]);
		expect(world.children).toHaveLength(1);
		// A failure BEFORE the reservation leaves nothing: the next turn is still a birth.
		const early = makeWorld();
		const admit = early.deps.createConnection;
		early.deps.createConnection = (child, handlers) => ({
			...admit(child, handlers),
			initialize: async () => ({ agentInfo: { name: "someone-else", version: "0.0.0" } }),
		});
		expect((await runTurn(early, transcript("FIRST"), "birth-early", "high")).type).toBe("error");
		expect(birth.birthReserved(keyOf("birth-early"), early.deps.birthDir)).toBe(false);
		early.deps.createConnection = admit;
		expect((await runTurn(early, transcript("FIRST"), "birth-early", "high")).type).toBe("done");
		// A reservation that cannot be made stops before session/new.
		const blocked = makeWorld();
		const parent = mkdtempSync(join(SANDBOX, "births-parent-"));
		blocked.deps.birthDir = join(parent, "births");
		if (process.getuid?.() !== 0) {
			chmodSync(parent, 0o500);
			onTestFinished(() => chmodSync(parent, 0o700));
			const refused = await runTurn(blocked, transcript("FIRST"), "birth-blocked", "high");
			expect(errorText(refused)).toBe(ACP_STOPS.reserve.text);
			expect(sealedNotices(refused)).toContain("[acp: birth reservation not saved (code=EACCES)]");
			expect(blocked.wire).toEqual(["initialize"]);
		}
		// A reservation that cannot be looked at is not "absent": nothing is spawned.
		const unseen = makeWorld();
		writeFileSync(unseen.deps.birthDir as string, "not a directory");
		const stopped = await runTurn(unseen, transcript("FIRST"), "birth-unseen", "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.unreadable.text);
		expect(sealedNotices(stopped)[0]).toBe("[acp: birth reservation unreadable (code=ENOTDIR)]");
		expect(unseen.children).toHaveLength(0);
	});

	it("[QK:ACP-PRE-BIRTH-PROVEN] a birth turn that failed before its reservation says so in its own answer, and only that answer lets a later turn be a birth", async () => {
		quietStderr();
		// Refused at admission: no reservation, the notice is in the answer, and the next turn is a birth.
		const early = makeWorld();
		const admit = early.deps.createConnection;
		early.deps.createConnection = (child, handlers) => ({
			...admit(child, handlers),
			initialize: async () => ({ agentInfo: { name: "someone-else", version: "0.0.0" } }),
		});
		const refused = await runTurn(early, transcript("FIRST"), "pre-birth", "high");
		expect(sealedNotices(refused)).toContain(`[acp: ${backend.ACP_NO_SESSION_NOTICE}]`);
		expect(backend.provenPreBirthAnswer(refused.type === "error" ? refused.error : undefined)).toBe(true);
		early.deps.createConnection = admit;
		expect((await runTurn(early, transcript("FIRST"), "pre-birth", "high")).type).toBe("done");
		// Failed AT session/new: the reservation was attempted, so the answer carries no such notice.
		const late = makeWorld();
		const create = late.deps.createConnection;
		late.deps.createConnection = (child, handlers) => ({
			...create(child, handlers),
			newSession: async () => {
				throw new Error("fake agent: session/new failed");
			},
		});
		const failed = await runTurn(late, transcript("FIRST"), "pre-birth-late", "high");
		expect(sealedNotices(failed)).not.toContain(`[acp: ${backend.ACP_NO_SESSION_NOTICE}]`);
		expect(backend.provenPreBirthAnswer(failed.type === "error" ? failed.error : undefined)).toBe(false);
		// The proof is this provider's own stamped block; nothing else.
		const notice = `\n[acp: ${backend.ACP_NO_SESSION_NOTICE}]\n`;
		const stamped = { type: "text", text: notice, textSignature: "entwurf:lifecycle-notice-v1" };
		expect(backend.provenPreBirthAnswer({ stopReason: "aborted", content: [stamped] })).toBe(true);
		expect(backend.provenPreBirthAnswer({ stopReason: "error", content: [{ type: "text", text: notice }] })).toBe(
			false,
		);
		// An error text proves nothing, a fixed stop text included: a vendor's raw late error can read the same.
		for (const id of ["mode", "host", "unreadable", "reserve", "version", "intent", "changed", "unknown"] as const) {
			const raw = {
				stopReason: "error",
				errorMessage: ACP_STOPS[id].text,
				content: [{ type: "text", text: "partial" }],
			};
			expect(backend.provenPreBirthAnswer(raw), id).toBe(false);
		}
		const lateRaw = makeWorld();
		piHost.setBranch(
			"pre-birth-raw",
			entriesOf([{ role: "user", content: "FIRST", timestamp: 0 }], {
				responseId: "entwurf-turn:earlier",
				stopReason: "error",
				errorMessage: ACP_STOPS.host.text,
				content: [{ type: "text", text: "partial output" }],
			}),
		);
		expect(errorText(await runTurn(lateRaw, transcript("FIRST"), "pre-birth-raw", "high"))).toBe(
			ACP_STOPS.noRecord.text,
		);
		expect(lateRaw.children).toHaveLength(0);
		// The locally owned early stops stamp their own answers, so the turn after one can still be a birth.
		const hostless = makeWorld();
		const reader = hostless.deps.sessionReader;
		hostless.deps.sessionReader = () => undefined;
		const noHost = await runTurn(hostless, transcript("FIRST"), "pre-birth-host", "high");
		expect(errorText(noHost)).toBe(ACP_STOPS.host.text);
		expect(backend.provenPreBirthAnswer(noHost.type === "error" ? noHost.error : undefined)).toBe(true);
		hostless.deps.sessionReader = reader;
		expect((await runTurn(hostless, transcript("FIRST"), "pre-birth-host", "high")).type).toBe("done");
		// A failed turn that is not proven pre-birth is history: the next turn stops instead of being born.
		const unproven = makeWorld();
		piHost.setBranch(
			"pre-birth-unproven",
			entriesOf([{ role: "user", content: "FIRST", timestamp: 0 }], {
				responseId: "entwurf-turn:earlier",
				stopReason: "error",
				errorMessage: "the agent stopped",
				content: [{ type: "text", text: "partial output" }],
			}),
		);
		expect(errorText(await runTurn(unproven, transcript("FIRST"), "pre-birth-unproven", "high"))).toBe(
			ACP_STOPS.noRecord.text,
		);
		expect(unproven.children).toHaveLength(0);
	});

	it("[QK:ACP-BIRTH-RECHECKED-AT-NEW] the Pi session and the abort are read again after initialize, at the last point before a session can exist", async () => {
		quietStderr();
		const world = makeWorld();
		const create = world.deps.createConnection;
		world.deps.createConnection = (child, handlers) => {
			const connection = create(child, handlers);
			return {
				...connection,
				initialize: async (params) => {
					const answer = await connection.initialize(params);
					// The Pi session this turn was called for is gone by the time the agent has answered.
					world.deps.sessionReader = () => undefined;
					return answer;
				},
			};
		};
		const stopped = await runTurn(world, transcript("FIRST"), "birth-recheck", "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.host.text);
		expect(world.wire).toEqual(["initialize"]);
		expect(birth.birthReserved(keyOf("birth-recheck"), world.deps.birthDir)).toBe(false);
		// The Pi session's entries failing to read is a stop of its own, never "no history".
		const unread = makeWorld();
		const reader = unread.deps.sessionReader;
		unread.deps.sessionReader = () => {
			const r = reader();
			return (
				r && {
					...r,
					getEntries: () => {
						throw new Error("fake Pi: entries unreadable");
					},
				}
			);
		};
		const refused = await runTurn(unread, transcript("FIRST"), "birth-unread", "high");
		expect(errorText(refused)).toBe(ACP_STOPS.host.text);
		expect(sealedNotices(refused)[0]).toBe("[acp: the Pi session's entries could not be read]");
		expect(unread.children).toHaveLength(0);
	});

	it("[QK:ACP-BIRTH-ONE-SNAPSHOT] a birth's prompt and marker range are the ones taken with its signatures, whatever happens to the context while it bootstraps", async () => {
		const gate: { hold: boolean; waiting?: () => void; release?: () => void } = { hold: true };
		const world = makeWorld(undefined, gate);
		const id = "birth-snapshot";
		const context = transcript("ASKED");
		gate.waiting = () => {
			(context.messages.at(-1) as { content: unknown }).content = "CHANGED-WHILE-BOOTSTRAPPING";
			context.messages.push({ role: "user", content: "ADDED-WHILE-BOOTSTRAPPING", timestamp: 9 });
			gate.hold = false;
			gate.release?.();
		};
		let marked: unknown;
		world.hooks.onPrompt = () => {
			const found = recordOf(world, id);
			marked = found.status === "found" ? found.record.pendingDispatch : undefined;
		};
		expect((await runTurn(world, context, id, "high")).type).toBe("done");
		expect(world.prompts.at(-1)?.text).toContain("ASKED");
		expect(world.prompts.at(-1)?.text).not.toContain("WHILE-BOOTSTRAPPING");
		expect(marked).toMatchObject({ start: 0, count: 2 });
	});

	it("[QK:ACP-PROMPT-FAIL-KEEPS-RECORD] a prompt that fails after its marker keeps the record, marker and all; a first prompt stops every later turn, a later one is resumed without its input", async () => {
		quietStderr();
		const fail = () => {
			throw new Error("fake agent: the prompt failed");
		};
		// The first prompt of a birth fails.
		const fresh = makeWorld();
		fresh.hooks.onPrompt = fail;
		const cutNew = await shownTurn(fresh, transcript("CUT-NEW"), "fail-new");
		expect(cutNew.sealed.type).toBe("error");
		expect(cutNew.shown).toContain("[acp: messages [0,2) of 2 may have run]");
		expect(cutNew.shown).toContain(`[acp: ${backend.ACP_RECORD_KEPT_NOTICE}]`);
		expect(recordOf(fresh, "fail-new")).toMatchObject({
			status: "found",
			record: { acpSessionId: "ACP-1", firstPrompt: "dispatched", pendingDispatch: { start: 0, count: 2 } },
		});
		fresh.hooks.onPrompt = undefined;
		expect(errorText(await runTurn(fresh, transcript("CUT-NEW", "NEXT"), "fail-new", "high"))).toBe(
			ACP_STOPS.firstUnknown.text,
		);
		expect(fresh.wire).toEqual(["initialize", "new", "prompt"]);
		// The prompt on a live session fails.
		const live = makeWorld();
		await runTurn(live, transcript("LIVE"), "fail-reuse", "high");
		live.hooks.onPrompt = fail;
		const cutLive = await shownTurn(live, transcript("LIVE", "CUT-REUSE"), "fail-reuse");
		expect(cutLive.sealed.type).toBe("error");
		expect(cutLive.shown).toContain("[acp: messages [3,4) of 4 may have run]");
		expect(recordOf(live, "fail-reuse")).toMatchObject({
			status: "found",
			record: { acpSessionId: "ACP-1", firstPrompt: "sealed", pendingDispatch: { start: 3, count: 1 } },
		});
		live.hooks.onPrompt = undefined;
		// The session is resumed under the same id and is sent the new input only: the one whose outcome is
		// unknown is not sent twice, and the turn says so.
		const resumed = await shownTurn(live, transcript("LIVE", "CUT-REUSE", "NEXT"), "fail-reuse");
		expect(resumed.sealed.type).toBe("done");
		expect(resumed.shown).toContain(`[acp: ${backend.heldInputsNotice(1, 0)}]`);
		expect(live.wire).toEqual(["initialize", "new", "prompt", "prompt", "initialize", "resume", "prompt"]);
		expect(live.resumes[0]).toMatchObject({ sessionId: "ACP-1" });
		expect(live.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["NEXT"] });
		expect(recordOf(live, "fail-reuse")).toMatchObject({
			status: "found",
			record: { acpSessionId: "ACP-1", pendingDispatch: null },
		});
	});

	it("[QK:ACP-UNKNOWN-FIXED-TEXT] a prompt that may have been dispatched and got no classified answer seals the fixed text; what was said is kept in a diagnostic, not in errorMessage", async () => {
		quietStderr();
		const cases: Array<{ id: string; arm: (world: ReturnType<typeof makeWorld>) => void; said: string }> = [
			{
				id: "unknown-rejected",
				arm: (world) => {
					world.hooks.onPrompt = () => {
						throw new Error("overloaded_error: 529 try again");
					};
				},
				said: "overloaded_error: 529 try again",
			},
			{
				// The send refused on the spot: the marker was already in the record, so it is the same case.
				id: "unknown-refused-send",
				arm: (world) => {
					world.hooks.refuseSend = new Error("write EPIPE 503");
				},
				said: "write EPIPE 503",
			},
		];
		for (const reuse of [false, true]) {
			for (const { id, arm, said } of cases) {
				const sessionId = `${id}-${reuse}`;
				const world = makeWorld();
				if (reuse) await runTurn(world, transcript("FIRST"), sessionId, "high");
				arm(world);
				const context = reuse ? transcript("FIRST", "CUT") : transcript("CUT");
				const { sealed, shown } = await shownTurn(world, context, sessionId);
				if (sealed.type !== "error") throw new Error(`${sessionId}: expected an error seal`);
				expect(sealed.error.stopReason, sessionId).toBe("error");
				// Control: the raw text alone would have had Pi send the whole prompt again.
				expect(isRetryableAssistantError(errorProbe(said)), sessionId).toBe(true);
				expect(sealed.error.errorMessage, sessionId).toBe(ACP_STOPS.unknown.text);
				assertNoReplay(sealed.error.errorMessage ?? "");
				expect(sealed.error.diagnostics, sessionId).toHaveLength(1);
				expect(sealed.error.diagnostics?.[0], sessionId).toMatchObject({
					type: "entwurf_acp_prompt_unknown",
					error: { message: said },
				});
				expect(shown, sessionId).toContain(`[acp: ${said}]`);
				expect(shown, sessionId).toContain(`[acp: ${backend.ACP_RECORD_KEPT_NOTICE}]`);
				// The marker stands, the transport is closed, and no later turn opens another session.
				expect(recordOf(world, sessionId), sessionId).toMatchObject({
					status: "found",
					record: { acpSessionId: "ACP-1", pendingDispatch: { count: reuse ? 1 : 2 } },
				});
				expect(world.lifecycle, sessionId).toContain("close");
				world.hooks.onPrompt = undefined;
				world.hooks.refuseSend = undefined;
				const next = await runTurn(world, transcript(...(reuse ? ["FIRST"] : []), "CUT", "NEXT"), sessionId, "high");
				afterUnknown(world, next, sessionId, reuse);
			}
		}
	});

	it("[QK:ACP-UNANSWERED-STOP-KEEPS-MARKER] a response with no stop reason, or one this build does not know, is not an answer: the marker stays and the session is closed", async () => {
		quietStderr();
		for (const reuse of [false, true]) {
			for (const reason of ["teapot", null] as const) {
				const sessionId = `unanswered-${reason}-${reuse}`;
				const world = makeWorld();
				if (reuse) await runTurn(world, transcript("FIRST"), sessionId, "high");
				world.hooks.stopReason = reason as never;
				const context = reuse ? transcript("FIRST", "CUT") : transcript("CUT");
				const { sealed } = await shownTurn(world, context, sessionId);
				if (sealed.type !== "error") throw new Error(`${sessionId}: expected an error seal`);
				expect(sealed.error.errorMessage, sessionId).toBe(ACP_STOPS.unknown.text);
				// The wire value survives the mapping, as for every stop reason.
				expect(sealed.error.rawStopReason, sessionId).toBe(reason ?? undefined);
				expect(sealed.error.diagnostics?.[0]?.error?.message, sessionId).toBe(
					reason === null
						? "ACP backend ended the turn without a stop reason"
						: "ACP backend stopped with an unrecognized reason: teapot",
				);
				expect(recordOf(world, sessionId), sessionId).toMatchObject({
					status: "found",
					record: { pendingDispatch: { count: reuse ? 1 : 2 } },
				});
				expect(world.lifecycle, sessionId).toContain("close");
				world.hooks.stopReason = undefined;
				const next = await runTurn(world, transcript(...(reuse ? ["FIRST"] : []), "CUT", "NEXT"), sessionId, "high");
				afterUnknown(world, next, sessionId, reuse);
			}
		}
	});

	it("[QK:ACP-ONE-SHOT-PROMPT-NO-REPLAY] a one-shot's failed prompt whose own words Pi would retry seals a fixed text, and the raw failure rides a diagnostic; other words stay verbatim", async () => {
		quietStderr();
		const oneShot = { lifecyclePolicy: () => "turn-scoped" as const };
		// The ACP SDK's words for a transport that ended under a pending request. Pi 1.6 reads them as transient.
		const said = "ACP connection closed";
		expect(isRetryableAssistantError(errorProbe(said))).toBe(true);
		const world = makeWorld();
		world.hooks.onPrompt = () => {
			throw new Error(said);
		};
		const cut = await runTurn(world, transcript("CUT"), "one-shot-cut", "high", { deps: oneShot });
		if (cut.type !== "error") throw new Error("expected an error seal");
		expect(cut.error.errorMessage).toBe(ACP_STOPS.oneShotUnknown.text);
		expect(isRetryableAssistantError(cut.error)).toBe(false);
		expect(cut.error.diagnostics?.[0]?.type).toBe(backend.ACP_ONE_SHOT_UNKNOWN_DIAGNOSTIC);
		expect(cut.error.diagnostics?.[0]?.error?.message).toBe(said);
		expect(world.prompts).toHaveLength(1);
		expect(recordOf(world, "one-shot-cut")).toEqual({ status: "missing" });

		// A failure Pi does not retry keeps the agent's own words, as before.
		const plain = makeWorld();
		plain.hooks.onPrompt = () => {
			throw new Error("fake agent: the prompt failed");
		};
		const kept = await runTurn(plain, transcript("CUT"), "one-shot-plain", "high", { deps: oneShot });
		expect(errorText(kept)).toContain("fake agent: the prompt failed");
		if (kept.type === "error") expect(kept.error.diagnostics ?? []).toHaveLength(0);
	});

	it("[QK:ACP-ANSWERED-STOP-KEEPS-SESSION] a refusal or an exhausted budget is an answer: the marker is cleared, the session stays and takes the next input", async () => {
		for (const reason of ["refusal", "max_turn_requests", "max_tokens"] as const) {
			const sessionId = `answered-${reason}`;
			const world = makeWorld();
			world.hooks.stopReason = reason;
			const first = await runTurn(world, transcript("ASK"), sessionId, "high");
			expect(first.type, reason).toBe(reason === "max_tokens" ? "done" : "error");
			expect(recordOf(world, sessionId), reason).toMatchObject({
				status: "found",
				record: { firstPrompt: "sealed", pendingDispatch: null },
			});
			expect(world.lifecycle, reason).not.toContain("close");
			world.hooks.stopReason = undefined;
			const next = await runTurn(world, transcript("ASK", "AGAIN"), sessionId, "high");
			expect(next.type, reason).toBe("done");
			expect(world.children, reason).toHaveLength(1);
			expect(
				world.prompts.map((p) => p.sessionId),
				reason,
			).toEqual(["ACP-1", "ACP-1"]);
		}
	});

	it("[QK:ACP-SEAL-OWED-BEFORE-REUSE] an answer the record did not take is written again before the session is used, and the turn stops while it cannot be", async () => {
		quietStderr();
		for (const reuse of [false, true]) {
			for (const repaired of [false, true]) {
				const sessionId = `seal-owed-${reuse}-${repaired}`;
				const world = makeWorld();
				const badDir = join(SANDBOX, `not-a-directory-${sessionId}`);
				writeFileSync(badDir, "keep");
				const recordDir = world.deps.sessionDir;
				if (reuse) await runTurn(world, transcript("FIRST"), sessionId, "high");
				// Only the seal fails: the marker is in the record, the answer is not.
				world.hooks.onPrompt = () => {
					world.deps.sessionDir = badDir;
				};
				const asked = reuse ? ["FIRST", "SECOND"] : ["FIRST"];
				expect((await runTurn(world, transcript(...asked), sessionId, "high")).type, sessionId).toBe("done");
				world.hooks.onPrompt = undefined;
				const sent = world.prompts.length;
				if (repaired) world.deps.sessionDir = recordDir;
				const { sealed, shown } = await shownTurn(world, transcript(...asked, "AFTER"), sessionId);
				if (repaired) {
					// The record held the answered turn's marker; it is sealed before this turn's marker goes over it.
					expect(sealed.type, sessionId).toBe("done");
					expect(world.prompts, sessionId).toHaveLength(sent + 1);
					expect(recordOf(world, sessionId), sessionId).toMatchObject({
						status: "found",
						record: { pendingDispatch: null },
					});
				} else {
					expect(errorText(sealed), sessionId).toBe(ACP_STOPS.seal.text);
					expect(shown, sessionId).toContain(
						"[acp: next: start a new session with /new; the record stays for diagnosis]",
					);
					expect(world.prompts, sessionId).toHaveLength(sent);
					// The session is kept: it is this conversation's only one.
					expect(world.lifecycle, sessionId).not.toContain("close");
				}
				expect(world.children, sessionId).toHaveLength(1);
			}
		}
	});

	it("[QK:ACP-ANSWER-THEN-GONE-SEALS] a child gone right after its answer still seals: the marker is cleared, the record stays, and the next turn resumes that session", async () => {
		quietStderr();
		for (const reuse of [false, true]) {
			const sessionId = `gone-after-answer-${reuse}`;
			const world = makeWorld();
			if (reuse) await runTurn(world, transcript("FIRST"), sessionId, "high");
			world.hooks.exitAfterAnswer = 0;
			const asked = reuse ? ["FIRST", "LAST"] : ["LAST"];
			expect((await runTurn(world, transcript(...asked), sessionId, "high")).type, sessionId).toBe("done");
			expect(recordOf(world, sessionId), sessionId).toMatchObject({
				status: "found",
				record: { acpSessionId: "ACP-1", firstPrompt: "sealed", pendingDispatch: null },
			});
			world.hooks.exitAfterAnswer = undefined;
			// The agent is gone and its session is not: the next turn resumes it and sends only the new input.
			const next = await runTurn(world, transcript(...asked, "NEXT"), sessionId, "high");
			expect(next.type, sessionId).toBe("done");
			expect(world.children, sessionId).toHaveLength(2);
			expect(
				world.wire.filter((w) => w === "new"),
				sessionId,
			).toHaveLength(1);
			expect(world.resumes, sessionId).toHaveLength(1);
			expect(world.prompts.at(-1), sessionId).toMatchObject({ sessionId: "ACP-1", blocks: ["NEXT"] });
		}
		// The same end a moment later, once the turn has sealed and kept its session.
		const world = makeWorld();
		await runTurn(world, transcript("LAST"), "gone-after-seal", "high");
		world.children[0].exit(0);
		const { sealed, shown } = await shownTurn(world, transcript("LAST", "NEXT"), "gone-after-seal");
		expect(sealed.type).toBe("done");
		expect(shown).toContain("[acp: previous claude agent ended between turns (exit code 0)]");
		expect(shown).toContain("[acp: resuming claude session]");
		expect(recordOf(world, "gone-after-seal")).toMatchObject({ status: "found", record: { pendingDispatch: null } });
		expect(world.children).toHaveLength(2);
		expect(world.wire).toEqual(["initialize", "new", "prompt", "initialize", "resume", "prompt"]);
	});

	it("[QK:ACP-DISPATCH-THROW-SEALS] an exception nothing caught still ends the turn, with a fixed text and nothing sent", async () => {
		const stderr = quietStderr();
		const world = makeWorld();
		await runTurn(world, transcript("FIRST"), "dispatch-throw", "high");
		const reader = world.deps.sessionReader;
		const broken: AcpTurnDeps["sessionReader"] = () => {
			const inner = reader();
			return (
				inner && {
					...inner,
					getBranch: () => {
						throw new Error("ECONNRESET 502 reading the branch");
					},
				}
			);
		};
		const { sealed, shown } = await shownTurn(
			{ ...world, deps: { ...world.deps, sessionReader: broken } },
			transcript("FIRST", "SECOND"),
			"dispatch-throw",
		);
		expect(errorText(sealed)).toBe(ACP_STOPS.internal.text);
		assertNoReplay(errorText(sealed));
		expect(shown).toContain("[acp: ECONNRESET 502 reading the branch]");
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("turn failed inside entwurf"));
		expect(world.prompts).toHaveLength(1);
		expect(world.lifecycle).not.toContain("close");
	});

	it("[QK:ACP-THROWN-UNPRINTABLE-SEALS] a thrown value that cannot even be printed still ends the turn", async () => {
		quietStderr();
		const seed = makeWorld();
		const reader = seed.deps.sessionReader;
		// Anything can be thrown: from the reader, where nothing catches it, and from a payload hook, where
		// the turn's own catch has to read it.
		const unprintable = Object.create(null);
		const mute: AcpTurnDeps["sessionReader"] = () => {
			const inner = reader();
			return (
				inner && {
					...inner,
					getBranch: () => {
						throw unprintable;
					},
				}
			);
		};
		const other = makeWorld();
		await runTurn(other, transcript("FIRST"), "dispatch-throw-mute", "high");
		const muted = await shownTurn(
			{ ...other, deps: { ...other.deps, sessionReader: mute } },
			transcript("FIRST", "SECOND"),
			"dispatch-throw-mute",
		);
		expect(errorText(muted.sealed)).toBe(ACP_STOPS.internal.text);
		expect(muted.shown).toContain("[acp: a value that cannot be printed]");
		for (const sessionId of ["hook-throw-new", "hook-throw-reuse"]) {
			const hooked = makeWorld();
			const asked = ["FIRST"];
			if (sessionId === "hook-throw-reuse") {
				await runTurn(hooked, transcript("FIRST"), sessionId, "high");
				asked.push("SECOND");
			}
			const sent = hooked.prompts.length;
			const sealed = await runTurn(hooked, transcript(...asked), sessionId, "high", {
				options: {
					onPayload: () => {
						throw unprintable;
					},
				},
			});
			expect(sealed.type, sessionId).toBe("error");
			expect(errorText(sealed), sessionId).toContain("a value that cannot be printed");
			expect(hooked.prompts, sessionId).toHaveLength(sent);
		}
	});

	it("[QK:ACP-ABORT-STANDING-STAYS-ABORTED] an abort whose prompt never answered seals as aborted with what was said, keeps the marker and closes the session", async () => {
		quietStderr();
		for (const reuse of [false, true]) {
			const sessionId = `abort-standing-${reuse}`;
			const world = makeWorld();
			if (reuse) await runTurn(world, transcript("FIRST"), sessionId, "high");
			const controller = new AbortController();
			// The agent fails while the operator's abort is in flight, with a text that reads as transient.
			world.hooks.onPrompt = () => {
				controller.abort();
				throw new Error("overloaded_error: 529 try again");
			};
			const context = reuse ? transcript("FIRST", "CUT") : transcript("CUT");
			const sealed = await runTurn(world, context, sessionId, "high", { options: { signal: controller.signal } });
			if (sealed.type !== "error") throw new Error(`${sessionId}: expected an error seal`);
			// Pi retries only `error` (pi-ai `isRetryableAssistantError`), so an aborted seal keeps its raw text.
			expect(sealed.reason, sessionId).toBe("aborted");
			expect(sealed.error.stopReason, sessionId).toBe("aborted");
			expect(sealed.error.errorMessage, sessionId).toContain("overloaded_error: 529 try again");
			expect(isRetryableAssistantError(sealed.error), sessionId).toBe(false);
			expect(sealed.error.diagnostics, sessionId).toBeUndefined();
			expect(recordOf(world, sessionId), sessionId).toMatchObject({
				status: "found",
				record: { pendingDispatch: { count: reuse ? 1 : 2 } },
			});
			expect(world.lifecycle, sessionId).toContain("close");
			world.hooks.onPrompt = undefined;
			const next = await runTurn(world, transcript(...(reuse ? ["FIRST"] : []), "CUT", "NEXT"), sessionId, "high");
			// An abort tells nothing about the dispatch: the next turn is the stop that does, and it names it.
			expect(errorText(next), sessionId).toBe(reuse ? ACP_STOPS.claudeSkip.text : ACP_STOPS.firstUnknown.text);
			expect(world.children, sessionId).toHaveLength(1);
			if (!reuse) continue;
			if (next.type !== "error") throw new Error("expected an error seal");
			expect(next.error.diagnostics?.[0], sessionId).toMatchObject({
				type: backend.ACP_SKIP_NOTICE_DIAGNOSTIC,
				details: { turnIds: [sealed.error.responseId] },
			});
			// Told: the turn after it resumes the session with the inputs that were never sent.
			const after = await runTurn(world, transcript("FIRST", "CUT", "NEXT", "THEN"), sessionId, "high");
			expect(after.type, sessionId).toBe("done");
			expect(world.prompts.at(-1), sessionId).toMatchObject({ sessionId: "ACP-1", blocks: ["NEXT", "THEN"] });
		}
	});

	// --- #171 step 8: a stored session is resumed under the same id ---------------------------------

	const leaseOf = (world: ReturnType<typeof makeWorld>) =>
		holderLeasePath("claude", "ACP-1", world.deps.holderDir as string);
	const recordBytes = (world: ReturnType<typeof makeWorld>, id: string) =>
		readFileSync(store.sessionRecordPath(keyOf(id), world.deps.sessionDir), "utf8");

	it("[QK:ACP-ATTACH-SAME-ID-DELTA] a session this Pi left is resumed under its id and sent only the new input; its marker names the turn and the inputs", async () => {
		const world = makeWorld();
		const id = "attach-delta";
		await runTurn(world, transcript("FIRST"), id, "high");
		expect(existsSync(leaseOf(world))).toBe(true);
		// Leaving the session (/new, quit): the agent is closed, proven gone, and the hold is given up.
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		expect(existsSync(leaseOf(world))).toBe(false);
		const during: unknown[] = [];
		world.hooks.onPrompt = () => void during.push(recordOf(world, id));
		const { sealed, shown } = await shownTurn(world, transcript("FIRST", "SECOND"), id);
		world.hooks.onPrompt = undefined;
		if (sealed.type !== "done") throw new Error(`expected done, got ${errorText(sealed)}`);
		expect(shown).toContain("[acp: resuming claude session]");
		expect(world.wire).toEqual(["initialize", "new", "prompt", "initialize", "resume", "prompt"]);
		expect(world.resumes[0]).toMatchObject({ sessionId: "ACP-1", cwd: process.cwd() });
		// No transcript and no first-prompt augment: the session holds both.
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
		expect(during[0]).toMatchObject({
			status: "found",
			record: {
				acpSessionId: "ACP-1",
				firstPrompt: "sealed",
				pendingDispatch: { turnId: sealed.message.responseId, inputEntryIds: [expect.any(String)] },
			},
		});
		expect(recordOf(world, id)).toMatchObject({
			status: "found",
			record: { acpSessionId: "ACP-1", pendingDispatch: null, sealedTurnId: sealed.message.responseId },
		});
		expect(existsSync(leaseOf(world))).toBe(true);
		// The resumed agent is this Pi's live session from here on.
		expect((await runTurn(world, transcript("FIRST", "SECOND", "THIRD"), id, "high")).type).toBe("done");
		expect(world.wire.slice(6)).toEqual(["prompt"]);
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-ATTACH-REFUSAL-KEEPS-RECORD] a resume that is not allowed, refused or answered for another session stops: nothing is sent, no session is opened, the record stays", async () => {
		quietStderr();
		const rows: Array<[string, keyof typeof ACP_STOPS, (world: ReturnType<typeof makeWorld>, id: string) => void]> = [
			[
				"no resume capability",
				"load",
				(world) => {
					world.hooks.initialize = { agentCapabilities: {} };
				},
			],
			[
				"refused",
				"resume",
				(world) => {
					world.hooks.onResume = () => {
						throw new Error("VENDOR-SAYS-NO");
					};
				},
			],
			[
				"another id",
				"resume",
				(world) => {
					world.hooks.resumeAnswer = { sessionId: "ACP-OTHER" };
				},
			],
			[
				"an id that is not one",
				"resume",
				(world) => {
					world.hooks.resumeAnswer = { sessionId: 42 } as never;
				},
			],
			[
				"an id key with nothing in it",
				"resume",
				(world) => {
					world.hooks.resumeAnswer = { sessionId: undefined };
				},
			],
			[
				"a writer no receipt measured",
				"version",
				(world, id) => {
					const path = store.sessionRecordPath(keyOf(id), world.deps.sessionDir);
					const record = JSON.parse(readFileSync(path, "utf8"));
					writeFileSync(path, JSON.stringify({ ...record, writer: { ...record.writer, version: "0.107.0" } }));
				},
			],
		];
		for (const [name, stop, arrange] of rows) {
			const world = makeWorld();
			const id = `attach-refused-${name.replaceAll(" ", "-")}`;
			await runTurn(world, transcript("FIRST"), id, "high");
			expect(await backend.releaseAcpSessions(id), name).toBe(1);
			arrange(world, id);
			const before = recordBytes(world, id);
			const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
			expect(errorText(stopped), name).toBe(ACP_STOPS[stop].text);
			expect(errorText(stopped), name).not.toContain("VENDOR-SAYS-NO");
			expect(world.prompts, name).toHaveLength(1);
			expect(
				world.wire.filter((w) => w === "new"),
				name,
			).toHaveLength(1);
			expect(recordBytes(world, id), name).toBe(before);
			if (stop === "version") continue;
			// Control: with the cause gone the same input goes to the same session. It was never sent.
			world.hooks.initialize = {};
			world.hooks.onResume = undefined;
			world.hooks.resumeAnswer = undefined;
			expect((await runTurn(world, transcript("FIRST", "SECOND"), id, "high")).type, name).toBe("done");
			expect(world.prompts.at(-1), name).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
			expect(
				world.wire.filter((w) => w === "new"),
				name,
			).toHaveLength(1);
		}
	});

	/** An attach answers the vendor's defaults (U2), so what the birth set is set again: `prefix` picks the option. */
	async function setAgainOnAttach(id: string, prefix: string): Promise<void> {
		const world = makeWorld();
		await runTurn(world, transcript("FIRST"), id, "high");
		const atBirth = world.log.filter((line) => line.startsWith(prefix));
		expect(atBirth.length).toBeGreaterThan(0);
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		const resumedAt = world.log.length;
		expect((await runTurn(world, transcript("FIRST", "SECOND"), id, "high")).type).toBe("done");
		expect(world.wire.slice(3)).toEqual(["initialize", "resume", "prompt"]);
		expect(world.log.slice(resumedAt).filter((line) => line.startsWith(prefix))).toEqual(atBirth);
	}
	it("[QK:ACP-ATTACH-SETS-MODEL-AGAIN] a resumed session is given its model again before the prompt", async () => {
		await setAgainOnAttach("attach-model-again", "set:model=");
	});
	it("[QK:ACP-ATTACH-SETS-EFFORT-AGAIN] a resumed session is given its effort again before the prompt", async () => {
		await setAgainOnAttach("attach-effort-again", "set:effort=");
	});

	it("[QK:ACP-ATTACH-AGENT-DIES] an agent that dies while resuming stops the turn by name: nothing is sent, no session is opened, the record stays", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "attach-agent-dies";
		await runTurn(world, transcript("FIRST"), id, "high");
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		const before = recordBytes(world, id);
		world.hooks.onResume = () => {
			world.children.at(-1)?.exit(1);
			throw new Error("ACP connection closed");
		};
		const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.resume.text);
		expect(world.wire).toEqual(["initialize", "new", "prompt", "initialize", "resume"]);
		expect(recordBytes(world, id)).toBe(before);
		// The dead agent is proven gone, so the same input goes to the same session afterwards.
		world.hooks.onResume = undefined;
		expect((await runTurn(world, transcript("FIRST", "SECOND"), id, "high")).type).toBe("done");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
		expect(world.wire.filter((w) => w === "new")).toHaveLength(1);
	});

	it("[QK:ACP-ATTACH-REOPENED-PI] a Pi session reopened later has only its record: its first ACP turn resumes the recorded id and opens none", async () => {
		const first = makeWorld();
		const id = "attach-reopened";
		await runTurn(first, transcript("FIRST"), id, "high");
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		// Another launch of Pi: nothing of the first one's agent or connection, the same stores.
		const reopened = makeWorld();
		reopened.deps.sessionDir = first.deps.sessionDir;
		reopened.deps.holderDir = first.deps.holderDir;
		reopened.deps.birthDir = first.deps.birthDir;
		const sealed = await runTurn(reopened, transcript("FIRST", "SECOND"), id, "high");
		expect(sealed.type).toBe("done");
		expect(reopened.wire).toEqual(["initialize", "resume", "prompt"]);
		expect(reopened.resumes[0]).toMatchObject({ sessionId: "ACP-1" });
		expect(reopened.prompts).toEqual([expect.objectContaining({ sessionId: "ACP-1", blocks: ["SECOND"] })]);
	});

	it("[QK:ACP-ATTACH-HOLDER-STOPS] a session another holder's lease stands on is not resumed: nothing is spawned and the lease stays as found", async () => {
		const others: Record<number, "live" | "dead" | "uncertain"> = {};
		const probe = (pid: number, nonce = "module-1"): LeaseProbe => ({
			self: { pid, startKey: `start-${pid}` },
			nonce,
			// One boot and one PID namespace: only there is a holder named.
			scope: { machine: "0".repeat(32), bootId: "11111111-2222-3333-4444-555555555555", pidNs: "pid:[1]" },
			classify: (identity) => others[identity.pid] ?? "uncertain",
			groupGone: () => false,
		});
		const rows: Array<[string, keyof typeof ACP_STOPS, LeaseProbe, "live" | "dead" | "uncertain"]> = [
			["another live process", "holder", probe(2), "live"],
			["a holder that died without releasing", "holderStale", probe(2), "dead"],
			["a holder that cannot be judged", "holderStale", probe(2), "uncertain"],
			["this process before a reload", "reload", probe(1, "module-0"), "live"],
		];
		for (const [name, stop, holder, verdict] of rows) {
			const world = makeWorld();
			world.deps.leaseProbe = probe(1);
			const id = `attach-held-${stop}-${verdict}`;
			await runTurn(world, transcript("FIRST"), id, "high");
			expect(await backend.releaseAcpSessions(id, world.deps.leaseProbe), name).toBe(1);
			const planted = acquireHolderLease(
				{ backend: "claude", acpSessionId: "ACP-1", at: "2026-11-22T00:00:00Z" },
				holder,
				world.deps.holderDir,
			);
			expect(planted.ok, name).toBe(true);
			others[2] = verdict;
			const lease = readFileSync(leaseOf(world), "utf8");
			const record = recordBytes(world, id);
			const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
			expect(errorText(stopped), name).toBe(ACP_STOPS[stop].text);
			expect(world.children, name).toHaveLength(1);
			expect(world.wire, name).toEqual(["initialize", "new", "prompt"]);
			expect(readFileSync(leaseOf(world), "utf8"), name).toBe(lease);
			expect(recordBytes(world, id), name).toBe(record);
		}
	});

	it("[QK:ACP-SKIP-STOP-NAMES-DISPATCH] an input held back with no stored answer that told the operator stops the turn once, naming the dispatch; the next turn goes on without it", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "skip-untold";
		const first = await runTurn(world, transcript("FIRST"), id, "high");
		if (first.type !== "done") throw new Error("expected done");
		world.hooks.onPrompt = () => {
			throw new Error("fake agent: the prompt failed");
		};
		await runTurn(world, transcript("FIRST", "CUT"), id, "high");
		world.hooks.onPrompt = undefined;
		const marked = recordOf(world, id);
		if (marked.status !== "found" || !marked.record.pendingDispatch?.turnId) throw new Error("no marker");
		const marker = marked.record.pendingDispatch;
		// Pi went down before it stored that turn's answer: the branch shows the input and nothing that told anyone.
		const context = transcript("FIRST", "CUT");
		context.messages.push({ role: "user", content: "NEXT", timestamp: 9 });
		// The first answer as this context shows it, under the turn id it was sealed with.
		const answered = {
			...context.messages.find((message) => message.role === "assistant"),
			provider: "entwurf",
			responseId: first.message.responseId,
		};
		piHost.setBranch(id, [
			{ type: "message", id: "u0", message: { role: "user", content: "FIRST" } },
			{ type: "message", id: "a0", message: answered },
			{ type: "message", id: marker.inputEntryIds?.[0], message: { role: "user", content: "CUT" } },
			{ type: "message", id: "u2", message: { role: "user", content: "NEXT" } },
		]);
		const before = recordBytes(world, id);
		const told = await runTurn(world, context, id, "high");
		if (told.type !== "error") throw new Error("expected the stop");
		expect(told.error.errorMessage).toBe(ACP_STOPS.claudeSkip.text);
		expect(sealedNotices(told)).toContain(`[acp: ${backend.heldInputsNotice(1, 0)}]`);
		expect(told.error.diagnostics?.[0]).toMatchObject({
			type: backend.ACP_SKIP_NOTICE_DIAGNOSTIC,
			details: { turnIds: [marker.turnId] },
		});
		// Nothing was started for it, and the record is as it was.
		expect(world.children).toHaveLength(1);
		expect(recordBytes(world, id)).toBe(before);
		// That stop is stored with its notice: the turn after it resumes the session without the held input.
		context.messages.push({ role: "user", content: "THEN", timestamp: 10 });
		const after = await runTurn(world, context, id, "high");
		expect(after.type).toBe("done");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["NEXT", "THEN"] });
		expect(world.prompts.flatMap((prompt) => prompt.blocks)).toEqual(expect.arrayContaining(["CUT", "NEXT", "THEN"]));
		expect(world.prompts.filter((prompt) => prompt.blocks.includes("CUT"))).toHaveLength(1);
	});

	it("[QK:ACP-CLOSE-BEFORE-DISPOSE] an idle session that is left gets session/close before its agent is disposed, where the agent offers it; its answer decides nothing", async () => {
		quietStderr();
		const offers = { agentCapabilities: { sessionCapabilities: { resume: {}, close: {} } } };
		const rows: Array<[string, (() => void | Promise<void>) | undefined]> = [
			["answered", undefined],
			[
				"refused",
				() => {
					throw new Error("close refused");
				},
			],
			["never answered", () => new Promise<void>(() => {})],
		];
		for (const [name, onClose] of rows) {
			const world = makeWorld();
			world.hooks.initialize = offers;
			world.hooks.onClose = onClose;
			const id = `close-${name.replaceAll(" ", "-")}`;
			await runTurn(world, transcript("FIRST"), id, "high");
			const kills: string[] = [];
			const kill = world.children[0].kill.bind(world.children[0]);
			world.children[0].kill = (signal?: NodeJS.Signals | number) => {
				kills.push(world.wire.at(-1) ?? "");
				return kill(signal);
			};
			expect(await backend.releaseAcpSessions(id), name).toBe(1);
			expect(world.wire, name).toEqual(["initialize", "new", "prompt", "close:ACP-1"]);
			// The agent was signalled only after the close had gone out.
			expect(kills.length, name).toBeGreaterThan(0);
			expect(new Set(kills), name).toEqual(new Set(["close:ACP-1"]));
			// Closed is not deleted: the same session is resumed afterwards.
			expect((await runTurn(world, transcript("FIRST", "SECOND"), id, "high")).type, name).toBe("done");
			expect(world.prompts.at(-1), name).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
		}
		// An agent that does not offer it is sent none.
		const world = makeWorld();
		await runTurn(world, transcript("FIRST"), "close-not-offered", "high");
		expect(await backend.releaseAcpSessions("close-not-offered")).toBe(1);
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
	});

	it("[QK:ACP-LEASE-RELEASE-NEEDS-PROOF] the hold on a session is given up only once its agent is seen gone, and until then no second agent resumes it", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "lease-proof";
		await runTurn(world, transcript("FIRST"), id, "high");
		// An agent that takes the signal and stays.
		world.children[0].kill = () => true;
		expect(await backend.releaseAcpSessions(id, undefined, 20)).toBe(0);
		expect(existsSync(leaseOf(world))).toBe(true);
		const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high", {
			deps: { childExitTimeoutMs: 20 },
		});
		expect(errorText(stopped)).toBe(ACP_STOPS.resume.text);
		expect(world.children).toHaveLength(1);
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
		// Its exit is observed: now the hold goes, and the session can be resumed.
		world.children[0].exit(null, "SIGKILL");
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		expect(existsSync(leaseOf(world))).toBe(false);
		expect((await runTurn(world, transcript("FIRST", "SECOND"), id, "high")).type).toBe("done");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
	});

	it("[QK:ACP-ATTACH-MCP-CHANGE] a changed MCP server set is given to the same session by resuming it; a changed permission stops and keeps it", async () => {
		const world = makeWorld();
		const id = "attach-mcp";
		await runTurn(world, transcript("FIRST"), id, "high");
		const base = world.deps.loadConfig;
		const extra = { name: "extra", command: "/bin/true", args: [], env: [] };
		world.deps.loadConfig = (cwd, modelId, adapter) => {
			const resolved = base(cwd, modelId, adapter);
			return { ...resolved, mcpServers: [...resolved.mcpServers, extra as never], mcpServersHash: "set-two" };
		};
		const { sealed, shown } = await shownTurn(world, transcript("FIRST", "SECOND"), id);
		expect(sealed.type).toBe("done");
		// The live agent was closed, by us: that is no death to announce.
		expect(shown).not.toContain("ended between turns");
		expect(world.wire).toEqual(["initialize", "new", "prompt", "initialize", "resume", "prompt"]);
		expect(world.resumes[0]).toMatchObject({ sessionId: "ACP-1" });
		expect((world.resumes[0].mcpServers as Array<{ name: string }>).map((server) => server.name)).toContain("extra");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
		expect(recordOf(world, id)).toMatchObject({ status: "found", record: { config: { mcpServers: "set-two" } } });
		// Anything else that changed is not something a session can be given: the turn stops, the session stays.
		const changed = world.deps.loadConfig;
		world.deps.loadConfig = (cwd, modelId, adapter) => ({
			...changed(cwd, modelId, adapter),
			permissionAllow: ["Bash(rm:*)"],
		});
		const stopped = await runTurn(world, transcript("FIRST", "SECOND", "THIRD"), id, "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.config.text);
		expect(world.children).toHaveLength(2);
		world.deps.loadConfig = changed;
		expect((await runTurn(world, transcript("FIRST", "SECOND", "THIRD"), id, "high")).type).toBe("done");
		expect(world.wire.slice(6)).toEqual(["prompt"]);
	});

	it("[QK:ACP-ATTACH-RECORD-RECHECKED] the record a resume was planned on is read again under the lease: one that moved meanwhile stops the turn before any agent starts", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "attach-recheck";
		await runTurn(world, transcript("FIRST"), id, "high");
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		// Another Pi with the same session id seals a turn and releases, after this turn planned its delta
		// and before it holds the lease: the probe is first read inside the lease acquisition.
		const path = store.sessionRecordPath(keyOf(id), world.deps.sessionDir);
		const real = backend.acpLeaseProbe();
		let moved = "";
		world.deps.leaseProbe = {
			...real,
			get self() {
				if (moved === "") {
					const record = JSON.parse(readFileSync(path, "utf8"));
					moved = JSON.stringify({ ...record, sealedTurnId: "entwurf-turn:another-pi" });
					writeFileSync(path, moved);
				}
				return real.self;
			},
		};
		const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.resume.text);
		expect(world.children).toHaveLength(1);
		expect(world.wire).toEqual(["initialize", "new", "prompt"]);
		expect(readFileSync(path, "utf8")).toBe(moved);
		// No agent was started under the lease this turn took, so it does not stand in anyone's way.
		expect(existsSync(leaseOf(world))).toBe(false);
	});

	it("[QK:ACP-AGENT-TRACKED-PAST-EXIT] an agent that ended between turns is still tracked: while its process group is not empty the session is not resumed and its lease is not released", async () => {
		quietStderr();
		const world = makeWorld();
		const id = "agent-group";
		await runTurn(world, transcript("FIRST"), id, "high");
		// The agent ends by itself; something it started is still running in its group.
		let groupEmpty = false;
		world.deps.childGroupGone = () => groupEmpty;
		world.children[0].exit(0);
		const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high", {
			deps: { childExitTimeoutMs: 20 },
		});
		expect(errorText(stopped)).toBe(ACP_STOPS.resume.text);
		expect(world.children).toHaveLength(1);
		expect(await backend.releaseAcpSessions(id, undefined, 20, () => groupEmpty)).toBe(0);
		expect(existsSync(leaseOf(world))).toBe(true);
		// An `error` event is not an exit: an agent that raised one and has a pid is not proven gone by it.
		// The group empties: now the session is resumed, by this process, on a second agent.
		groupEmpty = true;
		const resumed = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
		expect(resumed.type).toBe("done");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: "ACP-1", blocks: ["SECOND"] });
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-LEASE-RELEASE-WAITS-FOR-GROUP] an agent's process group that empties a moment after its exit is waited for: the hold is released within the wait", async () => {
		const world = makeWorld();
		const id = "release-waits";
		await runTurn(world, transcript("FIRST"), id, "high");
		// Measured on a real quit (2026-11-22): the agent exits first, the vendor process it started later.
		let asked = 0;
		expect(await backend.releaseAcpSessions(id, undefined, 2_000, () => ++asked > 3)).toBe(1);
		expect(asked).toBe(4);
		expect(existsSync(leaseOf(world))).toBe(false);
	});

	it("[QK:ACP-ATTACH-TEXT-CHANGE-STOPS] a stored session is not resumed under a setup text other than the one it was opened with", async () => {
		const world = makeWorld();
		const id = "attach-text";
		await runTurn(world, transcript("FIRST"), id, "high");
		expect(await backend.releaseAcpSessions(id)).toBe(1);
		const path = store.sessionRecordPath(keyOf(id), world.deps.sessionDir);
		const record = JSON.parse(readFileSync(path, "utf8"));
		// As if the carrier had read otherwise when the session was opened: only the text part differs.
		const before = JSON.stringify({
			...record,
			bridgeConfigSignature: "opened-with-another-text",
			config: { ...record.config, text: "another-text" },
		});
		writeFileSync(path, before);
		const stopped = await runTurn(world, transcript("FIRST", "SECOND"), id, "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.config.text);
		expect(world.children).toHaveLength(1);
		expect(readFileSync(path, "utf8")).toBe(before);
	});

	it("[QK:ACP-D18-UNHOSTED-STOPS] a Pi that is neither a resident nor an explicit one-shot stops an ACP turn before any spawn", async () => {
		const world = makeWorld();
		const unhosted = { ...world.deps, lifecyclePolicy: () => "unhosted" as const };
		const opts = { sessionId: "d18-unhosted", reasoning: "high" } as Parameters<typeof backend.streamAcpTurn>[2];
		let sealed: AssistantMessageEvent | undefined;
		for await (const event of backend.streamAcpTurn(sonnet(), transcript("NEVER-SENT"), opts, unhosted)) sealed = event;
		if (!sealed) throw new Error("no seal");
		expect(errorText(sealed)).toBe(ACP_STOPS.mode.text);
		assertNoReplay(errorText(sealed));
		expect(sealedNotices(sealed)).toEqual([
			"[acp: this Pi has no entwurf control and is not an explicit one-shot]",
			"[acp: next: start this session with entwurf pi]",
			`[acp: ${backend.ACP_NO_SESSION_NOTICE}]`,
		]);
		expect(world.children).toHaveLength(0);
		expect(readdirSync(world.deps.sessionDir as string)).toEqual([]);
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
		// The way out is a notice of its own and arrives whole: one line with the cause would be clipped at 80.
		expect(sealedNotices(refused)).toEqual([
			"[acp: session record unreadable (code=EISDIR)]",
			"[acp: next: make the record file readable, then send again]",
			`[acp: ${backend.ACP_NO_SESSION_NOTICE}]`,
		]);
		expect(errorText(refused)).not.toMatch(/remove/);
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

	it("[QK:ACP-REUSE-REFUSAL-KEEPS-SESSION] a mismatched answer on reuse fails before the prompt, keeps the live session, and the next turn sends the unsent input with its own", async () => {
		let answer = (value: string) => value;
		const world = makeWorld((value) => answer(value));
		await runTurn(world, transcript("first"), "th-reuse-mismatch", "high");
		answer = () => "default";
		const sealed = await runTurn(world, transcript("first", "second"), "th-reuse-mismatch", "low");
		expect(world.log.at(-1)).toBe("set:effort=low");
		assertNoReplay(errorText(sealed));
		expect(world.children).toHaveLength(1);
		answer = (value) => value;
		// The refused turn's answer is on the branch and "second" never reached the vendor: the next turn
		// sends it with "third", on the same session.
		const next = await runTurn(world, transcript("first", "second", "third"), "th-reuse-mismatch", "low");
		expect(next.type).toBe("done");
		expect(world.children).toHaveLength(1);
		expect(world.prompts.at(-1)?.blocks).toEqual(["second", "third"]);
		expect(world.prompts).toHaveLength(2);
	});

	it("[QK:ACP-THINKING-REUSE-ABORT] an abort already raised when a reuse turn starts waiting for a changed effort settles at once, sends no prompt and keeps the session", async () => {
		await reuseAbortDuringEffort("th-reuse-abort", false);
	}, 40_000);

	it("[QK:ACP-THINKING-REUSE-ABORT-LATE] an abort that arrives while a reuse turn is waiting for a changed effort settles at once, sends no prompt and keeps the session", async () => {
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

	it("[QK:ACP-CANCEL-NOTICE-NEW-KEPT] a cancelled first turn the agent answered keeps its session, says so, and the next message continues it", async () => {
		const gate: { hold: boolean; waiting?: () => void } = { hold: false };
		const world = makeWorld(undefined, undefined, gate);
		const { sealed, shown } = await abortedTurn(world, gate, transcript("first"), "cx-new");
		expect(sealed.type === "error" && sealed.reason).toBe("aborted");
		expect(shown).toContain(`[acp: ${backend.ACP_CANCEL_KEPT_NOTICE}]`);
		expect(shown).not.toContain(backend.ACP_CANCEL_CLOSED_NOTICE);
		gate.hold = false;
		expect((await runTurn(world, transcript("first", "second"), "cx-new", "high")).type).toBe("done");
		expect(world.children).toHaveLength(1);
		expect(world.wire).toEqual(["initialize", "new", "prompt", "prompt"]);
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
		await runTurn(world, transcript("first"), "late-own", "high");
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

describe("streamAcpTurn — a resident's branch gate and payload hook (#171 step 8)", () => {
	const finalOf = (event: AssistantMessageEvent): AssistantMessage => {
		if (event.type === "done") return event.message;
		if (event.type === "error") return event.error;
		throw new Error(`not a seal: ${event.type}`);
	};

	it("[QK:ACP-TURN-ID-ON-FINAL] every turn's final message carries its own turn id, sealed or stopped", async () => {
		const world = makeWorld();
		const first = finalOf(await runTurn(world, transcript("one"), "turn-id", "high"));
		const second = finalOf(await runTurn(world, transcript("one", "two"), "turn-id", "high"));
		const stopped = finalOf(
			await runTurn(world, transcript("x"), "turn-id-stop", "high", { deps: { sessionReader: () => undefined } }),
		);
		const ids = [first.responseId, second.responseId, stopped.responseId];
		for (const id of ids) expect(id).toMatch(/^entwurf-turn:[0-9a-f-]{36}$/);
		expect(new Set(ids).size).toBe(3);
	});

	it("[QK:ACP-REUSE-NEEDS-EXACT-ANSWER] equal text is not proof: another answer to the same input stops the turn and keeps the session", async () => {
		const world = makeWorld();
		const id = "gate-sibling";
		await runTurn(world, transcript("first"), id, "high");
		const firstAnswer = piHost.lastTurnId(id);
		if (!firstAnswer) throw new Error("no first turn id");
		// Control: Pi's branch ends in the answer this session gave, so the delta goes to the live session.
		expect((await runTurn(world, transcript("first", "second"), id, "high")).type).toBe("done");
		expect(world.prompts).toHaveLength(2);
		const context = transcript("first", "second", "third");
		// The pin moves with each seal: a branch that ends in the FIRST answer is no longer this session's last.
		piHost.setBranch(id, entriesOf(context.messages, { responseId: firstAnswer }));
		expect(errorText(await runTurn(world, context, id, "high"))).toBe(ACP_STOPS.changed.text);
		expect(world.prompts).toHaveLength(2);
		// /tree onto a sibling answer B with the same text, then a new input. The content prefix still matches.
		piHost.setBranch(id, entriesOf(context.messages, { responseId: "entwurf-turn:another-answer" }));
		const stopped = await runTurn(world, context, id, "high");
		expect(errorText(stopped)).toBe(ACP_STOPS.changed.text);
		expect(sealedNotices(stopped)).toContain(`[acp: next: ${ACP_STOPS.changed.exit}]`);
		expect(world.prompts).toHaveLength(2);
		expect(world.children).toHaveLength(1);
		expect(world.lifecycle).toEqual([]);
	});

	it("[QK:ACP-REUSE-INPUTS-MATCH-CONTEXT] an input the Pi session shows and the provider context lacks stops the turn: nothing is sent and nothing vanishes", async () => {
		const world = makeWorld();
		const id = "gate-dropped-input";
		await runTurn(world, transcript("first"), id, "high");
		const sealedId = piHost.lastTurnId(id);
		if (!sealedId) throw new Error("no sealed turn id");
		// Pi's branch: the answer, then X (sibling mail) and Y. A context transform dropped X: the context
		// carries the answer and Y only. The content prefix and the pinned answer both hold.
		const context = transcript("first", "Y");
		const shown = (extra: unknown[]) => {
			const entries = entriesOf(context.messages, { responseId: sealedId });
			entries.splice(entries.length - 1, 0, ...extra);
			return entries;
		};
		const mail = { type: "custom_message", id: "mail", customType: "entwurf", content: "X" };
		for (const [name, branch] of [
			["dropped", shown([mail])],
			["dropped user", shown([{ type: "message", id: "x", message: { role: "user", content: "X" } }])],
			[
				"replaced",
				shown([]).map((e, i, all) =>
					i === all.length - 1 ? { ...(e as object), message: { role: "user", content: "Z" } } : e,
				),
			],
			["added", shown([]).slice(0, -1)],
		] as const) {
			piHost.setBranch(id, branch as unknown[]);
			const stopped = await runTurn(world, context, id, "high");
			expect(errorText(stopped), name).toBe(ACP_STOPS.changed.text);
			expect(world.prompts, name).toHaveLength(1);
			expect(world.children, name).toHaveLength(1);
		}
		// Two inputs that a joined-and-hashed comparison reads alike and the wire does not: one string
		// against two text blocks. And an input that is not text only is not compared at all.
		const split = transcript("first", "unused");
		split.messages.splice(-1, 1, {
			role: "user",
			content: [
				{ type: "text", text: "alpha" },
				{ type: "text", text: "beta" },
			],
			timestamp: 9,
		});
		const asOneString = entriesOf(split.messages, { responseId: sealedId });
		asOneString[asOneString.length - 1] = {
			type: "message",
			id: "joined",
			message: { role: "user", content: "alpha|text:beta" },
		};
		piHost.setBranch(id, asOneString);
		expect(errorText(await runTurn(world, split, id, "high"))).toBe(ACP_STOPS.changed.text);
		const image = transcript("first", "unused");
		image.messages.splice(-1, 1, {
			role: "user",
			content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
			timestamp: 9,
		});
		piHost.setBranch(id, entriesOf(image.messages, { responseId: sealedId }));
		expect(errorText(await runTurn(world, image, id, "high"))).toBe(ACP_STOPS.changed.text);
		expect(world.prompts).toHaveLength(1);

		// Control: the same branch without the dropped input sends Y; and mail the context does carry is sent.
		piHost.setBranch(id, shown([]));
		expect((await runTurn(world, context, id, "high")).type).toBe("done");
		expect(world.prompts.at(-1)?.blocks).toEqual(["Y"]);
		const withMail = transcript("first", "Y", "unused");
		withMail.messages.splice(
			-1,
			1,
			{ role: "user", content: [{ type: "text", text: "MAIL" }], timestamp: 9 },
			{ role: "user", content: "after mail", timestamp: 9 },
		);
		const entries = entriesOf(withMail.messages, { responseId: piHost.lastTurnId(id) ?? "" });
		entries[entries.length - 2] = { type: "custom_message", id: "m2", customType: "entwurf", content: "MAIL" };
		piHost.setBranch(id, entries);
		expect((await runTurn(world, withMail, id, "high")).type).toBe("done");
		expect(world.prompts.at(-1)?.blocks).toEqual(["MAIL", "after mail"]);
	});

	it("[QK:ACP-REUSE-SENDS-CHECKED-DELTA] the delta that was compared is the delta that is sent and marked, whatever happens to the context while the turn waits", async () => {
		const gate: { hold: boolean; waiting?: () => void; release?: () => void } = { hold: false };
		const world = makeWorld(undefined, gate);
		const id = "gate-check-use";
		await runTurn(world, transcript("first"), id, "high");
		const context = transcript("first", "second");
		const range = { start: context.messages.length - 1, count: 1 };
		// An extension that kept the context changes the checked input and adds another, while the turn
		// waits for the effort readback.
		gate.hold = true;
		gate.waiting = () => {
			(context.messages.at(-1) as { content: unknown }).content = "CHANGED-AFTER-CHECK";
			context.messages.push({ role: "user", content: "ADDED-AFTER-CHECK", timestamp: 9 });
			gate.hold = false;
			gate.release?.();
		};
		let marked: unknown;
		world.hooks.onPrompt = () => {
			const file = join(world.sessionDir, readdirSync(world.sessionDir)[0]);
			marked = JSON.parse(readFileSync(file, "utf8")).pendingDispatch;
		};
		expect((await runTurn(world, context, id, "low")).type).toBe("done");
		expect(world.log.slice(-2)).toEqual(["set:effort=low", "prompt"]);
		expect(world.prompts.at(-1)?.blocks).toEqual(["second"]);
		expect(marked).toMatchObject(range);
	});

	it("[QK:ACP-RESIDENT-NEEDS-PI-SESSION] a resident turn with no readable Pi session, or for another session id, stops before any process", async () => {
		const world = makeWorld();
		const none = await runTurn(world, transcript("go"), "host-none", "high", {
			deps: { sessionReader: () => undefined },
		});
		expect(errorText(none)).toBe(ACP_STOPS.host.text);
		const other = await runTurn(world, transcript("go"), "host-other", "high", {
			deps: {
				sessionReader: () => ({ getSessionId: () => "someone-else", getBranch: () => [], getEntries: () => [] }),
			},
		});
		expect(errorText(other)).toBe(ACP_STOPS.host.text);
		expect(world.children).toHaveLength(0);
		// A one-shot reads no Pi session.
		const oneShot = await runTurn(world, transcript("go"), "host-one-shot", "high", {
			deps: { sessionReader: () => undefined, lifecyclePolicy: () => "turn-scoped" },
		});
		expect(oneShot.type).toBe("done");
	});

	it("[QK:ACP-HOOK-RESIDENT-STOPS] a hook that changes a resident's prompt stops the turn before the marker and keeps the session", async () => {
		const rewrites: Record<
			string,
			(payload: { sessionId: string; prompt: Array<{ type: string; text: string }> }) => unknown
		> = {
			replacement: (p) => ({ sessionId: p.sessionId, prompt: [{ type: "text", text: "REWRITTEN" }] }),
			"in place": (p) => {
				p.prompt[0].text = "REWRITTEN";
				return undefined;
			},
			"an extra key": (p) => ({ ...p, _meta: { added: true } }),
			"an added block": (p) => ({ sessionId: p.sessionId, prompt: [...p.prompt, { type: "text", text: "MORE" }] }),
		};
		for (const [name, onPayload] of Object.entries(rewrites)) {
			const world = makeWorld();
			const id = `hook-${name}`;
			await runTurn(world, transcript("first"), id, "high");
			const record = () => readFileSync(join(world.sessionDir, readdirSync(world.sessionDir)[0]), "utf8");
			const before = record();
			const two = transcript("first", "second");
			two.messages.push({ role: "user", content: "also", timestamp: 9 });
			const stopped = await runTurn(world, two, id, "high", {
				options: { onPayload },
			});
			expect(errorText(stopped), name).toBe(ACP_STOPS.hook.text);
			expect(sealedNotices(stopped), name).toContain(`[acp: next: ${ACP_STOPS.hook.exit}]`);
			expect(world.prompts, name).toHaveLength(1);
			expect(world.children, name).toHaveLength(1);
			expect(world.lifecycle, name).toEqual([]);
			// No marker: the record is byte-identical to the sealed one.
			expect(record(), name).toBe(before);
		}
		// Control: a hook that only looks leaves the resident turn alone.
		const world = makeWorld();
		await runTurn(world, transcript("first"), "hook-observer", "high");
		const seen: unknown[] = [];
		const passed = await runTurn(world, transcript("first", "second"), "hook-observer", "high", {
			options: { onPayload: (p: unknown) => void seen.push(structuredClone(p)) },
		});
		expect(passed.type).toBe("done");
		expect(seen).toHaveLength(1);
		// The first turn of a resident is held to the same rule.
		const birth = makeWorld();
		const first = await runTurn(birth, transcript("first"), "hook-birth", "high", {
			options: { onPayload: rewrites.replacement },
		});
		expect(errorText(first)).toBe(ACP_STOPS.hook.text);
		expect(birth.prompts).toHaveLength(0);
	});

	it("[QK:ACP-HOOK-DETACHED-PAYLOAD] what is checked is what is sent: a hook that changes its object after the check changes nothing on the wire", async () => {
		// A microtask queued from a microtask runs after the hook's result was checked and before the caller resumes.
		const later = (change: () => void) => queueMicrotask(() => queueMicrotask(change));
		const world = makeWorld();
		await runTurn(world, transcript("first"), "hook-late", "high");
		const resident = await runTurn(world, transcript("first", "second"), "hook-late", "high", {
			options: {
				onPayload: (p: { sessionId: string; prompt: Array<{ text: string }> }) => {
					later(() => {
						p.sessionId = "SOMEONE-ELSE";
						p.prompt[0].text = "LATE";
					});
				},
			},
		});
		expect(resident.type).toBe("done");
		expect(world.prompts.at(-1)).toMatchObject({ sessionId: world.prompts[0].sessionId, blocks: ["second"] });

		const replacement = { sessionId: "", prompt: [{ type: "text", text: "REPLACED" }] };
		const oneShot = await runTurn(world, transcript("go"), "hook-late-one-shot", "high", {
			deps: { lifecyclePolicy: () => "turn-scoped" as const },
			options: {
				onPayload: (p: { sessionId: string }) => {
					replacement.sessionId = p.sessionId;
					later(() => {
						replacement.sessionId = "SOMEONE-ELSE";
						replacement.prompt[0].text = "LATE";
					});
					return replacement;
				},
			},
		});
		expect(oneShot.type).toBe("done");
		expect(world.prompts.at(-1)?.blocks).toEqual(["REPLACED"]);
		expect(world.prompts.at(-1)?.sessionId).not.toBe("SOMEONE-ELSE");
	});

	it("[QK:ACP-HOOK-EFFECTIVE-PAYLOAD] a hook that returns nothing is still checked: a session id changed in place is refused, a one-shot's in-place rewrite is sent", async () => {
		const oneShot = { lifecyclePolicy: () => "turn-scoped" as const };
		const world = makeWorld();
		const tampered = await runTurn(world, transcript("go"), "hook-inplace-id", "high", {
			deps: oneShot,
			options: {
				onPayload: (p: { sessionId: string }) => {
					p.sessionId = "SOMEONE-ELSE";
				},
			},
		});
		expect(errorText(tampered)).toContain("changed the ACP sessionId");
		expect(world.prompts).toHaveLength(0);
		const emptied = await runTurn(world, transcript("go"), "hook-inplace-empty", "high", {
			deps: oneShot,
			options: {
				onPayload: (p: { prompt: unknown[] }) => {
					p.prompt.length = 0;
				},
			},
		});
		expect(errorText(emptied)).toContain("non-empty prompt array");
		expect(world.prompts).toHaveLength(0);
		const rewritten = await runTurn(world, transcript("go"), "hook-inplace-text", "high", {
			deps: oneShot,
			options: {
				onPayload: (p: { prompt: Array<{ text: string }> }) => {
					p.prompt[p.prompt.length - 1].text = "REWRITTEN-IN-PLACE";
				},
			},
		});
		expect(rewritten.type).toBe("done");
		expect(world.prompts.at(-1)?.text).toContain("REWRITTEN-IN-PLACE");
	});
});
