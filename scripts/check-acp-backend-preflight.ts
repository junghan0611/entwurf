// Deterministic gate for the S2c runtime tool-surface preflight wiring.
//
// S2b proved assertExcludeToolsHonored as a pure predicate; this proves it is
// actually wired into the streamShellAcp PROVIDER path and fires BEFORE any
// backend spawn. We call streamShellAcp with a context whose declared tools
// exclude a built-in the Claude child still exposes (`read`); the turn must fail
// fast into the returned stream as an `error` event — never reach a spawn, never
// emit `done`. No live backend is launched (the preflight throws first), so this
// stays deterministic and IN pnpm run check:full.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), which `node --experimental-strip-types` cannot resolve directly.
// So — like check-acp-provider-surface — we tsc-emit the project to a temp dir
// and import the COMPILED backend.js, whose `.js` imports resolve to real
// emitted siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";

const model = { id: "claude-sonnet-5" } as unknown as Model<Api>;

// Declared tools exclude `read`, but the Claude child always exposes Read →
// declared != actual → the preflight must reject before spawning.
//
// Built through `normalizeContext` — NOT as a `Context` literal. Since pi 0.86
// a custom provider is handed a TranscriptContext (model-runtime.ts calls
// `normalizeContext(context)` before `provider.streamSimple`), so `context.tools`
// is ALWAYS undefined on the provider path and the declared surface lives in the
// leading system message's `toolsAdded`. Feeding a 0.85-shaped literal straight
// into streamShellAcp would bypass the fold and let this gate stay green over a
// preflight that can no longer see any tools at all.
const context: TranscriptContext = normalizeContext({
	messages: [{ role: "user", content: "hi", timestamp: 0 }],
	tools: [
		{ name: "bash", description: "", parameters: {} as never },
		{ name: "edit", description: "", parameters: {} as never },
		{ name: "write", description: "", parameters: {} as never },
	],
});

// Premise guard: the fixture must really carry its tools as transcript state. If
// a future pi stops folding, this fails loudly instead of leaving the exclude-
// tools assertion below testing an empty surface for the wrong reason.
assert.equal(context.messages[0].role, "system", "normalizeContext folded the tools into a leading system message");
assert.deepEqual(
	(context.messages[0] as { toolsAdded?: { name: string }[] }).toolsAdded?.map((t) => t.name),
	["bash", "edit", "write"],
	"the declared surface rides the system message's toolsAdded",
);

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
			c: TranscriptContext,
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
	const errorEvent = events.find((e): e is Extract<AssistantMessageEvent, { type: "error" }> => e.type === "error");

	// The whole claim in ONE assertion, placed BEFORE the diagnostic breakdown so
	// a mutant always dies here and carries the signature. The breakdown below
	// still runs on a green tree and says WHICH half broke.
	const preflightFired =
		!types.includes("done") &&
		/cannot honor --exclude-tools \(read\)/.test(String(errorEvent?.error.errorMessage ?? ""));
	assert.ok(
		preflightFired,
		"[QK:ACP-PREFLIGHT-REPLAYS-TRANSCRIPT-TOOLS] the runtime tool-surface preflight must read the active tools by " +
			"REPLAYING the transcript's system messages (`getCurrentTools(context.messages)`), which is where pi 0.86 puts " +
			"the declared surface. Reading a `context.tools` field instead yields undefined on every 0.86 provider call; " +
			"with a fallback to the full builtin set that makes assertExcludeToolsHonored unfireable — the turn reaches a " +
			"spawn and the operator is told a tool is excluded while the backend can still run it. " +
			`Got events [${types.join(",")}], error=${JSON.stringify(errorEvent?.error.errorMessage ?? null)}`,
	);

	assert.ok(!types.includes("done"), `a tool-surface lie must NOT complete as done (got ${types.join(",")})`);
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

