/**
 * check-model-lock — deterministic unit test for `pi-extensions/model-lock.ts`.
 *
 * Mocks `ExtensionAPI` + `ExtensionContext` and drives the
 * `session_start` / `agent_start` / `model_select` handlers through every
 * case in the policy matrix. No pi process, no network, no API cost. The
 * harness shape mirrors pi-core's actual behavior (setModel mutates +
 * emits synthetic model_select with source="set") so reentry-guard
 * validation is realistic.
 *
 * Coverage (every assertion must pass):
 *   1.  native → native: no-op
 *   2.  native → pi-shell-acp: revert (warning notify)
 *   3.  pi-shell-acp → native: revert (warning notify)
 *   4.  pi-shell-acp/X → pi-shell-acp/Y (id differs): revert (warning notify)
 *   5.  pi-shell-acp → pi-shell-acp (same id): skip (changed=false)
 *   6.  undefined → any: skip (!from)
 *   7.  source="restore": skip
 *   8.  Reentry guard: revert's synthetic emit MUST NOT re-trigger revert
 *   9.  setModel returns false: notify level "error" instead of "warning"
 *   10. session_start "startup" + entries=0: lock NOT engaged, model_select no-op
 *   11. session_start "startup" + entries already have a message: lock engaged
 *   12. session_start "startup" empty → agent_start → lock engaged
 *   13. session_start "resume": lock engaged immediately
 *   14. session_start "new" + entries=0: lock NOT engaged
 *   15. session_start "reload" + entries have a message: lock engaged
 *   16. session_start "fork": lock engaged immediately
 *   17. session_start "reload" + entries=0 BUT prior sessionLocked=true: lock preserved
 *   18. getEntries() throws: defensive `catch { return true }` engages the lock
 *
 * Why this exists separate from smoke-model-switch:
 *   smoke-model-switch drives `ensureBridgeSession` directly to verify the
 *   A bridge-side guard. B (the extension hook) does NOT run there — there
 *   is no pi extension runtime in that smoke. This script is the B-side
 *   gate, and the two together form the full policy verification surface.
 *
 * Module-level state note: model-lock.ts uses two module-level flags
 * (`reverting`, `sessionLocked`) that persist across tests in the same
 * Node process. Each `makeHarness` call explicitly establishes the
 * starting state via `initial:` so tests do not implicitly depend on
 * order.
 *
 * See AGENTS.md § session model lock, NEXT.md § Session model lock.
 */

import assert from "node:assert/strict";

import modelLockExtension from "../pi-extensions/model-lock.ts";

type Provider = string;
type ModelLike = { provider: Provider; id: string };
type Source = "set" | "cycle" | "restore";
type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

interface ModelSelectEventLike {
	type: "model_select";
	model: ModelLike;
	previousModel: ModelLike | undefined;
	source: Source;
}

interface SessionStartEventLike {
	type: "session_start";
	reason: SessionStartReason;
	previousSessionFile?: string;
}

interface AgentStartEventLike {
	type: "agent_start";
}

interface EntryLike {
	type: string;
}

interface NotifyCall {
	message: string;
	level: "info" | "warning" | "error";
}

interface Harness {
	dispatchSessionStart(reason: SessionStartReason): Promise<void>;
	dispatchAgentStart(): Promise<void>;
	dispatch(event: ModelSelectEventLike): Promise<void>;
	setEntries(entries: EntryLike[]): void;
	setEntriesThrowing(throwing: boolean): void;
	setModelCalls: ModelLike[];
	notifyCalls: NotifyCall[];
	emitsDuringSetModel(): number;
}

/**
 * `initial` controls the starting state of module-level `sessionLocked`:
 *
 *   "locked"   — emit session_start "resume" (immediate lock). Default for
 *                tests 1-9 which predate the sessionLocked gate.
 *   "unlocked" — emit session_start "startup" with empty entries (no lock).
 *                For tests verifying pre-turn freedom.
 *   "manual"   — emit nothing. Test code drives session_start /
 *                agent_start explicitly. For tests with multi-step
 *                state setup (e.g., test 17 reload-preserve).
 */
type InitialState = "locked" | "unlocked" | "manual";

interface MakeHarnessOpts {
	setModelReturns?: boolean;
	initial?: InitialState;
	entries?: EntryLike[];
}

