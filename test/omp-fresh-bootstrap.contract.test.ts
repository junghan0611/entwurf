/**
 * omp-fresh-bootstrap.contract — the two halves of the #87 Bundle C fresh bootstrap, and the
 * seam between them.
 *
 * WHY THIS FILE EXISTS AT ALL. The launcher (`pi-extensions/lib/mux-fresh-call.ts`) composes a
 * payload; the birth extension (`pi-extensions/meta-bridge-omp.ts`) unpacks it and owns the
 * sibling's first two messages. Those two files never import each other and CANNOT: the
 * extension is copied into `<omp agent dir>/extensions/entwurf-meta-omp/` with only
 * `lib/meta-session` and `lib/session-id` beside it, so a shared constant would have to grow
 * the installed unit's closure, the installer, the doctor's parity list and two artifact
 * manifests. The duplication is deliberate and this gate is the thing that makes it safe —
 * the same shape `check-omp-fresh-preflight` already uses for the preflight's two reproduced
 * oracles.
 *
 * WHAT IT REFUSES TO PROVE. Nothing here runs omp. It proves the CONTRACT (what argv carries,
 * what the decoder admits, when the task is released); the ADMISSION is
 * `smoke-omp-fresh-live`, one real window and two real model turns.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildOmpBootstrapPayload,
	FRESH_CALL_CALLBACK_TOOL,
	OMP_BOOTSTRAP_FLAG,
	OMP_BOOTSTRAP_VERSION,
	TASK_MAX_CHARS,
} from "../pi-extensions/lib/mux-fresh-call.ts";
import entwurfMetaOmp, {
	buildOmpCallbackOnlyPrompt,
	createOmpBootstrap,
	decodeOmpBootstrapPayload,
	OMP_BOOTSTRAP_CALLBACK_TOOL,
	OMP_BOOTSTRAP_POLL_MS,
	OMP_BOOTSTRAP_READY_TIMEOUT_MS,
	OMP_BOOTSTRAP_TASK_MAX_CHARS,
	ompBootstrapCtxAccepts,
	ompCallbackToolReady,
	onBirthEdge,
	resetOmpBootstrapForTest,
	startOmpBootstrap,
	OMP_BOOTSTRAP_FLAG as UNIT_FLAG,
	OMP_BOOTSTRAP_VERSION as UNIT_VERSION,
} from "../pi-extensions/meta-bridge-omp.ts";

const GID = "20260805T000000-abcdef";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
const TASK = "summarise docs/mux-launch-rail.md";
const TOOL = "mcp__entwurf_bridge_entwurf_v";

describe("the launcher and the installed unit spell the contract the same way", () => {
	it("[QK:OMP-BOOTSTRAP-FLAG-AGREES] both halves name the same one-purpose flag — a launcher flag the unit never registered is an argv omp rejects, and a unit flag the launcher never sends is a bootstrap that never arms", () => {
		expect(OMP_BOOTSTRAP_FLAG).toBe(UNIT_FLAG);
		expect(OMP_BOOTSTRAP_FLAG).toBe("entwurf-bootstrap");
		// Registered WITHOUT dashes: the vendor's flag map is keyed by bare name
		// (`extensions/loader.ts:221-228`) and the composition adds the `--` itself.
		expect(UNIT_FLAG.startsWith("-")).toBe(false);
	});

	it("[QK:OMP-BOOTSTRAP-VERSION-AGREES] both halves agree on the grammar version — a mismatch is a STALE installed unit, which is the one thing doctor-omp-bridge exists to say out loud", () => {
		expect(OMP_BOOTSTRAP_VERSION).toBe(UNIT_VERSION);
	});

	it("[QK:OMP-BOOTSTRAP-CALLBACK-TOOL-AGREES] the unit matches the SAME minted callback name the launcher's prompt dialect names — the vendor sanitiser eats the digit in entwurf_v2, and two spellings of one tool is the failure that costs the whole first turn", () => {
		expect(OMP_BOOTSTRAP_CALLBACK_TOOL).toBe(FRESH_CALL_CALLBACK_TOOL.omp);
		expect(OMP_BOOTSTRAP_CALLBACK_TOOL).toBe(TOOL);
		expect(OMP_BOOTSTRAP_CALLBACK_TOOL).not.toContain("entwurf_v2");
	});

	it("[QK:OMP-BOOTSTRAP-TASK-CEILING-AGREES] the decoder's task ceiling is the launcher's — a unit that admitted less would silently drop tasks the public surface accepted", () => {
		expect(OMP_BOOTSTRAP_TASK_MAX_CHARS).toBe(TASK_MAX_CHARS);
	});

	it("[QK:OMP-BOOTSTRAP-ROUNDTRIP] what the launcher composes is exactly what the unit admits, byte for byte, including a task full of shell metacharacters", () => {
		const hostile = 'a "quoted" $VAR `sub` ; rm -rf / && echo \\n\ttab';
		const raw = buildOmpBootstrapPayload({ callerGardenId: GID, nonce: NONCE, task: hostile });
		const decoded = decodeOmpBootstrapPayload(raw);
		expect(decoded).toEqual({ ok: true, value: { target: GID, nonce: NONCE, task: hostile } });
	});
});

describe("the payload decoder refuses narrowly, and names each refusal", () => {
	const good = { v: OMP_BOOTSTRAP_VERSION, target: GID, nonce: NONCE, task: TASK };
	const enc = (o: unknown) => JSON.stringify(o);

	it("a well-formed payload is admitted", () => {
		expect(decodeOmpBootstrapPayload(enc(good))).toEqual({
			ok: true,
			value: { target: GID, nonce: NONCE, task: TASK },
		});
	});

	it.each([
		["flag-absent", undefined],
		["flag-not-string", true],
		["flag-not-string", ""],
		["payload-not-json", "{not json"],
		["payload-not-object", enc([1, 2])],
		["payload-not-object", enc("string")],
		["version-unsupported", enc({ ...good, v: 2 })],
		["version-unsupported", enc({ target: GID, nonce: NONCE, task: TASK })],
		["payload-unknown-key", enc({ ...good, cmd: "rm -rf /" })],
		["payload-unknown-key", enc({ ...good, env: "PI_SESSION_ID=x" })],
		["target-invalid", enc({ ...good, target: "not-a-garden-id" })],
		["target-invalid", enc({ ...good, target: 7 })],
		["nonce-invalid", enc({ ...good, nonce: "mux-fresh-call-short" })],
		["nonce-invalid", enc({ ...good, nonce: `${NONCE} ` })],
		["task-empty", enc({ ...good, task: "   " })],
		["task-empty", enc({ ...good, task: 5 })],
		["task-too-long", enc({ ...good, task: "x".repeat(TASK_MAX_CHARS + 1) })],
	] as const)("refuses with %s rather than repairing the payload", (reason, raw) => {
		expect(decodeOmpBootstrapPayload(raw)).toEqual({ ok: false, reason });
	});

	it("[QK:OMP-BOOTSTRAP-NO-ARBITRARY-CARRIER] an unknown key is a REFUSAL, not an ignored extra — this flag is the one place a caller can put arbitrary bytes, so what the launcher meant and what the unit acts on must be the same closed set", () => {
		for (const key of ["cmd", "command", "env", "path", "model", "cwd", "exec"]) {
			expect(decodeOmpBootstrapPayload(enc({ ...good, [key]: "x" }))).toEqual({
				ok: false,
				reason: "payload-unknown-key",
			});
		}
	});
});

describe("stage one waits for the exact callback tool on BOTH public snapshots", () => {
	const mcp = (name: string) => ({ name, sourceInfo: { source: "mcp" } });

	it("[QK:OMP-BOOTSTRAP-READY-NEEDS-BOTH] a tool that is registered but not ENABLED is not ready — a prompt can only call an enabled tool", () => {
		expect(ompCallbackToolReady({ on: () => {}, getAllTools: () => [mcp(TOOL)], getActiveTools: () => [] })).toBe(
			false,
		);
		expect(ompCallbackToolReady({ on: () => {}, getAllTools: () => [], getActiveTools: () => [TOOL] })).toBe(false);
		expect(ompCallbackToolReady({ on: () => {}, getAllTools: () => [mcp(TOOL)], getActiveTools: () => [TOOL] })).toBe(
			true,
		);
	});

	it("[QK:OMP-BOOTSTRAP-READY-NEEDS-MCP-PROVENANCE] a same-named tool from any other source is not the bridge — provenance is what stops an extension or built-in from being read as the callback", () => {
		expect(
			ompCallbackToolReady({
				on: () => {},
				getAllTools: () => [{ name: TOOL, sourceInfo: { source: "extension" } }],
				getActiveTools: () => [TOOL],
			}),
		).toBe(false);
	});

	it("action methods that throw are read as `not yet`, never as a fault — they throw until the runner initialises", () => {
		expect(
			ompCallbackToolReady({
				on: () => {},
				getAllTools: () => {
					throw new Error("Extension runtime not initialized");
				},
				getActiveTools: () => [TOOL],
			}),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The stage machine, driven deterministically. No sleeping, no real clock.
// ---------------------------------------------------------------------------

interface Fixture {
	/** Every `sendUserMessage` call, as the FULL argument list. Recording the arity is the
	 * point: `[content]` is the working form, `[content, {deliverAs}]` is the one that was
	 * measured to queue into a turn nobody starts. */
	sent: unknown[][];
	tools: Array<{ name: string; sourceInfo: { source: string } }>;
	active: string[];
	handle: ReturnType<typeof createOmpBootstrap>;
	/** Run the next scheduled poll. */
	tick(): void;
	/** Move the fake clock forward. */
	advance(ms: number): void;
	logs: string[];
}

