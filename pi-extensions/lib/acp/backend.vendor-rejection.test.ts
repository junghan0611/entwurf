/**
 * A vendor `incomplete_tool_call` rejection must not invite pi's whole-prompt replay (#127).
 *
 * claude-agent-acp 0.85.1 (#1212) fails a turn that reached `end_turn` while foreground tool
 * calls were still unanswered. With `clientCapabilities: {}` it rejects `session/prompt` with
 * JSON-RPC -32603 `Internal error: Claude ended the turn without returning results for tool
 * calls: <ids>` and `data: {errorKind: "incomplete_tool_call"}`, after logging the same line
 * (with session and turn ids) to stderr. pi classifies a failed assistant message by its
 * `errorMessage` alone, and both "Internal error" and any digit run such as `503` inside an id
 * read as transient — so the vendor text, or the stderr tail that repeats it, would make pi
 * resend the WHOLE prompt from a cold session after the tools already ran.
 *
 * The subject is the real `streamAcpTurn` pipeline (new and reuse paths) driven through its
 * `AcpTurnDeps` seam with typed fakes. The independent oracle is pi's own classifier pair,
 * `isRetryableAssistantError` and `isContextOverflow`, with positive controls proving that the
 * raw vendor text and the stderr line alone DO classify as transient.
 *
 * Module state is sandboxed: backend.ts and its siblings read `homedir()` at load (overlay and
 * session-cache paths), so HOME/XDG/PI_CODING_AGENT_DIR point into a temp dir BEFORE the
 * dynamic import, and every turn passes its own session id and record dir.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	isContextOverflow,
	isRetryableAssistantError,
	type Message,
	type Model,
	normalizeContext,
	type TranscriptContext,
	Type,
	type Usage,
} from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcpClientHandlers, AcpConnectionLike, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-vendor-rejection-"));
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
	config = await import("./config.ts");
});

afterAll(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(SANDBOX, { recursive: true, force: true });
});

// --- the vendor's exact 0.85.1 shapes (v0.85.1 src/acp-agent.ts:4297-4300, :4332) ----------
// The ids carry digit runs on purpose: `503` and `524` are terms in pi's transient dictionary,
// which matches as a bare substring — the stderr line alone is a replay trigger.
const TOOL_ID = "toolu_01H8503kQ2vZ";
const TURN_UUID = "8c1f5240-0d1e-4b2a-9e3f-5a7c9d2b1e04";
const VENDOR_DETAIL = `Claude ended the turn without returning results for tool calls: ${TOOL_ID}`;
const VENDOR_TEXT = `Internal error: ${VENDOR_DETAIL}`;
const VENDOR_DATA = { errorKind: "incomplete_tool_call" };
const stderrLine = (sessionId: string) =>
	`Session ${sessionId}, turn ${TURN_UUID}, stopReason=end_turn: ${VENDOR_DETAIL}\n`;
const incompleteToolRejection = () => new RequestError(-32603, VENDOR_TEXT, VENDOR_DATA);
/** A known provider overflow shape (pi-ai OVERFLOW_PATTERNS: "prompt is too long"). Used only as
 *  NOISE in a vendor stderr tail — not a claim that the vendor's rejection is an overflow. */
const OVERFLOW_NOISE = "prompt is too long: 250000 tokens > 200000 maximum";
/** Plain vendor stderr for the legacy rows: no digits, nothing either classifier reads. */
const LEGACY_STDERR = "vendor says goodbye";

const SONNET: Model<Api> = {
	id: "claude-sonnet-5",
	name: "claude-sonnet-5",
	api: "entwurf",
	provider: "entwurf",
	baseUrl: "",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: false,
	contextWindow: 200_000,
	maxTokens: 8_192,
};

// pi declares its tool surface on every turn; a context without it reads as "the operator
// excluded every tool" and the exclude-tools preflight refuses the turn before any prompt.
const PI_TOOLS = ["read", "bash", "edit", "write"].map((name) => ({
	name,
	description: "",
	parameters: Type.Object({}),
}));

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantReply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "entwurf",
		provider: "entwurf",
		model: SONNET.id,
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: 0,
	};
}

/** Alternating user/assistant history ending on a user turn. */
function transcript(...userTurns: string[]): TranscriptContext {
	const messages: Message[] = [];
	userTurns.forEach((text, i) => {
		messages.push({ role: "user", content: text, timestamp: i });
		if (i < userTurns.length - 1) messages.push(assistantReply(`reply ${i}`));
	});
	return normalizeContext({ tools: PI_TOOLS, messages });
}

// --- typed fakes on the exported seams -----------------------------------------------------

interface FakeChild extends AcpChildLike {
	readonly kills: Array<NodeJS.Signals | number | undefined>;
	writeStderr(text: string): void;
}