async function makeHarness(opts: MakeHarnessOpts = {}): Promise<Harness> {
	const setModelReturns = opts.setModelReturns ?? true;
	const initial: InitialState = opts.initial ?? "locked";
	let entries: EntryLike[] = opts.entries ?? [];
	let entriesThrowing = false;

	const modelSelectHandlers: Array<(event: ModelSelectEventLike, ctx: unknown) => Promise<void> | void> = [];
	const sessionStartHandlers: Array<(event: SessionStartEventLike, ctx: unknown) => Promise<void> | void> = [];
	const agentStartHandlers: Array<(event: AgentStartEventLike, ctx: unknown) => Promise<void> | void> = [];

	const setModelCalls: ModelLike[] = [];
	const notifyCalls: NotifyCall[] = [];
	let emitsDuringSetModel = 0;

	const ctx = {
		ui: {
			notify(message: string, level: "info" | "warning" | "error" = "info"): void {
				notifyCalls.push({ message, level });
			},
		},
		sessionManager: {
			getEntries(): EntryLike[] {
				if (entriesThrowing) throw new Error("simulated session-manager teardown");
				return entries;
			},
		},
	};

	const pi = {
		on(event: string, handler: any): void {
			if (event === "model_select") modelSelectHandlers.push(handler);
			else if (event === "session_start") sessionStartHandlers.push(handler);
			else if (event === "agent_start") agentStartHandlers.push(handler);
		},
		async setModel(model: ModelLike): Promise<boolean> {
			setModelCalls.push(model);
			// Simulate pi-core: AgentSession.setModel emits a synthetic
			// model_select with source "set" AFTER mutating state. The
			// reentry guard must catch this and skip.
			const syntheticEvent: ModelSelectEventLike = {
				type: "model_select",
				model,
				previousModel: { provider: "fake-prev", id: "synthetic" },
				source: "set",
			};
			emitsDuringSetModel += 1;
			for (const handler of modelSelectHandlers) {
				await handler(syntheticEvent, ctx);
			}
			return setModelReturns;
		},
	};

	// Register the extension. After this, handlers[] arrays hold the listeners.
	modelLockExtension(pi as any);

	const harness: Harness = {
		async dispatchSessionStart(reason: SessionStartReason) {
			for (const handler of sessionStartHandlers) {
				await handler({ type: "session_start", reason }, ctx);
			}
		},
		async dispatchAgentStart() {
			for (const handler of agentStartHandlers) {
				await handler({ type: "agent_start" }, ctx);
			}
		},
		async dispatch(event: ModelSelectEventLike) {
			for (const handler of modelSelectHandlers) {
				await handler(event, ctx);
			}
		},
		setEntries(next: EntryLike[]) {
			entries = next;
		},
		setEntriesThrowing(throwing: boolean) {
			entriesThrowing = throwing;
		},
		setModelCalls,
		notifyCalls,
		emitsDuringSetModel: () => emitsDuringSetModel,
	};

	// Establish the requested initial state via real handler dispatch so
	// module-level `sessionLocked` reflects the choice deterministically,
	// overriding whatever the previous test left behind.
	if (initial === "locked") {
		await harness.dispatchSessionStart("resume");
	} else if (initial === "unlocked") {
		// startup with empty entries → sessionLocked = false
		entries = [];
		await harness.dispatchSessionStart("startup");
	}
	// "manual": leave whatever module state is. Test must drive session_start
	// explicitly before any model_select assertion.

	return harness;
}

// Test models.
const NATIVE_A: ModelLike = { provider: "openai-codex", id: "gpt-5.4" };
const NATIVE_B: ModelLike = { provider: "openai-codex", id: "gpt-5.5" };
const PSA_SONNET: ModelLike = { provider: "pi-shell-acp", id: "claude-sonnet-4-6" };
const PSA_OPUS: ModelLike = { provider: "pi-shell-acp", id: "claude-opus-4-7" };

let passed = 0;
let failed = 0;

async function run(name: string, body: () => Promise<void>): Promise<void> {
	try {
		await body();
		console.log(`  ok   ${name}`);
		passed += 1;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`  FAIL ${name}`);
		console.error(`       ${msg}`);
		failed += 1;
	}
}

console.log("[check-model-lock] policy unit tests");

// =============================================================================
// Tests 1-9 — original policy matrix (sessionLocked=true via default "locked")
// =============================================================================

await run("1. native → native: no-op (touchesPiShellAcp=false)", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: NATIVE_B, previousModel: NATIVE_A, source: "set" });
	assert.equal(h.setModelCalls.length, 0);
	assert.equal(h.notifyCalls.length, 0);
});

await run("2. native → pi-shell-acp: revert + warning notify", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: NATIVE_A, source: "set" });
	assert.equal(h.setModelCalls.length, 1);
	assert.deepEqual(h.setModelCalls[0], NATIVE_A);
	assert.equal(h.notifyCalls.length, 1);
	assert.equal(h.notifyCalls[0].level, "warning");
	assert.match(h.notifyCalls[0].message, /locked to openai-codex\/gpt-5\.4/);
	assert.match(h.notifyCalls[0].message, /pi-shell-acp\/claude-sonnet-4-6/);
});

await run("3. pi-shell-acp → native: revert + warning notify", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1);
	assert.deepEqual(h.setModelCalls[0], PSA_SONNET);
	assert.equal(h.notifyCalls.length, 1);
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run("4. pi-shell-acp/X → pi-shell-acp/Y (id differs): revert + warning notify", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_OPUS, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "B reverts same-provider mismatch BEFORE next prompt");
	assert.deepEqual(h.setModelCalls[0], PSA_SONNET);
	assert.equal(h.notifyCalls.length, 1);
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run("5. pi-shell-acp → pi-shell-acp (same id): no-op (changed=false)", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 0);
	assert.equal(h.notifyCalls.length, 0);
});

