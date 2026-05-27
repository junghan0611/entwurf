/**
 * resume-mode — pure helper for the asymmetric-mitsein discriminator used by
 * the MCP `entwurf_resume` tool (Phase B Step 3) to resolve the effective
 * mode and (when applicable) the reject reason.
 *
 * Separated from `mcp/pi-tools-bridge/src/index.ts` so the deterministic gate
 * `scripts/check-async-resume-gate.ts` can import the resolution logic
 * without triggering the MCP server's `main()` side effect at module load.
 *
 * Rules:
 *   - explicit mode wins (after the reject check below)
 *   - omitted mode auto-resolves: async if replyable, sync if external
 *   - mode === "async" + non-replyable sender → reject (rejectReason set)
 *     mirrors entwurf_send's `wants_reply=true` rejection — external MCP
 *     hosts cannot receive followUp delivery and must not silently downgrade.
 *
 * Pure function. No env reads, no process spawn, no socket touch.
 */

export interface ResumeModeSenderEnvelope {
	replyable?: boolean;
}

export const ENTWURF_RESUME_ASYNC_REJECT_REASON =
	"entwurf_resume async requires a replyable pi-session caller " +
	"(PI_SESSION_ID + PI_AGENT_ID present). External MCP hosts cannot " +
	"receive followUp delivery and must use mode='sync' (or omit mode and " +
	"the auto-resolution picks sync).";

export function resolveEntwurfResumeMode(
	sender: ResumeModeSenderEnvelope,
	explicit?: "sync" | "async",
): { mode: "sync" | "async"; rejectReason: string | null } {
	const mode = explicit ?? (sender.replyable === true ? "async" : "sync");
	if (mode === "async" && sender.replyable !== true) {
		return { mode, rejectReason: ENTWURF_RESUME_ASYNC_REJECT_REASON };
	}
	return { mode, rejectReason: null };
}
