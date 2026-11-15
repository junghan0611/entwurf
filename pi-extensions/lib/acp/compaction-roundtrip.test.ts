/**
 * #163 S8: an ACP child's compaction, from the wire to the reopened session file.
 *
 * The production subjects, in Pi's own order (pi-coding-agent agent-session.js:810-826: the
 * extension `message_end` runs, then Pi persists the same assistant message):
 *   1. `streamAcpTurn` — a real turn whose scripted connection speaks the measured C2 frames
 *      (claude-agent-acp 0.107.0, `/tmp/ff08d4-next/s8-probe-raw/cell-C2-r1.ndjson`);
 *   2. the provider entry's own `message_end` handler (`acp-provider.ts`) → `pi.appendEntry`;
 *   3. a REAL `SessionManager`: `appendMessage` of that assistant message, the file on disk,
 *      `SessionManager.open` of it, and Pi's real `buildSessionContext` + `convertToLlm`.
 * Then Entwurf's own readers of that projection: `contextTranscript`, `latestUserDelta`,
 * `contextMessageSignatures`, `buildAcpPrompt("new")` and the first-user augment.
 *
 * The summary is a marker. A synthetic 120k-character summary checks the large case.
 * Proof scope: Entwurf code. Whether external readers of session files read custom entries is
 * not examined here.
 *
 * Session id attribution (§5.1) — read, not run: every Pi session replacement (/new, resume,
 * fork) rebuilds the runtime (agent-session-runtime.js:128-250), and the new agent takes
 * `sessionId: sessionManager.getSessionId()` (sdk.js:276), the same value the handler's ctx gives.
 * The cells below pin the consequence: a take under any other session id finds nothing.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AcpClientHandlers, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-compaction-rt-"));
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
let ctxlib: typeof import("./context.ts");
let store: typeof import("./session-store.ts");
let augment: typeof import("./augment.ts");
let providerEntry: (pi: never) => void;

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
	ctxlib = await import("./context.ts");
	store = await import("./session-store.ts");
	augment = await import("./augment.ts");
	providerEntry = (await import("../../acp-provider.ts")).default as never;
});

afterAll(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(SANDBOX, { recursive: true, force: true });
});

const MARK = "SUMMARY-MARK-c91e";
const SUMMARY = `1. Primary Request and Intent:\n   - ${MARK} the user asked about compaction.\n`;

function c2Frames(id: string, summary = SUMMARY) {
	return [
		{ sessionUpdate: "usage_update", used: 17884, size: 1_000_000 },
		{ sessionUpdate: "compaction_update", compactionId: id, status: "in_progress" },
		{
			sessionUpdate: "compaction_update",
			compactionId: id,
			status: "completed",
			summary: [{ type: "text", text: summary }],
		},
		{ sessionUpdate: "compaction_update", compactionId: id, status: "completed" },
		{ sessionUpdate: "usage_update", used: 3669, size: 1_000_000 },
		{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done after compacting." } },
	];
}

function sonnet(): Model<Api> {
	const row = models.curatedClaudeModels().find((r) => r.id === "claude-sonnet-5-5");
	if (!row) throw new Error("claude-sonnet-5-5 is not curated");
	return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
}

const PI_TOOLS = ["read", "bash", "edit", "write"].map((name) => ({
	name,
	description: "",
	parameters: obj({}, { open: true }),
}));

/** A turn driver whose connection speaks `frames` with the prompt on the wire. */
function turnDriver(frames: unknown[]) {
	const deps: AcpTurnDeps = {
		spawnChild: () => {
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
			} as unknown as AcpChildLike;
		},
		createConnection: (_child, handlers: AcpClientHandlers) => {
			const acpSessionId = `ACP-${Math.random().toString(16).slice(2, 8)}`;
			return {
				initialize: async () => ({}),
				newSession: async () => ({ sessionId: acpSessionId }),
				setSessionConfigOption: async (p: any) => ({ configOptions: [{ id: p.configId, currentValue: p.value }] }),
				prompt: async (): Promise<AcpPromptResponse> => {
					for (const update of frames) await handlers.sessionUpdate({ sessionId: acpSessionId, update } as never);
					return { stopReason: "end_turn" } as AcpPromptResponse;
				},
				cancel: () => {},
				close: () => {},
			};
		},
		lifecyclePolicy: () => "turn-scoped",
		loadConfig: (cwd, modelId, adapter) =>
			config.resolveProviderConfig({
				cwd,
				modelId,
				adapter,
				globalSettingsPath: join(SANDBOX, "absent-global-settings.json"),
				projectSettingsPath: join(SANDBOX, "absent-project-settings.json"),
			}),
		now: () => "2026-11-15T00:00:00Z",
		sessionDir: mkdtempSync(join(SANDBOX, "records-")),
		abortGraceMs: 40,
	};
	return async (sessionId: string): Promise<AssistantMessage> => {
		const ctx = normalizeContext({ tools: PI_TOOLS, messages: [{ role: "user", content: "hello", timestamp: 0 }] });
		const options = { sessionId, reasoning: "medium" } as Parameters<typeof backend.streamAcpTurn>[2];
		let final: AssistantMessage | undefined;
		for await (const e of backend.streamAcpTurn(sonnet(), ctx, options, deps)) {
			if (e.type === "done") final = e.message;
			if (e.type === "error") throw new Error(`turn failed: ${e.error.errorMessage}`);
		}
		if (!final) throw new Error("turn sealed no message");
		return final;
	};
}