function makeFakeChild(): FakeChild {
	const stderrListeners: Array<(chunk: Buffer) => void> = [];
	const kills: Array<NodeJS.Signals | number | undefined> = [];
	const pipe = () => ({ destroy() {}, unref() {} });
	return {
		pid: undefined,
		exitCode: null,
		signalCode: null,
		kills,
		stdin: pipe(),
		stdout: pipe(),
		stderr: {
			on(_event: "data", listener: (chunk: Buffer) => void) {
				stderrListeners.push(listener);
			},
			destroy() {},
			unref() {},
		},
		kill(signal?: NodeJS.Signals | number) {
			kills.push(signal);
			return true;
		},
		unref() {},
		once() {},
		writeStderr(text: string) {
			for (const listener of [...stderrListeners]) listener(Buffer.from(text));
		},
	};
}

interface PromptIo {
	handlers: AcpClientHandlers;
	child: FakeChild;
	sessionId: string;
	/** Resolves when the backend sends ACP `session/cancel` for this prompt. */
	cancelled: Promise<void>;
}
type PromptScript = (io: PromptIo) => Promise<AcpPromptResponse>;

/** One backend world: its own record dir, spawn log, and a queue of scripted prompts. */
function makeWorld() {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: FakeChild[] = [];
	const scripts: PromptScript[] = [];
	const cancels: string[] = [];
	let onCancel: (() => void) | undefined;

	const deps: AcpTurnDeps = {
		spawnChild: () => {
			const child = makeFakeChild();
			children.push(child);
			return child;
		},
		createConnection: (spawned, handlers) => {
			const child = children.find((c) => c === spawned);
			if (!child) throw new Error("createConnection: unknown child");
			const connection: AcpConnectionLike = {
				initialize: async () => ({}),
				newSession: async () => ({ sessionId: `ACP-${children.length}` }),
				setSessionConfigOption: async () => ({}),
				prompt: (params) => {
					const script = scripts.shift();
					if (!script) return Promise.reject(new Error("fake: no scripted prompt left"));
					const cancelled = new Promise<void>((resolve) => {
						onCancel = resolve;
					});
					return script({ handlers, child, sessionId: params.sessionId, cancelled });
				},
				cancel: (params) => {
					cancels.push(params.sessionId);
					onCancel?.();
				},
				close: () => {},
			};
			return connection;
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
		now: () => "2026-10-03T00:00:00Z",
		sessionDir,
		abortGraceMs: 40,
	};

	return {
		deps,
		children,
		cancels,
		/** Queue the next prompt's behaviour. */
		script(next: PromptScript) {
			scripts.push(next);
		},
		/** The one session record this world wrote. */
		record(): { contextMessageSignatures: string[] } {
			const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
			if (files.length !== 1) throw new Error(`expected one session record, found ${files.length}`);
			return JSON.parse(readFileSync(join(sessionDir, files[0]), "utf8"));
		},
	};
}

async function runTurn(
	world: ReturnType<typeof makeWorld>,
	context: TranscriptContext,
	sessionId: string,
	signal?: AbortSignal,
): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of backend.streamAcpTurn(SONNET, context, { sessionId, signal }, world.deps)) {
		events.push(event);
	}
	return events;
}

/** The single terminal event and the message it seals. */
function sealedOf(events: AssistantMessageEvent[]): { event: AssistantMessageEvent; message: AssistantMessage } {
	const sealed = events.filter((e) => e.type === "done" || e.type === "error");
	expect(sealed).toHaveLength(1);
	const event = sealed[0];
	if (event.type === "done") return { event, message: event.message };
	if (event.type === "error") return { event, message: event.error };
	throw new Error("unreachable");
}

const endTurn: PromptScript = async () => ({ stopReason: "end_turn" });

/** What 0.85.1 does on the wire: failed tool frames, the stderr log line, then the rejection. */
const incompleteToolTurn: PromptScript = async ({ handlers, child, sessionId }) => {
	await handlers.sessionUpdate({
		sessionId,
		update: { sessionUpdate: "tool_call", toolCallId: TOOL_ID, title: "Bash", status: "in_progress" },
	});
	child.writeStderr(stderrLine(sessionId));
	await handlers.sessionUpdate({
		sessionId,
		update: {
			sessionUpdate: "tool_call_update",
			toolCallId: TOOL_ID,
			status: "failed",
			content: [
				{
					type: "content",
					content: { type: "text", text: "Claude ended the turn without returning a result for this tool." },
				},
			],
		},
	});
	throw incompleteToolRejection();
};

function assertNoReplay(message: AssistantMessage): void {
	expect(message.stopReason).toBe("error");
	expect(isRetryableAssistantError(message)).toBe(false);
	expect(isContextOverflow(message, SONNET.contextWindow)).toBe(false);
	// The authored verdict carries no vendor text, no ids and no digits.
	expect(message.errorMessage).toBe(adapters.INCOMPLETE_TOOL_CALL_VERDICT);
	expect(message.errorMessage ?? "").not.toMatch(/\d/);
}