function fixture(payload = { target: GID, nonce: NONCE, task: TASK }): Fixture {
	const sent: unknown[][] = [];
	const logs: string[] = [];
	const tools: Array<{ name: string; sourceInfo: { source: string } }> = [];
	const active: string[] = [];
	let clock = 1_000;
	let pending: (() => void) | null = null;

	const handle = createOmpBootstrap({
		payload,
		pi: {
			on: () => {},
			getAllTools: () => tools,
			getActiveTools: () => active,
			sendUserMessage: (...args: unknown[]) => {
				sent.push(args);
			},
		},
		log: (level, message) => logs.push(`${level} ${message}`),
		timers: {
			set: (fn) => {
				pending = fn;
				return 1;
			},
			clear: () => {
				pending = null;
			},
			now: () => clock,
		},
	});

	return {
		sent,
		tools,
		active,
		handle,
		logs,
		tick() {
			const fn = pending;
			pending = null;
			fn?.();
		},
		advance(ms) {
			clock += ms;
		},
	};
}

/** Make the callback tool live. */
function arm(fx: Fixture): void {
	fx.tools.push({ name: TOOL, sourceInfo: { source: "mcp" } });
	fx.active.push(TOOL);
}

const call = (over: Record<string, unknown> = {}) => ({
	toolCallId: "call-1",
	toolName: TOOL,
	input: { target: GID, message: NONCE, intent: "fire-and-forget" },
	...over,
});
const result = (over: Record<string, unknown> = {}) => ({ ...call(), isError: false, ...over });

