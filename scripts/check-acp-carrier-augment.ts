// Deterministic gate for the S2d-1c billing carrier (engraving) + first-user
// augment. Separate axis from check-acp-session-reuse (GPT c32a6c8): reuse owns
// session lifecycle; THIS owns the two prompt-shaping surfaces.
//
// The two hard invariants it locks (NEXT §S2-scout 핀1 / §S2d gate ②③):
//   - the carrier (`_meta.systemPrompt`) is SHORT, NON-EMPTY by default (the v1
//     preset-replacement memory-containment lever), a PURE function of
//     (template, backend, sorted mcpServerNames), and folds into
//     bridgeConfigSignature so a carrier change invalidates reuse but a stable
//     carrier never forces a per-turn rebuild;
//   - the rich augment rides the `new` prompt on the WIRE only — never the pi
//     Context — so it never enters contextMessageSignatures, and an entwurf
//     prompt that already carries cwd/AGENTS.md gets exactly that one section
//     de-duped (nothing else).
// Pure + temp-dir fs, no spawn/child — IN pnpm check.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/pi-ai";
import {
	buildPiContextAugment,
	prependNewPromptAugment,
	promptCarriesEntwurfCwdContext,
	removeCwdAgentsSectionFromAugment,
} from "../pi-extensions/lib/acp/augment.ts";
import { buildAcpPrompt, contextToAcpPrompt } from "../pi-extensions/lib/acp/context.ts";
import { loadEngraving } from "../pi-extensions/lib/acp/engraving.ts";
import { bridgeConfigSignature, contextMessageSignatures } from "../pi-extensions/lib/acp/session-store.ts";
import { buildClaudeSessionMeta } from "../pi-extensions/lib/acp/tool-surface.ts";
import { ENTWURF_PROJECT_CONTEXT_OPEN_TAG } from "../protocol.js";

const tmp = mkdtempSync(join(tmpdir(), "acp-carrier-augment-"));
const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));
const BRIDGE_MARK = "operating through entwurf";

// ===========================================================================
// 1) loadEngraving is pure/deterministic + interpolates backend/mcp (sorted)
// ===========================================================================
{
	const file = join(tmp, "engraving.md");
	writeFileSync(file, "backend={{backend}} mcp={{mcp_servers}}\n");
	const prev = process.env.ENTWURF_ACP_ENGRAVING_PATH;
	process.env.ENTWURF_ACP_ENGRAVING_PATH = file;
	try {
		const a = loadEngraving({ backend: "claude", mcpServerNames: ["zebra", "alpha"] });
		const b = loadEngraving({ backend: "claude", mcpServerNames: ["zebra", "alpha"] });
		assert.equal(a, b, "loadEngraving is deterministic: same inputs → same output");
		assert.equal(a, "backend=claude mcp=alpha, zebra", "interpolates {{backend}} and SORTED {{mcp_servers}}");
		// Order of the input must not change the render (signature-stability guard).
		assert.equal(
			loadEngraving({ backend: "claude", mcpServerNames: ["alpha", "zebra"] }),
			a,
			"mcpServerNames order does not drift the rendered carrier (sorted)",
		);
		assert.equal(
			loadEngraving({ backend: "claude", mcpServerNames: [] }),
			"backend=claude mcp=(none registered)",
			"no mcp servers → (none registered)",
		);
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		else process.env.ENTWURF_ACP_ENGRAVING_PATH = prev;
	}
}