/** The provider entry against a fake Pi whose session writes go to a real SessionManager. */
function provider() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const sink: { sm?: SessionManager; appendThrows?: Error } = {};
	const fakePi = {
		registerProvider() {},
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(event, handler);
		},
		appendEntry(customType: string, data: unknown) {
			if (sink.appendThrows) throw sink.appendThrows;
			sink.sm?.appendCustomEntry(customType, data);
		},
		sendMessage(message: { customType: string; content: string; display: boolean }) {
			sink.sm?.appendCustomMessageEntry(message.customType, message.content, message.display);
		},
	};
	providerEntry(fakePi as never);
	const messageEnd = handlers.get("message_end");
	if (!messageEnd) throw new Error("acp-provider registered no message_end handler");
	return { sink, messageEnd };
}

/** One prompt, Pi's order: user persisted, turn, extension message_end, assistant persisted. */
async function roundtrip(
	opts: { frames?: unknown[]; appendThrows?: Error; hasUI?: boolean; endTwice?: boolean; stale?: boolean } = {},
) {
	const cwd = mkdtempSync(join(SANDBOX, "cwd-"));
	const dir = mkdtempSync(join(SANDBOX, "sessions-"));
	const sm = SessionManager.create(cwd, dir);
	const sid = sm.getSessionId();
	sm.appendMessage({ role: "user", content: "hello", timestamp: 1 });
	if (opts.stale) {
		// A record an earlier prompt of this session left untaken: this prompt's window drops it.
		backend.depositAcpCompactionRecords(`pi:${sid}`, [
			{
				v: 1,
				compactionId: "STALE-0001",
				status: "completed",
				promptWasCompactCommand: false,
				startedObservedAt: null,
				endedObservedAt: null,
				observedIntervalMs: null,
				tokensBefore: null,
				tokensAfter: null,
				summary: MARK,
			},
		]);
	}
	const assistant = await turnDriver(opts.frames ?? c2Frames(`C-${sid.slice(-6)}`))(sid);
	const { sink, messageEnd } = provider();
	sink.sm = sm;
	sink.appendThrows = opts.appendThrows;
	const notes: string[] = [];
	const ctx = {
		sessionManager: sm,
		hasUI: opts.hasUI ?? true,
		ui: { notify: (text: string) => notes.push(text) },
	};
	const errs: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
		errs.push(String(c));
		return true;
	});
	try {
		await messageEnd({ type: "message_end", message: assistant }, ctx);
		if (opts.endTwice) await messageEnd({ type: "message_end", message: assistant }, ctx);
	} finally {
		spy.mockRestore();
	}
	sm.appendMessage(assistant);
	const file = sm.getSessionFile() as string;
	const raw = readFileSync(file, "utf8");
	const reopened = SessionManager.open(file, dir);
	const entries = reopened.getEntries();
	const project = (list: typeof entries) =>
		normalizeContext({ tools: [], messages: convertToLlm(buildSessionContext(list).messages) });
	const context = project(entries);
	// The same session with the records taken out of the tree (children re-pointed to their parent).
	const isRecord = (e: (typeof entries)[number]) => e.type === "custom" && e.customType === "entwurf-acp-compaction";
	const parentOf = new Map(entries.filter(isRecord).map((e) => [e.id, e.parentId]));
	const withoutRecords = project(
		entries
			.filter((e) => !isRecord(e))
			.map((e) => {
				let parentId = e.parentId;
				while (parentId && parentOf.has(parentId)) parentId = parentOf.get(parentId) ?? null;
				return { ...e, parentId };
			}),
	);
	return { sid, assistant, raw, entries, context, withoutRecords, notes, errs, cwd };
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("an ACP compaction from the wire to the reopened session (#163 S8)", () => {
	it("[QK:ACP-COMPACT-PERSIST-ROUNDTRIP] the summary is in the custom entry exactly once — before the assistant message, nowhere else, also at 120k — and a take drains it", async () => {
		const r = await roundtrip({ endTwice: true });
		expect(count(r.raw, MARK)).toBe(1);
		const line = r.raw.split("\n").find((l) => l.includes(MARK)) as string;
		expect(JSON.parse(line)).toMatchObject({ type: "custom", customType: "entwurf-acp-compaction" });
		const records = r.entries.filter((e) => e.type === "custom" && e.customType === "entwurf-acp-compaction");
		expect(records).toHaveLength(1);
		const data = (records[0] as { data: Record<string, unknown> }).data;
		expect(data).toMatchObject({ status: "completed", summary: SUMMARY, summarySource: "terminal", v: 1 });
		expect(typeof data.recordedAt).toBe("string");
		const assistantEntry = r.entries.find((e) => e.type === "message" && e.message.role === "assistant");
		expect(assistantEntry?.parentId).toBe(records[0].id);
		expect(backend.takeAcpCompactionRecords("some-other-session")).toEqual({ records: [], droppedBefore: [] });

		const large = `${"요약 line ✓\n".repeat(11_000)}${MARK}-END`;
		const big = await roundtrip({ frames: c2Frames("C-large", large) });
		const bigRecord = big.entries.find((e) => e.type === "custom" && e.customType === "entwurf-acp-compaction") as {
			data: { summary: string; summaryChars: number };
		};
		expect(bigRecord.data.summary).toBe(large);
		expect(bigRecord.data.summaryChars).toBe(large.length);
		expect(count(big.raw, `${MARK}-END`)).toBe(1);
	});

	it("[QK:ACP-COMPACT-SUMMARY-NOT-IN-CHILD] the rebuild prompt, the transcript, the reuse delta and the first-user augment carry none of it", async () => {
		const r = await roundtrip();
		const rebuild = ctxlib
			.buildAcpPrompt(r.context, "new")
			.map((b) => b.text)
			.join("\n");
		const augmented = augment
			.prependNewPromptAugment(ctxlib.buildAcpPrompt(r.context, "new"), {
				backend: "claude",
				cwd: r.cwd,
				mcpServerNames: [],
				homeDir: r.cwd,
			})
			.map((b) => b.text)
			.join("\n");
		const delta = ctxlib
			.latestUserDelta(r.context)
			.map((b) => b.text)
			.join("\n");
		for (const text of [rebuild, augmented, delta, ctxlib.contextTranscript(r.context)]) {
			expect(count(text, MARK)).toBe(0);
		}
		expect(rebuild).toContain("Done after compacting.");
	});

	it("[QK:ACP-COMPACT-SUMMARY-NOT-IN-PI-CONTEXT] Pi's real projection has none of it, and the reuse signatures are the same as with no record", async () => {
		const r = await roundtrip();
		expect(count(JSON.stringify(r.context.messages), MARK)).toBe(0);
		expect(store.contextMessageSignatures(r.context)).toEqual(store.contextMessageSignatures(r.withoutRecords));
	});

	it("[QK:ACP-COMPACT-SUMMARY-NOT-IN-TEXT] the assistant message — its text, the lifecycle lines, its persisted JSON — carries none of it; the display line carries the facts", async () => {
		const r = await roundtrip();
		const text = r.assistant.content.map((b) => ("text" in b ? b.text : "")).join("");
		expect(count(text, MARK)).toBe(0);
		expect(count(JSON.stringify(r.assistant), MARK)).toBe(0);
		const assistantLine = r.raw.split("\n").find((l) => l.includes('"role":"assistant"')) as string;
		expect(count(assistantLine, MARK)).toBe(0);
		expect(text).toContain("[acp: compaction completed 18k→4k");
	});

	it("[QK:ACP-COMPACT-LOSS-VISIBLE] a record that cannot be written is said once in the UI and on stderr, with no summary; the turn is unaffected; no UI means stderr only; an empty take says nothing", async () => {
		const failed = await roundtrip({ appendThrows: new Error("session file is read-only") });
		expect(failed.notes).toHaveLength(1);
		expect(failed.notes[0]).toContain("not saved");
		expect(failed.errs.filter((l) => l.includes("not saved"))).toHaveLength(1);
		for (const line of [...failed.notes, ...failed.errs]) expect(line).not.toContain(MARK);
		expect(count(failed.raw, MARK)).toBe(0);
		expect(failed.assistant.stopReason).toBe("stop");

		const headless = await roundtrip({ appendThrows: new Error("read-only"), hasUI: false });
		expect(headless.notes).toEqual([]);
		expect(headless.errs.filter((l) => l.includes("not saved"))).toHaveLength(1);

		const stale = await roundtrip({ stale: true, frames: [] });
		expect(stale.notes).toHaveLength(1);
		expect(stale.notes[0]).toContain("STALE-00");
		expect(stale.notes[0]).not.toContain(MARK);
		expect(count(stale.raw, MARK)).toBe(0);

		const nothing = await roundtrip({ frames: [{ sessionUpdate: "usage_update", used: 100, size: 1_000_000 }] });
		expect(nothing.notes).toEqual([]);
		expect(nothing.errs.filter((l) => l.includes("not saved"))).toEqual([]);
	});

	it("only the writer names the entry type in production code (structure check, beside the behaviour above)", () => {
		// Internal shape, not behaviour: the oracles above prove where the summary does not go; this
		// keeps any second production reader or writer of the entry from appearing unnoticed.
		const root = join(__dirname, "..", "..");
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, name.name);
				if (name.isDirectory()) walk(p);
				else if (name.name.endsWith(".ts") && !name.name.endsWith(".test.ts")) files.push(p);
			}
		};
		walk(root);
		const literal = files.filter((f) => readFileSync(f, "utf8").includes('"entwurf-acp-compaction"'));
		const named = files.filter((f) => /\bACP_COMPACTION_ENTRY_TYPE\b/.test(readFileSync(f, "utf8")));
		expect(literal.map((f) => f.slice(root.length + 1))).toEqual(["lib/acp/compaction-record.ts"]);
		expect(named.map((f) => f.slice(root.length + 1)).sort()).toEqual([
			"lib/acp/compaction-record.ts",
			"lib/acp/compaction-writer.ts",
		]);
	});
});
