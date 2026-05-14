/**
 * model-lock — pi-shell-acp session model lock (extension-side revert).
 *
 * Companion to the bridge-side guard in `acp-bridge.ts` (ensureBridgeSession
 * reuse-path `ModelSwitchLockedError`). The two work as a pair:
 *
 *   - A (bridge-side): live reuse-path mismatch inside a pi-shell-acp
 *     bridge session is refused at `ensureBridgeSession`. This is the
 *     fallback/direct-call boundary: it prevents silent backend handoff
 *     and MCP identity drift if the extension hook is absent, disabled,
 *     or fails before the revert lands.
 *
 *   - B (this hook): cross-provider departure (pi-shell-acp/X → native) AND
 *     cross-provider entry (native → pi-shell-acp/X) — both touch the
 *     pi-shell-acp boundary and are refused by reverting to the previous
 *     model via `pi.setModel(previousModel)`. This is NOT a clean refusal:
 *     pi-core has already mutated `agent.state.model` and appended
 *     `model_change` to the JSONL before emitting `model_select`. We
 *     observe the after-event and revert, which adds a second
 *     `model_change` entry (X → Y → X).
 *
 * Why both surfaces (B fires first, A is the fallback):
 *   - B observes `model_select` immediately when pi-core emits it,
 *     which happens during `AgentSession.setModel()` BEFORE the next
 *     prompt reaches any provider. So for the pi-shell-acp →
 *     pi-shell-acp case (and every other touches-pi-shell-acp case), B
 *     reverts the model first and the next prompt then enters the
 *     bridge under the ORIGINAL model. A's reuse-path mismatch check
 *     therefore does not fire on the happy path — there is no mismatch
 *     left to catch. A only matters if B fails to register, throws
 *     before `pi.setModel(from)` completes, or is disabled by an
 *     operator overriding the extensions list.
 *   - cross-provider departure (pi-shell-acp → native) and cross-provider
 *     entry (native → pi-shell-acp) NEVER reach A at all — the next
 *     prompt routes to a different provider, so `ensureBridgeSession`
 *     is not called. B is the only surface for those cases.
 *   - Wire-evidence captured during the issue #14 investigation: in a
 *     native → pi-shell-acp entry, pi JSONL continued (hi1, hi2, ...)
 *     but a fresh ACP backend session was bootstrapped and the model
 *     could not see the pre-switch turn (model replied "현재 세션에서
 *     hi2만 보입니다"). Same failure mode as pi-shell-acp → native
 *     departure, mirrored.
 *
 * Policy:
 *   - A pi-shell-acp session is locked to its starting model.
 *   - Native-to-native switching is free. Once a native session is
 *     anchored, switching INTO pi-shell-acp is refused because it would
 *     create a fresh ACP backend behind a continuous pi transcript.
 *   - The lock fires for any in-session `model_select` event whose
 *     transition touches the pi-shell-acp boundary
 *     (`from.provider === "pi-shell-acp" || to.provider === "pi-shell-acp"`)
 *     and whose source is "set" or "cycle" (not "restore").
 *
 * Honest limits:
 *   - This is NOT a transcript-clean refusal. The first `model_change`
 *     entry (X → Y) is already in the JSONL by the time we observe the
 *     event. Our `pi.setModel(from)` adds a second entry (Y → X). For a
 *     fully clean refusal, pi-core would need a cancellable
 *     `before_model_select` hook that this repo intentionally does not
 *     patch (pi-shell-acp does not send PRs to pi-core).
 *   - On the happy path B is a strict superset of A's coverage. A is the
 *     fallback for cases where B did not run (handler registration
 *     missing, thrown before the revert lands, extension disabled by an
 *     operator override of the extensions list). Smoke `check-model-lock`
 *     verifies B's policy logic; `smoke-model-switch` continues to
 *     verify A's bridge-side throw as the fallback contract.
 *
 * References:
 *   - pi-core setModel: pi-mono/packages/coding-agent/src/core/agent-session.ts:1416
 *   - ModelSelectEvent: pi-mono/packages/coding-agent/src/core/extensions/types.ts:711-719
 *   - ExtensionAPI.setModel: types.ts:1228 (returns Promise<boolean>; false = auth missing)
 *   - ExtensionUIContext.notify: types.ts:135 (sync void)
 *   - Wire evidence native → pi-shell-acp entry failure mode: GLG live test
 *     2026-05-14 ~13:30 KST, session pi:019e24c0-1251-...
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const PI_SHELL_ACP_PROVIDER = "pi-shell-acp";

/**
 * Module-level reentry guard.
 *
 * When our handler calls `pi.setModel(from)` to revert, pi-core's
 * `AgentSession.setModel()` mutates state and emits another `model_select`
 * event (with `source: "set"`). Without this flag, our hook would observe
 * the synthetic emit and try to revert again — infinite recursion. The
 * flag is set BEFORE `pi.setModel` and cleared in a `finally` so any
 * exception path still releases it.
 *
 * Why module-level (not closure-local in the handler): the handler is
 * registered once and shared. A handler-local `let reverting = false` is
 * also module-scoped in practice but module-level makes the lifetime
 * explicit. ctx-local is unavailable — ExtensionContext has no mutable
 * scratch space we are supposed to use.
 */