// ===========================================================================
// 2) empty/whitespace/missing → null; shipped default → the non-empty v1 lever;
//    buildClaudeSessionMeta omits the systemPrompt key when carrier absent
// ===========================================================================
{
	const metaParams = {
		modelId: "claude-x",
		tools: ["Read"],
		permissionAllow: ["Read(*)"],
		disallowedTools: [],
		settingSources: [],
		strictMcpConfig: false,
		skillPlugins: [],
	};

	const whitespace = join(tmp, "blank.md");
	writeFileSync(whitespace, "   \n\t\n");
	const prev = process.env.ENTWURF_ACP_ENGRAVING_PATH;
	process.env.ENTWURF_ACP_ENGRAVING_PATH = whitespace;
	try {
		assert.equal(loadEngraving({ backend: "claude", mcpServerNames: [] }), null, "whitespace-only template → null");
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		else process.env.ENTWURF_ACP_ENGRAVING_PATH = prev;
	}

	process.env.ENTWURF_ACP_ENGRAVING_PATH = join(tmp, "does-not-exist.md");
	try {
		assert.equal(loadEngraving({ backend: "claude", mcpServerNames: [] }), null, "missing/unreadable template → null");
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		else process.env.ENTWURF_ACP_ENGRAVING_PATH = prev;
	}

	// No override → the shipped default prompts/engraving.md is NON-EMPTY (the v1
	// engraving lever): a string carrier is emitted, which makes claude-agent-acp
	// REPLACE its `claude_code` preset with this string (acp-agent.js: string-form
	// `_meta.systemPrompt` → full preset replacement). That replacement is what
	// strips the preset's auto-memory section so the model never learns it has a
	// per-session memory store — the memory containment v1 shipped, restored here.
	assert.equal(
		loadEngraving({ backend: "claude", mcpServerNames: [] }),
		"# Engraving Here",
		"shipped default engraving is the non-empty v1 lever → string carrier (preset replaced, auto-memory stripped)",
	);

	// carrier absent (undefined) → NO systemPrompt key at all.
	const metaAbsent = buildClaudeSessionMeta(metaParams, undefined);
	assert.ok(!("systemPrompt" in metaAbsent), "carrier absent opt-out → _meta has NO systemPrompt key");
	// carrier present → the exact string is the systemPrompt.
	const metaPresent = buildClaudeSessionMeta(metaParams, "tiny carrier");
	assert.equal(metaPresent.systemPrompt, "tiny carrier", "carrier present → _meta.systemPrompt is the rendered string");
}

// ===========================================================================
// 3) a carrier change changes bridgeConfigSignature (invalidates reuse)
// ===========================================================================
{
	const base = {
		backend: "claude" as const,
		modelId: "claude-x",
		nativeModelId: "claude-x",
		mcpServersHash: "deadbeef",
		settingSources: [],
		strictMcpConfig: true,
		tools: ["Read", "Bash", "Edit", "Write"],
		skillPlugins: [],
		permissionAllow: ["Read(*)"],
		disallowedTools: [],
	};
	const absent = bridgeConfigSignature({ ...base, appendSystemPrompt: "" });
	const present = bridgeConfigSignature({ ...base, appendSystemPrompt: "# carrier" });
	assert.notEqual(absent, present, "carrier change → different config signature (a drifted carrier invalidates reuse)");
	// stable carrier → stable signature (no per-turn rebuild)
	assert.equal(
		bridgeConfigSignature({ ...base, appendSystemPrompt: "# carrier" }),
		present,
		"same carrier → same signature (a stable carrier never forces a rebuild)",
	);
}

