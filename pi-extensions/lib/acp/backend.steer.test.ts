/**
 * #163 S7: a busy ACP turn can be steered — capability, the busy window, and who owns it.
 *
 * The production subject is the REAL turn driver (`streamAcpTurn`) through its `AcpTurnDeps` seam,
 * with a fake child and connection, so the window a steer reaches is the one a real prompt opens.
 * The capability oracle is the adapter's measured initialize `_meta` (claude-agent-acp 0.107.0,
 * probe raw `issue163-probe-raw/cell-A.ndjson`: `{"steering":{"supported":true}}`); the steer
 * answer is the measured `{"outcome":"injected"}` (cell A).
 *
 * Module state is sandboxed as in backend.summary-turn.test.ts: HOME/XDG/PI_CODING_AGENT_DIR point
 * into a temp dir BEFORE the dynamic import.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakePiHost } from "../../../scripts/lib/acp-fake-pi-session.ts";
import { type AcpSteerSeamV1, lookupAcpSteerSeam, registerAcpSteerSeam } from "../acp-steer-seam.ts";
import type { AcpPromptResponse, AcpSteerParams } from "./acp-client.ts";
import type { AcpChildLike, AcpTurnDeps } from "./backend.ts";

// #171 step 8: the Pi session a resident turn reads, kept in step with each call.
const piHost = fakePiHost();

const SANDBOX = mkdtempSync(join(tmpdir(), "acp-steer-"));
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

const MEASURED_INITIALIZE_META = { steering: { supported: true } };
const CELL_A_INJECTED = { outcome: "injected" };

function sonnet(): Model<Api> {
	const row = models.curatedClaudeModels().find((r) => r.id === "claude-sonnet-5-5");
	if (!row) throw new Error("claude-sonnet-5-5 is not curated");
	return { ...row, api: "entwurf", provider: "entwurf", baseUrl: "" } as Model<Api>;
}

/** Pi's ordinary tool surface, so the turn passes the tool-surface preflight as a real one does. */
const PI_TOOLS = ["read", "bash", "edit", "write"].map((name) => ({
	name,
	description: "",
	parameters: obj({}, { open: true }),
}));

/** Each earlier turn of a Pi session as its context shows it: the input and a completed answer. */
const earlierTurns = new Map<string, number>();
function withEarlierTurns<M>(sessionId: string | undefined, input: string, now: M[]): M[] {
	if (sessionId === undefined) return now;
	const earlier = earlierTurns.get(sessionId) ?? 0;
	earlierTurns.set(sessionId, earlier + 1);
	const before: unknown[] = [];
	for (let i = 0; i < earlier; i++) {
		before.push(
			{ role: "user", content: input, timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: "entwurf",
				provider: "entwurf",
				model: "claude-sonnet-5-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			},
		);
	}
	return [...(before as M[]), ...now];
}

function context(text: string, sessionId?: string) {
	return normalizeContext({
		tools: PI_TOOLS,
		messages: withEarlierTurns(sessionId, text, [{ role: "user" as const, content: text, timestamp: 0 }]),
	});
}

/** One backend world whose prompts wait at the wire until released; records steer requests. */
function makeWorld(initializeAnswer: unknown) {
	const sessionDir = mkdtempSync(join(SANDBOX, "records-"));
	const steers: AcpSteerParams[] = [];

	const exits: Array<(...args: unknown[]) => void> = [];
	const gate: { release?: () => void; fail?: (e: Error) => void; entered?: () => void } = {};
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
				kill: () => true,
				unref() {},
				once(event: string, cb: (...args: unknown[]) => void) {
					if (event === "exit") exits.push(cb);
				},
			} as AcpChildLike;
			return child;
		},
		createConnection: () => {
			const acpSessionId = `ACP-${steers.length}-${Math.random().toString(16).slice(2, 6)}`;
			return {
				initialize: async () => {
					// #168: the pinned claude-agent-acp, read from the adapter's own floor.
					const { CLAUDE_ACP_AGENT: a } = await import("./backend-adapter.ts");
					return { ...(initializeAnswer as object), agentInfo: { name: a.name, version: a.floor } };
				},
				newSession: async () => ({ sessionId: acpSessionId }),
				setSessionConfigOption: async (p: any) => ({ configOptions: [{ id: p.configId, currentValue: p.value }] }),
				prompt: async (): Promise<AcpPromptResponse> => {
					await new Promise<void>((resolve, reject) => {
						gate.release = resolve;
						gate.fail = reject;
						gate.entered?.();
					});
					return { stopReason: "end_turn" } as AcpPromptResponse;
				},
				steer: async (params: AcpSteerParams) => {
					steers.push(params);
					return CELL_A_INJECTED;
				},
				cancel: () => {},
				close: () => {},
			};
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
		now: () => "2026-11-15T00:00:00Z",
		sessionDir,
		birthDir: `${sessionDir}-births`,
		abortGraceMs: 40,
	};
	/**
	 * Start a turn for Pi session `sid` and wait until its prompt is on the wire. Returns the turn's
	 * completion inside an object: an async function returning a promise would wait for it.
	 */
	const startTurn = async (sid: string, signal?: AbortSignal): Promise<{ done: Promise<void> }> => {
		const entered = new Promise<void>((resolve) => (gate.entered = resolve));
		const opts = { sessionId: sid, reasoning: "medium", signal } as Parameters<typeof backend.streamAcpTurn>[2];
		const events: unknown[] = [];
		const done = (async () => {
			for await (const e of backend.streamAcpTurn(sonnet(), context("hello", sid), opts, deps)) events.push(e);
		})();
		await Promise.race([
			entered,
			done.then(() => {
				throw new Error(`turn ended before its prompt reached the wire: ${JSON.stringify(events).slice(0, 600)}`);
			}),
		]);
		return { done };
	};
	return { deps, steers, exits, gate, startTurn };
}

