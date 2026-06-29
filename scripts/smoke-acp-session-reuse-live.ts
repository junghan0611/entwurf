// S2d-1b-2b — live in-memory session reuse acceptance. LIVE-gated, OUT of check.
//
//   LIVE=1 ./run.sh smoke-acp-session-reuse-live
//
// The deterministic gate (check-acp-session-reuse) proves the prompt SCOPE
// (delta-only) and the wiring with a fake seam. This proves the REAL thing: a
// process-scoped pi process drives TWO real ACP turns over ONE reused
// claude-agent-acp child, and turn 2 — which sends ONLY the latest user delta —
// gets an answer that depends on a codeword introduced in turn 1. That is only
// possible if (a) the child/connection were actually reused (not respawned) and
// (b) the live ACP session kept turn 1 in its own history (so the delta was
// enough). A respawn-per-turn backend (S2c) would forget the codeword.
//
// It forces process-scoped by pushing the real `--entwurf-control` resident flag
// into argv (resolveLifecyclePolicy reads process.argv), then calls the REAL
// streamShellAcp (real overlay + real spawn) twice with the same sessionId.
//
// The one-shot exit0 half (a `pi -p` turn-scoped session tears down cleanly) is
// owned by smoke-acp-provider-live — reuse must not regress it.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.ENTWURF_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";
const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_PROVIDER_TIMEOUT_MS) || 240_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-session-reuse-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-session-reuse-live] skipped — set LIVE=1 to run the real 2-turn reuse acceptance.");
	process.exit(0);
}

type Stream = AsyncIterable<AssistantMessageEvent> & {
	result: () => Promise<{ stopReason: string; errorMessage?: string }>;
};

async function consume(stream: Stream): Promise<{ text: string; error?: string; done: boolean }> {
	let text = "";
	let error: string | undefined;
	let done = false;
	for await (const ev of stream) {
		if (ev.type === "text_delta") text += ev.delta;
		else if (ev.type === "done") done = true;
		else if (ev.type === "error") error = ev.error.errorMessage ?? "error";
	}
	return { text, error, done };
}

const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`.toUpperCase();
const codeword = `KIWI${nonce}`;
const scratch = mkdtempSync(resolve(tmpdir(), "entwurf-reuse-"));
const TMP_EMIT = resolve(REPO_ROOT, ".tmp-verify/acp-reuse-live");
rmSync(TMP_EMIT, { recursive: true, force: true });

async function main(): Promise<void> {
	// Compile so backend.js's `.js` sibling imports resolve (same trick as gates).
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		cwd: REPO_ROOT,
		stdio: "pipe",
	});
	// tsc emits only .ts→.js; the engraving carrier is a .md asset that ships
	// alongside engraving.js in the real package, and backend.js reads it at its
	// default path. Copy it into the emit tree so the carrier resolves (the
	// deterministic check-acp-session-reuse gate does the same copyFileSync).
	const promptsOut = resolve(TMP_EMIT, "pi-extensions/lib/acp/prompts");
	mkdirSync(promptsOut, { recursive: true });
	copyFileSync(resolve(REPO_ROOT, "pi-extensions/lib/acp/prompts/engraving.md"), resolve(promptsOut, "engraving.md"));
	const backendUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href;
	// biome-ignore lint/suspicious/noExplicitAny: compiled module imported by URL
	const backend = (await import(backendUrl)) as any;

	// Force process-scoped: the real resident flag makes resolveLifecyclePolicy
	// pick `process-scoped`, so turn 2 reuses the in-memory child.
	if (!process.argv.includes("--entwurf-control")) process.argv.push("--entwurf-control");

	const model = { id: MODEL } as unknown as Model<Api>;
	const options = { cwd: scratch, sessionId: "reuse-smoke" };

	console.error(`[smoke-acp-session-reuse-live] repo:     ${REPO_ROOT}`);
	console.error(`[smoke-acp-session-reuse-live] cwd:      ${scratch}`);
	console.error(`[smoke-acp-session-reuse-live] model:    entwurf/${MODEL}`);
	console.error(`[smoke-acp-session-reuse-live] codeword: ${codeword}`);

	// --- turn 1 (new): introduce the codeword, full transcript ---
	const turn1: Context = {
		messages: [
			{
				role: "user",
				content: `Remember this codeword: ${codeword}. Reply with exactly OK and nothing else.`,
				timestamp: 0,
			},
		],
	};
	const r1 = await Promise.race([
		consume(backend.streamShellAcp(model, turn1, options) as Stream),
		new Promise<never>((_, rej) => setTimeout(() => rej(new Error("turn 1 timed out")), TURN_TIMEOUT_MS)),
	]);
	if (r1.error) fail(`turn 1 errored: ${r1.error}`);
	if (!r1.done) fail("turn 1 did not complete");
	console.error(`[smoke-acp-session-reuse-live] turn 1 reply: ${JSON.stringify(r1.text.slice(-120))}`);

	// --- turn 2 (reuse): ask for the codeword, DELTA ONLY ---
	const turn2: Context = {
		messages: [
			...turn1.messages,
			{
				role: "assistant",
				content: [{ type: "text", text: r1.text || "OK" }],
				api: "entwurf",
				provider: "entwurf",
				model: MODEL,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			},
			{
				role: "user",
				content: "What codeword did I ask you to remember? Reply with exactly that codeword and nothing else.",
				timestamp: 0,
			},
		],
	};
	const r2 = await Promise.race([
		consume(backend.streamShellAcp(model, turn2, options) as Stream),
		new Promise<never>((_, rej) => setTimeout(() => rej(new Error("turn 2 timed out")), TURN_TIMEOUT_MS)),
	]);
	if (r2.error) fail(`turn 2 errored: ${r2.error}`);
	if (!r2.done) fail("turn 2 did not complete");
	console.error(`[smoke-acp-session-reuse-live] turn 2 reply: ${JSON.stringify(r2.text.slice(-120))}`);

	// The codeword only lives in turn 1. Turn 2 sent only the delta question, so a
	// correct answer proves the reused live ACP session remembered turn 1.
	assert.ok(
		r2.text.includes(codeword),
		`turn 2 reply did not contain the turn-1 codeword ${codeword} — reuse/memory failed (reply: ${JSON.stringify(r2.text.slice(-200))})`,
	);

	console.log(
		"[smoke-acp-session-reuse-live] PASS — 2-turn reuse over one ACP child; turn-2 delta recalled the turn-1 codeword",
	);
	console.log(`  model:    entwurf/${MODEL}`);
	console.log(`  codeword: ${codeword} recalled in turn 2 (delta-only)`);
}

main()
	.then(() => {
		// retained child is SIGKILLed by the backend's process 'exit' hook.
		process.exit(0);
	})
	.catch((err) => {
		fail(err instanceof Error ? err.message : String(err));
	})
	.finally(() => {
		rmSync(scratch, { recursive: true, force: true });
		rmSync(TMP_EMIT, { recursive: true, force: true });
	});