// ---------------------------------------------------------------------------
// Provider-path fixture sweep — the cast that got past typecheck twice
// ---------------------------------------------------------------------------
// The behavioral cells above prove ONE gate feeds the 0.86 shape. This proves the
// others cannot quietly stop doing so. When the pi 0.86 pin landed, the branded
// `TranscriptContext` named every gate that built a provider-path fixture as a
// `Context` LITERAL — and named none of the four that wrote `as Context`, because a
// cast is exactly the operation that silences the brand. Those four then failed in
// the full floor with `'error' !== 'done'`, a message that says nothing about the
// cause. A fixture cast to `Context` declares no tools, `getCurrentTools` replays
// none, and every turn seals as an exclude-tools rejection before the prompt is
// sent — which reads like broken streaming and is actually a stale fixture.
//
// So: no provider-path source may cast to `Context` at all. Static by nature —
// there is no production subject here and nothing to drive, the claim IS the
// absence of a token in a file set — so this carries no mutant. Its kill-proof is
// the sweep itself: delete the assertion and nothing else changes, which is true of
// any absence check and is why it lives beside the capability it protects rather
// than in a lane of its own.
{
	// The SMOKES are in scope, not only the deterministic gates. Leaving them out is how this
	// guard missed `smoke-acp-session-reuse-live.ts` in the 0.23.2 release gate: the gates it
	// did sweep were all green, and the one provider-path fixture it could not see failed an
	// hour into a LIVE run instead.
	const swept = [
		...readdirSync(resolve("scripts"))
			.filter((f) => (f.startsWith("check-acp-") || f.startsWith("smoke-")) && f.endsWith(".ts"))
			.map((f) => join("scripts", f)),
		...readdirSync(resolve("pi-extensions", "lib"), { recursive: true, encoding: "utf8" })
			.filter((f) => f.endsWith(".test.ts"))
			.map((f) => join("pi-extensions", "lib", f)),
	];
	// Guard the sweep: a glob that matches nothing passes vacuously and says so to nobody.
	assert.ok(swept.length >= 10, `provider-path sweep matched only ${swept.length} files — the globs stopped resolving`);

	// BOTH spellings, because the hazard is the TYPE, not one syntax for reaching it. The four
	// gates found in the full floor wrote `as Context`; the live smoke found in the release gate
	// wrote `const turn1: Context = {…}`. A guard that names one spelling only teaches the next
	// author which spelling to use.
	//
	// `Context[...]` and `Context<...>` are NOT the hazard and are excluded by the trailing
	// lookahead: `messages: Context["messages"]` is the legitimate INPUT to `normalizeContext`,
	// which takes a real Context by contract. Flagging it would push authors to re-type pi's own
	// message array by hand, which is a worse fixture than the one this rule exists to prevent.
	const RAW_CONTEXT = /(?:\bas\s+Context|:\s*Context)\b(?![[<])/;
	const offenders: string[] = [];
	for (const file of swept) {
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, i) => {
				// Prose about the rule is not a violation of it.
				if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
				if (RAW_CONTEXT.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
			});
	}
	assert.deepEqual(
		offenders,
		[],
		"[QK:ACP-FIXTURE-NO-CONTEXT-CAST] a provider-path fixture may not be typed as the raw `Context` — neither by " +
			"annotation nor by cast. Since pi 0.86 a custom provider receives a branded TranscriptContext, and the brand is " +
			"the only thing that names a stale fixture at typecheck time; either spelling silences it, so the fixture " +
			"declares no tools, the exclude-tools preflight rejects every turn before the prompt is sent, and the failure " +
			"surfaces as `'error' !== 'done'` with nothing pointing at the cause. Build it with " +
			"`normalizeContext({ tools, messages })` instead. Found:\n" +
			offenders.join("\n"),
	);
}

console.log(
	"[check-acp-backend-preflight] ok — streamShellAcp replays the 0.86 transcript's system messages for the active tool " +
		"surface and runs assertExcludeToolsHonored before spawn; a declared-vs-actual " +
		"tool-surface lie fails fast into the stream as an error event (no backend launched, no done); " +
		"actionableAcpBackendHint (A-c) classifies a context-window 400 into an actionable hint without misclassifying " +
		"unrelated failures; and no provider-path fixture in the acp gates, the smokes or the lib tests is typed as the raw " +
		"`Context` (annotation or cast), so the " +
		"TranscriptContext brand still names a stale one at typecheck time",
);
