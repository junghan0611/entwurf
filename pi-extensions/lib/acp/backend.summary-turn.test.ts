/**
 * Pi's summary request runs as a one-shot, tool-less ACP turn, and a compaction closes the
 * conversation's Claude child (#163).
 *
 * Before this, every Pi-side summary on an ACP Claude model — manual `/compact`, the threshold,
 * overflow recovery, `/tree` branch summaries — was refused by the tool-surface preflight: the
 * request declares no tools, and an empty surface read as "the operator excluded read/bash/edit/
 * write". GLG's bar (2026-11-14): a manual `/compact` that completes, a summary that is exactly
 * what the model wrote (the session file is what gets embedded), the old Claude child closed
 * right after compaction, and sessions whose tools the operator narrowed get summaries too.
 *
 * The oracle for "what a summary request looks like" is Pi itself: the installed
 * `generateSummary` / `generateBranchSummary` drive the real `streamAcpTurn` through its
 * `AcpTurnDeps` seam with typed fakes, so the options and context the provider receives are
 * Pi's, not a fixture's. A Pi upgrade that stops marking summaries with `cacheRetention: "none"`
 * turns these red instead of silently restoring the refusal.
 *
 * Module state is sandboxed as in backend.thinking.test.ts: HOME/XDG/PI_CODING_AGENT_DIR point
 * into a temp dir BEFORE the dynamic import.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessageEvent,
	getCurrentSystemPrompt,
	getCurrentTools,
	type Message,
	type Model,
	normalizeContext,
	type TranscriptContext,
	type Usage,
} from "@earendil-works/pi-ai";
import { generateBranchSummary, generateSummary } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-summary-"));
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
const SUMMARY_BODY = "## Goal\nKeep the summary exactly as the model wrote it.";

function sonnet(): Model<Api> {
	const row = models.curatedClaudeModels().find((r) => r.id === "claude-sonnet-5-5");
	if (!row) throw new Error("claude-sonnet-5-5 is not curated");
	return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
}

function conversation(...userTurns: string[]): Message[] {
	const messages: Message[] = [];
	userTurns.forEach((text, i) => {
		messages.push({ role: "user", content: text, timestamp: i });
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
	});
	return messages;
}

/** An ordinary agent-loop context: Pi's tool surface declared, the user's latest turn last. */
function transcript(...userTurns: string[]): TranscriptContext {
	const messages = conversation(...userTurns.slice(0, -1));
	messages.push({ role: "user", content: userTurns.at(-1) ?? "", timestamp: userTurns.length });
	return normalizeContext({ tools: PI_TOOLS, messages });
}

type WireCall = { method: string; params: unknown };

