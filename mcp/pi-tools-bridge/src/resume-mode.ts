/**
 * resume-mode — pure helper for the async-followUp discriminator used by
 * the MCP `entwurf_resume` tool (Phase B Step 3) to resolve the effective
 * mode and (when applicable) the reject reason.
 *
 * Separated from `mcp/pi-tools-bridge/src/index.ts` so the deterministic gate
 * `scripts/check-async-resume-gate.ts` can import the resolution logic
 * without triggering the MCP server's `main()` side effect at module load.
 *
 * Rules:
 *   1. explicit mode wins (after the reject checks below)
 *   2. omitted mode auto-resolves: async ONLY for a pi-session caller (it owns a
 *      control socket for followUp); sync for external AND meta-session.
 *   3. mode === "async" + not async-capable → reject (followUp gate). A
 *      meta-session is entwurf_send-replyable (garden-id mailbox) but has NO pi
 *      control socket, so it cannot host async-resume followUp any more than an
 *      external host can. `replyable` alone is NOT the async discriminant —
 *      `origin === "pi-session"` is. Conflating them routed meta-session resumes
 *      into a control-socket lookup that always fails.
 *   4. effective mode === "async" + cwd is set → reject (cwd silent-ignore
 *      guard). The async launcher uses the saved session header cwd as
 *      authority (#9); accepting cwd here while the launcher ignores it
 *      would mislead the caller into thinking their override applied.
 *
 * Pure function. No env reads, no process spawn, no socket touch.
 */

export interface ResumeModeSenderEnvelope {
	replyable?: boolean;
	origin?: "pi-session" | "external-mcp" | "meta-session";
}

export const ENTWURF_RESUME_ASYNC_REJECT_REASON =
	"entwurf_resume async requires a replyable pi-session caller " +
	"(PI_SESSION_ID + PI_AGENT_ID present, with a live control socket). External " +
	"MCP hosts and meta-session senders (garden-id mailbox, no control socket) " +
	"cannot receive followUp delivery and must use mode='sync' (or omit mode and " +
	"the auto-resolution picks sync).";

export const ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON =
	"entwurf_resume: cwd override is sync-only. Async resume uses the saved " +
	"session header cwd as authority (#9). Either drop cwd, or pass " +
	"mode='sync' to apply the override on the sync path.";

export function resolveEntwurfResumeMode(
	sender: ResumeModeSenderEnvelope,
	explicit?: "sync" | "async",
	cwd?: string,
): { mode: "sync" | "async"; rejectReason: string | null } {
	// Async followUp needs a pi control socket — ONLY a pi-session caller has one.
	// A meta-session is replyable for entwurf_send (garden-id mailbox) but cannot
	// host async resume, so replyable alone must not auto-route to async.
	const asyncCapable = sender.replyable === true && sender.origin === "pi-session";
	const mode = explicit ?? (asyncCapable ? "async" : "sync");
	if (mode === "async" && !asyncCapable) {
		return { mode, rejectReason: ENTWURF_RESUME_ASYNC_REJECT_REASON };
	}
	if (mode === "async" && typeof cwd === "string" && cwd.length > 0) {
		return { mode, rejectReason: ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON };
	}
	return { mode, rejectReason: null };
}
