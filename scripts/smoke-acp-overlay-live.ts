// S2b — Claude config overlay + tool-narrowed raw ACP turn. LIVE-gated, OUT of
// `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-overlay-live
//
// What this proves (and ONLY this), one layer above the S2a raw-turn baseline:
//   - the pinned Claude ACP adapter is spawned with CLAUDE_CONFIG_DIR pointed at
//     a pi-authored overlay (verified in the child's /proc/<pid>/environ);
//   - that overlay supplies `settings.json` with `hooks:{}` — the honest
//     "mailbox absence by design" claim (no meta-bridge hook on this child's
//     settings surface). NOTE: we do NOT diff the live meta-store for absence —
//     other Claude sessions mint records concurrently, so that assertion is
//     flaky (GPT S2b Q1). The honest claim is overlay-supplies-hooks:{}.
//   - the session is opened with a tool-narrowed `_meta.claudeCode.options`
//     (tools + disallowedTools) and STILL drives one real model turn;
//   - `_meta.systemPrompt` is kept ABSENT so the billing carrier never grows
//     (NEXT §S2-scout 핀1) — asserted on the payload we send.
//
// Deliberately NOT here (later cuts / forbidden ahead of the provider path):
//   - no pi provider path, no streamSimple replacement (backend-stub stays
//     fail-loud — that is S2c);
//   - no event mapping, no session reuse / signature, no identity carrier /
//     engraving / first-user augment (S2d);
//   - no behavioral tool-denial probe ("try WebSearch") — flaky and not the
//     required evidence; the deterministic gate (check-acp-tool-surface) owns
//     the truthfulness check.
//
// Boundary notes (mirror S2a, GPT-reviewed):
//   - launch source MUST be the resolved package bin; a silent PATH fallback
//     FAILS acceptance unless ENTWURF_ACP_OVERLAY_ALLOW_PATH_FALLBACK=1 (then
//     the run is stamped debug/non-acceptance).
//   - scratch cwd is a fresh mkdtemp (repo isolation); the overlay is a
//     separate fresh mkdtemp with realDir = the operator's ~/.claude so live
//     credentials pass through — entwurf neither copies nor proxies auth.

import { strict as assert } from "node:assert";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import {
	CLAUDE_REAL_CONFIG_DIR,
	claudeLaunchEnvDefaults,
	ensureClaudeConfigOverlay,
} from "../pi-extensions/lib/acp/overlay.ts";
import {
	buildClaudeSessionMeta,
	DEFAULT_CLAUDE_DISALLOWED_TOOLS,
	DEFAULT_CLAUDE_PERMISSION_ALLOW,
	DEFAULT_CLAUDE_TOOLS,
} from "../pi-extensions/lib/acp/tool-surface.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";

const REQUESTED_MODEL_ID = process.env.ENTWURF_ACP_OVERLAY_MODEL ?? "claude-sonnet-4-6";
const ALLOW_PATH_FALLBACK = process.env.ENTWURF_ACP_OVERLAY_ALLOW_PATH_FALLBACK === "1";
const RAW_TAIL_CAP = 64 * 1024;

function fail(msg: string): never {
	console.error(`[smoke-acp-overlay-live] FAIL: ${msg}`);
	process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		p,
		sleep(ms).then((): never => {
			throw new Error(`${label} timed out after ${ms}ms`);
		}),
	]);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-overlay-live] skipped — set LIVE=1 to run the real overlay ACP turn.");
	process.exit(0);
}

function resolveLaunch(): { command: string; args: string[]; source: string; acceptance: boolean } {
	const require = createRequire(import.meta.url);
	try {
		const pkgJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
		const binPath = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.["claude-agent-acp"];
		if (binPath) {
			return {
				command: process.execPath,
				args: [join(dirname(pkgJsonPath), binPath)],
				source: "package:@agentclientprotocol/claude-agent-acp",
				acceptance: true,
			};
		}
		fail("@agentclientprotocol/claude-agent-acp resolved but exposes no bin entry");
	} catch (err) {
		if (!ALLOW_PATH_FALLBACK) {
			fail(
				`could not resolve @agentclientprotocol/claude-agent-acp package bin (${(err as Error).message}). ` +
					"This is an acceptance failure — the dep pin / install is broken. Set " +
					"ENTWURF_ACP_OVERLAY_ALLOW_PATH_FALLBACK=1 only for debug.",
			);
		}
	}
	return {
		command: "claude-agent-acp",
		args: [],
		source: "PATH:claude-agent-acp (debug/non-acceptance)",
		acceptance: false,
	};
}

