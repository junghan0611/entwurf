/**
 * check-pi-bridge-sender — the pi-session carrier is backed by a pi RECORD before the bridge uses it (#125).
 *
 * Since #125 a pi session reaches every Entwurf verb through the compiled entwurf-bridge (Pi's built-in
 * MCP spawns it with the born gardenId as an explicit `PI_SESSION_ID`), so the bridge's pi-session
 * rail is the main road. `resolveAuthoritativeSender` now checks, after the claims reconcile and
 * before returning the pi branch, that the carrier names an existing, readable pi record — through
 * the same per-entry targeted reader the sender/self policy already uses.
 *
 * WHY A SCRIPTS GATE AND NOT A BESIDE TEST: the subject is the bridge PROCESS answering a real
 * `tools/call` over stdio (the same shape as check-codex-bridge-identity beside it); a vitest lane
 * would have to boot that subprocess anyway. The store is a throwaway `ENTWURF_META_SESSIONS_DIR`, the
 * control-socket dir a throwaway HOME: nothing on the operator host is read or written.
 *
 * Cells, in order (node:assert stops at the first failure, so each mutant dies at its own claim):
 *   RECORD-BACKED       a pi record with NO control socket: identity is kept, replyable:false — the
 *                       socket is replyability, never admission.
 *   MISSING-REFUSED     a well-formed carrier with no record refuses loud; no anonymous/other-rail answer.
 *   BACKEND-REFUSED     a carrier naming a record of ANOTHER backend refuses by name.
 *   UNREADABLE-CAUSE    a record file that cannot be parsed refuses with ITS cause, not as "absent".
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-pi-bridge-sender-"));
const home = path.join(tmp, "home");
const sessionsDir = path.join(tmp, "meta-sessions");
fs.mkdirSync(home, { recursive: true });

function born(backend: "pi" | "claude-code", nativeSessionId: string): string {
	return upsertMetaSession({
		input: { backend, nativeSessionId, cwd: "/gate/pi-bridge-sender", model: "gate/model" },
		dir: sessionsDir,
	}).record.gardenId;
}

async function selfAs(gardenId: string): Promise<{ text: string; isError: boolean }> {
	const child = spawn("bash", [path.join(ROOT, "mcp/entwurf-bridge/start.sh")], {
		cwd: ROOT,
		env: {
			PATH: process.env.PATH,
			HOME: home,
			PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
			ENTWURF_META_SESSIONS_DIR: sessionsDir,
			PI_SESSION_ID: gardenId,
			PI_AGENT_ID: "gate/pi-bridge-sender",
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const lines = createInterface({ input: child.stdout });
	const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
	try {
		const reply = await new Promise<unknown>((resolve, reject) => {
			lines.on("line", (line) => {
				const value = JSON.parse(line) as { id?: unknown };
				if (value.id === 2) resolve(value);
			});
			child.once("error", reject);
			child.once("exit", (code) => reject(new Error(`bridge exited ${code} before replying: ${stderr}`)));
			const send = (msg: unknown): void => {
				child.stdin.write(`${JSON.stringify(msg)}\n`);
			};
			send({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gate", version: "0" } },
			});
			send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
			send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "entwurf_self", arguments: {} } });
		});
		const result = (reply as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }).result;
		assert.ok(result, `tools/call returned no result object (stderr: ${stderr})`);
		return { text: result.content?.[0]?.text ?? "", isError: result.isError === true };
	} finally {
		clearTimeout(timer);
		lines.close();
		child.kill("SIGTERM");
	}
}

try {
	const piId = born("pi", "01900000-0000-7000-8000-00000000a001");
	const self = await selfAs(piId);
	assert.ok(
		!self.isError && new RegExp(`sessionId:\\s+${piId}`).test(self.text) && /replyable:\s+false/.test(self.text),
		`[QK:PI-BRIDGE-SENDER-RECORD-BACKED] a pi record with no control socket keeps its identity and answers replyable:false — the socket is replyability, never admission (got: ${self.text})`,
	);

	const absentId = "20991231T235959-a0a0a0";
	const absent = await selfAs(absentId);
	assert.ok(
		absent.isError && /no meta-record for garden id "20991231T235959-a0a0a0"/.test(absent.text),
		`[QK:PI-BRIDGE-SENDER-MISSING-REFUSED] a well-formed PI_SESSION_ID with no record refuses loud, naming the absent record — no anonymous or other-rail answer (got: ${absent.text})`,
	);

	const claudeId = born("claude-code", "00000000-0000-4000-8000-00000000c001");
	const foreign = await selfAs(claudeId);
	assert.ok(
		foreign.isError && /names a claude-code record, not a pi citizen/.test(foreign.text),
		`[QK:PI-BRIDGE-SENDER-BACKEND-REFUSED] a PI_SESSION_ID naming another backend's record refuses by name (got: ${foreign.text})`,
	);

	const brokenId = born("pi", "01900000-0000-7000-8000-00000000a002");
	fs.writeFileSync(path.join(sessionsDir, `${brokenId}.meta.json`), "{ not json");
	const broken = await selfAs(brokenId);
	assert.ok(
		broken.isError && !/no meta-record for garden id/.test(broken.text) && /not valid JSON/.test(broken.text),
		`[QK:PI-BRIDGE-SENDER-UNREADABLE-CAUSE] an unreadable pi record refuses with ITS own cause, never flattened into "absent" (got: ${broken.text})`,
	);

	console.log(
		"check-pi-bridge-sender: a pi-session carrier is served only when it names a readable pi record; missing, foreign-backend and unreadable records each refuse with their own cause, and socket absence stays replyability",
	);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