/** One backend world. Records every wire call with its params and every child torn down. */
function makeWorld(
	agentOutput: (say: (update: Record<string, unknown>) => void) => void = () => {},
	decorate: (resolved: ReturnType<AcpTurnDeps["loadConfig"]>) => ReturnType<AcpTurnDeps["loadConfig"]> = (c) => c,
) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: AcpChildLike[] = [];
	const killed = new Set<AcpChildLike>();
	const wire: WireCall[] = [];
	/** What the next prompt does: its stop reason, and a gate it waits on (with a signal that it got there). */
	const control: { stopReason: string; hold?: Promise<void>; entered?: () => void } = { stopReason: "end_turn" };
	let handlers: Parameters<AcpTurnDeps["createConnection"]>[1] | undefined;
	const deps: AcpTurnDeps = {
		spawnChild: () => {
			const pipe = () => ({ destroy() {}, unref() {} });
			const child: AcpChildLike = {
				pid: undefined,
				exitCode: null,
				signalCode: null,
				stdin: pipe(),
				stdout: pipe(),
				stderr: { on() {}, destroy() {}, unref() {} },
				kill: () => {
					killed.add(child);
					return true;
				},
				unref() {},
				once() {},
			};
			children.push(child);
			return child;
		},
		createConnection: (_child, registered) => {
			handlers = registered;
			const acpSessionId = `ACP-${children.length}`;
			return {
				initialize: async () => ({}),
				newSession: async (params: unknown) => {
					wire.push({ method: "newSession", params });
					return { sessionId: acpSessionId };
				},
				setSessionConfigOption: async (p: any) => {
					wire.push({ method: `set:${p.configId}`, params: p });
					return { configOptions: [{ id: p.configId, currentValue: p.value }] };
				},
				prompt: async (params: unknown): Promise<AcpPromptResponse> => {
					wire.push({ method: "prompt", params });
					control.entered?.();
					if (control.hold) await control.hold;
					agentOutput((update) => void handlers?.sessionUpdate({ sessionId: acpSessionId, update } as never));
					return { stopReason: control.stopReason } as AcpPromptResponse;
				},
				cancel: () => {},
				close: () => {},
			};
		},
		lifecyclePolicy: () => "process-scoped",
		loadConfig: (cwd, modelId, adapter) =>
			decorate(
				config.resolveProviderConfig({
					cwd,
					modelId,
					adapter,
					globalSettingsPath: join(SANDBOX, "absent-global-settings.json"),
					projectSettingsPath: join(SANDBOX, "absent-project-settings.json"),
				}),
			),
		now: () => "2026-11-14T00:00:00Z",
		sessionDir,
		abortGraceMs: 40,
	};
	const calls = (method: string) => wire.filter((c) => c.method === method).map((c) => c.params as any);
	/** Hold the next prompts at the wire until the returned release is called. */
	const hold = () => {
		let release!: () => void;
		control.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const entered = new Promise<void>((resolve) => {
			control.entered = resolve;
		});
		return {
			entered,
			release: () => {
				control.hold = undefined;
				control.entered = undefined;
				release();
			},
		};
	};
	return { deps, children, killed, wire, calls, control, hold };
}

