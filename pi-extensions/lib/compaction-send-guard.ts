/**
 * compaction-send-guard — whether a control-socket `send` may call `pi.sendMessage`.
 *
 * Pi 0.85.1 has no public `ExtensionContext.isCompacting()`. Compaction is non-idle
 * (`AgentSession.isIdle` = no agent run AND not compacting) but `sendCustomMessage`
 * does not refuse it. A non-streaming `triggerTurn:true` send starts `_runAgentPrompt`
 * while `compact()` is rewriting the session tree — the field path that can make
 * compaction "풀린다" and still return `delivered:true` (#111).
 *
 * Public facts the resident can see, without reaching into `AgentSession`:
 *   - `ctx.isIdle()`
 *   - `ctx.signal` — `agent.activeRun?.abortController.signal`, undefined when
 *     there is no low-level agent run. This is NOT `AgentSession.isStreaming`
 *     (`_isAgentRunActive`). After `agent.prompt()` returns, `_handlePostAgentRun`
 *     retry / auto-compaction / continuation keeps `_isAgentRunActive=true` while
 *     `ctx.signal` is already undefined.
 *   - `session_before_compact` / `session_compact` / `session_compact_failed`
 *
 * Terminal semantics, read from installed `agent-session.js`:
 *   - `session_before_compact` fires AFTER the abort controller is set (manual
 *     compact then awaits summarization auth — a real start-race window).
 *   - `session_compact` is NOT guaranteed (only if the saved compaction entry is
 *     found by summary-text match).
 *   - `session_compact_failed` fires on cancel / abort / fail.
 *   - `isIdle()` becoming true is the honest recovery for a missed success event.
 *
 * Auto-compaction can run inside `_handlePostAgentRun` while `_isAgentRunActive`
 * stays true, so only the event flag can name that window `compacting`.
 *
 * Quiet unknown (`!idle && !hasAgentSignal && !armed`) is fail-closed as `busy`,
 * not `compacting`: the public pair cannot tell manual-compact start race from
 * branch summary, post-run retry, or continuation. Calling those `compacting`
 * is a false claim. The start-race guarantee is still "do not call sendMessage".
 *
 * The predicate takes no send mode. Every mode is refused the same way.
 */

export const COMPACTION_SEND_REJECT = "compacting" as const;
export const BUSY_SEND_REJECT = "busy" as const;
export type CompactionSendReject = typeof COMPACTION_SEND_REJECT | typeof BUSY_SEND_REJECT;

export type CompactionGuard = {
	/** Armed by `session_before_compact`; disarmed by either terminal event or idle recovery. */
	armed: boolean;
};

export type CompactionSendFacts = {
	idle: boolean;
	/** `ctx.signal !== undefined`. Not `AgentSession.isStreaming`. */
	hasAgentSignal: boolean;
};

export function createCompactionGuard(): CompactionGuard {
	return { armed: false };
}

export function noteCompactionBefore(guard: CompactionGuard): void {
	guard.armed = true;
}

export function noteCompactionTerminal(guard: CompactionGuard): void {
	guard.armed = false;
}

/**
 * `null` = admit (caller may `pi.sendMessage`).
 * `"compacting"` = event-armed compaction; `"busy"` = quiet unknown non-idle.
 * Either way: do not call `pi.sendMessage`; do not emit `delivered:true`.
 */
export function compactionSendReject(guard: CompactionGuard, facts: CompactionSendFacts): CompactionSendReject | null {
	if (facts.idle) {
		// Idle means Pi is neither in an agent run nor compacting. Also recovers a
		// missed `session_compact` so a later ordinary stream is not stuck refused.
		guard.armed = false;
		return null;
	}
	if (guard.armed) return COMPACTION_SEND_REJECT;
	if (!facts.hasAgentSignal) return BUSY_SEND_REJECT;
	return null; // live agent run — steer/followUp unchanged
}