describe("vendor incomplete_tool_call rejection (#127, upstream #1212)", () => {
	it("positive controls: the raw vendor text and the vendor stderr line each classify as transient", () => {
		const probe = (errorMessage: string): AssistantMessage => ({
			...assistantReply(""),
			stopReason: "error",
			errorMessage,
		});
		expect(isRetryableAssistantError(probe(VENDOR_TEXT))).toBe(true);
		// No "Internal error" here: the digit run inside the ids is the trigger.
		expect(isRetryableAssistantError(probe(stderrLine("S")))).toBe(true);
		// The overflow oracle is live too: a known provider overflow shape classifies as one.
		expect(isContextOverflow(probe(OVERFLOW_NOISE), SONNET.contextWindow)).toBe(true);
	});

	it("[QK:ACP-INCOMPLETE-TOOL-NO-REPLAY-NEW] new path: sealed once as a non-transient error, after the failed tool frames, and the child is dropped", async () => {
		const world = makeWorld();
		world.script(incompleteToolTurn);
		const events = await runTurn(world, transcript("run the build"), "cell-new");
		const { event, message } = sealedOf(events);
		expect(event.type).toBe("error");
		if (event.type === "error") expect(event.reason).toBe("error");
		assertNoReplay(message);
		// The failed tool frame reached the operator BEFORE the turn error.
		const failedNotice = events.findIndex(
			(e) => e.type === "text_delta" && e.delta.includes("[tool:failed]") && e.delta.includes("Bash"),
		);
		expect(failedNotice).toBeGreaterThanOrEqual(0);
		expect(failedNotice).toBeLessThan(events.indexOf(event));
		// Dropped: the same session id spawns a fresh child next turn.
		world.script(endTurn);
		await runTurn(world, transcript("run the build", "again"), "cell-new");
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-INCOMPLETE-TOOL-RAW-EVIDENCE] the raw vendor rejection survives verbatim in diagnostics, never in errorMessage", async () => {
		const world = makeWorld();
		world.script(incompleteToolTurn);
		const { message } = sealedOf(await runTurn(world, transcript("run the build"), "cell-evidence"));
		const diagnostics = message.diagnostics ?? [];
		expect(diagnostics).toHaveLength(1);
		const [diagnostic] = diagnostics;
		expect(diagnostic.type).toBe(adapters.ACP_PROMPT_REJECTION_DIAGNOSTIC);
		expect(diagnostic.error?.name).toBe("RequestError");
		expect(diagnostic.error?.message).toBe(VENDOR_TEXT);
		expect(diagnostic.error?.code).toBe(-32603);
		expect(diagnostic.details?.errorKind).toBe("incomplete_tool_call");
		const dataJson = diagnostic.details?.dataJson;
		expect(typeof dataJson).toBe("string");
		expect(JSON.parse(String(dataJson))).toEqual(VENDOR_DATA);
		expect(String(diagnostic.details?.stderrTail)).toContain(VENDOR_DETAIL);
		expect(message.errorMessage ?? "").not.toContain(VENDOR_DETAIL);
		expect(message.errorMessage ?? "").not.toContain(TOOL_ID);
	});

	it("[QK:ACP-INCOMPLETE-TOOL-NO-REPLAY-REUSE] reuse path: the retained session's rejection is sealed non-transient and the session is dropped", async () => {
		const world = makeWorld();
		world.script(endTurn);
		await runTurn(world, transcript("first"), "cell-reuse");
		world.script(incompleteToolTurn);
		const { event, message } = sealedOf(await runTurn(world, transcript("first", "second"), "cell-reuse"));
		expect(world.children).toHaveLength(1); // the rejection came over the REUSED child
		expect(event.type).toBe("error");
		if (event.type === "error") expect(event.reason).toBe("error");
		assertNoReplay(message);
		world.script(endTurn);
		await runTurn(world, transcript("first", "second", "third"), "cell-reuse");
		expect(world.children).toHaveLength(2);
	});

	it("[QK:ACP-VENDOR-REJECTION-OTHERS-UNCHANGED] every other rejection keeps today's verbatim-first errorMessage and gains no diagnostic", async () => {
		const others: Array<{ label: string; error: Error }> = [
			{ label: "-32603 without data", error: new RequestError(-32603, "Internal error: no result") },
			{
				label: "-32603 with another errorKind",
				error: new RequestError(-32603, "Internal error: no result", { errorKind: "no_result" }),
			},
			{
				label: "another code with the same errorKind",
				error: new RequestError(-32000, "Authentication required", VENDOR_DATA),
			},
			{ label: "an untyped error with the same text", error: new Error(VENDOR_TEXT) },
		];
		for (const [i, other] of others.entries()) {
			const world = makeWorld();
			world.script(async ({ child }) => {
				child.writeStderr(`${LEGACY_STDERR}\n`);
				throw other.error;
			});
			const { message } = sealedOf(await runTurn(world, transcript("go"), `cell-other-${i}`));
			expect(message.stopReason, other.label).toBe("error");
			// Today's composition, byte for byte: the raw text first, then the vendor tail.
			expect(message.errorMessage, other.label).toBe(
				`${other.error.message}\n--- backend stderr (tail) ---\n${LEGACY_STDERR}`,
			);
			expect(message.diagnostics, other.label).toBeUndefined();
		}
	});

	it("overflow-looking vendor stderr stays in the diagnostic: the verdict reads as neither transient nor overflow", async () => {
		const world = makeWorld();
		world.script(async ({ child }) => {
			child.writeStderr(`${OVERFLOW_NOISE}\n`);
			child.writeStderr(stderrLine("cell-overflow-noise"));
			throw incompleteToolRejection();
		});
		const { message } = sealedOf(await runTurn(world, transcript("go"), "cell-overflow-noise"));
		assertNoReplay(message);
		const [diagnostic] = message.diagnostics ?? [];
		expect(String(diagnostic?.details?.stderrTail)).toContain(OVERFLOW_NOISE);
		// The overflow hint the raw text earns is evidence too — it never reaches errorMessage.
		expect(String(diagnostic?.details?.hint)).toContain("context-window overflow");
		expect(message.errorMessage ?? "").not.toContain("overflow");
	});

	it("a non-wire data value that cannot serialize is named in the diagnostic and never breaks the seal or the drop", async () => {
		// Wire data is parsed JSON and always serializes; these two hand-built forms pass the
		// typed guard anyway, so recording them must not throw past the seal.
		const cyclic: { errorKind: string; self?: unknown } = { errorKind: "incomplete_tool_call" };
		cyclic.self = cyclic;
		const forms: Array<{ label: string; data: object }> = [
			{ label: "a cycle", data: cyclic },
			{ label: "a bigint", data: { errorKind: "incomplete_tool_call", tokens: BigInt(10) } },
		];
		for (const [i, form] of forms.entries()) {
			const world = makeWorld();
			world.script(async () => {
				throw new RequestError(-32603, VENDOR_TEXT, form.data);
			});
			const sessionId = `cell-nonwire-${i}`;
			const { event, message } = sealedOf(await runTurn(world, transcript("go"), sessionId));
			expect(event.type, form.label).toBe("error");
			assertNoReplay(message);
			const [diagnostic] = message.diagnostics ?? [];
			expect(diagnostic?.details?.dataJson, form.label).toBe("[unserializable: TypeError]");
			expect(diagnostic?.error?.message, form.label).toBe(VENDOR_TEXT);
			world.script(endTurn);
			await runTurn(world, transcript("go", "again"), sessionId);
			expect(world.children, form.label).toHaveLength(2);
		}
	});

	it("an operator abort keeps abort precedence even if the vendor answers with the typed rejection", async () => {
		const world = makeWorld();
		const controller = new AbortController();
		world.script(async ({ cancelled }) => {
			controller.abort();
			await cancelled;
			throw incompleteToolRejection();
		});
		const { event, message } = sealedOf(await runTurn(world, transcript("go"), "cell-abort", controller.signal));
		expect(event.type).toBe("error");
		if (event.type === "error") expect(event.reason).toBe("aborted");
		expect(message.stopReason).toBe("aborted");
		expect(message.diagnostics).toBeUndefined();
	});

	it("[QK:ACP-REUSE-COOPERATIVE-CANCEL] a reused session's cooperative cancel seals aborted, keeps the child, and persists the turn", async () => {
		const world = makeWorld();
		world.script(endTurn);
		await runTurn(world, transcript("first"), "cell-cancel");
		const signaturesAfterFirst = world.record().contextMessageSignatures.length;

		const controller = new AbortController();
		world.script(async ({ cancelled }) => {
			controller.abort();
			await cancelled;
			return { stopReason: "cancelled" };
		});
		const { event, message } = sealedOf(
			await runTurn(world, transcript("first", "second"), "cell-cancel", controller.signal),
		);
		expect(event.type).toBe("error");
		if (event.type === "error") expect(event.reason).toBe("aborted");
		expect(message.stopReason).toBe("aborted");
		expect(world.cancels).toEqual(["ACP-1"]);
		expect(world.children[0].kills).toEqual([]); // cooperative: no signal reached the child
		expect(world.record().contextMessageSignatures.length).toBeGreaterThan(signaturesAfterFirst);

		world.script(endTurn);
		await runTurn(world, transcript("first", "second", "third"), "cell-cancel");
		expect(world.children).toHaveLength(1); // retained and reused
	});
});
