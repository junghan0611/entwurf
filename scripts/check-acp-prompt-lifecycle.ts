// Deterministic gate for the ACP PROMPT LIFECYCLE contract (backend.ts).
//
// WHAT THIS EXISTS TO STOP. The prompt used to be raced against a 600s absolute
// wall clock. Two defects rode on that single number:
//
//   1. It killed turns that were still working. A recorded host transcript
//      (2026-07-30) shows the same review prompt cut three times at exactly
//      600000ms while the child was still emitting tool calls.
//   2. Its own error text ("prompt timed out after 600000ms") lands inside pi's
//      transient-error dictionary — `RETRYABLE_PROVIDER_ERROR_PATTERN` in
//      @earendil-works/pi-ai `utils/retry` matches `timed? out` / `timeout` — so
//      pi replayed the SAME full prompt from a cold ACP session up to
//      `retry.maxRetries` times. One wall-clock cutoff cost four full turns.
//
// The contract now: a prompt ends on LIFECYCLE EVENTS ONLY — it resolves, the
// operator aborts, or the child dies / its stdio ends. Elapsed time is not
// evidence, and a quiet turn is not a failed turn.
//
// The static half of that claim (no PROMPT_TIMEOUT_MS, no withTimeout("prompt"))
// is pinned by check-probe-ordering, which owns the production-boundary pins.
// THIS gate is the behavioral half: every cell drives `streamAcpTurn` against a
// fake ACP child + connection and asserts what an operator would actually see.
//
// The retry claim is checked against pi's REAL classifier, imported from
// `@earendil-works/pi-ai/compat` — an oracle independent of the subject. The
// cell also asserts the old string still classifies as retryable, so the check
// cannot pass by the classifier having quietly stopped matching anything.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), so — like check-acp-stop-reason — we tsc-emit the project and
// import the COMPILED backend.js whose `.js` imports resolve to real siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Message, Model } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";

const sonnet = { id: "claude-sonnet-5" } as unknown as Model<Api>;

type Stream = AsyncIterable<AssistantMessageEvent>;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The old cutoff's text — kept verbatim as the classifier's positive control. */
const RETIRED_TIMEOUT_TEXT = "prompt timed out after 600000ms";

/** How long a quiet in-flight prompt is observed before it must still be alive. */
const STALL_OBSERVATION_MS = 250;
/** Injected post-abort cleanup grace (production ships 5s; the contract is that it is BOUNDED). */
const TEST_ABORT_GRACE_MS = 40;

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * A fake child that can actually DIE: the production code learns about a child's
 * end through `once("exit")` and about its complaints through the stderr drain,
 * so a no-op fake could not exercise either.
 */
