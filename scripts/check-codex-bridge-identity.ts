import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THREAD_ID = "00000000-codex-bridge-gate-0001";
const OTHER_GARDEN_ID = "20990101T000000-beefed";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-bridge-identity-"));
const sessionsDir = path.join(tmp, "meta-sessions");
const senderDir = path.join(tmp, "meta-senders");
const codexHome = path.join(tmp, "codex-home");
const born = upsertMetaSession({
	input: {
		backend: "codex",
		nativeSessionId: THREAD_ID,
		cwd: "/gate/codex/bridge-cwd",
		model: "gate-codex-model",
		transcriptPath: "/gate/codex/rollout.jsonl",
	},
	dir: sessionsDir,
});

const requestMeta = {
	threadId: THREAD_ID,
	"x-codex-turn-metadata": {
		session_id: THREAD_ID,
		thread_id: THREAD_ID,
	},
};

interface RpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params: Record<string, unknown>;
}

async function callBridge(
	extraEnv: NodeJS.ProcessEnv,
	requests: RpcRequest[],
	wantedIds: number[],
): Promise<Map<number, unknown>> {
	const child = spawn("bash", [path.join(ROOT, "mcp/entwurf-bridge/start.sh")], {
		cwd: ROOT,
		env: {
			...process.env,
			PI_SESSION_ID: "",
			PI_AGENT_ID: "",
			ENTWURF_META_SESSIONS_DIR: sessionsDir,
			ENTWURF_META_SENDERS_DIR: senderDir,
			ENTWURF_BRIDGE_NATIVE_HOST: "codex",
			CODEX_HOME: codexHome,
			...extraEnv,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const lines = createInterface({ input: child.stdout });
	const responses = new Map<number, unknown>();
	const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
	try {
		const done = new Promise<void>((resolve, reject) => {
			lines.on("line", (line) => {
				try {
					const value = JSON.parse(line) as { id?: unknown };
					if (typeof value.id === "number") responses.set(value.id, value);
					if (wantedIds.every((id) => responses.has(id))) resolve();
				} catch (error) {
					reject(new Error(`bridge wrote non-JSON stdout: ${line}`, { cause: error }));
				}
			});
			child.once("error", reject);
			child.once("exit", (code) => {
				if (!wantedIds.every((id) => responses.has(id))) {
					reject(new Error(`bridge exited ${code} before replies ${wantedIds.join(", ")}: ${stderr}`));
				}
			});
		});
		for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
		await done;
		return responses;
	} finally {
		clearTimeout(timer);
		lines.close();
		child.kill("SIGTERM");
	}
}

function initialize(id: number): RpcRequest {
	return {
		jsonrpc: "2.0",
		id,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "codex-mcp-client", title: "Codex", version: "0.153.4" },
		},
	};
}

function selfCall(id: number, meta?: Record<string, unknown>): RpcRequest {
	return {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: { name: "entwurf_self", arguments: {}, ...(meta ? { _meta: meta } : {}) },
	};
}

function toolText(response: unknown): { text: string; isError: boolean } {
	if (typeof response !== "object" || response === null || !("result" in response)) {
		throw new Error("tools/call returned no result object");
	}
	const result = response.result;
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		throw new Error("tools/call result has no content array");
	}
	const first = result.content[0];
	if (typeof first !== "object" || first === null || !("text" in first) || typeof first.text !== "string") {
		throw new Error("tools/call result has no text content");
	}
	return { text: first.text, isError: "isError" in result && result.isError === true };
}

try {
	const replies = await callBridge(
		{},
		[
			initialize(1),
			{ jsonrpc: "2.0", method: "notifications/initialized", params: {} },
			selfCall(2, requestMeta),
			selfCall(3),
			selfCall(4, {
				...requestMeta,
				"x-codex-turn-metadata": { session_id: THREAD_ID, thread_id: "different-thread" },
			}),
		],
		[1, 2, 3, 4],
	);
	const self = toolText(replies.get(2));
	assert.equal(self.isError, false, `[QK:CODEX-BRIDGE-REQUEST-IDENTITY] ${self.text}`);
	assert.match(self.text, new RegExp(born.record.gardenId));
	assert.match(self.text, /agentId:\s+meta-session\/codex/);
	assert.match(self.text, /origin:\s+meta-session/);
	assert.match(self.text, /cwd:\s+\/gate\/codex\/bridge-cwd/);

	const absent = toolText(replies.get(3));
	assert.equal(absent.isError, true, "a Codex request without _meta must not borrow the preceding request's identity");
	assert.match(absent.text, /identity|wiring incomplete/);

	const mismatch = toolText(replies.get(4));
	assert.equal(mismatch.isError, true, "disagreeing per-request ids must fail loud");
	assert.match(mismatch.text, /three ids disagree/);

	const conflictReplies = await callBridge(
		{ PI_SESSION_ID: OTHER_GARDEN_ID, PI_AGENT_ID: OTHER_GARDEN_ID },
		[initialize(10), { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, selfCall(11, requestMeta)],
		[10, 11],
	);
	const conflict = toolText(conflictReplies.get(11));
	assert.equal(conflict.isError, true, "a leaked pi identity and Codex request identity must not be priority-resolved");
	assert.match(conflict.text, /conflicting sender identity/);
	console.log(
		"check-codex-bridge-identity: request metadata reaches the bridge identity resolver; absent, mismatched, and conflicting claims refuse",
	);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
