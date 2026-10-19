/**
 * #107 rail 2b: the mailbox body's sender header, proven beside the renderer.
 *
 * The oracle is literal expected text. The local cases pin the header every existing sender already
 * produces, so the remote branch is shown not to move it. The remote cases pin the one new
 * sessionLine and the sender-host cwd label.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMetaMailboxBody, type MailboxSenderEnvelope } from "./meta-mailbox-body.ts";

const TS = "2026-10-19T00:00:00.000Z"; // 09:00:00 KST
const GID = "20261007T132839-0aaaaa";

let savedHome: string | undefined;
beforeEach(() => {
	savedHome = process.env.HOME;
	process.env.HOME = "/home/op";
});
afterEach(() => {
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
});

function header(sender: MailboxSenderEnvelope): string {
	return formatMetaMailboxBody(sender, "m", false).split("────")[0];
}

const base = { sessionId: GID, agentId: "agent/x", cwd: "/home/op/repos/entwurf", timestamp: TS };

describe("the remote branch leaves every local header unchanged", () => {
	it("[QK:REMOTE-DISPLAY-LOCAL-UNCHANGED] replyable pi-session, non-replyable meta-session and external headers render exactly as before", () => {
		expect(header({ ...base, origin: "pi-session", replyable: true })).toBe(
			"[entwurf received ⟵]\n" +
				"  from:        agent/x @ ~/repos/entwurf\n" +
				`  session:     ${GID} (replyable — reply via entwurf_v2 to this sessionId, intent=fire-and-forget)\n` +
				"  at:          2026-10-19 09:00:00 KST\n" +
				"  wants reply: no\n",
		);
		expect(header({ ...base, origin: "meta-session", replyable: false })).toBe(
			"[entwurf received ⟵]\n" +
				"  from:        agent/x @ ~/repos/entwurf\n" +
				`  session:     ${GID} (meta-session, non-replyable)\n` +
				"  at:          2026-10-19 09:00:00 KST\n" +
				"  wants reply: no\n",
		);
		expect(header({ ...base, origin: "external-mcp", replyable: false })).toBe(
			"[entwurf received ⟵]\n" +
				"  from:        agent/x @ ~/repos/entwurf\n" +
				`  session:     ${GID} (external, non-replyable)\n` +
				"  at:          2026-10-19 09:00:00 KST\n" +
				"  wants reply: no\n",
		);
	});
});

describe("a remote sender", () => {
	const remote = (replyRoute: "declared" | "none"): MailboxSenderEnvelope => ({
		...base,
		origin: "external-mcp",
		replyable: false,
		remote: { via: "laptop", replyRoute },
	});

	it("[QK:REMOTE-DISPLAY-SESSIONLINE] names its route and whether a route back is declared, and never offers a live reply hint", () => {
		const declared = header(remote("declared"));
		const none = header(remote("none"));
		expect(declared).toContain(`  session:     ${GID} (remote via laptop; reply route declared, not probed)\n`);
		expect(none).toContain(`  session:     ${GID} (remote via laptop; no reply route declared)\n`);
		for (const h of [declared, none]) expect(h).not.toContain("reply via entwurf_v2");
	});

	it("[QK:REMOTE-DISPLAY-SENDER-HOST-CWD] shows its cwd as a sender-host path, never abbreviated against this host's HOME", () => {
		expect(header(remote("none"))).toContain("  from:        agent/x @ /home/op/repos/entwurf (sender-host path)\n");
	});
});
