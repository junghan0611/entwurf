/**
 * A vendor `incomplete_tool_call` rejection must not invite pi's whole-prompt replay (#127).
 *
 * claude-agent-acp 0.85.1 (#1212) fails a turn that reached `end_turn` while foreground tool
 * calls were still unanswered. With `clientCapabilities: {}` it rejects `session/prompt` with
 * JSON-RPC -32603 `Internal error: Claude ended the turn without returning results for tool
 * calls: <ids>` and `data: {errorKind: "incomplete_tool_call"}`, after logging the same line
 * (with session and turn ids) to stderr. pi classifies a failed assistant message by its
 * `errorMessage` alone, and "Internal error" reads as transient — so the vendor text would make pi
 * resend the WHOLE prompt from a cold session after the tools already ran. Through pi-ai 1.3 any
 * digit run such as `503` inside an id read as transient too, so the stderr tail alone was a
 * trigger; pi-ai 1.4 matches status codes only as standalone numbers (upstream #11057), and the
 * stderr line alone now reads as non-transient.
 *
 * The subject is the real `streamAcpTurn` pipeline (new and reuse paths) driven through its
 * `AcpTurnDeps` seam with typed fakes. The independent oracle is pi's own classifier pair,
 * `isRetryableAssistantError` and `isContextOverflow`, with controls proving that the raw vendor
 * text DOES classify as transient and that, on the pinned pi-ai, the stderr line's opaque ids do not.
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
	type Usage,
} from "@earendil-works/pi-ai";
import { calculateContextTokens, getLastAssistantUsage, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { fakePiHost } from "../../../scripts/lib/acp-fake-pi-session.ts";
import type { AcpClientHandlers, AcpConnectionLike, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";
import { ACP_STOPS } from "./stop-texts.ts";

// #171 step 8: the Pi session a resident turn reads, kept in step with each call.
const piHost = fakePiHost();

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
let models: typeof import("./models.ts");

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
	adapters = await import("./backend-adapter.ts");
	config = await import("./config.ts");
	models = await import("./models.ts");
});

afterAll(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(SANDBOX, { recursive: true, force: true });
});

// --- the vendor's exact 0.85.1 shapes (v0.85.1 src/acp-agent.ts:4297-4300, :4332) ----------
// The ids carry digit runs on purpose: `503` and `524` are terms in pi's transient dictionary. Through
// pi-ai 1.3 it matched them as bare substrings, so the stderr line alone was a replay trigger; pi-ai 1.4
// bounds them (`(?<![a-z0-9])(?:429|500|502|503|504|520|524)(?![a-z0-9])`, upstream #11057).
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
	id: "claude-sonnet-5-5",
	name: "claude-sonnet-5-5",
	api: "entwurf",
	provider: "entwurf",
	baseUrl: "",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: true,
	// #142: the curated level map; every turn below runs at "medium" (runTurn), which the fake driver
	// reads back as effort. The effort contract itself lives in backend.thinking.test.ts.
	thinkingLevelMap: {
		off: null,
		minimal: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max",
	},
	contextWindow: 200_000,
	maxTokens: 8_192,
};

// pi declares its tool surface on every turn; a context without it reads as "the operator
// excluded every tool" and the exclude-tools preflight refuses the turn before any prompt.
const PI_TOOLS = ["read", "bash", "edit", "write"].map((name) => ({
	name,
	description: "",
	parameters: obj({}, { open: true }),
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
	const prompts: string[][] = [];
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const children: FakeChild[] = [];
	const scripts: PromptScript[] = [];
	const cancels: string[] = [];
	let onCancel: (() => void) | undefined;
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
			const child = makeFakeChild();
			children.push(child);
			agentOf.set(child, agentFor(launch));
			return child;
		},
		createConnection: (spawned, handlers) => {
			const child = children.find((c) => c === spawned);
			if (!child) throw new Error("createConnection: unknown child");
			const connection: AcpConnectionLike = {
				initialize: async () => ({ agentInfo: { name: agentOf.get(child)?.name, version: agentOf.get(child)?.floor } }),
				newSession: async () => ({ sessionId: `ACP-${children.length}` }),
				setSessionConfigOption: async (p: any) => ({ configOptions: [{ id: p.configId, currentValue: p.value }] }),
				prompt: (params) => {
					prompts.push(params.prompt.map((block) => (block as { text: string }).text));
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
		sessionReader: piHost.sessionReader,
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
		birthDir: `${sessionDir}-births`,
		abortGraceMs: 40,
	};

	return {
		deps,
		children,
		cancels,
		/** The text blocks of every prompt that reached the wire, in order. */
		prompts,
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
	model: Model<Api> = SONNET,
): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of backend.streamAcpTurn(
		model,
		context,
		{ sessionId, signal, reasoning: "medium" },
		world.deps,
	)) {
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
	it("controls: the raw vendor text classifies as transient, the stderr line's opaque ids no longer do", () => {
		const probe = (errorMessage: string): AssistantMessage => ({
			...assistantReply(""),
			stopReason: "error",
			errorMessage,
		});
		expect(isRetryableAssistantError(probe(VENDOR_TEXT))).toBe(true);
		// No "Internal error" here, only the digit runs inside the ids: pi-ai 1.4 reads `…8503…` as part
		// of an id, not as status 503. The authored verdict below still carries no digits.
		expect(isRetryableAssistantError(probe(stderrLine("S")))).toBe(false);
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
		// The record keeps its marker; no later turn opens a second session for this conversation.
		world.script(endTurn);
		const after = sealedOf(await runTurn(world, transcript("run the build", "again"), "cell-new"));
		expect(after.message.errorMessage).toBe(ACP_STOPS.interim.text);
		expect(world.children).toHaveLength(1);
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

	it("[QK:ACP-INCOMPLETE-TOOL-NO-REPLAY-REUSE] reuse path: the retained session's rejection is sealed non-transient and no second session follows", async () => {
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
		const after = sealedOf(await runTurn(world, transcript("first", "second", "third"), "cell-reuse"));
		expect(after.message.errorMessage).toBe(ACP_STOPS.interim.text);
		expect(world.children).toHaveLength(1);
	});

	it("[QK:ACP-VENDOR-REJECTION-OTHERS-UNCHANGED] every other rejection is not read as the vendor's: on a resident it seals as unknown, its raw text in a diagnostic of its own", async () => {
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
			// #171 step 8: the prompt may have been dispatched and no classified answer came back, so the sealed text is the fixed one
			// (Pi reads it alone to decide a retry). What the agent said is kept whole, beside it.
			expect(message.errorMessage, other.label).toBe(ACP_STOPS.unknown.text);
			expect(message.diagnostics, other.label).toHaveLength(1);
			const [diagnostic] = message.diagnostics ?? [];
			expect(diagnostic?.type, other.label).toBe("entwurf_acp_prompt_unknown");
			expect(diagnostic?.error?.message, other.label).toBe(other.error.message);
			expect(diagnostic?.details?.stderrTail, other.label).toBe(LEGACY_STDERR);
			expect(JSON.stringify(diagnostic), other.label).not.toContain(adapters.INCOMPLETE_TOOL_CALL_VERDICT);
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
			const after = sealedOf(await runTurn(world, transcript("go", "again"), sessionId));
			expect(after.message.errorMessage, form.label).toBe(ACP_STOPS.interim.text);
			expect(world.children, form.label).toHaveLength(1);
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

// --- #167: every prompt-phase agy failure is non-replayable -----------------------------------
// agy's typed rejection vocabulary is unmeasured, and its tools run with permission prompts
// bypassed. The rows are the synthetic sweep posted on #167 (2026-11-16): four of them read as
// transient to pi when sealed verbatim. The oracle is pi's own classifier pair again.
describe("agy prompt-phase failure (#167)", () => {
	const agyFlash = (): Model<Api> => {
		const row = models.curatedAgyModels().find((r) => r.id === "agy-gemini-3.8-flash");
		if (!row) throw new Error("agy-gemini-3.8-flash is not curated");
		return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
	};
	const AGY_TOOL_ID = "agy-run-1";
	const SWEEP: Array<{ label: string; make: () => Error; transientIfVerbatim: boolean }> = [
		{
			label: "bare JSON-RPC internal",
			make: () => new RequestError(-32603, "Internal error"),
			transientIfVerbatim: true,
		},
		{
			label: "internal + 429",
			make: () => new RequestError(-32603, "Internal error: 429 Too Many Requests"),
			transientIfVerbatim: true,
		},
		{
			label: "internal + UNAUTHENTICATED",
			make: () => new RequestError(-32603, "Internal error: UNAUTHENTICATED: invalid authentication credentials"),
			transientIfVerbatim: true,
		},
		{ label: "untyped rate limit", make: () => new Error("rate limit exceeded"), transientIfVerbatim: true },
		{
			label: "internal + quota exceeded",
			make: () => new RequestError(-32603, "Internal error: RESOURCE_EXHAUSTED: Quota exceeded for model"),
			transientIfVerbatim: false,
		},
		{
			label: "ACP auth_required",
			make: () => new RequestError(-32000, "Authentication required"),
			transientIfVerbatim: false,
		},
	];
	/** One completed native tool, then the rejection — the tool already ran when the prompt fails. */
	const toolThenFail =
		(make: () => Error): PromptScript =>
		async ({ handlers, sessionId }) => {
			await handlers.sessionUpdate({
				sessionId,
				update: { sessionUpdate: "tool_call", toolCallId: AGY_TOOL_ID, title: "run_command", status: "in_progress" },
			});
			await handlers.sessionUpdate({
				sessionId,
				update: { sessionUpdate: "tool_call_update", toolCallId: AGY_TOOL_ID, status: "completed", content: [] },
			});
			throw make();
		};
	const assertAgyNoReplay = (message: AssistantMessage, raw: Error, label: string) => {
		expect(message.stopReason, label).toBe("error");
		expect(message.errorMessage, label).toBe(adapters.AGY_PROMPT_FAILURE_VERDICT);
		expect(isRetryableAssistantError(message), label).toBe(false);
		expect(isContextOverflow(message, agyFlash().contextWindow), label).toBe(false);
		const [diagnostic] = message.diagnostics ?? [];
		expect(diagnostic?.type, label).toBe(adapters.ACP_PROMPT_REJECTION_DIAGNOSTIC);
		expect(diagnostic?.error?.message, label).toBe(raw.message);
		expect(String(diagnostic?.details?.errorKind), label).toBe(
			raw instanceof RequestError ? `jsonrpc:${raw.code}` : `error:${raw.name}`,
		);
	};

	it("controls: the verbatim sweep texts classify as the thread measured", () => {
		for (const row of SWEEP) {
			const verbatim: AssistantMessage = {
				...assistantReply(""),
				stopReason: "error",
				errorMessage: row.make().message,
			};
			expect(isRetryableAssistantError(verbatim), row.label).toBe(row.transientIfVerbatim);
		}
	});

	it("[QK:ACP-AGY-PROMPT-FAILURE-NO-REPLAY] new path: after a completed tool, every sweep row seals the fixed verdict, keeps the raw failure, and opens no second session", async () => {
		for (const [i, row] of SWEEP.entries()) {
			const world = makeWorld();
			const raw = row.make();
			world.script(toolThenFail(() => raw));
			const sessionId = `cell-agy-new-${i}`;
			const { message } = sealedOf(await runTurn(world, transcript("build it"), sessionId, undefined, agyFlash()));
			assertAgyNoReplay(message, raw, row.label);
			world.script(endTurn);
			const after = sealedOf(await runTurn(world, transcript("build it", "again"), sessionId, undefined, agyFlash()));
			expect(after.message.errorMessage, row.label).toBe(ACP_STOPS.interim.text);
			expect(world.children, row.label).toHaveLength(1);
		}
	});

	it("[QK:ACP-L18-AGY-WIRE-SEPARATED] agy's prompt blocks leave separated on the new and the reuse path; Claude's leave as built", async () => {
		const twoInputs = (): TranscriptContext => {
			const base = transcript("first");
			return {
				...base,
				messages: [
					...base.messages,
					assistantReply("reply 0"),
					{ role: "user", content: "reply with only DONE.", timestamp: 1 },
					{ role: "user", content: "What does effects.txt contain now?", timestamp: 2 },
				],
			};
		};
		const agy = makeWorld();
		agy.script(endTurn);
		await runTurn(agy, transcript("first"), "l18-agy", undefined, agyFlash());
		agy.script(endTurn);
		await runTurn(agy, twoInputs(), "l18-agy", undefined, agyFlash());
		expect(agy.children).toHaveLength(1);
		const [agyNew, agyReuse] = agy.prompts;
		// New: the augment and the transcript are separate blocks; every one but the last ends apart.
		expect(agyNew.length).toBeGreaterThan(1);
		for (const text of agyNew.slice(0, -1)) expect(text.endsWith("\n\n")).toBe(true);
		expect(agyReuse).toEqual(["reply with only DONE.\n\n", "What does effects.txt contain now?"]);

		const claude = makeWorld();
		claude.script(endTurn);
		await runTurn(claude, transcript("first"), "l18-claude");
		claude.script(endTurn);
		await runTurn(claude, twoInputs(), "l18-claude");
		// Claude reads a command from the first block alone; its blocks are not touched.
		expect(claude.prompts[1]).toEqual(["reply with only DONE.", "What does effects.txt contain now?"]);
	});

	it("reuse path: a retained agy session's prompt failure seals the same verdict", async () => {
		const world = makeWorld();
		world.script(endTurn);
		await runTurn(world, transcript("first"), "cell-agy-reuse", undefined, agyFlash());
		const raw = new RequestError(-32603, "Internal error");
		world.script(toolThenFail(() => raw));
		const { message } = sealedOf(
			await runTurn(world, transcript("first", "second"), "cell-agy-reuse", undefined, agyFlash()),
		);
		expect(world.children).toHaveLength(1);
		assertAgyNoReplay(message, raw, "reuse");
	});

	it("[QK:ACP-AGY-BOOTSTRAP-FAILURE-VERBATIM] a failure before the prompt is sent ran no tool: it keeps the verbatim path and gains no diagnostic", async () => {
		const world = makeWorld();
		const createConnection = world.deps.createConnection;
		world.deps.createConnection = (spawned, handlers) => ({
			...createConnection(spawned, handlers),
			newSession: async () => {
				throw new RequestError(-32603, "Internal error");
			},
		});
		const { message } = sealedOf(await runTurn(world, transcript("go"), "cell-agy-boot", undefined, agyFlash()));
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage?.startsWith("Internal error")).toBe(true);
		expect(message.diagnostics).toBeUndefined();
	});
});

// --- #168 comment 7006202786 §2: what pi's meter reads from an agy turn (characterization) -------
// agy declares no `sealsTurnAccounting` (backend-adapter.ts), so the seal in backend.ts returns
// early and the mapper's raw observation is what pi gets: each `usage_update.used` overwrites
// `usage.totalTokens`. These cells pin TODAY's behaviour; they assert no new accounting. The `used`
// values and the PromptResponse aggregate are synthetic fixture numbers, not agy measurements.
// The oracle is pi's own reader pair: `calculateContextTokens` (what the post-turn threshold check
// takes when non-zero) and `getLastAssistantUsage` (the last non-zero usage a zero-usage turn falls
// back to). Both readings are pi 1.5.2 source reads, not a run of pi's session: compaction.js:65-97,
// and agent-session.js:2574-2600 (`directContextTokens === 0` → `estimateContextTokens`).
describe("agy usage_update and pi's context meter (#168)", () => {
	const agyFlash = (): Model<Api> => {
		const row = models.curatedAgyModels().find((r) => r.id === "agy-gemini-3.8-flash");
		if (!row) throw new Error("agy-gemini-3.8-flash is not curated");
		return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
	};
	/** Three calls in one turn, occupancy not monotonic: the turn sum (9,700) and the maximum (5,400)
	 *  both differ from the last call's occupancy (3,100). */
	const USED = [1_200, 5_400, 3_100] as const;
	const LAST = USED[USED.length - 1];
	const AGGREGATE = { inputTokens: 8_000, outputTokens: 1_700, totalTokens: 9_700 };
	const threeCalls: PromptScript = async ({ handlers, sessionId }) => {
		for (const used of USED) {
			await handlers.sessionUpdate({ sessionId, update: { sessionUpdate: "usage_update", used, size: 1_000_000 } });
		}
		return { stopReason: "end_turn", usage: AGGREGATE } as AcpPromptResponse;
	};
	/** One call: the occupancy cell below then does not depend on how several `used` values combine. */
	const oneCall: PromptScript = async ({ handlers, sessionId }) => {
		await handlers.sessionUpdate({ sessionId, update: { sessionUpdate: "usage_update", used: LAST, size: 1_000_000 } });
		return { stopReason: "end_turn" };
	};
	const noUsed: PromptScript = async ({ handlers, sessionId }) => {
		await handlers.sessionUpdate({
			sessionId,
			update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
		});
		return { stopReason: "end_turn" };
	};
	const asEntry = (message: AssistantMessage) => ({ type: "message", message }) as unknown as SessionEntry;

	it("[QK:ACP-AGY-OCCUPANCY-LAST-USED] a turn whose usage_update `used` differs across calls seals the LAST call's value as totalTokens — not the sum, not the maximum, not the PromptResponse aggregate", async () => {
		const world = makeWorld();
		world.script(threeCalls);
		const { event, message } = sealedOf(await runTurn(world, transcript("go"), "occ-last", undefined, agyFlash()));
		expect(event.type).toBe("done");
		expect(message.usage.totalTokens).toBe(LAST);
		expect([message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite]).toEqual([
			0, 0, 0, 0,
		]);
		// No seal on this row: the aggregate is relayed nowhere.
		expect((message.usage as unknown as { acp?: unknown }).acp).toBeUndefined();
		// What pi's threshold check reads for this turn.
		expect(calculateContextTokens(message.usage)).toBe(LAST);
	});

	it("[QK:ACP-AGY-OCCUPANCY-ABSENT-USED] a following turn that carries no `used` seals totalTokens 0 — nothing is carried — so pi falls back to the previous turn's last `used`", async () => {
		const world = makeWorld();
		world.script(oneCall);
		const first = sealedOf(await runTurn(world, transcript("go"), "occ-absent", undefined, agyFlash())).message;
		world.script(noUsed);
		const second = sealedOf(
			await runTurn(world, transcript("go", "again"), "occ-absent", undefined, agyFlash()),
		).message;
		// Same retained child: the reuse path, not a fresh session.
		expect(world.children).toHaveLength(1);
		expect(second.stopReason).toBe("stop");
		expect(second.usage.totalTokens).toBe(0);
		expect(calculateContextTokens(second.usage)).toBe(0);
		// pi skips the zero-usage turn and reads the last non-zero one: turn one's last `used`
		// (plus its own trailing-message estimate, which this cell does not compute).
		const fallback = getLastAssistantUsage([asEntry(first), asEntry(second)]);
		expect(fallback && calculateContextTokens(fallback)).toBe(LAST);
	});
});