describe("stage one: the callback-only prompt, and nothing else", () => {
	it("[QK:OMP-BOOTSTRAP-NO-FIXED-DELAY] start observes readiness immediately and then POLLS — the gap is a race, not a constant, so a fixed wait is never correct", () => {
		const fx = fixture();
		fx.handle.start();
		expect(fx.sent).toEqual([]);
		expect(fx.handle.phase()).toBe("waiting");
		fx.tick();
		expect(fx.sent).toEqual([]);
		arm(fx);
		fx.tick();
		expect(fx.handle.phase()).toBe("callback-sent");
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-CALLBACK-ONLY] the first message asks for the callback and carries NO task — the measured failure answered `ACK` to a prompt that carried both", () => {
		const fx = fixture();
		arm(fx);
		fx.handle.start();
		const args = fx.sent[0] as unknown[];
		const content = args[0] as string;
		expect(content).toContain(TOOL);
		expect(content).toContain(GID);
		expect(content).toContain(NONCE);
		expect(content).not.toContain(TASK);
		// Stage one runs on an idle session, so the omitted-option form starts a turn. An
		// explicit option here would queue into a turn nobody starts.
		expect(args).toHaveLength(1);
	});

	it("the callback-only prompt promises the task as the NEXT message, so the sibling neither asks for it nor guesses", () => {
		const prompt = buildOmpCallbackOnlyPrompt({ target: GID, nonce: NONCE });
		expect(prompt).toContain("NEXT user message");
		expect(prompt).not.toContain("ACK");
		expect(prompt).not.toContain("DONE");
	});

	it("[QK:OMP-BOOTSTRAP-ONE-CALLBACK-PROMPT] readiness observed twice sends the callback prompt once — the phase moves BEFORE the send", () => {
		const fx = fixture();
		arm(fx);
		fx.handle.start();
		fx.handle.start();
		fx.tick();
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-BOUNDED-READINESS] readiness is bounded: past the deadline the bootstrap FAILS and the task is never sent, so the public caller times out honestly", () => {
		const fx = fixture();
		fx.handle.start();
		fx.advance(OMP_BOOTSTRAP_READY_TIMEOUT_MS + 1);
		fx.tick();
		expect(fx.handle.phase()).toBe("failed");
		expect(fx.sent).toEqual([]);
		// Even if the tool turns up afterwards, nothing restarts.
		arm(fx);
		fx.tick();
		expect(fx.sent).toEqual([]);
	});

	it("the poll period and the deadline are both explicit product constants, not magic numbers in a loop", () => {
		expect(OMP_BOOTSTRAP_POLL_MS).toBeGreaterThan(0);
		expect(OMP_BOOTSTRAP_READY_TIMEOUT_MS).toBeGreaterThan(OMP_BOOTSTRAP_POLL_MS * 10);
	});
});