// Read the child's startup environment from /proc (Linux). Returns the value of
// `key` or undefined. The environ is fixed at exec, so this is strong evidence
// the var was planted into the spawn — not just our in-process copy.
async function readChildEnv(pid: number, key: string): Promise<string | undefined> {
	const buf = await readFile(`/proc/${pid}/environ`);
	for (const entry of buf.toString("utf8").split("\0")) {
		const eq = entry.indexOf("=");
		if (eq > 0 && entry.slice(0, eq) === key) return entry.slice(eq + 1);
	}
	return undefined;
}

async function main(): Promise<void> {
	const launch = resolveLaunch();
	const scratch = await mkdtemp(join(tmpdir(), "entwurf-s2b-cwd-"));
	const overlayDir = await mkdtemp(join(tmpdir(), "entwurf-s2b-overlay-"));

	// Materialize the overlay against the operator's REAL ~/.claude so live
	// credentials pass through; settings.json (hooks:{}) is ours.
	ensureClaudeConfigOverlay(CLAUDE_REAL_CONFIG_DIR, overlayDir);
	const overlaySettingsPath = join(overlayDir, "settings.json");
	const overlaySettings = JSON.parse(readFileSync(overlaySettingsPath, "utf8"));
	assert.ok(
		overlaySettings.hooks &&
			typeof overlaySettings.hooks === "object" &&
			Object.keys(overlaySettings.hooks).length === 0,
		"overlay settings.json must supply hooks:{} (mailbox absence by design)",
	);

	const envOverride = claudeLaunchEnvDefaults(overlayDir);
	assert.equal(envOverride.CLAUDE_CONFIG_DIR, overlayDir, "launch env builder must target the overlay dir");

	console.error(`[smoke-acp-overlay-live] launch source: ${launch.source}`);
	console.error(`[smoke-acp-overlay-live] scratch cwd:   ${scratch}`);
	console.error(`[smoke-acp-overlay-live] overlay dir:   ${overlayDir}`);
	console.error(`[smoke-acp-overlay-live] model request: ${REQUESTED_MODEL_ID}`);

	const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(launch.command, launch.args, {
		cwd: scratch,
		env: { ...process.env, ...envOverride },
		stdio: ["pipe", "pipe", "pipe"],
	}) as ChildProcessByStdio<Writable, Readable, Readable>;

	const stderrTail: string[] = [];
	child.stderr.on("data", (c) => {
		stderrTail.push(c.toString());
		if (stderrTail.length > 200) stderrTail.shift();
	});

	let rawBytes = "";
	child.stdout.on("data", (c) => {
		rawBytes += c.toString();
		if (rawBytes.length > RAW_TAIL_CAP * 2) rawBytes = rawBytes.slice(-RAW_TAIL_CAP);
	});

	const stdoutWeb = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
	const stdinWeb = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>;
	const stream = ndJsonStream(stdinWeb, stdoutWeb);

	let collectedText = "";
	let unexpectedPermission = 0;
	let unexpectedFileOp = 0;

	const connection = new ClientSideConnection(
		() => ({
			sessionUpdate: async (notification: any) => {
				const u = notification?.update;
				if (u?.sessionUpdate === "agent_message_chunk") {
					const t = u?.content?.text;
					if (typeof t === "string") collectedText += t;
				}
			},
			requestPermission: async (): Promise<any> => {
				unexpectedPermission++;
				return { outcome: { outcome: "cancelled" } };
			},
			readTextFile: async (): Promise<any> => {
				unexpectedFileOp++;
				throw new Error("unexpected readTextFile in overlay OK turn");
			},
			writeTextFile: async (): Promise<any> => {
				unexpectedFileOp++;
				throw new Error("unexpected writeTextFile in overlay OK turn");
			},
		}),
		stream as any,
	);

	let failure: Error | null = null;
	try {
		if (!launch.acceptance) {
			throw new Error("launch was a PATH fallback (debug) — not an acceptance PASS");
		}

		// The child's startup env must carry our overlay redirect.
		const childPid = child.pid;
		assert.ok(childPid, "spawned child has no pid");
		const childConfigDir = await readChildEnv(childPid, "CLAUDE_CONFIG_DIR");
		assert.equal(
			childConfigDir,
			overlayDir,
			`child CLAUDE_CONFIG_DIR must be the overlay (got ${JSON.stringify(childConfigDir)})`,
		);
		console.error(`[smoke-acp-overlay-live] child CLAUDE_CONFIG_DIR=${childConfigDir} ✓`);

		// 1) initialize
		const init = await withTimeout(
			"initialize",
			connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {},
				clientInfo: { name: "entwurf-smoke", version: "s2b-overlay" },
			} as any),
			30_000,
		);
		assert.ok(init, "initialize returned no result");
		console.error(`[smoke-acp-overlay-live] initialize ok (protocolVersion=${(init as any)?.protocolVersion})`);

		// 2) newSession — overlay-aware: scratch cwd, no MCP, tool-narrowed _meta,
		//    NO systemPrompt (carrier stays absent).
		const sessionMeta = buildClaudeSessionMeta({
			modelId: REQUESTED_MODEL_ID,
			tools: DEFAULT_CLAUDE_TOOLS,
			permissionAllow: DEFAULT_CLAUDE_PERMISSION_ALLOW,
			disallowedTools: DEFAULT_CLAUDE_DISALLOWED_TOOLS,
			settingSources: [],
			strictMcpConfig: false,
			skillPlugins: [],
		});
		assert.ok(!("systemPrompt" in sessionMeta), "S2b payload must NOT carry _meta.systemPrompt");
		const created = (await withTimeout(
			"newSession",
			connection.newSession({ cwd: scratch, mcpServers: [], _meta: sessionMeta } as any),
			30_000,
		)) as any;
		const sessionId = created?.sessionId;
		assert.ok(sessionId, "newSession returned no sessionId");
		console.error(
			`[smoke-acp-overlay-live] newSession ok (sessionId=${String(sessionId).slice(0, 12)}…, tool-narrowed _meta)`,
		);

		// 3) force the requested model — honesty, same as S2a.
		const setModel = (connection as any).unstable_setSessionModel;
		if (typeof setModel !== "function") {
			throw new Error(`unstable_setSessionModel unsupported — cannot enforce ${REQUESTED_MODEL_ID}`);
		}
		await withTimeout("setSessionModel", setModel.call(connection, { sessionId, modelId: REQUESTED_MODEL_ID }), 30_000);
		console.error(`[smoke-acp-overlay-live] model set -> ${REQUESTED_MODEL_ID}`);

		// 4) one tiny turn.
		const promptResult = (await withTimeout(
			"prompt",
			connection.prompt({
				sessionId,
				prompt: [{ type: "text", text: "Reply with exactly OK and nothing else." }],
			} as any),
			120_000,
		)) as any;
		console.error(`[smoke-acp-overlay-live] prompt returned (stopReason=${promptResult?.stopReason})`);

		// ---- assertions ----
		assert.ok(promptResult, "prompt returned no result");
		assert.equal(unexpectedPermission, 0, `unexpected permission request(s): ${unexpectedPermission}`);
		assert.equal(unexpectedFileOp, 0, `unexpected file op(s): ${unexpectedFileOp}`);
		assert.ok(rawBytes.trim().length > 0, "no raw NDJSON bytes captured from backend stdout");
		const normalized = collectedText.replace(/\s+/g, " ").trim().toUpperCase();
		assert.ok(
			normalized.includes("OK"),
			`agent text did not contain "OK" (got: ${JSON.stringify(collectedText.slice(0, 200))})`,
		);

		console.log("[smoke-acp-overlay-live] PASS — overlay + tool-narrowed raw ACP turn drove a live model reply");
		console.log(`  launch:        ${launch.source}`);
		console.log(`  overlay:       ${overlayDir} (hooks:{})`);
		console.log(`  CLAUDE_CONFIG_DIR (child): ${overlayDir}`);
		console.log(`  model:         ${REQUESTED_MODEL_ID}`);
		console.log(`  reply:         ${JSON.stringify(collectedText.trim().slice(0, 120))}`);
		console.log(`  rawBytes:      ${rawBytes.length} captured (NDJSON)`);
	} catch (err) {
		failure = err instanceof Error ? err : new Error(String(err));
		console.error(`[smoke-acp-overlay-live] stderr tail:\n${stderrTail.slice(-20).join("")}`);
		console.error(`[smoke-acp-overlay-live] raw NDJSON tail:\n${rawBytes.slice(-2048)}`);
	} finally {
		await terminateChild(child);
		for (const dir of [scratch, overlayDir]) {
			try {
				await rm(dir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
	}

	if (failure) fail(failure.message);
}

await main();
