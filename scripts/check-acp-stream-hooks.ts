// Deterministic gate for the pi 0.84 streamSimple HOOK contract on the ACP rail
// (#63; upstream pi-mono #7372 → doc-only PR #7576).
//
// What the contract is, measured, not assumed:
//
//   onPayload   maps TRUTHFULLY: the provider request on this rail is the ACP
//               `session/prompt` params, so the hook receives the EXACT
//               `{sessionId, prompt}` object after the wire content is fully
//               built (augment / reuse delta included) and immediately before
//               `connection.prompt`; a returned replacement becomes the wire
//               params. Integrity is fail-closed: a replacement must be a
//               non-null, non-array object keeping the bootstrapped sessionId
//               and carrying a non-empty prompt array — prompt rewriting is
//               upstream-granted power, session identity and this rail's own
//               non-empty-prompt invariant are not.
//   onResponse  is an EXPLICIT LOCAL NON-HTTP EXEMPTION: pi hard-types it as
//               HTTP `{status, headers}` and ACP's terminal result arrives only
//               after the session-update body was consumed — any invocation
//               would fabricate HTTP evidence. This gate pins the ABSENCE
//               behaviorally across success, error, and abort turns.
//
// Every cell drives `streamAcpTurn` against a fake ACP child/connection with
// handlers registered for BOTH hooks, and judges what actually reached the wire.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), so — like check-acp-prompt-lifecycle — we tsc-emit the project
// and import the COMPILED backend.js whose `.js` imports resolve to real siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Message, Model } from "@earendil-works/pi-ai";

const sonnet = { id: "claude-sonnet-5" } as unknown as Model<Api>;

type Stream = AsyncIterable<AssistantMessageEvent>;

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let res!: (value: T) => void;
	let rej!: (err: unknown) => void;
	const promise = new Promise<T>((a, b) => {
		res = a;
		rej = b;
	});
	return { promise, resolve: res, reject: rej };
}

function makeFakeChild() {
	const pipe = () => ({ destroy() {}, unref() {} });
	return {
		pid: undefined as number | undefined,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stdin: pipe(),
		stdout: pipe(),
		stderr: { on() {}, destroy() {}, unref() {} },
		kill() {
			return true;
		},
		unref() {},
		once() {},
	};
}

const EMPTY_MCP_HASH = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const DEFAULT_RESOLVED_CONFIG: any = {
	settingSources: [],
	strictMcpConfig: true,
	showToolNotifications: true,
	mcpServers: [],
	mcpServersHash: EMPTY_MCP_HASH,
	tools: ["Read"],
	skillPlugins: [],
	permissionAllow: ["Read(*)"],
	disallowedTools: [],
};

/** One backend world whose fake connection CAPTURES the raw wire prompt params. */
function makeHarness(recordDir: string) {
	const children: ReturnType<typeof makeFakeChild>[] = [];
	const promptCalls: Array<{ sessionId: string; prompt: Array<{ type: string; text: string }> }> = [];

	const makeConnection = (_handlers: any) => ({
		initialize: async () => ({ agentCapabilities: {} }),
		newSession: async () => ({ sessionId: "ACP-1" }),
		setSessionConfigOption: async () => ({}),
		prompt: async (params: any) => {
			// Deep-cloned: the capture must be the bytes that crossed the seam, not a
			// live reference a later mutation could rewrite.
			promptCalls.push(structuredClone(params));
			return { stopReason: "end_turn" };
		},
		cancel: async () => {},
		close: () => {},
	});

	return {
		children,
		promptCalls,
		deps: {
			resolveLaunch: () => ({ command: "node", args: ["fake"] }),
			ensureOverlay: () => {},
			spawnChild: () => {
				const c = makeFakeChild();
				children.push(c);
				return c;
			},
			createConnection: (_child: any, handlers: any) => makeConnection(handlers),
			lifecyclePolicy: () => "process-scoped",
			loadConfig: () => DEFAULT_RESOLVED_CONFIG,
			now: () => "2026-08-07T00:00:00Z",
			sessionDir: recordDir,
			abortGraceMs: 40,
		},
	};
}