describe("stage two: the task is released by an exact successful tool RESULT, or not at all", () => {
	function readyFixture(): Fixture {
		const fx = fixture();
		arm(fx);
		fx.handle.start();
		return fx;
	}

	it("[QK:OMP-BOOTSTRAP-RESULT-ARMS-ONLY] a matching successful result RELEASES but does not send — inside the callback turn the session is still streaming, and `[LIVE 2026-08-30]` a send from there was measured to never reach the session at all", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		expect(fx.handle.pendingCallId()).toBe("call-1");
		expect(fx.sent).toHaveLength(1);
		fx.handle.onToolResult(result());
		expect(fx.handle.phase()).toBe("released");
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-TASK-AT-TURN-END] the task is delivered at the FIRST turn_end after the release, exactly once, with NO delivery option — the omitted form is the one measured to land and start a turn", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		fx.handle.onTurnEnd();
		expect(fx.handle.phase()).toBe("task-sent");
		expect(fx.sent).toHaveLength(2);
		expect(fx.sent[1]).toEqual([TASK]);
	});

	it("[QK:OMP-BOOTSTRAP-NO-EXPLICIT-DELIVERY] neither stage passes a delivery option — an explicit `deliverAs` queues without starting a turn in EITHER state (`agent-session.ts:6511-6513`), which is the exact shape that lost the first LIVE", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		fx.handle.onTurnEnd();
		for (const args of fx.sent) expect(args).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-TURN-END-BEFORE-RESULT] a turn_end BEFORE the callback result sends nothing — the phase test is the whole guard, and this handler fires on every turn of the session", () => {
		const fx = readyFixture();
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
		fx.handle.onToolCall(call());
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
		expect(fx.handle.phase()).toBe("callback-sent");
	});

	it("[QK:OMP-BOOTSTRAP-ONE-TASK] a second, third and later turn_end send nothing more — the latch moves BEFORE the send, so one release is one task", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		fx.handle.onTurnEnd();
		fx.handle.onTurnEnd();
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(2);
		expect(fx.handle.phase()).toBe("task-sent");
	});

	it("[QK:OMP-BOOTSTRAP-CALL-ALONE-RELEASES-NOTHING] a tool_call is only an attempt — it fires before scheduling and before approval, so it can never release the task", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolCall(call({ toolCallId: "call-2" }));
		expect(fx.sent).toHaveLength(1);
		expect(fx.handle.phase()).toBe("callback-sent");
	});

	it.each([
		["a wrong tool name", () => ({ over: { toolName: "mcp__entwurf_bridge_entwurf_peers" } })],
		["a wrong nonce", () => ({ over: { input: { target: GID, message: "mux-fresh-call-000000000000000000000000" } } })],
		["a wrong target", () => ({ over: { input: { target: "20260101T000000-000000", message: NONCE } } })],
		["a non-object input", () => ({ over: { input: "target=…" } })],
	] as const)("%s never releases the task", (_label, mk) => {
		const fx = readyFixture();
		const { over } = mk();
		fx.handle.onToolCall(call(over as Record<string, unknown>));
		expect(fx.handle.pendingCallId()).toBe(null);
		fx.handle.onToolResult(result(over as Record<string, unknown>));
		expect(fx.handle.phase()).toBe("callback-sent");
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-ERROR-RESULT-NO-TASK] an errored callback leaves the task unsent through the turn_end boundary too — `isError` is the vendor's own success axis and MCP protocol errors set it", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result({ isError: true }));
		expect(fx.handle.phase()).toBe("callback-sent");
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("a result whose isError is missing or non-boolean is NOT a success — the predicate is `=== false`, not falsy, and the turn_end that follows still finds nothing armed", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult({ ...call(), isError: undefined });
		fx.handle.onToolResult({ ...call(), isError: 0 });
		expect(fx.handle.phase()).toBe("callback-sent");
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-STRICT-CALL-ID] a result for a call this bootstrap never matched cannot release the task, even when its tool, target and nonce all match", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result({ toolCallId: "someone-elses-call" }));
		expect(fx.handle.phase()).toBe("callback-sent");
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("a result arriving before any matching call is ignored — the id store is what stage two waits on", () => {
		const fx = readyFixture();
		fx.handle.onToolResult(result());
		expect(fx.handle.phase()).toBe("callback-sent");
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-ONE-RELEASE] duplicate successful results still produce exactly one task — the release latch is spent on the first, and the turn_end that follows finds one armed task, not three", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		fx.handle.onToolResult(result());
		fx.handle.onToolResult(result());
		expect(fx.sent).toHaveLength(1);
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(2);
		expect(fx.handle.phase()).toBe("task-sent");
	});

	it("[QK:OMP-BOOTSTRAP-INVALIDATE-NO-TASK] an invalidated bootstrap — a session switch, or a replacement taking the lane — never sends the task afterwards", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.invalidate("session_switch(new)");
		expect(fx.handle.phase()).toBe("failed");
		fx.handle.onToolResult(result());
		fx.handle.onTurnEnd();
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-RELEASED-IS-INVALIDATABLE] a bootstrap invalidated BETWEEN the callback result and the next turn_end loses its task — `/new` replaces the session under a living process, and the caller's task must die with the session it was addressed to", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		expect(fx.handle.phase()).toBe("released");
		fx.handle.invalidate("session_switch(new)");
		fx.handle.onTurnEnd();
		expect(fx.handle.phase()).toBe("failed");
		expect(fx.sent).toHaveLength(1);
	});

	it("a bootstrap that has SENT its task stays task-sent when invalidated afterwards — a spent lane is not rewritten by teardown", () => {
		const fx = readyFixture();
		fx.handle.onToolCall(call());
		fx.handle.onToolResult(result());
		fx.handle.onTurnEnd();
		fx.handle.invalidate("session_shutdown");
		expect(fx.handle.phase()).toBe("task-sent");
		expect(fx.sent).toHaveLength(2);
	});

	it("a vendor with no sendUserMessage fails loudly in the log and never claims to have delivered anything", () => {
		const fx = fixture();
		const handle = createOmpBootstrap({
			payload: { target: GID, nonce: NONCE, task: TASK },
			pi: {
				on: () => {},
				getAllTools: () => [{ name: TOOL, sourceInfo: { source: "mcp" } }],
				getActiveTools: () => [TOOL],
			},
			// Readiness is already true here, so nothing is ever scheduled — but the seam is
			// REQUIRED and has no default, which is the whole of the D2 repair.
			timers: { set: () => 1, clear: () => {}, now: () => 1_000 },
			log: (level, message) => fx.logs.push(`${level} ${message}`),
		});
		handle.start();
		expect(handle.phase()).toBe("failed");
		expect(fx.logs.join("\n")).toContain("sendUserMessage is not available");
	});
});