/** The agent writes a summary and, around it, everything that would otherwise become a notice. */
function summarizerSays(say: (update: Record<string, unknown>) => void): void {
	say({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash", status: "pending" });
	say({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [] });
	say({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: SUMMARY_BODY } });
	say({ sessionUpdate: "usage_update", used: 12_345, size: 1_000_000, cost: { amount: 0.01, currency: "USD" } });
}

/**
 * An operator surface with something to strip: one MCP server and one skill plugin on top of the
 * default tools and allow list. Without it the sandbox's empty defaults would make "the summary
 * child gets no MCP / no plugins" true of every turn.
 */
function operatorSurface(resolved: ReturnType<AcpTurnDeps["loadConfig"]>): ReturnType<AcpTurnDeps["loadConfig"]> {
	return {
		...resolved,
		mcpServers: [{ name: "operator-probe", command: "/bin/true", args: [], env: [] }],
		skillPlugins: [join(SANDBOX, "operator-skill-plugin")],
		settingSources: ["user", "project"],
	};
}

/** Pi's own summarizer, routed through the real turn driver; returns what the provider received. */
function piStreamFn(world: ReturnType<typeof makeWorld>, seen: { context?: TranscriptContext; options?: any }) {
	return ((model: Model<Api>, context: TranscriptContext, options: any) => {
		seen.context = context;
		seen.options = options;
		return backend.streamAcpTurn(model, context, options, world.deps);
	}) as never;
}

async function ordinaryTurn(world: ReturnType<typeof makeWorld>, context: TranscriptContext, sessionId: string) {
	const events: AssistantMessageEvent[] = [];
	const opts = { sessionId, reasoning: "medium" } as Parameters<typeof backend.streamAcpTurn>[2];
	for await (const event of backend.streamAcpTurn(sonnet(), context, opts, world.deps)) events.push(event);
	const sealed = events.filter((e) => e.type === "done" || e.type === "error");
	expect(sealed).toHaveLength(1);
	return sealed[0];
}

describe("Pi's summary request through the ACP turn driver (#163)", () => {
	it("[QK:ACP-SUMMARY-TURN-TOOLLESS] Pi's /compact summary reaches a child with no tools, no MCP, no plugin and nothing pre-approved", async () => {
		const world = makeWorld(summarizerSays, operatorSurface);
		// The same world's ordinary turn carries the operator surface the summary must drop.
		await ordinaryTurn(world, transcript("hello"), "S-ordinary");
		const [ordinary] = world.calls("newSession");
		expect(ordinary.mcpServers.map((s: { name: string }) => s.name)).toContain("operator-probe");
		expect(ordinary._meta.claudeCode.options.tools.length).toBeGreaterThan(0);
		expect(ordinary._meta.claudeCode.options.settings.permissions.allow.length).toBeGreaterThan(0);
		expect(ordinary._meta.claudeCode.options.plugins).toHaveLength(1);

		const seen: { context?: TranscriptContext; options?: any } = {};
		const summary = await generateSummary(
			conversation("plan the release", "run the gates"),
			sonnet(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			piStreamFn(world, seen),
		);
		expect(summary).toBe(SUMMARY_BODY);

		// Pi's side of the contract, read off what Pi actually sent.
		expect(seen.options?.cacheRetention).toBe("none");
		expect(getCurrentTools(seen.context?.messages ?? [])).toEqual([]);

		const created = world.calls("newSession").at(-1);
		expect(created.mcpServers).toEqual([]);
		const options = created._meta.claudeCode.options;
		expect(options.tools).toEqual([]);
		expect(options.settings.permissions.allow).toEqual([]);
		expect(options.plugins).toBeUndefined();
	});

	it("[QK:ACP-SUMMARY-INSTRUCTIONS-RELAYED] Pi's summarization instructions open the prompt; the conversation follows and no augment rides along", async () => {
		const world = makeWorld(summarizerSays);
		// In this cwd an ordinary first turn does carry the augment, so its absence below is a finding.
		await ordinaryTurn(world, transcript("hello"), "S-ordinary");
		expect(JSON.stringify(world.calls("prompt")[0].prompt)).toContain("AGENTS.md");
		const seen: { context?: TranscriptContext; options?: any } = {};
		await generateSummary(
			conversation("plan the release", "run the gates"),
			sonnet(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			piStreamFn(world, seen),
		);
		const prompted = world.calls("prompt").at(-1);
		const instructions = getCurrentSystemPrompt(seen.context?.messages ?? []).trim();
		expect(instructions.length).toBeGreaterThan(0);
		expect(prompted.prompt).toHaveLength(2);
		expect(prompted.prompt[0]).toEqual({ type: "text", text: instructions });
		expect(prompted.prompt[1].text).toContain("<conversation>");
		expect(prompted.prompt[1].text).toContain("plan the release");
		// The first-message augment (`## <path>/AGENTS.md` sections) belongs to a conversation, not a summary.
		expect(JSON.stringify(prompted.prompt)).not.toContain("AGENTS.md");
	});

	it("[QK:ACP-SUMMARY-TURN-NO-NOTICE] the summary Pi stores is exactly the model's text — no lifecycle or tool notice joins it", async () => {
		const world = makeWorld(summarizerSays);
		const summary = await generateSummary(
			conversation("first"),
			sonnet(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			piStreamFn(world, {}),
		);
		expect(summary).toBe(SUMMARY_BODY);
		expect(summary).not.toContain("[acp:");
		expect(summary).not.toContain("[tool:");
	});

	it("[QK:ACP-SUMMARY-TURN-NOT-RETAINED] the summary child is closed after its one turn, even under a process-scoped policy", async () => {
		const world = makeWorld(summarizerSays);
		await generateSummary(
			conversation("first"),
			sonnet(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			piStreamFn(world, {}),
		);
		expect(world.children).toHaveLength(1);
		expect(world.killed.has(world.children[0])).toBe(true);
	});

	it("a summary that arrives with the conversation's own session id leaves the conversation's child alone", async () => {
		const world = makeWorld();
		await ordinaryTurn(world, transcript("hello"), "S-shared");
		expect(world.children).toHaveLength(1);
		const summaryContext = normalizeContext({
			systemPrompt: "summarize",
			messages: [{ role: "user", content: "<conversation>hello</conversation>", timestamp: 0 }],
		});
		const opts = { sessionId: "S-shared", reasoning: "medium", cacheRetention: "none" } as Parameters<
			typeof backend.streamAcpTurn
		>[2];
		for await (const _ of backend.streamAcpTurn(sonnet(), summaryContext, opts, world.deps)) {
		}
		expect(world.children).toHaveLength(2);
		expect(world.killed.has(world.children[0])).toBe(false);
		expect(world.killed.has(world.children[1])).toBe(true);
		// The conversation continues on its own child.
		await ordinaryTurn(world, transcript("hello", "again"), "S-shared");
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-SUMMARY-REQUIRES-CACHE-RETENTION] an ordinary turn with every tool excluded is still refused before any child starts", async () => {
		const world = makeWorld();
		const context = normalizeContext({
			tools: [],
			messages: [{ role: "user", content: "do something", timestamp: 0 }],
		});
		const sealed = await ordinaryTurn(world, context, "S-no-tools");
		expect(sealed.type).toBe("error");
		expect(sealed.type === "error" && sealed.error.errorMessage).toContain("cannot honor --exclude-tools");
		expect(world.children).toHaveLength(0);
	});

	it("[QK:ACP-SUMMARY-TURN-NO-SETTING-SOURCES] the summary child reads none of the operator's Claude settings — no CLAUDE.md, hooks or plugins from disk", async () => {
		const world = makeWorld(summarizerSays, operatorSurface);
		await ordinaryTurn(world, transcript("hello"), "S-ordinary");
		expect(world.calls("newSession")[0]._meta.claudeCode.options.settingSources).toEqual(["user", "project"]);
		await generateSummary(
			conversation("first"),
			sonnet(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			piStreamFn(world, {}),
		);
		expect(world.calls("newSession").at(-1)._meta.claudeCode.options.settingSources).toEqual([]);
	});

	it("[QK:ACP-SUMMARY-VENDOR-CANCEL-NOT-KEPT] a summary the backend cancelled while Pi did not abort is refused by Pi, never stored as a checkpoint", async () => {
		const world = makeWorld(summarizerSays);
		world.control.stopReason = "cancelled";
		await expect(
			generateSummary(
				conversation("first"),
				sonnet(),
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"medium",
				piStreamFn(world, {}),
			),
		).rejects.toThrow(backend.ACP_SUMMARY_CANCELLED_MESSAGE);
	});

	it("[QK:ACP-SUMMARY-REQUIRES-EMPTY-SURFACE] a request that declares tools stays an ordinary turn even with cacheRetention none", async () => {
		const world = makeWorld();
		const opts = { sessionId: "S-tools-none", reasoning: "medium", cacheRetention: "none" } as Parameters<
			typeof backend.streamAcpTurn
		>[2];
		for await (const _ of backend.streamAcpTurn(sonnet(), transcript("hello"), opts, world.deps)) {
		}
		const [created] = world.calls("newSession");
		expect(created._meta.claudeCode.options.tools.length).toBeGreaterThan(0);
		expect(JSON.stringify(world.calls("prompt")[0].prompt)).toContain("AGENTS.md");
	});

	it("Pi's /tree branch summary takes the same tool-less path", async () => {
		const world = makeWorld(summarizerSays);
		const seen: { context?: TranscriptContext; options?: any } = {};
		const entries = conversation("explore option A").map((message, i) => ({
			type: "message" as const,
			id: `e${i}`,
			parentId: i === 0 ? null : `e${i - 1}`,
			timestamp: new Date(0).toISOString(),
			message,
		}));
		const result = await generateBranchSummary(entries as never, {
			model: sonnet(),
			signal: new AbortController().signal,
			thinkingLevel: "medium",
			streamFn: piStreamFn(world, seen),
		});
		expect(result.error).toBeUndefined();
		expect(result.summary).toContain(SUMMARY_BODY);
		expect(result.summary).not.toContain("[acp:");
		expect(seen.options?.cacheRetention).toBe("none");
		const [created] = world.calls("newSession");
		expect(created._meta.claudeCode.options.tools).toEqual([]);
		expect(world.killed.has(world.children[0])).toBe(true);
	});
});

describe("a compaction closes the conversation's Claude child (#163, GLG 2026-11-14)", () => {
	/** Load the provider entry against a fake Pi and return its session_compact handler. */
	async function compactHandler() {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const fakePi = {
			registerProvider() {},
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
		};
		const entry = (await import("../../acp-provider.ts")).default;
		entry(fakePi as never);
		const handler = handlers.get("session_compact");
		if (!handler) throw new Error("acp-provider registered no session_compact handler");
		return (sessionId: string) =>
			handler({ type: "session_compact" }, { sessionManager: { getSessionId: () => sessionId } });
	}

	it("[QK:ACP-COMPACT-CLOSES-CHILD] after session_compact the retained child is gone, and the next turn opens a new one from the compacted transcript", async () => {
		const world = makeWorld();
		await ordinaryTurn(world, transcript("long work"), "S-compact");
		await ordinaryTurn(world, transcript("long work", "more work"), "S-compact");
		expect(world.children).toHaveLength(1);

		const compacted = await compactHandler();
		compacted("S-compact");
		expect(world.killed.has(world.children[0])).toBe(true);

		const after = normalizeContext({
			tools: PI_TOOLS,
			messages: [
				{
					role: "user",
					content: `The conversation history before this point was compacted:\n${SUMMARY_BODY}`,
					timestamp: 0,
				},
				{ role: "user", content: "continue", timestamp: 1 },
			],
		});
		const sealed = await ordinaryTurn(world, after, "S-compact");
		expect(sealed.type).toBe("done");
		expect(world.children).toHaveLength(2);
		const prompts = world.calls("prompt");
		expect(JSON.stringify(prompts.at(-1).prompt)).toContain("Keep the summary exactly as the model wrote it.");
	});

	it("[QK:ACP-COMPACT-SPARES-TURN-IN-FLIGHT] a session whose turn is still running is not closed — neither a reused turn nor a first one", async () => {
		const compacted = await compactHandler();

		// A reused turn in flight: the retained session is busy and its key claimed.
		const world = makeWorld();
		await ordinaryTurn(world, transcript("one"), "S-reuse-busy");
		const reuse = world.hold();
		const running = ordinaryTurn(world, transcript("one", "two"), "S-reuse-busy");
		await reuse.entered;
		compacted("S-reuse-busy");
		expect(backend.closeRetainedAcpSession("S-reuse-busy")).toBe(false);
		expect(world.killed.has(world.children[0])).toBe(false);
		reuse.release();
		expect((await running).type).toBe("done");
		await ordinaryTurn(world, transcript("one", "two", "three"), "S-reuse-busy");
		expect(world.children).toHaveLength(1);

		// A first turn in flight: nothing is retained yet, so there is nothing to close.
		const fresh = makeWorld();
		const first = fresh.hold();
		const opening = ordinaryTurn(fresh, transcript("one"), "S-first-busy");
		await first.entered;
		compacted("S-first-busy");
		expect(fresh.killed.size).toBe(0);
		first.release();
		expect((await opening).type).toBe("done");
	});

	it("closes nothing for a session that holds no ACP child", async () => {
		expect(backend.closeRetainedAcpSession("never-used")).toBe(false);
	});
});