// ===========================================================================
// helper: a context whose first user message is `firstUser`
// ===========================================================================
function ctxWith(firstUser: string): Context {
	return {
		messages: [
			{ role: "user", content: firstUser, timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
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
			{ role: "user", content: "latest turn", timestamp: 0 },
		],
	};
}

// ===========================================================================
// 4) augment is prepended on the `new` prompt; the `reuse` delta has none
// ===========================================================================
{
	const ctx = ctxWith("hello");
	const newBlocks = prependNewPromptAugment(buildAcpPrompt(ctx, "new"), {
		backend: "claude",
		cwd: tmp,
		mcpServerNames: [],
		homeDir: tmp,
	});
	assert.ok(newBlocks.length >= 2, "new prompt = augment block + transcript block(s)");
	assert.ok(newBlocks[0].text.includes(BRIDGE_MARK), "new prompt block 0 is the bridge-identity augment");
	assert.ok(
		newBlocks.some((b) => b.text.includes("latest turn")),
		"the original transcript is preserved after the augment",
	);

	// The reuse path (backend never calls prependNewPromptAugment on reuse) is the
	// bare delta — no augment. Proven by the builder output itself.
	const reuse = buildAcpPrompt(ctx, "reuse");
	assert.ok(
		reuse.every((b) => !b.text.includes(BRIDGE_MARK)),
		"reuse delta carries NO augment (once-only: augment rides `new` only)",
	);
}

// ===========================================================================
// 5) the augment NEVER enters contextMessageSignatures (wire-only, no mutation)
// ===========================================================================
{
	const ctx = ctxWith("hello");
	const before = contextMessageSignatures(ctx);
	prependNewPromptAugment(buildAcpPrompt(ctx, "new"), {
		backend: "claude",
		cwd: tmp,
		mcpServerNames: [],
		homeDir: tmp,
	});
	const after = contextMessageSignatures(ctx);
	assert.deepEqual(after, before, "prepending the augment does NOT mutate the Context → sigs unchanged (gate ②)");
	// And the full transcript builder is itself augment-free (augment is added later).
	assert.ok(
		contextToAcpPrompt(ctx).every((b) => !b.text.includes(BRIDGE_MARK)),
		"buildAcpPrompt(new) alone carries no augment — it is a pure wire-level prepend",
	);
}

// ===========================================================================
// 6) & 7) entwurf cwd/AGENTS.md de-dup — present → drop ONLY that section;
//          absent → keep it. Home AGENTS.md always survives.
// ===========================================================================
{
	const home = mkdtempSync(join(tmpdir(), "acp-home-"));
	const proj = mkdtempSync(join(tmpdir(), "acp-proj-"));
	writeFileSync(join(home, "AGENTS.md"), "HOME-AGENTS-CONTENT");
	writeFileSync(join(proj, "AGENTS.md"), "CWD-AGENTS-CONTENT");

	const cwdHeading = `## ${join(proj, "AGENTS.md")}`;
	const homeHeading = `## ${join(home, "AGENTS.md")}`;
	const augParams = { backend: "claude" as const, cwd: proj, mcpServerNames: [], homeDir: home };

	// Full augment carries BOTH AGENTS sections.
	const full = buildPiContextAugment(augParams);
	assert.ok(full.includes(homeHeading), "augment carries the home AGENTS.md section");
	assert.ok(full.includes(cwdHeading), "augment carries the cwd AGENTS.md section");

	// (7) plain prompt, no entwurf marker → cwd section kept.
	const plain = prependNewPromptAugment(buildAcpPrompt(ctxWith("just a question"), "new"), augParams);
	assert.ok(plain[0].text.includes(cwdHeading), "no entwurf marker → cwd AGENTS.md section is kept");

	// (6) entwurf-spawned first user → marker present → cwd section dropped, home kept.
	// Marker built from the SAME constant production uses (entwurf-core enrich +
	// augment promptCarriesEntwurfCwdContext), so a future ENTWURF_PROJECT_CONTEXT_OPEN_TAG
	// change cannot leave this gate green while real de-dup breaks (GPT c32a6c8 amber B).
	const entwurfFirst = `${ENTWURF_PROJECT_CONTEXT_OPEN_TAG} path="${join(proj, "AGENTS.md")}">\nCWD-AGENTS-CONTENT\n</project-context>\n\ndo the task`;
	const ctxE = ctxWith(entwurfFirst);
	const promptText = contextToAcpPrompt(ctxE)
		.map((b) => b.text)
		.join("\n");
	assert.ok(promptCarriesEntwurfCwdContext(promptText, proj), "detects the entwurf cwd project-context marker");
	const deduped = prependNewPromptAugment(buildAcpPrompt(ctxE, "new"), augParams);
	assert.ok(
		!deduped[0].text.includes(cwdHeading),
		"entwurf marker present → cwd AGENTS.md section de-duped from augment",
	);
	assert.ok(deduped[0].text.includes(homeHeading), "de-dup keeps the home AGENTS.md section");
	assert.ok(deduped[0].text.includes(BRIDGE_MARK), "de-dup keeps the bridge identity");

	// the pure remover is a no-op when the section is absent
	assert.equal(
		removeCwdAgentsSectionFromAugment("no project context here", proj),
		"no project context here",
		"removeCwdAgentsSectionFromAugment is a no-op when there is no cwd section",
	);
}

// ===========================================================================
// 8) day-granularity date (no clock time) + 50KB truncation
// ===========================================================================
{
	const aug = buildPiContextAugment({ backend: "claude", cwd: tmp, mcpServerNames: [], homeDir: tmp });
	const dateLine = aug.split("\n").find((l) => l.startsWith("Current date:"));
	assert.ok(dateLine, "augment carries a Current date line");
	assert.match(dateLine as string, /^Current date: \d{4}-\d{2}-\d{2}$/, "date is day-granularity only (no clock time)");

	// > 50KB cwd AGENTS.md → augment truncated with the marker.
	const bigHome = mkdtempSync(join(tmpdir(), "acp-big-"));
	writeFileSync(join(bigHome, "AGENTS.md"), "X".repeat(80 * 1024));
	const big = buildPiContextAugment({ backend: "claude", cwd: tmp, mcpServerNames: [], homeDir: bigHome });
	assert.ok(Buffer.byteLength(big, "utf8") <= 50 * 1024, "augment is truncated to the 50KB cap");
	assert.match(
		big,
		/context augment truncated to \d+ bytes/,
		"truncation leaves an honest marker [QK:AUGMENT-TRUNC-MARKER]",
	);
}

// ===========================================================================
// 9) The shipped repo AGENTS.md fits with a realistic operator-global budget.
//    This guards the real 2026-07-27 failure: project AGENTS.md alone exceeded
//    the cap, tail-cutting its own later rules plus Current date/cwd. The cap
//    remains an honest fallback; the maintained package prompt must not hit it.
// ===========================================================================
{
	const budgetHome = mkdtempSync(join(tmpdir(), "acp-budget-home-"));
	writeFileSync(join(budgetHome, "AGENTS.md"), "H".repeat(12 * 1024));
	const actual = buildPiContextAugment({
		backend: "claude",
		cwd: REPO_DIR,
		mcpServerNames: ["entwurf-bridge"],
		homeDir: budgetHome,
	});
	assert.doesNotMatch(
		actual,
		/context augment truncated/,
		"repo AGENTS.md + 12KB global baseline fits without truncation [QK:AUGMENT-BUDGET-FITS]",
	);
	assert.ok(
		actual.includes(`Current working directory: ${REPO_DIR}`),
		"non-truncated augment retains the trailing cwd fact",
	);
}

// ===========================================================================
// 10) CARRIER PROVENANCE — the augment states what it is, per rail.
//
// Measured 2026-07-30: asked where its instructions came from, the Claude ACP
// model reported the bridge-identity and task-stance paragraphs as its SYSTEM
// prompt. They are a first-user-message prepend. The model was not lying — on
// the wire it cannot tell a long first user message from a system prompt, and
// nothing in the block said which it was. The rails also differ for real
// (backend-adapter.ts: claude's buildSessionMeta carries `_meta.systemPrompt`;
// cortex's returns undefined so no `_meta` is sent), so ONE generic sentence
// would be false on one of them.
//
// What this pins is a STATEABILITY claim, not an obedience claim: the boundary
// must be present and rail-correct in the text the model reads. It cannot make
// a model answer honestly — it removes the excuse that it had no way to know.
// ===========================================================================
{
	const claudeAug = buildPiContextAugment({ backend: "claude", cwd: tmp, mcpServerNames: [], homeDir: tmp });
	const cortexAug = buildPiContextAugment({ backend: "cortex", cwd: tmp, mcpServerNames: [], homeDir: tmp });

	for (const [rail, aug] of [
		["claude", claudeAug],
		["cortex", cortexAug],
	] as const) {
		assert.ok(
			aug.includes("prepended to the FIRST USER MESSAGE of this session. It is not your system prompt."),
			`[QK:CARRIER-PROVENANCE-STATED] the ${rail} augment must say what it IS (first-user-message text) and what it ` +
				"is NOT (the system prompt) — without that line a model reading it has no way to attribute it, and the " +
				"measured failure was exactly that misattribution",
		);
		assert.ok(
			aug.indexOf("# entwurf: where this text comes from") < aug.indexOf(BRIDGE_MARK),
			`the ${rail} provenance frame precedes the bridge narrative it is about`,
		);
	}

	// Rail-correct, not generic: claude names its carrier and scopes it to the
	// engraving; cortex denies having one at all.
	assert.ok(
		claudeAug.includes("does have a system-prompt carrier (`_meta.systemPrompt`)") &&
			claudeAug.includes("it carries the operator engraving only"),
		"[QK:CARRIER-FRAME-NAMES-CLAUDE-CARRIER] the claude frame must name the real carrier AND scope it to the engraving — " +
			`saying only "this is not your system prompt" leaves the model to guess what the system prompt then is. Got: ${JSON.stringify(claudeAug.slice(0, 500))}`,
	);
	assert.ok(
		cortexAug.includes("carries no system-prompt carrier at all") &&
			!cortexAug.includes("does have a system-prompt carrier"),
		"[QK:CARRIER-FRAME-DENIES-CORTEX-CARRIER] the cortex frame must deny the carrier — cortex's buildSessionMeta returns " +
			`undefined so no _meta is sent; claiming a tiny carrier there would be a lie. Got: ${JSON.stringify(cortexAug.slice(0, 500))}`,
	);

	// The rail difference is not a doc claim — it is in the adapter source.
	const adapterSrc = readFileSync(join(REPO_DIR, "pi-extensions/lib/acp/backend-adapter.ts"), "utf8");
	const cortexAt = adapterSrc.indexOf('backend: "cortex"');
	assert.ok(cortexAt > 0, "backend-adapter.ts still declares the cortex adapter");
	assert.match(
		adapterSrc.slice(cortexAt),
		/buildSessionMeta\(\)\s*\{\s*return undefined;/,
		"[QK:CARRIER-RAIL-DIFF-IS-SOURCE-PINNED] cortex's buildSessionMeta must still return undefined — the source fact the " +
			"cortex frame's 'no carrier at all' sentence rests on. If this ever grows a carrier, the frame becomes a lie.",
	);

	// DISJOINT SURFACES: the thing the model is told is its system prompt (the
	// engraving) must not contain the narrative it is told is user text. If the
	// two ever overlapped, the frame would be unfalsifiable prose.
	const shippedCarrier = loadEngraving({ backend: "claude", mcpServerNames: [] });
	assert.ok(shippedCarrier, "shipped carrier is present (fail-loud lever)");
	assert.ok(
		!(shippedCarrier as string).includes(BRIDGE_MARK) && !claudeAug.includes(shippedCarrier as string),
		`the claude carrier and the augment must stay disjoint — the carrier carries the ` +
			`engraving only and the augment carries the narrative, which is precisely what the provenance frame tells the ` +
			`model. Carrier: ${JSON.stringify(shippedCarrier)}`,
	);
}

console.log(
	"[check-acp-carrier-augment] ok — engraving carrier: pure/deterministic, sorted mcp interpolation, " +
		"empty/whitespace/missing → null, shipped-default → non-empty v1 lever (preset replaced), carrier absent → no _meta.systemPrompt key, carrier change → " +
		"signature change (stable carrier → stable signature); augment: prepended on `new` only (reuse delta has none), " +
		"wire-only so it never enters contextMessageSignatures, entwurf cwd/AGENTS.md de-dup (present → drop only that " +
		"section, home kept; absent → kept), day-granularity date, 50KB truncation marker, shipped AGENTS budget; " +
		"provenance: both rails state the augment is first-user-message text and not the system prompt, claude names its " +
		"tiny engraving-only carrier while cortex denies having one (pinned against cortexAdapter.buildSessionMeta → " +
		"undefined), and carrier/augment stay disjoint",
);