describe("the session fence: which context may act on a bootstrap at all", () => {
	/** The vendor's `ReadonlySessionManager` surface, minimally complete — this unit reads only
	 * `getSessionId`, but the mirror declares all three (`session-manager.ts:359-376`). */
	const manager = (getSessionId: () => unknown) => ({ getSessionId, getCwd: () => "/tmp", getSessionFile: () => null });
	const tui = (id: string) => ({ mode: "tui", cwd: "/tmp", sessionManager: manager(() => id) });

	it("[QK:OMP-BOOTSTRAP-SESSION-FENCE] only the visible tui host holding the SAME native session id may act — a wrong session id is refused, so a replaced session cannot release the previous caller's task", () => {
		expect(ompBootstrapCtxAccepts(tui("native-1"), "native-1")).toBe(true);
		expect(ompBootstrapCtxAccepts(tui("native-2"), "native-1")).toBe(false);
	});

	it("[QK:OMP-BOOTSTRAP-SUBAGENT-FENCE] a task subagent is refused even on the same id — it re-runs this very factory, and its tool results are not the host's", () => {
		for (const mode of ["print", "rpc", "json"]) {
			expect(ompBootstrapCtxAccepts({ ...tui("native-1"), mode }, "native-1")).toBe(false);
		}
	});

	it("a context with no readable session id is refused rather than guessed", () => {
		expect(ompBootstrapCtxAccepts({ mode: "tui", cwd: "/tmp" }, "native-1")).toBe(false);
		expect(ompBootstrapCtxAccepts({ mode: "tui", cwd: "/tmp", sessionManager: manager(() => 7) }, "native-1")).toBe(
			false,
		);
		expect(
			ompBootstrapCtxAccepts(
				{
					mode: "tui",
					cwd: "/tmp",
					sessionManager: manager(() => {
						throw new Error("vendor threw");
					}),
				},
				"native-1",
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The birth seam: arming, the epoch that ends an arming, and the timers a bootstrap is
// allowed to own. These are the #87 amendment cells (Terra review, Defects 1 and 2).
//
// They drive `startOmpBootstrap` directly rather than `onBirthEdge`, on purpose: birth
// itself writes a record and a sender marker, and those are `check-omp-birth-hook`'s
// subject. What is under test here is the part with no filesystem in it — what a later
// birth edge does to a live bootstrap, and which timer surface a bootstrap may hold.
// The tool/turn events go through the REAL wiring (`entwurfMetaOmp`), because the session
// fence those handlers apply is half of what makes the epoch rule true.
// ---------------------------------------------------------------------------

const NATIVE = "01a05000-0000-7000-8000-000000000001";
const OTHER_NATIVE = "01a05000-0000-7000-8000-000000000002";

/** Every field of every vendor event this unit binds is optional, so ONE widened record is
 * assignable to all four `on` overloads at once — which is what lets this fixture keep a
 * single handler table instead of four. */
type WiredEvent = {
	type?: unknown;
	reason?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	input?: unknown;
	isError?: unknown;
};
/** The two members `ExtensionContext` requires; everything else the unit reads is optional
 * there, so the narrow form is the one assignable to every overload's context. */
type WiredCtx = { mode: unknown; cwd: unknown };
/** Which vendor timer member this build is missing. `"none"` is a complete v18.0.0 context. */
type TimerGap = "none" | "setTimeout" | "clearTimer";

function birthFixture() {
	const sent: unknown[][] = [];
	const logs: string[] = [];
	const tools: Array<{ name: string; sourceInfo: { source: string } }> = [];
	const active: string[] = [];
	/** Handles the ctx has created and has NOT been asked to clear. A leaked poll is a
	 * non-empty map after teardown, which is exactly what the raw global timer could not say. */
	const live = new Map<number, () => void>();
	const handlers = new Map<string, Array<(event: WiredEvent, ctx: WiredCtx) => void>>();
	let nextHandle = 1;

	const pi = {
		on(event: string, handler: (event: WiredEvent, ctx: WiredCtx) => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerFlag: () => {},
		getFlag: (name: string) =>
			name === UNIT_FLAG ? JSON.stringify({ v: UNIT_VERSION, target: GID, nonce: NONCE, task: TASK }) : undefined,
		getAllTools: () => tools,
		getActiveTools: () => active,
		sendUserMessage: (...args: unknown[]) => {
			sent.push(args);
		},
	};
	// The real binding, so `tool_call` / `tool_result` / `turn_end` reach the module's own
	// session fence rather than a handle the test is holding by the hand.
	entwurfMetaOmp(pi);

	const vendorSetTimeout = (fn: () => void, _ms: number) => {
		const handle = nextHandle++;
		live.set(handle, fn);
		return handle;
	};
	const vendorClearTimer = (handle: unknown) => {
		live.delete(handle as number);
	};

	const ctx = (nativeSessionId: string, gap: TimerGap = "none") => ({
		mode: "tui",
		cwd: "/tmp",
		sessionManager: { getSessionId: () => nativeSessionId, getCwd: () => "/tmp", getSessionFile: () => null },
		setTimeout: gap === "setTimeout" ? undefined : vendorSetTimeout,
		clearTimer: gap === "clearTimer" ? undefined : vendorClearTimer,
	});

	return {
		sent,
		logs,
		tools,
		active,
		live,
		/** The REAL `onBirthEdge` with this fixture's `pi` — the wired path, INCLUDING its two
		 * early exits. `birth` below skips it because a healthy edge writes a record and a
		 * marker, which is `check-omp-birth-hook`'s subject; this one exists precisely to drive
		 * an edge that never gets that far. */
		birthEdge(edge: string, rawCtx: { mode: unknown; cwd: unknown }) {
			onBirthEdge(edge, rawCtx, pi);
		},
		/** One birth edge, with the ctx the vendor would carry. */
		birth(edge: string, nativeSessionId = NATIVE, gap: TimerGap = "none") {
			startOmpBootstrap({
				pi,
				ctx: ctx(nativeSessionId, gap),
				envelope: { nativeSessionId, cwd: "/tmp", transcriptPath: null },
				edge,
				log: (level, message) => logs.push(`${level} ${message}`),
			});
		},
		/** Fire a wired vendor event, as the runner would, against a session's own ctx. */
		emit(event: string, payload: WiredEvent, nativeSessionId = NATIVE) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx(nativeSessionId));
		},
		/** Run every timer the ctx currently owns, once. */
		tick() {
			for (const [handle, fn] of [...live]) {
				live.delete(handle);
				fn();
			}
		},
		/** Make the callback tool live. */
		ready() {
			tools.push({ name: TOOL, sourceInfo: { source: "mcp" } });
			active.push(TOOL);
		},
	};
}

describe("defect 1 — a birth edge ends the epoch, and the native id is not the epoch", () => {
	beforeEach(() => {
		resetOmpBootstrapForTest();
	});
	afterEach(() => {
		resetOmpBootstrapForTest();
	});

	it('[QK:OMP-BOOTSTRAP-SAME-ID-SWITCH-INVALIDATES] a session_switch carrying the SAME native id kills a nonfinal bootstrap — the vendor emits `session_switch(reason:"resume")` on the same-file reload path and replaces the transcript, so surviving it would release the caller\'s task into a conversation the caller never opened', () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start");
		expect(fx.sent).toHaveLength(1); // the callback-only prompt, and nothing else

		fx.birth("session_switch(resume)", NATIVE);
		expect(fx.logs.join("\n")).toContain("ended the bootstrap epoch");
		expect(fx.logs.join("\n")).toContain("same-id=true");

		// The callback still lands, and the turn boundary that would have carried the task
		// now finds nothing: the bootstrap is gone from the lane, so the fence has no handle.
		fx.emit("tool_call", call());
		fx.emit("tool_result", result());
		fx.emit("turn_end", {});
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-NO-REARM-AFTER-EPOCH] the killed epoch is never rearmed — `getFlag` reads a per-process map that reading does not consume, so an unlatched unit would arm the same payload again on the very next edge", () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start");
		fx.birth("session_switch(resume)", NATIVE);
		fx.birth("session_switch(resume)", NATIVE);
		fx.birth("session_start", OTHER_NATIVE);
		fx.tick();
		fx.emit("turn_end", {}, OTHER_NATIVE);
		expect(fx.sent).toHaveLength(1);
		expect(fx.logs.filter((line) => line.includes("bootstrap-armed"))).toHaveLength(1);
	});

	it("a DIFFERENT native id ends the epoch on the same one path — the absorbed branch still holds, and the log names which case it was", () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start");
		fx.birth("session_switch(fork)", OTHER_NATIVE);
		expect(fx.logs.join("\n")).toContain("same-id=false");
		fx.emit("turn_end", {});
		expect(fx.sent).toHaveLength(1);
	});

	it("[QK:OMP-BOOTSTRAP-EPOCH-CLEARS-POLL] the ended epoch takes its readiness poll with it — a bootstrap still WAITING when the switch arrives leaves no timer behind for the vendor to run against a replaced session", () => {
		const fx = birthFixture();
		fx.birth("session_start"); // no tools yet: the poll is scheduled and outstanding
		expect(fx.live.size).toBe(1);
		fx.birth("session_switch(resume)", NATIVE);
		expect(fx.live.size).toBe(0);
		fx.ready();
		fx.tick();
		expect(fx.sent).toEqual([]);
	});

	it("[QK:OMP-BOOTSTRAP-EPOCH-ENDS-BEFORE-ENVELOPE] a later birth edge that BAILS still ends the epoch — `onBirthEdge` exits early on a refused envelope and on a throwing upsert, and a bail is a WORSE edge than a healthy one, never a reason to keep the previous caller's task alive (#87 O-D1r)", () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start");
		fx.emit("tool_call", call());
		fx.emit("tool_result", result());
		// released: the callback provably succeeded and the task is armed for the next turn_end.

		// A store of its own, so "no record was minted" is a fact this cell can read rather
		// than a claim it has to trust. The hook log resolves under the same root.
		const store = fs.mkdtempSync(path.join(os.tmpdir(), "omp-epoch-"));
		const sessionsDir = path.join(store, "meta-sessions");
		const previous = process.env.ENTWURF_META_SESSIONS_DIR;
		process.env.ENTWURF_META_SESSIONS_DIR = sessionsDir;
		try {
			// Past the mode fence — this IS the visible host — but with no `sessionManager` the
			// envelope is refused, so onBirthEdge returns before it ever reaches upsertMetaSession.
			fx.birthEdge("session_switch(resume)", { mode: "tui", cwd: "/tmp" });
		} finally {
			if (previous === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
			else process.env.ENTWURF_META_SESSIONS_DIR = previous;
		}

		fx.emit("turn_end", {});
		// One message ever left: the callback-only prompt. The task died with the epoch.
		expect(fx.sent).toHaveLength(1);
		// And the bail really was a bail — no record store came into existence.
		expect(fs.existsSync(sessionsDir)).toBe(false);
		fs.rmSync(store, { recursive: true, force: true });
	});
});

describe("defect 2 — the readiness poll belongs to the creator context, or it does not exist", () => {
	beforeEach(() => {
		resetOmpBootstrapForTest();
	});
	afterEach(() => {
		resetOmpBootstrapForTest();
	});

	it("[QK:OMP-BOOTSTRAP-CREATOR-OWNED-TIMER] the poll is scheduled through the BIRTH ctx's own `setTimeout`, not a global one — the vendor registers its timers per session and clears them on session_shutdown, and a raw global timer is in no registry at all", () => {
		const fx = birthFixture();
		fx.birth("session_start");
		expect(fx.live.size).toBe(1);
		fx.ready();
		fx.tick();
		expect(fx.sent).toHaveLength(1);
		// The send closed the poll through the SAME ctx's clearTimer.
		expect(fx.live.size).toBe(0);
	});

	it("[QK:OMP-BOOTSTRAP-REFUSES-UNCANCELLABLE-TIMER] a vendor build with no `clearTimer` does not arm at all — an uncancellable 100ms poll inside the operator's TUI is a defect we would have installed, while an unarmed launch is an honest fresh-call timeout", () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start", NATIVE, "clearTimer");
		expect(fx.sent).toEqual([]);
		expect(fx.live.size).toBe(0);
		expect(fx.logs.join("\n")).toContain("bootstrap-timers-unavailable");
		expect(fx.logs.join("\n")).toContain("the task was NOT sent");
		expect(fx.logs.join("\n")).not.toContain("bootstrap-armed");
	});

	it("a build with no `setTimeout` is refused on the same terms, and neither refusal leaves the launch rearmable", () => {
		const fx = birthFixture();
		fx.ready();
		fx.birth("session_start", NATIVE, "setTimeout");
		expect(fx.logs.join("\n")).toContain("bootstrap-timers-unavailable");
		// The launch had its one chance; a later edge must not arm the caller's task into a
		// session the caller never opened.
		fx.birth("session_start", OTHER_NATIVE);
		fx.tick();
		expect(fx.sent).toEqual([]);
		expect(fx.logs.join("\n")).not.toContain("bootstrap-armed");
	});

	it("a manual `omp` — no flag — reaches neither the timer check nor the log, so an operator session stays silent", () => {
		const fx = birthFixture();
		const bare = {
			on: () => {},
			registerFlag: () => {},
			getFlag: () => undefined,
			getAllTools: () => [],
			getActiveTools: () => [],
			sendUserMessage: () => {},
		};
		const logs: string[] = [];
		startOmpBootstrap({
			pi: bare,
			ctx: { mode: "tui", cwd: "/tmp" },
			envelope: { nativeSessionId: NATIVE, cwd: "/tmp", transcriptPath: null },
			edge: "session_start",
			log: (level, message) => logs.push(`${level} ${message}`),
		});
		expect(logs).toEqual([]);
		expect(fx.sent).toEqual([]);
	});

	it("[QK:OMP-BOOTSTRAP-LATE-TICK-IS-INERT] a tick that escapes teardown does nothing — the phase is the guard, so even a vendor that ran a cleared timer could not resurrect the send", () => {
		const fx = birthFixture();
		fx.birth("session_start");
		const escaped = [...fx.live.values()][0];
		fx.birth("session_switch(resume)", NATIVE);
		fx.ready();
		escaped();
		expect(fx.sent).toEqual([]);
		expect(fx.live.size).toBe(0);
	});
});
