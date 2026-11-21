/**
 * #163 S8: the ACP child's compactions through the REAL turn driver — what is collected, when, and
 * for whom.
 *
 * The production subject is `streamAcpTurn` through its `AcpTurnDeps` seam, with a fake child and
 * a scripted connection that speaks the measured C2 frames (claude-agent-acp 0.107.0,
 * `/tmp/ff08d4-next/s8-probe-raw/cell-C2-r1.ndjson`) at a chosen phase: during bootstrap (as a
 * `session/load` replay would, context-compaction.js:85-107) or with the prompt on the wire.
 * Records are read back the way the provider reads them, `takeAcpCompactionRecords`.
 *
 * Module state is sandboxed as in backend.steer.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AcpClientHandlers, AcpPromptResponse } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";
import { AcpCompactionCollector } from "./compaction-record.ts";
import * as mapper from "./event-mapper.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-compaction-"));
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

const SUMMARY = "SUMMARY-MARK-77ab: the user asked about compaction.";
/** The measured C2 frames, in order. */
function c2Frames(id: string) {
	return [
		{ sessionUpdate: "usage_update", used: 17884, size: 1_000_000 },
		{ sessionUpdate: "compaction_update", compactionId: id, status: "in_progress" },
		{
			sessionUpdate: "compaction_update",
			compactionId: id,
			status: "completed",
			summary: [{ type: "text", text: SUMMARY }],
		},
		{ sessionUpdate: "compaction_update", compactionId: id, status: "completed" },
		{ sessionUpdate: "usage_update", used: 3669, size: 1_000_000 },
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

/** A world whose connection speaks `script.bootstrap` during newSession and `script.prompt` with the prompt on the wire. */
function makeWorld(
	script: { bootstrap?: unknown[]; prompt?: unknown[] },
	shape: { turnScoped?: boolean; closeThrows?: boolean } = {},
) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const initializeParams: unknown[] = [];
	let closeThrew = false;
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
			const say = async (frames: unknown[] | undefined) => {
				for (const update of frames ?? []) {
					await handlers.sessionUpdate({ sessionId: acpSessionId, update } as never);
				}
			};
			return {
				initialize: async (p: unknown) => {
					initializeParams.push(p);
					// #168: the pinned claude-agent-acp, read from the adapter's own floor.
					const { CLAUDE_ACP_AGENT: a } = await import("./backend-adapter.ts");
					return { agentInfo: { name: a.name, version: a.floor } };
				},
				newSession: async () => {
					await say(script.bootstrap);
					return { sessionId: acpSessionId };
				},
				setSessionConfigOption: async (p: any) => ({ configOptions: [{ id: p.configId, currentValue: p.value }] }),
				prompt: async (): Promise<AcpPromptResponse> => {
					await say(script.prompt);
					return { stopReason: "end_turn" } as AcpPromptResponse;
				},
				cancel: () => {},
				close: () => {
					// Once, right after the seal: the catch's own close then succeeds (the production close
					// is best-effort and never throws; this stands in for any throw after the seal).
					if (shape.closeThrows && !closeThrew) {
						closeThrew = true;
						throw new Error("close failed after the seal");
					}
				},
			};
		},
		lifecyclePolicy: () => (shape.turnScoped ? "turn-scoped" : "process-scoped"),
		loadConfig: (cwd, modelId, adapter) =>
			config.resolveProviderConfig({
				cwd,
				modelId,
				adapter,
				globalSettingsPath: join(SANDBOX, "absent-global-settings.json"),
				projectSettingsPath: join(SANDBOX, "absent-project-settings.json"),
			}),
		now: () => "2026-11-15T00:00:00Z",
		sessionDir,
		abortGraceMs: 40,
	};
	/** Run one whole turn; returns what it showed and how it sealed. */
	const turn = async (opts: { sessionId?: string; summary?: boolean; text?: string; texts?: string[] }) => {
		const ctx = normalizeContext({
			tools: opts.summary ? [] : PI_TOOLS,
			messages: (opts.texts ?? [opts.text ?? "hello"]).map((text) => ({
				role: "user" as const,
				content: text,
				timestamp: 0,
			})),
		});
		const options = {
			sessionId: opts.sessionId,
			reasoning: "medium",
			...(opts.summary ? { cacheRetention: "none" } : {}),
		} as Parameters<typeof backend.streamAcpTurn>[2];
		let shown = "";
		let sealed = "";
		/** The stream's own event order: text deltas by content, then the terminal. */
		const order: string[] = [];
		let final: { content: Array<{ type: string; text?: string }> } | undefined;
		for await (const e of backend.streamAcpTurn(sonnet(), ctx, options, deps)) {
			if (e.type === "text_delta") {
				shown += e.delta;
				order.push(e.delta);
			}
			if (e.type === "done") final = e.message as never;
			if (e.type === "done" || e.type === "error") order.push(`<${e.type}>`);
			if (e.type === "done" || e.type === "error") sealed = e.type;
		}
		return { shown, sealed, order, final };
	};
	return { deps, initializeParams, turn };
}