let reverting = false;

/**
 * Module-level "session has started" gate.
 *
 * Before the operator commits to a turn, model changes are configuration
 * (CLI `--model`, settings.json default, pre-turn model selector) and the
 * lock must NOT fire — locking pre-turn would defeat legitimate setup.
 * Once the session has anchored a model identity (an existing conversation
 * is loaded, or the first agent_start fires), the lock becomes active.
 *
 * The flag is consulted by `model_select` and set by:
 *   - `session_start`: per-reason policy (see below)
 *   - `agent_start`:   always true (first turn = identity anchored)
 *
 * session_start reason behavior:
 *   - resume / fork:        immediately true (inherited identity)
 *   - reload:               preserved OR refreshed via getEntries() —
 *                           guards against module re-import during
 *                           extension reload that would reset the flag
 *   - startup / new (default): true IFF entries already contain a message
 *                              (saved-session-on-startup path is rare
 *                              today since pi-mono distinguishes
 *                              resume/new explicitly, but this is a
 *                              future-proof guard)
 */
let sessionLocked = false;

/**
 * Probe whether the session has at least one conversational message.
 *
 * `entry.type === "message"` matches `SessionMessageEntry` (real user /
 * assistant / tool-result messages). Other entry types — `model_change`,
 * `thinking_level_change`, `label`, `custom`, `session_info`,
 * `compaction`, `branch_summary` — are not conversational, so our own
 * revert-induced `model_change` entries do NOT register as "started".
 *
 * Defensive false-positive: if `getEntries()` throws at a reload /
 * teardown boundary, we treat the session as started and engage the
 * lock. This is the conservative side because failing-open would let a
 * race window break the lock. The repo's general "throw, don't warn"
 * rule yields here because this is a lock-state probe, not config
 * validation — silent fall-through to "locked" preserves safety.
 */
function hasStartedConversation(ctx: ExtensionContext): boolean {
	try {
		return ctx.sessionManager.getEntries().some((entry) => entry.type === "message");
	} catch {
		return true;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (event, ctx) => {
		if (event.reason === "resume" || event.reason === "fork") {
			// Resumed/forked sessions inherit a model identity from the
			// session being resumed/forked. Lock immediately.
			sessionLocked = true;
			return;
		}
		if (event.reason === "reload") {
			// Reload happens in-process (extension/settings reattach).
			// If the module was re-imported during reload, our `sessionLocked`
			// resets to false — recover via getEntries(). If the module
			// survived, preserve the existing flag.
			sessionLocked = sessionLocked || hasStartedConversation(ctx);
			return;
		}
		// startup / new — empty session: pre-turn model changes are free.
		// Non-empty session (rare today, but possible if pi-mono ever
		// loads a saved session under `reason: "startup"`): lock.
		sessionLocked = hasStartedConversation(ctx);
	});

	pi.on("agent_start", () => {
		// First prompt has triggered the agent loop. Model identity is
		// now anchored for this session — lock from here on.
		sessionLocked = true;
	});

	pi.on("model_select", async (event, ctx) => {
		// Reentry: our own revert call. Skip to avoid infinite loop.
		if (reverting) return;

		// "restore" fires when pi reloads a saved session's model on
		// startup. Refusing that would either loop or block a legitimate
		// resume. "set" (explicit /model, model selector, Ctrl+P) and
		// "cycle" (next/prev) both reach the user-initiated switch path
		// and are the cases we want to lock.
		if (event.source === "restore") return;

		// Session not yet started — pre-turn model changes are operator
		// configuration, not a lock violation. CLI --model override,
		// settings.json default load, and pre-turn model selector all
		// reach here under the unlocked state.
		if (!sessionLocked) return;

		const from = event.previousModel;
		const to = event.model;

		// First model selection has no previous model to revert to.
		// Lock only applies to in-session switches.
		if (!from) return;

		// Same model picked again (id + provider identical). Not a switch,
		// just a no-op state set. Skip.
		if (from.provider === to.provider && from.id === to.id) return;

		// Only act when the transition touches the pi-shell-acp boundary.
		// Covers:
		//   pi-shell-acp → pi-shell-acp (id different)    — B primary, A fallback
		//   pi-shell-acp → native                         — B only (A out of flow)
		//   native       → pi-shell-acp                   — B only (A not yet engaged)
		// Skips:
		//   native       → native                         — out of scope, free
		const touchesPiShellAcp = from.provider === PI_SHELL_ACP_PROVIDER || to.provider === PI_SHELL_ACP_PROVIDER;
		if (!touchesPiShellAcp) return;

		reverting = true;
		try {
			const ok = await pi.setModel(from);
			ctx.ui.notify(
				ok
					? `Session is locked to ${from.provider}/${from.id}; reverted attempted switch to ${to.provider}/${to.id}.`
					: `Session is locked to ${from.provider}/${from.id}; failed to revert from ${to.provider}/${to.id} (auth missing for original model?).`,
				ok ? "warning" : "error",
			);
		} finally {
			reverting = false;
		}
	});
}