async function collect(stream: Stream): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	return events;
}

const sealed = (events: AssistantMessageEvent[]) =>
	events.filter((e) => e.type === "done" || e.type === "error") as any[];

const userCtx = (text: string): Context => ({ messages: [{ role: "user", content: text, timestamp: 0 }] }) as Context;

function reuseCtx(prior: string, latest: string): Context {
	return {
		messages: [
			{ role: "user", content: prior, timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: "x",
				provider: "x",
				model: "x",
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
			} as unknown as Message,
			{ role: "user", content: latest, timestamp: 0 },
		],
	} as Context;
}

// EVERY cell registers onResponse; the exemption claim at the end judges the sum.
let onResponseCalls = 0;
const onResponse = () => {
	onResponseCalls++;
};

const TMP_EMIT = ".tmp-verify/acp-stream-hooks";
rmSync(TMP_EMIT, { recursive: true, force: true });
const recordDir = mkdtempSync(resolve(tmpdir(), "acp-stream-hooks-"));

try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const promptsOut = resolve(TMP_EMIT, "pi-extensions/lib/acp/prompts");
	mkdirSync(promptsOut, { recursive: true });
	copyFileSync("pi-extensions/lib/acp/prompts/engraving.md", resolve(promptsOut, "engraving.md"));
	const backend = (await import(pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href)) as any;

	// ----------------------------------------------------------------------
	// CELL 1 — NEW turn: the hook sees the EXACT wire params; undefined keeps them.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const seen: any[] = [];
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("NONCE-FIRST-TURN"),
				{
					sessionId: "hooks-new",
					onPayload: (payload: unknown) => {
						seen.push(structuredClone(payload));
						return undefined;
					},
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		assert.equal(sealed(events)[0]?.type, "done", "the pass-through turn completes normally");
		assert.ok(
			seen.length === 1 && JSON.stringify(seen[0]) === JSON.stringify(h.promptCalls[0]),
			"[QK:ACPHOOK-PAYLOAD-EXACT-WIRE] before_provider_request must run exactly once and receive the EXACT ACP " +
				"session/prompt params that then cross the wire — same bootstrapped sessionId, same fully-built prompt " +
				"(augment included) — and an undefined return must leave those params untouched; a skipped hook or a " +
				"divergent payload means extensions observe a fiction",
		);
		assert.ok(
			JSON.stringify(seen[0].prompt).includes("NONCE-FIRST-TURN"),
			"the observed payload really carries this turn's user content",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 2 — NEW turn: a returned replacement becomes the wire params.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("NONCE-ORIGINAL"),
				{
					sessionId: "hooks-replace",
					onPayload: (payload: any) => ({
						sessionId: payload.sessionId,
						prompt: [{ type: "text", text: "NONCE-REPLACED-WIRE" }],
					}),
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		assert.equal(sealed(events)[0]?.type, "done", "the replaced turn completes normally");
		assert.equal(h.promptCalls.length, 1, "exactly one prompt crossed the wire");
		const wire = JSON.stringify(h.promptCalls[0]);
		assert.ok(
			wire.includes("NONCE-REPLACED-WIRE") && !wire.includes("NONCE-ORIGINAL"),
			"[QK:ACPHOOK-REPLACEMENT-ON-WIRE] a replacement returned by before_provider_request must BE the wire params — " +
				"the upstream contract says 'use any returned replacement payload', and ignoring it is exactly the " +
				"pi-vertex defect (#7372) that silently breaks payload-hooking extensions",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 3 — REUSE turn parity: same boundary, delta params, replacement honored.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const seen: any[] = [];
		let replaceReuse = false;
		const options = {
			sessionId: "hooks-reuse",
			onPayload: (payload: any) => {
				seen.push(structuredClone(payload));
				if (!replaceReuse) return undefined;
				return { sessionId: payload.sessionId, prompt: [{ type: "text", text: "NONCE-REUSE-REPLACED" }] };
			},
			onResponse,
		};
		const first = await collect(backend.streamAcpTurn(sonnet, userCtx("NONCE-TURN-ONE"), options, h.deps) as Stream);
		assert.equal(sealed(first)[0]?.type, "done", "turn 1 (new) completes");
		replaceReuse = true;
		const second = await collect(
			backend.streamAcpTurn(sonnet, reuseCtx("NONCE-TURN-ONE", "NONCE-TURN-TWO"), options, h.deps) as Stream,
		);
		assert.equal(sealed(second)[0]?.type, "done", "turn 2 (reuse) completes");
		assert.equal(h.children.length, 1, "turn 2 reused the live session — no second child");
		const reuseSeen = JSON.stringify(seen[1] ?? null);
		const reuseWire = JSON.stringify(h.promptCalls[1] ?? null);
		assert.ok(
			seen.length === 2 &&
				reuseSeen.includes("NONCE-TURN-TWO") &&
				!reuseSeen.includes("NONCE-TURN-ONE") &&
				reuseWire.includes("NONCE-REUSE-REPLACED") &&
				!reuseWire.includes("NONCE-TURN-TWO"),
			"[QK:ACPHOOK-REUSE-PARITY] the reuse turn owes the hook the SAME truthful boundary as a new turn — the payload " +
				"it sees is the actual delta-only wire params for the live session, and its replacement crosses the wire; " +
				"a hook that only fires on cold turns would hide every resident-session request from extensions",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 4 — a rejecting hook fails the turn LOUD, nothing is sent.
	// (Ordered before the refusal cells: a silent-fallback defect at the call
	// site must die here, at its own claim, before an integrity cell can trip.)
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("hook rejection"),
				{
					sessionId: "hooks-reject",
					onPayload: () => Promise.reject(new Error("NONCE-HOOK-EXPLODED")),
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" &&
				String(seal.error?.errorMessage ?? "").includes("NONCE-HOOK-EXPLODED") &&
				h.promptCalls.length === 0,
			"[QK:ACPHOOK-REJECTION-FAILS-LOUD] pi's own runner already swallows extension handler errors, so a rejection " +
				"reaching this seam is a real failure — it must seal the turn loudly with the original message and send " +
				"nothing, never be silently caught into a fallback send",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 5 — a non-object replacement is refused LOUD, nothing is sent.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("invalid replacement"),
				{ sessionId: "hooks-invalid", onPayload: () => 42, onResponse },
				h.deps,
			) as Stream,
		);
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" &&
				String(seal.error?.errorMessage ?? "").includes("non-object replacement") &&
				h.promptCalls.length === 0,
			"[QK:ACPHOOK-INVALID-REPLACEMENT-REFUSED] a replacement that is not a non-null, non-array object must seal " +
				"the turn as a loud error BEFORE anything reaches the wire — silently falling back to the original params " +
				"would hide a broken extension exactly where it thinks it is rewriting requests",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 6 — a sessionId-tampering replacement is refused LOUD, nothing is sent.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("tampered sessionId"),
				{
					sessionId: "hooks-tamper",
					onPayload: (payload: any) => ({ sessionId: "SOMEONE-ELSE", prompt: payload.prompt }),
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" &&
				String(seal.error?.errorMessage ?? "").includes("changed the ACP sessionId") &&
				h.promptCalls.length === 0,
			"[QK:ACPHOOK-SESSIONID-TAMPER-REFUSED] a replacement that changes the bootstrapped sessionId must refuse the " +
				"turn before the wire — entwurf cannot truthfully deliver to an ACP session it did not open, and silently " +
				"sending there would corrupt session identity while reporting success",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 7 — a replacement that empties the prompt is refused LOUD, nothing sent.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("emptied prompt"),
				{
					sessionId: "hooks-empty",
					onPayload: (payload: any) => ({ sessionId: payload.sessionId, prompt: [] }),
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" &&
				String(seal.error?.errorMessage ?? "").includes("non-empty prompt array") &&
				h.promptCalls.length === 0,
			"[QK:ACPHOOK-EMPTY-PROMPT-REFUSED] a replacement whose prompt is missing, non-array, or empty must refuse " +
				"the turn by name before the wire — this rail already owns a non-empty-prompt invariant on the built " +
				"params, and a replacement must not be able to undo it into an empty ACP send",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 8 — abort raised WHILE the hook is awaited wins before the wire (NEW turn).
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const gate = deferred<undefined>();
		const controller = new AbortController();
		const turn = collect(
			backend.streamAcpTurn(
				sonnet,
				userCtx("abort during hook"),
				{
					sessionId: "hooks-abort",
					signal: controller.signal,
					onPayload: () => gate.promise,
					onResponse,
				},
				h.deps,
			) as Stream,
		);
		// Let the turn reach the awaited hook, abort, THEN let the hook resolve.
		await new Promise((r) => setTimeout(r, 25));
		controller.abort();
		gate.resolve(undefined);
		const events = await turn;
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" && seal.reason === "aborted" && h.promptCalls.length === 0,
			"[QK:ACPHOOK-ABORT-DURING-HOOK-WINS] an abort raised while onPayload is awaited must win before the wire " +
				"write — the turn seals aborted and NO prompt is sent, because a slow handler must never turn a cancelled " +
				"turn into a delivered one",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 9 — abort during the awaited hook wins on the REUSE path too: the
	// resident session's bootstrap prompt is the control, and no SECOND prompt
	// may cross the wire.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const gate = deferred<undefined>();
		const controller = new AbortController();
		let deferReuseHook = false;
		const options: Record<string, unknown> = {
			sessionId: "hooks-reuse-abort",
			signal: controller.signal,
			onPayload: () => (deferReuseHook ? gate.promise : undefined),
			onResponse,
		};
		const first = await collect(
			backend.streamAcpTurn(sonnet, userCtx("NONCE-REUSE-ABORT-ONE"), options, h.deps) as Stream,
		);
		assert.equal(sealed(first)[0]?.type, "done", "turn 1 (new) establishes the resident session");
		assert.equal(h.promptCalls.length, 1, "the bootstrap prompt is the control send");
		deferReuseHook = true;
		const turn = collect(
			backend.streamAcpTurn(
				sonnet,
				reuseCtx("NONCE-REUSE-ABORT-ONE", "NONCE-REUSE-ABORT-TWO"),
				options,
				h.deps,
			) as Stream,
		);
		await new Promise((r) => setTimeout(r, 25));
		controller.abort();
		gate.resolve(undefined);
		const events = await turn;
		const seal = sealed(events)[0];
		assert.ok(
			seal?.type === "error" && seal.reason === "aborted" && h.promptCalls.length === 1 && h.children.length === 1,
			"[QK:ACPHOOK-REUSE-ABORT-WINS] an abort raised while the REUSE turn's onPayload is awaited must win before " +
				"the wire write — the turn seals aborted and the resident session's bootstrap prompt stays the ONLY send; " +
				"the reuse path owes the same abort-over-slow-handler guarantee as a cold turn",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 10 — the onResponse exemption, judged across every cell above.
	// ----------------------------------------------------------------------
	assert.equal(
		onResponseCalls,
		0,
		"[QK:ACPHOOK-ONRESPONSE-NEVER-CALLED] onResponse was registered on every turn above — success, replacement, " +
			"reuse, refusals, rejection, and both abort paths — and must have been invoked ZERO times: ACP has no " +
			"truthful HTTP {status, headers} and its terminal result arrives after the body was consumed, so any " +
			"invocation is fabricated evidence; the exemption is deliberate and this is its behavioral pin",
	);
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	try {
		// A leftover EMPTY parent dir reads as IMPURE tree drift in the
		// qualification harness; a concurrent sibling gate's emit keeps it alive
		// and this rmdir simply fails.
		rmdirSync(".tmp-verify");
	} catch {
		// non-empty or already gone — fine either way
	}
	rmSync(recordDir, { recursive: true, force: true });
}

console.log(
	"[check-acp-stream-hooks] ok — before_provider_request receives the exact ACP session/prompt wire params on new " +
		"AND reuse turns and its replacement is honored fail-closed (non-null non-array object, sessionId invariant, " +
		"non-empty prompt array, loud refusal with zero sends otherwise, rejection loud, abort-during-hook wins on " +
		"BOTH paths), and after_provider_response is a deliberate non-HTTP exemption invoked zero times across " +
		"success/error/abort",
);