function stderrLines(run: () => Promise<unknown>) {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	});
	return run().then(
		(value) => {
			spy.mockRestore();
			return { value, lines };
		},
		(err) => {
			spy.mockRestore();
			throw err;
		},
	);
}

describe("the ACP child's compactions through the turn driver (#163 S8)", () => {
	it("[QK:ACP-COMPACT-FIRST-USER-BLOCK] attributes the command only to the first delta block, where Claude ACP reads a command", async () => {
		// claude-agent-acp 0.109.0 takes a command from the first text block (prompt-to-claude.js:31,36-39,
		// v1/acp-agent.js:1147,1152-1153); a session-info line after it must not hide the command.
		const first = makeWorld({ prompt: c2Frames("first-compact") });
		await first.turn({ sessionId: "first-compact", texts: ["/compact", "device=oracle time_kst=20261121T091435"] });
		expect(backend.takeAcpCompactionRecords("first-compact").records[0]?.promptWasCompactCommand).toBe(true);
		const second = makeWorld({ prompt: c2Frames("first-bash") });
		await second.turn({ sessionId: "first-bash", texts: ["Ran `echo hi`", "/compact"] });
		expect(backend.takeAcpCompactionRecords("first-bash").records[0]?.promptWasCompactCommand).toBe(false);
	});
	it("[QK:ACP-COMPACT-CAPABILITY-DECLARED] initialize declares the session.compaction client capability", async () => {
		const w = makeWorld({});
		await w.turn({ sessionId: "S-cap" });
		expect(w.initializeParams).toHaveLength(1);
		expect((w.initializeParams[0] as { clientCapabilities?: unknown }).clientCapabilities).toEqual({
			session: { compaction: {} },
		});
		expect(backend.takeAcpCompactionRecords("S-cap")).toEqual({ records: [], droppedBefore: [] });
	});

	it("[QK:ACP-COMPACT-PROMPT-FENCE] a compaction_update during bootstrap (a load replay) is counted, never recorded; one with the prompt on the wire is recorded for that Pi session", async () => {
		const replay = makeWorld({ bootstrap: c2Frames("REPLAYED-uuid") });
		const { value, lines } = await stderrLines(() => replay.turn({ sessionId: "S-fence-replay" }));
		expect((value as { sealed: string }).sealed).toBe("done");
		expect(backend.takeAcpCompactionRecords("S-fence-replay").records).toEqual([]);
		// A bootstrap update reaches this turn's state only if the handler is already installed;
		// either way nothing of it is recorded, and anything that reached the state is reported.
		expect(lines.join("")).not.toContain("SUMMARY-MARK");

		// The window itself, at the mapper: a frame that reaches the turn's state while its
		// collector's window is closed (after the prompt answered, before the seal) is counted only.
		const events: unknown[] = [];
		const state = mapper.createAcpStreamState({ push: (e: unknown) => events.push(e) } as never, {
			api: "entwurf",
			provider: "entwurf",
			model: "claude-sonnet-5-5",
		});
		state.compaction = new AcpCompactionCollector({
			collect: true,
			promptWasCompactCommand: false,
			now: Date.now,
			emitLine: () => {},
		});
		for (const f of c2Frames("AFTER-CLOSE")) mapper.applyAcpSessionUpdate(state, f as never);
		expect(state.compactionFencedOut).toBe(3);
		expect(state.compaction.close()).toEqual([]);

		const live = makeWorld({ prompt: c2Frames("LIVE-id") });
		const out = await live.turn({ sessionId: "S-fence-live" });
		const taken = backend.takeAcpCompactionRecords("S-fence-live");
		expect(taken.records).toHaveLength(1);
		expect(taken.records[0]).toMatchObject({
			compactionId: "LIVE-id",
			status: "completed",
			summary: SUMMARY,
			summarySource: "terminal",
			tokensAfter: { value: 3669, source: "usage_update" },
		});
		expect(out.shown).toContain("[acp: compaction completed 18k→4k");
		expect(out.shown).not.toContain("SUMMARY-MARK");
		expect(backend.takeAcpCompactionRecords("S-fence-live")).toEqual({ records: [], droppedBefore: [] });
	});

	it("[QK:ACP-COMPACT-SCOPE] Pi's summary turn and a key with no Pi session collect nothing; the summary turn shows no line, the cwd: turn still does", async () => {
		const summary = makeWorld({ prompt: c2Frames("IN-SUMMARY") });
		const s = await stderrLines(() => summary.turn({ sessionId: "S-summary-uuid", summary: true }));
		expect(backend.takeAcpCompactionRecords("S-summary-uuid").records).toEqual([]);
		expect((s.value as { shown: string }).shown).not.toContain("compaction");
		expect((s.value as { shown: string }).shown).not.toContain("SUMMARY-MARK");
		// v5.2 §2: the summary turn's text is the same as with no compaction frame at all.
		const plainSummary = await makeWorld({}).turn({ sessionId: "S-summary-uuid-2", summary: true });
		expect((s.value as { shown: string }).shown).toBe(plainSummary.shown);

		const cwd = makeWorld({ prompt: c2Frames("IN-CWD") });
		const c = await stderrLines(() => cwd.turn({}));
		expect((c.value as { shown: string }).shown).toContain("[acp: compaction completed 18k→4k");
		expect(c.lines.join("")).toContain("not recorded: outside the record's scope");

		const plain = makeWorld({ prompt: c2Frames("IN-PLAIN") });
		await plain.turn({ sessionId: "S-scope-plain" });
		expect(backend.takeAcpCompactionRecords("S-scope-plain").records).toHaveLength(1);
	});

	it("[QK:ACP-COMPACT-DISCARD-STDERR] a record no message_end took is dropped when the key's next window opens, with one stderr line and no body; only a later take of that key hears of it", async () => {
		const script: { prompt?: unknown[] } = { prompt: c2Frames("STRANDED") };
		const w = makeWorld(script);
		await w.turn({ sessionId: "S-drop" }); // nobody takes it
		script.prompt = []; // the next prompt on the same (retained) session compacts nothing
		const { lines } = await stderrLines(() => w.turn({ sessionId: "S-drop" }));
		const dropLines = lines.filter((l) => l.includes("dropped"));
		expect(dropLines).toHaveLength(1);
		expect(dropLines[0]).toContain("STRANDED".slice(0, 8));
		expect(dropLines[0]).not.toContain("SUMMARY-MARK");
		expect(backend.takeAcpCompactionRecords("S-other-key")).toEqual({ records: [], droppedBefore: [] });
		expect(backend.takeAcpCompactionRecords("S-drop")).toEqual({
			records: [],
			droppedBefore: [{ compactionId: "STRANDED", status: "completed" }],
		});
		expect(backend.takeAcpCompactionRecords("S-drop")).toEqual({ records: [], droppedBefore: [] });
	});

	it("[QK:ACP-COMPACT-WINDOW-CLOSE-LINE-IN-STREAM] a terminal with no usage after it: the line goes out when the prompt answers, in the stream before <done> and in the final content, without the summary", async () => {
		const frames = c2Frames("NO-AFTER").filter((f) => f.sessionUpdate !== "usage_update");
		const w = makeWorld({ prompt: frames });
		const out = await w.turn({ sessionId: "S-window-close" });
		const lineAt = out.order.findIndex((d) => d.includes("compaction completed"));
		const doneAt = out.order.indexOf("<done>");
		expect(lineAt).toBeGreaterThanOrEqual(0);
		expect(doneAt).toBeGreaterThan(lineAt);
		const content = (out.final?.content ?? []).map((b) => b.text ?? "").join("");
		expect(content).toContain("compaction completed");
		expect(content).not.toContain("SUMMARY-MARK");
		const [record] = backend.takeAcpCompactionRecords("S-window-close").records;
		expect(record.tokensAfter).toBeNull();
	});

	it("[QK:ACP-COMPACT-DEPOSIT-ONCE] a turn that throws after its seal (close fails) deposits its records once: one record, and no false drop at the next window", async () => {
		const throwing = makeWorld({ prompt: c2Frames("SEAL-THEN-THROW") }, { turnScoped: true, closeThrows: true });
		await throwing.turn({ sessionId: "S-deposit-once" });
		expect(backend.takeAcpCompactionRecords("S-deposit-once").records).toHaveLength(1);
		const next = makeWorld({}, { turnScoped: true });
		const { lines } = await stderrLines(() => next.turn({ sessionId: "S-deposit-once" }));
		expect(lines.filter((l) => l.includes("dropped"))).toEqual([]);
		expect(backend.takeAcpCompactionRecords("S-deposit-once")).toEqual({ records: [], droppedBefore: [] });
	});
});