function makeFakeChild() {
	const exitListeners: Array<(...args: unknown[]) => void> = [];
	const stderrListeners: Array<(chunk: Buffer) => void> = [];
	const kills: Array<NodeJS.Signals | number | undefined> = [];
	const pipe = () => ({ destroy() {}, unref() {} });
	const child = {
		pid: undefined as number | undefined,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
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
		once(event: "exit" | "error", listener: (...args: unknown[]) => void) {
			if (event === "exit") exitListeners.push(listener);
		},
		/** driver: the backend writes to its stderr (its dying words). */
		writeStderr(text: string) {
			for (const listener of [...stderrListeners]) listener(Buffer.from(text));
		},
		/** driver: the backend process ends. */
		die(code: number | null, signal: NodeJS.Signals | null = null) {
			child.exitCode = code;
			child.signalCode = signal;
			for (const listener of exitListeners.splice(0)) listener(code, signal);
		},
	};
	return child;
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

/**
 * One backend world: a single fake child + a retained fake connection whose
 * `prompt` stays PENDING until the cell settles it. `close()` rejects that
 * pending request exactly as the real SDK does (jsonrpc `close()` rejects every
 * pending response), which is what makes the abort-escalation path observable.
 */
function makeHarness(recordDir: string) {
	const children: ReturnType<typeof makeFakeChild>[] = [];
	const cancels: Array<{ sessionId: string }> = [];
	const closes: unknown[] = [];
	let pending: Deferred<{ stopReason?: string }> | undefined;
	let promptCount = 0;
	let notifier: ((update: Record<string, unknown>) => Promise<void>) | undefined;

	const makeConnection = (handlers: any) => ({
		initialize: async () => ({ agentCapabilities: {} }),
		newSession: async () => ({ sessionId: "ACP-1" }),
		setSessionConfigOption: async () => ({}),
		prompt: ({ sessionId }: any) => {
			promptCount++;
			notifier = (update) => handlers.sessionUpdate({ update, sessionId });
			pending = deferred<{ stopReason?: string }>();
			return pending.promise;
		},
		cancel: (params: { sessionId: string }) => {
			cancels.push(params);
		},
		close: (err?: unknown) => {
			closes.push(err ?? null);
			pending?.reject(err ?? new Error("ACP connection closed"));
		},
	});

	return {
		children,
		cancels,
		closes,
		get promptCount() {
			return promptCount;
		},
		/** the agent answers the in-flight prompt */
		settle(stopReason: string) {
			pending?.resolve({ stopReason });
		},
		/** the agent streams something mid-turn (proof the turn is progressing) */
		async progress(text: string) {
			await notifier?.({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
		},
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
			now: () => "2026-07-30T00:00:00Z",
			sessionDir: recordDir,
			abortGraceMs: TEST_ABORT_GRACE_MS,
		},
	};
}

/** Start a turn and collect its events in the background. */
function startTurn(
	backend: any,
	context: Context,
	options: Record<string, unknown>,
	deps: unknown,
): { events: AssistantMessageEvent[]; done: Promise<void> } {
	const events: AssistantMessageEvent[] = [];
	const stream = backend.streamAcpTurn(sonnet, context, options, deps) as Stream;
	const done = (async () => {
		for await (const ev of stream) events.push(ev);
	})();
	return { events, done };
}

const sealed = (events: AssistantMessageEvent[]) =>
	events.filter((e) => e.type === "done" || e.type === "error") as any[];

const userCtx = (text: string): Context => ({ messages: [{ role: "user", content: text, timestamp: 0 }] }) as Context;

/** A reuse-shaped context: prior user, assistant, new user. */
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

const TMP_EMIT = ".tmp-verify/acp-prompt-lifecycle";
rmSync(TMP_EMIT, { recursive: true, force: true });
const recordDir = mkdtempSync(resolve(tmpdir(), "acp-prompt-life-"));

try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const promptsOut = resolve(TMP_EMIT, "pi-extensions/lib/acp/prompts");
	mkdirSync(promptsOut, { recursive: true });
	copyFileSync("pi-extensions/lib/acp/prompts/engraving.md", resolve(promptsOut, "engraving.md"));
	const backend = (await import(pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href)) as any;

	// ----------------------------------------------------------------------
	// CELL 1 — a long / quiet turn is NOT killed.
	//
	// The prompt stays pending across an observation window with no lifecycle
	// event at all. Nothing may seal it: not the silence, not the elapsed time.
	// Then it answers, and the turn ends normally — the SAME turn, not a replay.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const turn = startTurn(backend, userCtx("a long tool-using turn"), { sessionId: "life-stall" }, h.deps);

		await delay(STALL_OBSERVATION_MS / 2);
		await h.progress("still working");
		await delay(STALL_OBSERVATION_MS / 2);

		assert.deepEqual(
			sealed(turn.events).map((e) => `${e.type}:${e.reason}`),
			[],
			"[QK:PROMPT-STALL-NOT-KILLED] an in-flight prompt with no lifecycle event must stay open — no wall clock, no " +
				"silence timer, and no 'still working' heuristic may seal a turn the backend has not answered",
		);
		assert.equal(h.children.length, 1, "the observed turn spawned exactly one child and never replaced it");

		h.settle("end_turn");
		await turn.done;
		const seal = sealed(turn.events);
		assert.equal(seal.length, 1, "the turn seals exactly once");
		assert.equal(seal[0].type, "done", "the long turn ends as a normal done");
		assert.equal(seal[0].message.stopReason, "stop", "…with stopReason stop");
		assert.equal(h.promptCount, 1, "the answer came from the ORIGINAL prompt — no cold replay was issued");
	}

	// ----------------------------------------------------------------------
	// CELL 2 — a user abort is a PROTOCOL event, not a signal race.
	//
	// ACP `session/cancel` asks the agent to end its own turn; the spec has it
	// answer the pending session/prompt with `cancelled`, which maps to aborted.
	// A child that honors it is never signalled at all.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const controller = new AbortController();
		const turn = startTurn(
			backend,
			userCtx("abort me"),
			{ sessionId: "life-abort", signal: controller.signal },
			h.deps,
		);
		await delay(30);
		controller.abort();
		await delay(5);

		assert.deepEqual(
			h.cancels,
			[{ sessionId: "ACP-1" }],
			"[QK:ABORT-SENDS-PROTOCOL-CANCEL] an abort must send ACP session/cancel for the live session FIRST — the " +
				"protocol's own ending, so the agent can close its turn instead of being killed mid-tool",
		);
		assert.deepEqual(h.children[0].kills, [], "a cancel that is being honored must not signal the child");

		// The agent answers the cancel the way the protocol requires.
		h.settle("cancelled");
		await turn.done;
		const seal = sealed(turn.events);
		assert.equal(seal[0].type, "error", "an aborted turn seals as an error event (never a done)");
		assert.equal(seal[0].reason, "aborted", "…with reason aborted");
		assert.equal(seal[0].error.stopReason, "aborted", "…and a final message stopReason of aborted");
		assert.equal(seal[0].error.rawStopReason, "cancelled", "…preserving the raw ACP reason");
		assert.equal(h.children.length, 1, "an abort spawns NO new child");
		assert.equal(h.promptCount, 1, "an abort issues no replacement prompt");
	}

	// ----------------------------------------------------------------------
	// CELL 3 — an abort against a WEDGED agent still returns, bounded.
	//
	// The agent ignores session/cancel. After the bounded grace the backend
	// escalates: process-group teardown + connection close (which rejects the
	// pending request), so the operator's abort is answered either way.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const controller = new AbortController();
		const turn = startTurn(backend, userCtx("wedged"), { sessionId: "life-wedged", signal: controller.signal }, h.deps);
		await delay(30);
		const startedAt = Date.now();
		controller.abort();
		await turn.done;
		const elapsed = Date.now() - startedAt;

		// The bound is the claim. Escalation's teardown is belt-and-braces with the
		// error path's own teardown (asserted below as a standing guarantee), so
		// only the WAIT can be isolated: an abort must be answered within the grace
		// it was given, never on some other clock.
		assert.ok(
			elapsed < TEST_ABORT_GRACE_MS * 25,
			`[QK:ABORT-ESCALATION-BOUNDED] an abort against an agent that ignores session/cancel must be answered within ` +
				`the grace it was GIVEN (${TEST_ABORT_GRACE_MS}ms) — it waited ${elapsed}ms, so the cleanup window is ` +
				"running on a clock the caller does not control",
		);
		assert.ok(
			h.children[0].kills.includes("SIGTERM") && h.closes.length > 0,
			`the escalated child is signalled and its connection closed — kills=${JSON.stringify(h.children[0].kills)} ` +
				`closes=${h.closes.length}`,
		);
		const seal = sealed(turn.events);
		assert.equal(seal[0].reason, "aborted", "the wedged abort still seals as aborted");
		assert.equal(h.children.length, 1, "escalation spawns NO new child");
	}

	// ----------------------------------------------------------------------
	// CELL 4 — a child that dies mid-prompt is DIAGNOSED, and its error is not
	// a transient one.
	//
	// The SDK's own rejection for this case says only "ACP connection closed".
	// The turn must instead name the exit status and carry the child's stderr —
	// and must not be worded in a way that makes pi replay the whole prompt.
	// ----------------------------------------------------------------------
	let childDeathMessage = "";
	{
		const h = makeHarness(recordDir);
		const turn = startTurn(backend, userCtx("dies mid-turn"), { sessionId: "life-death" }, h.deps);
		await delay(30);
		h.children[0].writeStderr("claude: fatal: FATAL-STDERR-MARK\n");
		h.children[0].die(1, null);
		await turn.done;

		const seal = sealed(turn.events);
		assert.equal(seal[0].type, "error", "a child death seals as an error event");
		childDeathMessage = String(seal[0].error.errorMessage);
		assert.ok(
			childDeathMessage.includes("ended while the prompt was still in flight") &&
				childDeathMessage.includes("exit code 1") &&
				childDeathMessage.includes("FATAL-STDERR-MARK"),
			"[QK:CHILD-EXIT-DIAGNOSED] a mid-prompt child death must report HOW it ended (exit status) and WHAT it said " +
				`(stderr tail) — a bare "ACP connection closed" is undiagnosable. Got: ${JSON.stringify(childDeathMessage)}`,
		);
	}

	// ----------------------------------------------------------------------
	// CELL 5 — the SAME diagnostics on a REUSE turn.
	//
	// This is the shape a live sonnet session hit on 2026-07-30: turn N was a
	// reuse turn, the child died mid-tool, and the operator got "ACP connection
	// closed" with nothing else — because the stderr buffer belonged to the
	// turn that spawned the child and the reuse path passed no tail at all.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const t1 = startTurn(backend, userCtx("first NONCE-R1"), { sessionId: "life-reuse" }, h.deps);
		await delay(20);
		h.settle("end_turn");
		await t1.done;
		assert.equal(sealed(t1.events)[0].type, "done", "turn 1 completes so the session is retained for reuse");

		const t2 = startTurn(backend, reuseCtx("first NONCE-R1", "second NONCE-R2"), { sessionId: "life-reuse" }, h.deps);
		await delay(30);
		assert.equal(h.children.length, 1, "turn 2 reused the live child (no respawn)");
		h.children[0].writeStderr("claude: fatal: REUSE-STDERR-MARK\n");
		h.children[0].die(null, "SIGKILL");
		await t2.done;

		const message = String(sealed(t2.events)[0].error.errorMessage);
		assert.ok(
			message.includes("signal SIGKILL") && message.includes("REUSE-STDERR-MARK"),
			"[QK:REUSE-CARRIES-CHILD-DIAGNOSTICS] a reuse turn must report the child's exit status and stderr tail too — " +
				`the buffer is session-scoped precisely so a resident session's death is readable. Got: ${JSON.stringify(message)}`,
		);
	}

	// ----------------------------------------------------------------------
	// CELL 6 — a death BETWEEN turns is announced by the next turn.
	//
	// Nobody is waiting on the child when it dies idle, so that death has no
	// turn to fail. Without an announcement the next turn opens a fresh child
	// and reads as an ordinary cold start, hiding that the backend session the
	// operator was talking to is gone. Opening a new child for a NEW user turn
	// is not a replay — but it must not be silent either.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const t1 = startTurn(backend, userCtx("first NONCE-D1"), { sessionId: "life-idle-death" }, h.deps);
		await delay(20);
		h.settle("end_turn");
		await t1.done;

		// … the operator reads the answer, and while they think, the child dies.
		h.children[0].die(137, "SIGKILL");
		await delay(5);

		const t2 = startTurn(
			backend,
			reuseCtx("first NONCE-D1", "second NONCE-D2"),
			{ sessionId: "life-idle-death" },
			h.deps,
		);
		await delay(30);
		const notices = t2.events
			.filter((e: any) => e.type === "text" || e.type === "text_start" || e.type === "text_delta")
			.map((e: any) => String(e.delta ?? e.text ?? e.content ?? ""))
			.join("");
		const announced = notices.includes("previous claude session ended between turns");
		assert.ok(
			announced && notices.includes("exit code 137") && notices.includes("signal SIGKILL"),
			"[QK:IDLE-DEATH-ANNOUNCED] a backend session that died BETWEEN turns must be announced by the next turn, with " +
				`how it ended — a silent respawn hides that the session the operator was talking to is gone. Saw: ${JSON.stringify(notices.slice(0, 400))}`,
		);
		assert.ok(
			notices.indexOf("previous claude session ended between turns") <
				notices.indexOf("[acp: preparing claude session]"),
			"the death is announced BEFORE the bootstrap notice — otherwise it reads as an ordinary cold start",
		);

		h.settle("end_turn");
		await t2.done;
		assert.equal(sealed(t2.events)[0].type, "done", "the announcement does not fail the turn — it explains it");

		// Announced ONCE: a third turn is a plain cold start again.
		const t3 = startTurn(backend, userCtx("third NONCE-D3"), { sessionId: "life-idle-death" }, h.deps);
		await delay(20);
		h.settle("end_turn");
		await t3.done;
		const laterNotices = t3.events
			.filter((e: any) => e.type === "text" || e.type === "text_start" || e.type === "text_delta")
			.map((e: any) => String(e.delta ?? e.text ?? e.content ?? ""))
			.join("");
		assert.ok(
			!laterNotices.includes("previous claude session ended between turns"),
			"the announcement is read-and-clear — a stale death must not be re-announced every turn",
		);
	}

	// ----------------------------------------------------------------------
	// CELL 7 — a DELIBERATE teardown is not news.
	//
	// A turn-scoped session (plain interactive / `pi -p`) tears its child down
	// after every turn by design, and that teardown reaches the very same exit
	// path a real death does. If the backend cannot tell the two apart, every
	// ordinary turn announces the previous turn's routine cleanup as a death —
	// an alarm that fires constantly is worse than none, because it trains the
	// operator to ignore the one that matters.
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const turnScopedDeps = { ...h.deps, lifecyclePolicy: () => "turn-scoped" };

		const t1 = startTurn(backend, userCtx("first NONCE-T1"), { sessionId: "life-turn-scoped" }, turnScopedDeps);
		await delay(20);
		h.settle("end_turn");
		await t1.done;
		assert.equal(sealed(t1.events)[0].type, "done", "turn 1 completes");
		// The teardown SIGTERMs the child; a real child would exit right after.
		assert.ok(h.children[0].kills.includes("SIGTERM"), "a turn-scoped turn tears its child down after the turn");
		h.children[0].die(0, "SIGTERM");
		await delay(5);

		const t2 = startTurn(backend, userCtx("second NONCE-T2"), { sessionId: "life-turn-scoped" }, turnScopedDeps);
		await delay(20);
		const notices = t2.events
			.filter((e: any) => e.type === "text" || e.type === "text_start" || e.type === "text_delta")
			.map((e: any) => String(e.delta ?? e.text ?? e.content ?? ""))
			.join("");
		assert.ok(
			!notices.includes("previous claude session ended between turns"),
			"[QK:RETIRED-TEARDOWN-NOT-ANNOUNCED] a teardown WE performed must not be reported as a death — otherwise " +
				`every ordinary turn-scoped turn cries wolf about its own cleanup. Saw: ${JSON.stringify(notices.slice(0, 300))}`,
		);
		h.settle("end_turn");
		await t2.done;
	}

	// ----------------------------------------------------------------------
	// CELL 8 — our prompt-phase failure text is not transient, judged by pi.
	// ----------------------------------------------------------------------
	assert.equal(
		isRetryableAssistantError({ stopReason: "error", errorMessage: RETIRED_TIMEOUT_TEXT } as any),
		true,
		"positive control: pi still classifies the RETIRED 600s cutoff text as transient — that classification is " +
			"exactly why one wall-clock kill cost four full cold turns",
	);
	assert.equal(
		isRetryableAssistantError({ stopReason: "error", errorMessage: childDeathMessage } as any),
		false,
		"[QK:PROMPT-ERROR-NOT-TRANSIENT] pi must NOT classify a prompt-phase lifecycle failure we authored as a " +
			"transient provider error — a retry here is a cold replay of the whole prompt, not a cheap retry. " +
			`Judged text: ${JSON.stringify(childDeathMessage)}`,
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
	"[check-acp-prompt-lifecycle] ok — a prompt ends on lifecycle events only: a quiet in-flight turn survives an " +
		"observation window and then completes on its ORIGINAL prompt (no wall clock, no replay); a user abort sends ACP " +
		"session/cancel first and seals cancelled→aborted without signalling a cooperating child; a wedged agent is torn " +
		"down after the bounded grace and still returns promptly with no new child; a child that dies mid-prompt is " +
		"reported with its exit status AND stderr tail on BOTH the new and the reuse path; a death BETWEEN turns is " +
		"announced once by the next turn while a teardown WE performed stays silent; and pi's own " +
		"isRetryableAssistantError refuses " +
		"to classify that failure as transient while still matching the retired 600s text",
);
