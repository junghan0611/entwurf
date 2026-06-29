/**
 * meta-mailbox-body — the SINGLE source for rendering an entwurf message as a
 * meta-bridge mailbox body. Both transports that can deliver to a garden citizen
 * with no live control socket use this:
 *   - the MCP bridge entwurf_v2 (mcp/entwurf-bridge) — external/Claude-host sends
 *   - the pi-native entwurf_v2 (pi-extensions/entwurf-control.ts) — pi-session sends
 *
 * The control-socket path carries the sender envelope inside its RPC framing; the
 * mailbox path is just a file, so the envelope must be SERIALIZED INTO the body —
 * else a receiver reading entwurf_inbox_read would not know who sent it, whether
 * the sender is replyable (and at which sessionId), or whether a reply was wanted.
 * The render mirrors the live "[entwurf received ⟵]" header so a transcript reads
 * the same whether the message arrived over a socket or a mailbox.
 *
 * No filesystem/network IO and no mutation — the only ambient read is
 * process.env.HOME for display abbreviation (so not strictly referentially pure,
 * but deterministic per environment). Extracted so the two senders cannot drift
 * in how a mailbox message presents who-sent-it — the field that round-trips
 * garden-id replies.
 */

/** The fields a mailbox body needs from a sender. Structurally compatible with
 * the SenderEnvelope of both entwurf_v2 surfaces. */
export interface MailboxSenderEnvelope {
	sessionId: string;
	agentId: string;
	cwd: string;
	timestamp: string; // ISO 8601 UTC
	origin?: "pi-session" | "external-mcp" | "meta-session";
	replyable?: boolean;
}

/** `~`-abbreviate a home-relative cwd for display. Reads process.env.HOME. */
function abbreviateHome(cwd: string): string {
	const home = process.env.HOME;
	if (!home) return cwd;
	if (cwd === home) return "~";
	if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

/** Format a UTC ISO timestamp as `YYYY-MM-DD HH:MM:SS KST` (UTC+9, no DST).
 * Returns the raw input when it does not parse. Pure. */
function formatKstTimestamp(iso: string): string {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return iso;
	const kst = new Date(ms + 9 * 60 * 60 * 1000);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ` +
		`${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`
	);
}

/**
 * Render the full mailbox body: header envelope + separator + message. A
 * replyable sender (pi-session, or a trusted meta-session) advertises its
 * sessionId as the reply address; a non-replyable sender says so WITHOUT
 * losing its origin — a record-backed meta-session that is currently inactive
 * renders as `(meta-session, non-replyable)`, not degraded to `external`.
 */
export function formatMetaMailboxBody(sender: MailboxSenderEnvelope, message: string, wantsReply: boolean): string {
	const replyable = sender.replyable === true;
	const isMeta = sender.origin === "meta-session";
	const kind = isMeta ? "meta-session, " : "";
	const sessionLine = replyable
		? `${sender.sessionId} (${kind}replyable — reply via entwurf_v2 to this sessionId, intent=fire-and-forget)`
		: isMeta
			? `${sender.sessionId} (meta-session, non-replyable)`
			: `${sender.sessionId} (external, non-replyable)`;
	return (
		`[entwurf received ⟵]\n` +
		`  from:        ${sender.agentId} @ ${abbreviateHome(sender.cwd)}\n` +
		`  session:     ${sessionLine}\n` +
		`  at:          ${formatKstTimestamp(sender.timestamp)}\n` +
		`  wants reply: ${wantsReply ? "yes" : "no"}\n` +
		`────────────────────────────────────────\n` +
		`${message}\n`
	);
}