describe("busy steer through the ACP turn driver (#163 S7)", () => {
	it("[QK:ACP-STEER-CAPABILITY-GATED] a steer is sent only when initialize advertised steering.supported === true", async () => {
		const answers = [{}, { _meta: { steering: { supported: false } } }, { _meta: { steering: {} } }];
		for (const [i, answer] of answers.entries()) {
			// One Pi session per world: the reuse map is module state, so a repeated id would reuse a
			// previous world's connection.
			const sid = `S-cap-off-${i}`;
			const w = makeWorld(answer);
			const { done } = await w.startTurn(sid);
			expect(await backend.steerBusyAcpSession(sid, "m")).toEqual({
				effect: "not-sent",
				reason: "steering-unsupported",
			});
			expect(w.steers).toEqual([]);
			w.gate.release?.();
			await done;
		}
		const on = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done } = await on.startTurn("S-cap-on");
		expect(await backend.steerBusyAcpSession("S-cap-on", "m")).toEqual({ effect: "injected" });
		expect(on.steers).toHaveLength(1);
		on.gate.release?.();
		await done;
	});

	it("[QK:ACP-STEER-BUSY-ONLY] with no prompt on the wire nothing is sent", async () => {
		const w = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		expect(await backend.steerBusyAcpSession("S-idle", "m")).toEqual({ effect: "not-sent", reason: "no-busy-window" });
		expect(w.steers).toEqual([]);
	});

	it("[QK:ACP-STEER-NEW-TURN-REACHABLE] the FIRST turn of a Pi session — not yet in the reuse map — is reachable, and so is a reuse turn, each on its own ACP session exactly once", async () => {
		const w = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done: first } = await w.startTurn("S-new");
		expect(await backend.steerBusyAcpSession("S-new", "to the new turn")).toEqual({ effect: "injected" });
		w.gate.release?.();
		await first;
		const { done: second } = await w.startTurn("S-new");
		expect(await backend.steerBusyAcpSession("S-new", "to the reuse turn")).toEqual({ effect: "injected" });
		w.gate.release?.();
		await second;
		expect(w.steers.map((s) => s.prompt[0].text)).toEqual(["to the new turn", "to the reuse turn"]);
		expect(w.steers[0].sessionId).toBe(w.steers[1].sessionId);
	});

	it("[QK:ACP-STEER-WINDOW-OWNER-CLEANUP] the window closes when the prompt ends — settled, failed, aborted or the child gone — and another session's window is untouched", async () => {
		const w = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done: other } = await w.startTurn("S-other");
		const settled = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done: a } = await settled.startTurn("S-settle");
		settled.gate.release?.();
		await a;
		expect(await backend.steerBusyAcpSession("S-settle", "m")).toMatchObject({ reason: "no-busy-window" });

		const failed = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done: b } = await failed.startTurn("S-fail");
		failed.gate.fail?.(new Error("agent error"));
		await b;
		expect(await backend.steerBusyAcpSession("S-fail", "m")).toMatchObject({ reason: "no-busy-window" });

		const aborted = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const ctl = new AbortController();
		const { done: c } = await aborted.startTurn("S-abort", ctl.signal);
		ctl.abort();
		await c;
		expect(await backend.steerBusyAcpSession("S-abort", "m")).toMatchObject({ reason: "no-busy-window" });

		const died = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done: d } = await died.startTurn("S-died");
		for (const exit of died.exits) exit(1, null);
		await d;
		expect(await backend.steerBusyAcpSession("S-died", "m")).toMatchObject({ reason: "no-busy-window" });

		expect(await backend.steerBusyAcpSession("S-other", "still busy")).toEqual({ effect: "injected" });
		w.gate.release?.();
		await other;
	});

	it("[QK:ACP-STEER-WINDOW-OWNER-ONLY] a window is removed only by the turn that opened it, never by an older one closing late", async () => {
		const sentA: AcpSteerParams[] = [];
		const sentB: AcpSteerParams[] = [];
		const conn = (sent: AcpSteerParams[]) => ({
			initialize: async () => ({}),
			newSession: async () => ({}),
			prompt: async () => ({}) as AcpPromptResponse,
			steer: async (p: AcpSteerParams) => {
				sent.push(p);
				return CELL_A_INJECTED;
			},
		});
		const closeA = backend.openAcpSteerWindow("pi:S-owner", {
			connection: conn(sentA),
			acpSessionId: "A",
			steering: true,
		});
		const closeB = backend.openAcpSteerWindow("pi:S-owner", {
			connection: conn(sentB),
			acpSessionId: "B",
			steering: true,
		});
		closeA();
		expect(await backend.steerBusyAcpSession("S-owner", "m")).toEqual({ effect: "injected" });
		expect(sentA).toEqual([]);
		expect(sentB.map((p) => p.sessionId)).toEqual(["B"]);
		closeB();
		expect(await backend.steerBusyAcpSession("S-owner", "m")).toMatchObject({ reason: "no-busy-window" });
	});

	it("[QK:ACP-STEER-SEAM-DUPLICATE-REFUSED] the same seam again is a no-op; a different seam over an old value that is not a version-1 seam is refused by name and leaves it in place; a wrong-shaped value reads as invalid", () => {
		const host = {};
		const seam: AcpSteerSeamV1 = {
			version: 1,
			steerBusy: async () => ({ effect: "injected" }),
			hasOpenWindow: () => false,
		};
		registerAcpSteerSeam(seam, host);
		registerAcpSteerSeam(seam, host);
		expect(lookupAcpSteerSeam(host)).toEqual({ kind: "ok", seam });
		expect(lookupAcpSteerSeam({})).toEqual({ kind: "absent" });
		const broken = { version: 1, steerBusy: async () => ({ effect: "injected" }) };
		const old = { [Symbol.for("entwurf.acp.steer.v1")]: broken };
		expect(() => registerAcpSteerSeam(seam, old)).toThrow(/^acp-steer-seam-duplicate: .*not a version-1 seam/);
		expect(old[Symbol.for("entwurf.acp.steer.v1")]).toBe(broken);
		expect(lookupAcpSteerSeam(old)).toMatchObject({ kind: "invalid" });
		const bad = {
			[Symbol.for("entwurf.acp.steer.v1")]: { version: 2, steerBusy: () => {}, hasOpenWindow: () => false },
		};
		expect(lookupAcpSteerSeam(bad)).toMatchObject({ kind: "invalid" });
	});

	it("[QK:ACP-STEER-SEAM-RELOAD-IDLE-REPLACES] a different seam replaces an old one whose backend has no prompt in flight (a reload); the real backend's seam reports idle once its turn ended", async () => {
		const next: AcpSteerSeamV1 = {
			version: 1,
			steerBusy: async () => ({ effect: "injected" }),
			hasOpenWindow: () => false,
		};
		const host = {};
		registerAcpSteerSeam(backend.ACP_STEER_SEAM, host);
		const w = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done } = await w.startTurn("S-reload-idle");
		w.gate.release?.();
		await done;
		expect(backend.ACP_STEER_SEAM.hasOpenWindow()).toBe(false);
		registerAcpSteerSeam(next, host);
		expect(lookupAcpSteerSeam(host)).toEqual({ kind: "ok", seam: next });
	});

	it("[QK:ACP-STEER-SEAM-RELOAD-BUSY-REFUSED] a different seam over an old one with a prompt in flight is refused by name and the old seam stays — as is an old seam whose answer throws", async () => {
		const next: AcpSteerSeamV1 = {
			version: 1,
			steerBusy: async () => ({ effect: "injected" }),
			hasOpenWindow: () => false,
		};
		const host = {};
		registerAcpSteerSeam(backend.ACP_STEER_SEAM, host);
		const w = makeWorld({ _meta: MEASURED_INITIALIZE_META });
		const { done } = await w.startTurn("S-reload-busy");
		expect(backend.ACP_STEER_SEAM.hasOpenWindow()).toBe(true);
		expect(() => registerAcpSteerSeam(next, host)).toThrow(/^acp-steer-seam-duplicate: .*prompt in flight/);
		expect(lookupAcpSteerSeam(host)).toEqual({ kind: "ok", seam: backend.ACP_STEER_SEAM });
		w.gate.release?.();
		await done;
		const throwing: AcpSteerSeamV1 = {
			...next,
			hasOpenWindow: () => {
				throw new Error("gone");
			},
		};
		const h2 = {};
		registerAcpSteerSeam(throwing, h2);
		expect(() => registerAcpSteerSeam(next, h2)).toThrow(/^acp-steer-seam-duplicate: /);
	});
});
