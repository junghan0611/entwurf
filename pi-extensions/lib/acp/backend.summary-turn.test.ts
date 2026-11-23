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

import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
import { generateBranchSummary, generateSummary } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { fakePiHost } from "../../../scripts/lib/acp-fake-pi-session.ts";
import type { AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";
import { ACP_STOPS } from "./stop-texts.ts";

// #171 step 8: the Pi session a resident turn reads, kept in step with each call.
const piHost = fakePiHost();

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
	backend = piHost.wrap(await import("./backend.ts"));
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
	// #168: these worlds take the bundled launches; an ambient operator override is cleared for this test and restored after it.
	for (const name of ["CLAUDE_AGENT_ACP_COMMAND", "AGY_ACP_COMMAND"]) {
		const ambient = process.env[name];
		if (ambient === undefined) continue;
		delete process.env[name];
		onTestFinished(() => {
			process.env[name] = ambient;
		});
	}
	const launchOf = new Map<AcpChildLike, string>();
	const deps: AcpTurnDeps = {
		spawnChild: (launch) => {
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
			launchOf.set(child, launch.command);
			return child;
		},
		createConnection: (child, registered) => {
			handlers = registered;
			const acpSessionId = `ACP-${children.length}`;
			return {
				// #168: answer as the server the launch names; an unknown launch fails the world.
				initialize: async () => {
					const { AGY_ACP_AGENT, CLAUDE_ACP_AGENT } = await import("./backend-adapter.ts");
					const command = launchOf.get(child);
					const a = command === "agy" ? AGY_ACP_AGENT : command === process.execPath ? CLAUDE_ACP_AGENT : undefined;
					if (!a) throw new Error(`test world: unexpected ACP launch ${command}`);
					return { agentInfo: { name: a.name, version: a.floor } };
				},
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
		sessionReader: piHost.sessionReader,
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
		birthDir: `${sessionDir}-births`,
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
		await ordinaryTurn(world, transcript("hello"), "S-ordinary-1");
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
		await ordinaryTurn(world, transcript("hello"), "S-ordinary-2");
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
		await ordinaryTurn(world, transcript("hello"), "S-ordinary-3");
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

	// #172: a conversation one-shot whose prompt failed seals a fixed stop so Pi cannot replay it
	// ([QK:ACP-ONE-SHOT-PROMPT-NO-REPLAY]); Pi's summary request is stateless and tool-less, so it is the
	// stated exception and keeps the agent's and the transport's own words, retryable ones included.
	it("[QK:ACP-SUMMARY-FAILURE-KEEPS-WORDS] a summary request whose prompt fails keeps the failure's own words, not the one-shot fixed stop", async () => {
		const transient = "ACP connection closed";
		for (const said of [transient, "fake agent: the summary prompt failed"]) {
			const world = makeWorld();
			const failed = Promise.reject(new Error(said));
			failed.catch(() => {});
			world.control.hold = failed;
			const summaryContext = normalizeContext({
				systemPrompt: "summarize",
				messages: [{ role: "user", content: "<conversation>hello</conversation>", timestamp: 0 }],
			});
			const opts = { sessionId: "S-summary-fails", reasoning: "medium", cacheRetention: "none" } as Parameters<
				typeof backend.streamAcpTurn
			>[2];
			const events: AssistantMessageEvent[] = [];
			for await (const event of backend.streamAcpTurn(sonnet(), summaryContext, opts, world.deps)) events.push(event);
			const sealed = events.filter((e) => e.type === "done" || e.type === "error");
			expect(sealed, said).toHaveLength(1);
			const [seal] = sealed;
			if (seal.type !== "error") throw new Error(`${said}: expected an error seal`);
			expect(seal.error.errorMessage, said).toContain(said);
			expect(seal.error.errorMessage, said).not.toBe(ACP_STOPS.oneShotUnknown.text);
			expect(seal.error.diagnostics?.map((d) => d.type) ?? [], said).not.toContain(
				backend.ACP_ONE_SHOT_UNKNOWN_DIAGNOSTIC,
			);
			expect(isRetryableAssistantError(seal.error), said).toBe(said === transient);
			expect(
				world.wire.filter((w) => w.method === "prompt"),
				said,
			).toHaveLength(1);
		}
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

describe("the Antigravity ACP backend through the turn driver (#167)", () => {
	function agyFlash(): Model<Api> {
		const row = models.curatedAgyModels().find((r) => r.id === "agy-gemini-3.8-flash");
		if (!row) throw new Error("agy-gemini-3.8-flash is not curated");
		return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
	}
	async function agyTurn(
		world: ReturnType<typeof makeWorld>,
		context: TranscriptContext,
		options: Record<string, unknown>,
	) {
		const events: AssistantMessageEvent[] = [];
		const opts = options as Parameters<typeof backend.streamAcpTurn>[2];
		for await (const event of backend.streamAcpTurn(agyFlash(), context, opts, world.deps)) events.push(event);
		const sealed = events.filter((e) => e.type === "done" || e.type === "error");
		expect(sealed).toHaveLength(1);
		return sealed[0];
	}

	it("an agy turn through the real driver: the carrier goes on session/new, then the native model, then the thought level, then the prompt", async () => {
		const world = makeWorld((say) =>
			say({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }),
		);
		const sealed = await agyTurn(world, transcript("hello"), { sessionId: "S-agy", reasoning: "low" });
		expect(sealed.type).toBe("done");
		expect(world.wire.map((c) => c.method)).toEqual(["newSession", "set:model", "set:thought_level", "prompt"]);
		expect(world.calls("newSession")[0]._meta).toBeDefined();
		expect(world.calls("set:model")[0].value).toBe("gemini-3.8-flash");
		expect(world.calls("set:thought_level")[0].value).toBe("low");
	});

	it("[QK:ACP-AGY-SUMMARY-EXECUTION-DENIED] Pi's summary request to an agy model runs in an isolated per-turn root with v1:deny-all, neutral cwd, and cleans up after child exit", async () => {
		const { AGY_GEMINI_OVERLAY_DIR, AGY_SUMMARY_ROOT_DIR, AGY_REAL_GEMINI_DIR } = await import("./overlay.ts");
		// Seed an operator token so the isolated summary overlay creates a token symlink to unlink on cleanup.
		const opAppData = join(AGY_REAL_GEMINI_DIR, "antigravity-cli");
		mkdirSync(opAppData, { recursive: true });
		const opToken = join(opAppData, "antigravity-oauth-token");
		writeFileSync(opToken, "test-token", { mode: 0o600 });

		// Seed the shared overlay with v1:hidden-turns first to prove summary turns never touch its bytes (C4).
		const { agyAdapter } = await import("./backend-adapter.ts");
		agyAdapter.ensureOverlay({
			cwd: join(SANDBOX, "project"),
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			sessionKey: "shared-pre",
		});
		const sharedSeatPath = join(AGY_GEMINI_OVERLAY_DIR, "config", "hooks.json");
		const sharedSeatBefore = readFileSync(sharedSeatPath, "utf8");
		expect(sharedSeatBefore).toContain("v1:hidden-turns");

		const piWorld = makeWorld(summarizerSays);
		const origSpawn = piWorld.deps.spawnChild;
		const seenLaunches: Array<{ args: string[]; cwd: string }> = [];
		let capturedHookSeat = "";
		piWorld.deps.spawnChild = (launch, launchCwd, extraEnv) => {
			seenLaunches.push({ args: launch.args, cwd: launchCwd });
			const idx = launch.args.indexOf("--gemini-dir");
			if (idx >= 0) {
				capturedHookSeat = readFileSync(join(launch.args[idx + 1], "config", "hooks.json"), "utf8");
			}
			const c = origSpawn(launch, launchCwd, extraEnv);
			const origKill = c.kill;
			c.kill = (sig) => {
				(c as { exitCode: number | null }).exitCode = 0;
				return origKill(sig);
			};
			return c;
		};
		const seen: { context?: TranscriptContext; options?: any } = {};
		const summary = await generateSummary(
			conversation("plan the release", "run the gates"),
			agyFlash(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"low",
			piStreamFn(piWorld, seen),
		);
		expect(summary).toBe(SUMMARY_BODY);
		expect(seen.options?.cacheRetention).toBe("none");
		expect(piWorld.children).toHaveLength(1);
		expect(seenLaunches).toHaveLength(1);
		const geminiIdx = seenLaunches[0].args.indexOf("--gemini-dir");
		expect(geminiIdx).toBeGreaterThanOrEqual(0);
		const usedGeminiDir = seenLaunches[0].args[geminiIdx + 1];
		expect(usedGeminiDir.startsWith(AGY_SUMMARY_ROOT_DIR)).toBe(true);
		expect(usedGeminiDir).not.toBe(AGY_GEMINI_OVERLAY_DIR);
		expect(seenLaunches[0].cwd.startsWith(AGY_SUMMARY_ROOT_DIR)).toBe(true);
		expect(capturedHookSeat).toContain("v1:deny-all");
		// newSession receives the neutral isolated cwd and empty MCP list.
		const nsParams = piWorld.calls("newSession")[0] as { cwd: string; mcpServers: unknown[] };
		expect(nsParams.cwd).toBe(seenLaunches[0].cwd);
		expect(nsParams.mcpServers).toEqual([]);
		// Shared overlay seat bytes stayed untouched, and operator token is still intact.
		expect(readFileSync(sharedSeatPath, "utf8")).toBe(sharedSeatBefore);
		expect(existsSync(opToken)).toBe(true);
		// Confirmed child exit + success cleaned up the per-turn summary root.
		await vi.waitFor(() => expect(existsSync(usedGeminiDir)).toBe(false));
	});

	it("[QK:ACP-SUMMARY-MODE-EXPLICIT] backend dispatch accepts only explicitly listed summaryTurnMode values and refuses absent or unknown modes before spawn", async () => {
		const { agyAdapter } = await import("./backend-adapter.ts");
		const origMode = agyAdapter.summaryTurnMode;
		try {
			(agyAdapter as { summaryTurnMode?: unknown }).summaryTurnMode = "unknown-mode";
			const world = makeWorld(summarizerSays);
			const context = normalizeContext({
				tools: [],
				messages: [...conversation("first"), { role: "user", content: "summarize", timestamp: 9 }],
			});
			const sealed = await agyTurn(world, context, {
				sessionId: "S-agy-badmode",
				reasoning: "low",
				cacheRetention: "none",
			});
			expect(sealed.type).toBe("error");
			const message = sealed.type === "error" ? (sealed.error.errorMessage ?? "") : "";
			expect(message).toContain("acp-summary-turn-unsupported");
			expect(isRetryableAssistantError({ stopReason: "error", errorMessage: message } as never)).toBe(false);
			expect(world.children).toHaveLength(0);
		} finally {
			(agyAdapter as { summaryTurnMode?: unknown }).summaryTurnMode = origMode;
		}
	});

	it("[QK:ACP-AGY-SUMMARY-CLEANUP-S3] failed summary unlinks only the isolated token symlink after confirmed exit; unconfirmed exit preserves everything", async () => {
		const { AGY_SUMMARY_ROOT_DIR, AGY_REAL_GEMINI_DIR } = await import("./overlay.ts");
		const opToken = join(AGY_REAL_GEMINI_DIR, "antigravity-cli", "antigravity-oauth-token");
		expect(existsSync(opToken)).toBe(true);

		// Case 1: failed summary + confirmed child exit -> token symlink unlinked, rootDir preserved.
		const beforeDirs = existsSync(AGY_SUMMARY_ROOT_DIR)
			? new Set(readdirSync(AGY_SUMMARY_ROOT_DIR))
			: new Set<string>();
		const failWorld = makeWorld(() => {
			throw new Error("boom in prompt");
		});
		const origSpawnFail = failWorld.deps.spawnChild;
		let failGeminiDir = "";
		failWorld.deps.spawnChild = (launch, launchCwd, extraEnv) => {
			const idx = launch.args.indexOf("--gemini-dir");
			if (idx >= 0) failGeminiDir = launch.args[idx + 1];
			const c = origSpawnFail(launch, launchCwd, extraEnv);
			const origKill = c.kill;
			c.kill = (sig) => {
				(c as { exitCode: number | null }).exitCode = 1;
				return origKill(sig);
			};
			return c;
		};
		const ctx = normalizeContext({
			tools: [],
			messages: [...conversation("first"), { role: "user", content: "summarize", timestamp: 9 }],
		});
		const failSealed = await agyTurn(failWorld, ctx, {
			sessionId: "S-agy-fail",
			reasoning: "low",
			cacheRetention: "none",
		});
		expect(failSealed.type).toBe("error");
		await vi.waitFor(() =>
			expect(existsSync(join(failGeminiDir, "antigravity-cli", "antigravity-oauth-token"))).toBe(false),
		);
		expect(existsSync(failGeminiDir)).toBe(true);
		expect(existsSync(opToken)).toBe(true);
		for (const d of readdirSync(AGY_SUMMARY_ROOT_DIR)) {
			if (!beforeDirs.has(d)) rmSync(join(AGY_SUMMARY_ROOT_DIR, d), { recursive: true, force: true });
		}

		// Case 2: length (max_tokens) summary + confirmed child exit -> token symlink unlinked, rootDir preserved (D2).
		const lengthWorld = makeWorld(summarizerSays);
		lengthWorld.control.stopReason = "max_tokens";
		const origSpawnLen = lengthWorld.deps.spawnChild;
		let lenGeminiDir = "";
		lengthWorld.deps.spawnChild = (launch, launchCwd, extraEnv) => {
			const idx = launch.args.indexOf("--gemini-dir");
			if (idx >= 0) lenGeminiDir = launch.args[idx + 1];
			const c = origSpawnLen(launch, launchCwd, extraEnv);
			const origKill = c.kill;
			c.kill = (sig) => {
				(c as { exitCode: number | null }).exitCode = 0;
				return origKill(sig);
			};
			return c;
		};
		const lenSealed = await agyTurn(lengthWorld, ctx, {
			sessionId: "S-agy-len",
			reasoning: "low",
			cacheRetention: "none",
		});
		expect(lenSealed.type).toBe("done");
		if (lenSealed.type === "done") expect(lenSealed.reason).toBe("length");
		await vi.waitFor(() =>
			expect(existsSync(join(lenGeminiDir, "antigravity-cli", "antigravity-oauth-token"))).toBe(false),
		);
		expect(existsSync(lenGeminiDir)).toBe(true);
		expect(existsSync(opToken)).toBe(true);
		for (const d of readdirSync(AGY_SUMMARY_ROOT_DIR)) {
			if (!beforeDirs.has(d)) rmSync(join(AGY_SUMMARY_ROOT_DIR, d), { recursive: true, force: true });
		}

		// Case 3: unconfirmed child exit (exitCode stays null) -> nothing unlinked or deleted.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const hungWorld = makeWorld(summarizerSays);
			hungWorld.deps.childExitTimeoutMs = 10;
			const origSpawnHung = hungWorld.deps.spawnChild;
			let hungGeminiDir = "";
			hungWorld.deps.spawnChild = (launch, launchCwd, extraEnv) => {
				const idx = launch.args.indexOf("--gemini-dir");
				if (idx >= 0) hungGeminiDir = launch.args[idx + 1];
				return origSpawnHung(launch, launchCwd, extraEnv);
			};
			await agyTurn(hungWorld, ctx, { sessionId: "S-agy-hung", reasoning: "low", cacheRetention: "none" });
			await vi.waitFor(() =>
				expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("summary child exit unconfirmed")),
			);
			expect(existsSync(hungGeminiDir)).toBe(true);
			expect(lstatSync(join(hungGeminiDir, "antigravity-cli", "antigravity-oauth-token")).isSymbolicLink()).toBe(true);
			expect(existsSync(opToken)).toBe(true);
			for (const d of readdirSync(AGY_SUMMARY_ROOT_DIR)) {
				if (!beforeDirs.has(d)) rmSync(join(AGY_SUMMARY_ROOT_DIR, d), { recursive: true, force: true });
			}
		} finally {
			warnSpy.mockRestore();
		}

		// Case 4 (D1): AGY_ACP_COMMAND override through the real driver refuses before creating any root or spawning.
		const ovWorld = makeWorld(summarizerSays);
		const prevOverride = process.env.AGY_ACP_COMMAND;
		process.env.AGY_ACP_COMMAND = "/opt/override-agy";
		try {
			const ovSealed = await agyTurn(ovWorld, ctx, { sessionId: "S-agy-ov", reasoning: "low", cacheRetention: "none" });
			expect(ovSealed.type).toBe("error");
			const ovMsg = ovSealed.type === "error" ? (ovSealed.error.errorMessage ?? "") : "";
			expect(ovMsg).toContain("acp-agy-summary-override-unsupported");
			expect(ovWorld.children).toHaveLength(0);
			const afterOvDirs = existsSync(AGY_SUMMARY_ROOT_DIR) ? readdirSync(AGY_SUMMARY_ROOT_DIR) : [];
			expect(afterOvDirs.filter((d) => !beforeDirs.has(d))).toEqual([]);
		} finally {
			if (prevOverride === undefined) delete process.env.AGY_ACP_COMMAND;
			else process.env.AGY_ACP_COMMAND = prevOverride;
		}
	});

	it("[QK:ACP-AGY-SUMMARY-CLEANUP-THROW-CONTAINED] a summary-root cleanup that throws after the seal leaves the answered turn as it was, is reported on stderr, and escapes as no unhandled rejection", async () => {
		const { agyAdapter } = await import("./backend-adapter.ts");
		const original = agyAdapter.ensureOverlay.bind(agyAdapter);
		const ensureSpy = vi.spyOn(agyAdapter, "ensureOverlay").mockImplementation((input) => {
			const real = original(input);
			if (!real.cleanup) return real;
			const cleanup = real.cleanup;
			return {
				...real,
				cleanup: (opts) => {
					cleanup(opts);
					throw Object.assign(new Error("EBUSY: resource busy or locked, rmdir"), { code: "EBUSY" });
				},
			};
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => void unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const world = makeWorld(summarizerSays);
			const origSpawn = world.deps.spawnChild;
			world.deps.spawnChild = (launch, launchCwd, extraEnv) => {
				const c = origSpawn(launch, launchCwd, extraEnv);
				const origKill = c.kill;
				c.kill = (sig) => {
					(c as { exitCode: number | null }).exitCode = 0;
					return origKill(sig);
				};
				return c;
			};
			const ctx = normalizeContext({
				tools: [],
				messages: [...conversation("first"), { role: "user", content: "summarize", timestamp: 9 }],
			});
			const sealed = await agyTurn(world, ctx, {
				sessionId: "S-agy-cleanup-throw",
				reasoning: "low",
				cacheRetention: "none",
			});
			expect(sealed.type).toBe("done");
			if (sealed.type === "done") expect(sealed.reason).toBe("stop");
			await vi.waitFor(() =>
				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringMatching(
						/^\[acp\] summary root cleanup failed; preserved .+: EBUSY: resource busy or locked, rmdir$/,
					),
				),
			);
			// One macrotask turn for a rejection of the finished microtask to surface.
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
			warnSpy.mockRestore();
			ensureSpy.mockRestore();
		}
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

	it("[QK:ACP-COMPACT-CLOSES-CHILD] after session_compact the retained child is gone, and the next turn opens no second session from the compacted transcript", async () => {
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
		// #171 step 8 (decision 17): the closed session's record stays, and no second session is opened for
		// this conversation. This branch shows a compaction and an input but not the answer the session
		// gave last, so nothing proves what to send: the turn stops with nothing sent. (A branch that does
		// show it resumes the same session: [QK:ACP-COMPACT-KEEPS-SESSION].)
		piHost.setBranch("S-compact", [
			{ type: "compaction", id: "c1", summary: SUMMARY_BODY },
			{ type: "message", id: "u1", message: { role: "user", content: "continue" } },
		]);
		const sealed = await ordinaryTurn(world, after, "S-compact");
		expect(sealed.type === "error" && sealed.error.errorMessage).toBe(ACP_STOPS.changed.text);
		expect(world.children).toHaveLength(1);
		expect(world.calls("prompt")).toHaveLength(2);
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

describe("a session replaced in this process closes the child it leaves (#151, GLG 2026-11-17)", () => {
	/** Load the provider entry against a fake Pi and return its session_shutdown handler. */
	async function shutdownHandler() {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const fakePi = {
			registerProvider() {},
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
		};
		const entry = (await import("../../acp-provider.ts")).default;
		entry(fakePi as never);
		const handler = handlers.get("session_shutdown");
		if (!handler) throw new Error("acp-provider registered no session_shutdown handler");
		return (reason: string, sessionId: string) =>
			handler({ type: "session_shutdown", reason }, { sessionManager: { getSessionId: () => sessionId } });
	}

	it("[QK:ACP-REPLACED-SESSION-CLOSES-CHILD] /new, /resume and /fork (and /renew, which rides newSession) close the leaving session's retained child at once, and the next session opens its own", async () => {
		const shutdown = await shutdownHandler();
		for (const reason of ["new", "resume", "fork"]) {
			const world = makeWorld();
			const leaving = `S-leave-${reason}`;
			await ordinaryTurn(world, transcript("chapter n"), leaving);
			await ordinaryTurn(world, transcript("chapter n", "more"), leaving);
			expect(world.children).toHaveLength(1);

			shutdown(reason, leaving);
			expect(world.killed.has(world.children[0])).toBe(true);
			expect(backend.closeRetainedAcpSession(leaving)).toBe(false);

			// The session that replaces it starts empty (/new, or /renew whose outline is its first message).
			const sealed = await ordinaryTurn(world, transcript("outline, then hello"), `S-next-${reason}`);
			expect(sealed.type).toBe("done");
			expect(world.children).toHaveLength(2);
		}
	});

	it("[QK:ACP-SHUTDOWN-RELOAD-QUIT-KEEP-CHILD] reload keeps the same session and its child; quit closes every retained child so its session can be released", async () => {
		const shutdown = await shutdownHandler();
		const world = makeWorld();
		await ordinaryTurn(world, transcript("one"), "S-stay-reload");
		await shutdown("reload", "S-stay-reload");
		expect(world.killed.size).toBe(0);
		await ordinaryTurn(world, transcript("one", "two"), "S-stay-reload");
		expect(world.children).toHaveLength(1);
		// quit: Pi awaits the handler. The agent is closed at once, whichever session Pi names.
		const quitting = makeWorld();
		await ordinaryTurn(quitting, transcript("one"), "S-stay-quit");
		const left = shutdown("quit", "another-session");
		expect(quitting.killed.has(quitting.children[0])).toBe(true);
		await left;
	}, 20_000);
});