await run("6. undefined → pi-shell-acp (first selection): no-op (!from)", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: undefined, source: "set" });
	assert.equal(h.setModelCalls.length, 0);
	assert.equal(h.notifyCalls.length, 0);
});

await run('7. source="restore": no-op (skip restore)', async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: NATIVE_A, source: "restore" });
	assert.equal(h.setModelCalls.length, 0);
	assert.equal(h.notifyCalls.length, 0);
});

await run("8. Reentry guard: synthetic model_select inside setModel must NOT re-trigger revert", async () => {
	const h = await makeHarness();
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: NATIVE_A, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "setModel must be called exactly once (no reentry)");
	assert.equal(h.emitsDuringSetModel(), 1, "exactly one synthetic emit happened (sanity check)");
	assert.equal(h.notifyCalls.length, 1, "notify must be called exactly once (no reentry)");
});

await run("9. setModel returns false (auth missing): notify level error", async () => {
	const h = await makeHarness({ setModelReturns: false });
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1);
	assert.equal(h.notifyCalls.length, 1);
	assert.equal(h.notifyCalls[0].level, "error");
	assert.match(h.notifyCalls[0].message, /failed to revert/);
});

// =============================================================================
// Tests 10-18 — session lifecycle gate (sessionLocked)
// =============================================================================

await run('10. session_start "startup" + entries=0: lock NOT engaged, model_select no-op', async () => {
	const h = await makeHarness({ initial: "unlocked" });
	// Pre-turn model change (CLI --model, settings.json default, etc.) — must be free.
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: NATIVE_A, source: "set" });
	assert.equal(h.setModelCalls.length, 0, "lock must NOT fire before first agent_start");
	assert.equal(h.notifyCalls.length, 0);
});

await run('11. session_start "startup" + entries have a message: lock engaged', async () => {
	// Future-proof guard: pi-mono currently distinguishes resume from
	// startup, but if a future pi version loads a saved session under
	// "startup" the entries-based check engages the lock.
	const h = await makeHarness({ initial: "manual", entries: [{ type: "message" }] });
	await h.dispatchSessionStart("startup");
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "saved-session-on-startup engages the lock");
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run('12. session_start "startup" empty → agent_start → lock engaged', async () => {
	const h = await makeHarness({ initial: "unlocked" });
	// Pre-turn: still unlocked, change allowed.
	await h.dispatch({ type: "model_select", model: PSA_OPUS, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 0, "pre-turn no-op");

	// First prompt arrives → agent_start fires → lock engaged.
	await h.dispatchAgentStart();
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "post agent_start lock engaged");
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run('13. session_start "resume": lock engaged immediately', async () => {
	const h = await makeHarness({ initial: "manual" });
	await h.dispatchSessionStart("resume");
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "resume engages lock without needing agent_start");
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run('14. session_start "new" + entries=0: lock NOT engaged', async () => {
	const h = await makeHarness({ initial: "manual" });
	await h.dispatchSessionStart("new");
	await h.dispatch({ type: "model_select", model: PSA_SONNET, previousModel: NATIVE_A, source: "set" });
	assert.equal(h.setModelCalls.length, 0, "new session pre-turn must be free");
});

await run('15. session_start "reload" + entries have a message: lock engaged', async () => {
	const h = await makeHarness({ initial: "manual", entries: [{ type: "message" }] });
	await h.dispatchSessionStart("reload");
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "reload of an active session engages lock");
});

await run('16. session_start "fork": lock engaged immediately', async () => {
	const h = await makeHarness({ initial: "manual" });
	await h.dispatchSessionStart("fork");
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "fork engages lock immediately");
});

await run('17. session_start "reload" + entries=0 BUT prior sessionLocked=true: lock preserved', async () => {
	// This is the GPT-flagged edge case: a session that already locked
	// (via earlier agent_start or resume) must survive a reload even
	// if message entries are not visible at the reload instant. The
	// guard `sessionLocked = sessionLocked || hasStartedConversation(ctx)`
	// keeps the prior `true` instead of resetting to `false`.
	const h = await makeHarness({ initial: "manual" });
	await h.dispatchSessionStart("resume"); // sessionLocked = true
	h.setEntries([]); // simulate entries momentarily empty at reload boundary
	await h.dispatchSessionStart("reload"); // sessionLocked = true || false = true (preserved)
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "reload must NOT release a prior lock");
	assert.equal(h.notifyCalls[0].level, "warning");
});

await run("18. getEntries() throws: defensive catch engages the lock", async () => {
	const h = await makeHarness({ initial: "manual" });
	h.setEntriesThrowing(true);
	// Without the try/catch fallback, this dispatch would propagate the
	// throw and the module would be in an indeterminate state. With the
	// `catch { return true }` defensive probe, the lock engages.
	await h.dispatchSessionStart("startup");
	await h.dispatch({ type: "model_select", model: NATIVE_A, previousModel: PSA_SONNET, source: "set" });
	assert.equal(h.setModelCalls.length, 1, "throwing probe must conservatively engage lock");
});

console.log("");
console.log(`[check-model-lock] ${passed} passed, ${failed} failed`);

if (failed > 0) {
	process.exit(1);
}
