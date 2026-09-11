import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeProductionEntwurfV2Deps } from "../pi-extensions/lib/entwurf-v2-production.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import { probeCodexThread } from "../pi-extensions/lib/native-push/codex-ws-client.ts";
import { skipLive } from "./lib/live-skip.ts";

if (process.env.LIVE !== "1") {
	skipLive(
		"smoke-codex-native-push-live",
		"set LIVE=1 + CODEX_LIVE_THREAD_ID to run (sends a real turn to an already-loaded Codex thread).",
	);
}

const threadId = process.env.CODEX_LIVE_THREAD_ID?.trim();
if (!threadId) {
	skipLive(
		"smoke-codex-native-push-live",
		"set CODEX_LIVE_THREAD_ID to a thread loaded by a TUI attached to the default Codex app-server.",
	);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-live-"));
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const sessionsDir = path.join(root, "meta-sessions");
const born = upsertMetaSession({
	dir: sessionsDir,
	input: {
		backend: "codex",
		nativeSessionId: threadId,
		cwd: process.cwd(),
		model: process.env.CODEX_LIVE_MODEL?.trim() || null,
		transcriptPath: path.join(root, "codex-live-transcript.jsonl"),
	},
});

const before = await probeCodexThread(threadId);
assert.equal(before.status, "alive", `[QK:CODEX-LIVE-PROBE] ${before.status === "alive" ? "" : before.reason}`);

const token = `CODEX-NATIVE-LIVE-${Date.now()}`;
const result = await runEntwurfV2(
	{
		target: born.record.gardenId,
		intent: "fire-and-forget",
		wantsReply: true,
		message: `Entwurf native-push live acceptance. Reply with exactly ${token}`,
	},
	makeProductionEntwurfV2Deps({
		senderProvider: () => ({
			sessionId: born.record.gardenId,
			agentId: "meta-session/codex",
			cwd: process.cwd(),
			timestamp: new Date().toISOString(),
			origin: "meta-session",
			replyable: true,
		}),
		sessionsDir,
		mailboxDir: path.join(root, "mailbox"),
		controlSocketDir: path.join(root, "control"),
		lockDir: path.join(root, "locks"),
	}),
);
assert.equal(result.kind, "executed", `[QK:CODEX-LIVE-PUBLIC-DISPATCH] ${JSON.stringify(result)}`);
assert.equal(result.kind === "executed" ? result.transport : null, "native-push");
const after = await probeCodexThread(threadId);
assert.equal(after.status, "alive", "Codex thread remains loaded after the one-shot queue acceptance");

console.log(`smoke-codex-native-push-live: delivered ${token}`);
console.log(`  gardenId: ${born.record.gardenId}`);
console.log(`  threadId: ${threadId}`);
console.log(`  socket:   ${before.status === "alive" ? before.route.socketPath : "unreachable"}`);
console.log("  verify the exact token appears in that visible Codex TUI; the delivery receipt is not the model result");
