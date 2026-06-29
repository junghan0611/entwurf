// Deterministic gate for the S2c runtime tool-surface preflight wiring.
//
// S2b proved assertExcludeToolsHonored as a pure predicate; this proves it is
// actually wired into the streamShellAcp PROVIDER path and fires BEFORE any
// backend spawn. We call streamShellAcp with a context whose declared tools
// exclude a built-in the Claude child still exposes (`read`); the turn must fail
// fast into the returned stream as an `error` event — never reach a spawn, never
// emit `done`. No live backend is launched (the preflight throws first), so this
// stays deterministic and IN pnpm check.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), which `node --experimental-strip-types` cannot resolve directly.
// So — like check-acp-provider-surface — we tsc-emit the project to a temp dir
// and import the COMPILED backend.js, whose `.js` imports resolve to real
// emitted siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";

const model = { id: "claude-sonnet-4-6" } as unknown as Model<Api>;

// Declared tools exclude `read`, but the Claude child always exposes Read →
// declared != actual → the preflight must reject before spawning.
const context: Context = {
	messages: [{ role: "user", content: "hi", timestamp: 0 }],
	tools: [
		{ name: "bash", description: "", parameters: {} as never },
		{ name: "edit", description: "", parameters: {} as never },
		{ name: "write", description: "", parameters: {} as never },
	],
};

const TMP_EMIT = ".tmp-verify/acp-backend-preflight";
rmSync(TMP_EMIT, { recursive: true, force: true });
try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const backendUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href;
	const mod = (await import(backendUrl)) as {
		streamShellAcp: (
			m: Model<Api>,
			c: Context,
		) => AsyncIterable<AssistantMessageEvent> & {
			result: () => Promise<{ stopReason: string; errorMessage?: string }>;
		};
		actionableAcpBackendHint: (message: string) => string | undefined;
	};

	// Detour A (A-c): the pure context-overflow classifier turns a terse backend
	// 400 into an actionable hint, WITHOUT changing routing or hiding the error.
	// Resume must stay legitimate, so the hint names the turn-scoped full-transcript
	// cause and never tells the operator to stop resuming.
	const overflowHint = mod.actionableAcpBackendHint("prompt is too long: 215345 tokens > 200000 maximum");
	assert.ok(overflowHint, "a 'prompt is too long' 400 must classify as a context-overflow hint");
	assert.match(overflowHint, /context-window overflow/, "hint names the overflow");
	assert.match(overflowHint, /persisted resume|window/, "hint names the follow-up root fix");
	assert.match(overflowHint, /locks the model, not resume/, "hint keeps resume legitimate");
	// AMBER1 (GPT review): the hint must NOT assert "turn-scoped" outright — finishError also
	// runs on a resident's first/incompatible turn. It says "FRESH ACP backend session" instead.
	assert.match(overflowHint, /fresh ACP backend session/i, "hint does not over-assert turn-scoped");
	assert.doesNotMatch(overflowHint, /this is a turn-scoped session/, "hint dropped the false-on-resident wording");
	// Positive corpus — real Anthropic overflow phrasings (FN coverage, GPT review).
	assert.ok(
		mod.actionableAcpBackendHint("Error: input is too long for the context window"),
		"context-window phrasing also classifies",
	);
	assert.ok(
		mod.actionableAcpBackendHint("Please reduce the length of the messages or completion."),
		"the 'reduce the length' overflow guidance also classifies",
	);
	// Negative corpus — unrelated failures must NOT be misclassified as overflow. More than one
	// case so the "no misclassification" claim is honestly bounded (GPT review: ECONNREFUSED alone
	// over-claims). These deliberately include near-miss words (exceeded / too many / denied).
	for (const benign of [
		"connect ECONNREFUSED /tmp/acp.sock",
		"rate limit exceeded (429 Too Many Requests)",
		"spawn claude ENOENT",
		"permission denied reading credentials",
	]) {
		assert.equal(mod.actionableAcpBackendHint(benign), undefined, `must NOT misclassify: ${benign}`);
	}

	// Seam guard (GPT review): finishError must call the classifier and must GATE it on
	// `aborted` (an aborted turn gets no overflow hint — abort is not an overflow). A source
	// guard, not a behavioral harness: the wiring is a one-liner and the classifier itself is
	// proven above, so this proves the integration without driving a fake overflowing turn.
	const backendSrc = readFileSync(resolve("pi-extensions/lib/acp/backend.ts"), "utf8");
	assert.match(
		backendSrc,
		/aborted\s*\?\s*undefined\s*:\s*actionableAcpBackendHint\(/,
		"finishError gates the overflow hint on `aborted` (no hint on abort) and calls the classifier",
	);

	const stream = mod.streamShellAcp(model, context);
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);

	const types = events.map((e) => e.type);
	assert.ok(!types.includes("done"), `a tool-surface lie must NOT complete as done (got ${types.join(",")})`);
	const errorEvent = events.find((e): e is Extract<AssistantMessageEvent, { type: "error" }> => e.type === "error");
	assert.ok(errorEvent, `expected an error event (got ${types.join(",")})`);
	assert.equal(errorEvent.reason, "error", "tool-surface divergence is a hard error, not aborted");
	assert.equal(errorEvent.error.stopReason, "error", "final message stopReason must be error");
	assert.match(
		String(errorEvent.error.errorMessage ?? ""),
		/cannot honor --exclude-tools \(read\)/,
		"error must carry the runtime preflight message naming the unhonored tool",
	);

	// The stream result resolves to the same error (stream closed cleanly).
	const final = await stream.result();
	assert.match(
		String(final.errorMessage ?? ""),
		/cannot honor --exclude-tools/,
		"stream result carries the preflight error",
	);
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
}

console.log(
	"[check-acp-backend-preflight] ok — streamShellAcp runs assertExcludeToolsHonored before spawn; a declared-vs-actual " +
		"tool-surface lie fails fast into the stream as an error event (no backend launched, no done); " +
		"actionableAcpBackendHint (A-c) classifies a context-window 400 into an actionable hint without misclassifying unrelated failures",
);
