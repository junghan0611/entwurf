// Deterministic gate for the S2d bootstrapPath-scoped ACP prompt builder (핀4).
//
// The S2c→S2d hazard: contextToAcpPrompt flattens the WHOLE transcript because
// spawn-per-turn sessions hold no memory. Once S2d adds session reuse, sending
// that whole transcript to a session that ALREADY remembers the prior turns
// duplicates history. So the prompt SCOPE must follow bootstrapPath:
//   - "new"                      → full transcript (the only history carrier)
//   - "reuse" | "resume" | "load"→ latest user delta only (first user after the
//                                  last assistant; the trailing-group FIRST user
//                                  so the SessionStart hook message is skipped).
//
// This gate proves the split deterministically — BEFORE the session store that
// produces the reuse paths exists, so the builder is correct the moment it is
// wired. Pure/deterministic — IN pnpm check.

import { strict as assert } from "node:assert";
import type { Context } from "@earendil-works/pi-ai";
import {
	type AcpBootstrapPath,
	buildAcpPrompt,
	contextToAcpPrompt,
	latestUserDelta,
} from "../pi-extensions/lib/acp/context.ts";

const REUSE_PATHS: AcpBootstrapPath[] = ["reuse", "resume", "load"];

// A multi-turn context: a prior turn, an assistant answer, the real latest user
// turn (with an image), and a SessionStart hook user-message appended AFTER it.
function multiTurn(): Context {
	return {
		systemPrompt: "SECRET-SYSTEM-PROMPT",
		tools: [{ name: "x", description: "d", parameters: {} as never }],
		messages: [
			{ role: "user", content: "first question", timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "an answer" }],
				api: "x",
				provider: "x",
				model: "x",
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
				content: [
					{ type: "image", data: "BASE64IMAGEDATA", mimeType: "image/png" },
					{ type: "text", text: "follow up" },
				],
				timestamp: 0,
			},
			// pi appends the SessionStart hook AFTER the real prompt — the builder
			// must NOT pick this as the latest user delta.
			{ role: "user", content: "device=thinkpad time_kst=20260618T160000", timestamp: 0 },
		],
	};
}

// ---------------------------------------------------------------------------
// 1) "new" → full transcript (identical to contextToAcpPrompt)
// ---------------------------------------------------------------------------
{
	const ctx = multiTurn();
	const prompt = buildAcpPrompt(ctx, "new");
	assert.deepEqual(prompt, contextToAcpPrompt(ctx), '"new" is the full-transcript builder');
	assert.equal(prompt.length, 1, '"new" is a single text block');
	const text = prompt[0].text;
	assert.match(text, /User: first question/, '"new" carries the prior user turn (history)');
	assert.match(text, /Assistant: an answer/, '"new" carries the assistant turn');
	assert.match(text, /follow up/, '"new" carries the latest user turn');
	assert.ok(!text.includes("SECRET-SYSTEM-PROMPT"), '"new" never leaks systemPrompt');
	assert.ok(!text.includes("BASE64IMAGEDATA"), '"new" never embeds raw image data');
}

// ---------------------------------------------------------------------------
// 2) reuse / resume / load → latest user delta ONLY
// ---------------------------------------------------------------------------
for (const path of REUSE_PATHS) {
	const ctx = multiTurn();
	const prompt = buildAcpPrompt(ctx, path);
	assert.deepEqual(prompt, latestUserDelta(ctx), `"${path}" is the delta builder`);
	assert.equal(prompt.length, 1, `"${path}" is a single text block`);
	const text = prompt[0].text;
	// Only the real latest user turn — not prior history, not the hook message.
	assert.match(text, /follow up/, `"${path}" carries the latest user turn`);
	assert.ok(!text.includes("first question"), `"${path}" excludes prior history (no duplicate injection)`);
	assert.ok(!text.includes("an answer"), `"${path}" excludes the assistant turn`);
	assert.ok(
		!text.includes("device=thinkpad"),
		`"${path}" skips the SessionStart hook user-message (trailing-group FIRST user, not last)`,
	);
	// Image still leaves a marker, never raw data.
	assert.match(text, /\[image omitted: image\/png\]/, `"${path}" keeps the image marker`);
	assert.ok(!text.includes("BASE64IMAGEDATA"), `"${path}" never embeds raw image data`);
}

// ---------------------------------------------------------------------------
// 3) delta differs from full transcript (the whole point)
// ---------------------------------------------------------------------------
{
	const ctx = multiTurn();
	assert.notDeepEqual(
		buildAcpPrompt(ctx, "reuse"),
		buildAcpPrompt(ctx, "new"),
		"reuse delta must NOT equal the full-transcript new prompt",
	);
}

// ---------------------------------------------------------------------------
// 4) no assistant yet → first user of the whole context is the delta
// ---------------------------------------------------------------------------
{
	const ctx: Context = {
		messages: [
			{ role: "user", content: "only question", timestamp: 0 },
			{ role: "user", content: "device=thinkpad time_kst=x", timestamp: 0 },
		],
	};
	const delta = latestUserDelta(ctx);
	assert.equal(delta.length, 1, "delta exists when there is a user turn");
	assert.equal(delta[0].text, "only question", "first user wins (hook message skipped) even with no assistant");
}

// ---------------------------------------------------------------------------
// 5) trailing message is assistant (no user after it) → empty delta
// ---------------------------------------------------------------------------
{
	const ctx: Context = {
		messages: [
			{ role: "user", content: "q", timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "a" }],
				api: "x",
				provider: "x",
				model: "x",
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
		],
	};
	assert.deepEqual(latestUserDelta(ctx), [], "no user after the last assistant → empty delta");
}

// ---------------------------------------------------------------------------
// 6) empty context → empty for every path
// ---------------------------------------------------------------------------
{
	const empty: Context = { messages: [] };
	assert.deepEqual(buildAcpPrompt(empty, "new"), [], "empty context → empty new prompt");
	for (const path of REUSE_PATHS) {
		assert.deepEqual(buildAcpPrompt(empty, path), [], `empty context → empty ${path} prompt`);
	}
}

// ---------------------------------------------------------------------------
// 7) unknown bootstrapPath → THROW (fail-loud, never silent delta-only)
// ---------------------------------------------------------------------------
// 핀4 safety: a bad path must crash, not quietly fall through to delta-only —
// that would lose history on a path that should carry the full transcript.
{
	const ctx = multiTurn();
	assert.throws(
		() => buildAcpPrompt(ctx, "bogus" as AcpBootstrapPath),
		/unknown bootstrapPath/,
		"unknown bootstrapPath must crash, not silently delta-only (history loss is the fail-open hazard)",
	);
}

console.log(
	"[check-acp-prompt-builder] ok — bootstrapPath scopes the prompt: new=full transcript (history carrier), " +
		"reuse/resume/load=latest user delta (first user after last assistant, SessionStart hook skipped, image marker " +
		"kept, no raw image data, prior history excluded), no-assistant/trailing-assistant/empty edges, " +
		"unknown bootstrapPath → throw (fail-loud, never silent delta-only)",
);
