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
//
// This cell owns the BODY of the render. The carrier's leading boundary is cell
// 11's axis, so the body assertions here match on the tail — a cell that pinned
// the whole string would fire first on any boundary regression and steal the
// attribution from the claim that actually owns it.
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
		assert.ok(a?.endsWith("backend=claude mcp=alpha, zebra"), "interpolates {{backend}} and SORTED {{mcp_servers}}");
		// Order of the input must not change the render (signature-stability guard).
		assert.equal(
			loadEngraving({ backend: "claude", mcpServerNames: ["alpha", "zebra"] }),
			a,
			"mcpServerNames order does not drift the rendered carrier (sorted)",
		);
		assert.ok(
			loadEngraving({ backend: "claude", mcpServerNames: [] })?.endsWith("backend=claude mcp=(none registered)"),
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
		assert.equal(
			loadEngraving({ backend: "claude", mcpServerNames: [] }),
			null,
			"[QK:CARRIER-OPT-OUT-SURVIVES-SEPARATOR] a whitespace-only override must still be the operator OPT-OUT (null), " +
				"never a carrier made of nothing but the A-join boundary. Emptiness is decided on the TRIMMED BODY, before " +
				"the leading separator is attached — attach it first and an emptied engraving file silently becomes a " +
				'non-empty "\\n\\n" carrier: the opt-out disappears, the claude_code preset gets replaced by whitespace, and ' +
				"bridgeConfigSignature folds a string the operator never wrote",
		);
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
	// (`includes`, not `equal`: the leading A-join boundary is cell 11's axis.)
	assert.ok(
		loadEngraving({ backend: "claude", mcpServerNames: [] })?.includes("# Engraving Here"),
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

// ===========================================================================
// 11) A-JOIN — the carrier owns its own leading boundary.
//
// Measured LIVE 2026-07-31 (0.64.0 adapter, fresh Claude ACP): the system prompt
// reached the model as
//   `You are a Claude agent, built on Anthropic's Claude Agent SDK.# Engraving Here`
// A string-form `_meta.systemPrompt` REPLACES the claude_code preset
// (acp-agent.js), but the SDK still prefixes its own fixed identity sentence and
// joins the two with NOTHING — the operator's heading was swallowed into the tail
// of that sentence.
//
// The fix cannot live in engraving.md. The render is trimmed (cell 1's
// determinism guard: operator file whitespace must not drift
// bridgeConfigSignature), so a leading blank line in the markdown is eaten before
// it ever reaches the wire. These cells pin the boundary where it can survive —
// in the LOADER — and pin the two ways it can be lost again: an opt-out turned
// into a whitespace carrier (cell 2), and a downstream normalize at the meta hop.
// ===========================================================================
{
	// The exact sentence measured on the wire. Only its CONCATENATION is our
	// contract — the SDK owns the wording and may change it; what may not change
	// is that our carrier starts a block of its own after whatever precedes it.
	const SDK_FIXED_SENTENCE = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

	const bare = join(tmp, "bare-engraving.md");
	writeFileSync(bare, "# Operator Engraving");
	const padded = join(tmp, "padded-engraving.md");
	writeFileSync(padded, "\n\n\n# Operator Engraving\n\n");

	const prev = process.env.ENTWURF_ACP_ENGRAVING_PATH;
	let bareCarrier: string | null;
	let paddedCarrier: string | null;
	try {
		process.env.ENTWURF_ACP_ENGRAVING_PATH = bare;
		bareCarrier = loadEngraving({ backend: "claude", mcpServerNames: [] });
		process.env.ENTWURF_ACP_ENGRAVING_PATH = padded;
		paddedCarrier = loadEngraving({ backend: "claude", mcpServerNames: [] });
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		else process.env.ENTWURF_ACP_ENGRAVING_PATH = prev;
	}

	const shipped = loadEngraving({ backend: "claude", mcpServerNames: [] });
	assert.ok(shipped, "shipped carrier is present (fail-loud lever)");
	assert.equal(
		loadEngraving({ backend: "claude", mcpServerNames: [] }),
		shipped,
		"the bounded shipped carrier is still a pure function of its inputs (no per-call drift → no per-turn rebuild)",
	);

	// Reproduce the SDK join with NO glue of our own — the exact concatenation
	// acp-agent.js performs — and read the result the way the model does. The
	// operator-override row is what proves the boundary is the LOADER's: that file
	// carries no leading whitespace at all.
	for (const [what, carrier] of [
		["shipped default", shipped as string],
		["operator override with no leading whitespace", bareCarrier as string],
	] as const) {
		const joined = `${SDK_FIXED_SENTENCE}${carrier}`;
		const lines = joined.split("\n");
		assert.ok(
			lines[0] === SDK_FIXED_SENTENCE && lines[1] === "" && (lines[2]?.length ?? 0) > 0,
			`[QK:CARRIER-LEADS-ITS-OWN-BLOCK] the ${what} must open its own block after the fixed SDK sentence. The SDK ` +
				"concatenates that sentence with a string `_meta.systemPrompt` and puts NOTHING between them, and the render " +
				"is trimmed, so the boundary has to come from the loader — measured 2026-07-31 as the swallowed heading " +
				`\`…Claude Agent SDK.# Engraving Here\`, which is what taught the model its engraving was part of the SDK's ` +
				`own sentence. Joined: ${JSON.stringify(joined.slice(0, 160))}`,
		);
	}

	// …and the boundary is a loader CONSTANT: whatever the operator's file leads
	// with, the carrier reads the same. Otherwise file whitespace would drift the
	// carrier and, through appendSystemPrompt, the reuse signature.
	assert.equal(
		paddedCarrier,
		bareCarrier,
		"template leading/trailing whitespace never reaches the carrier — the boundary is ours, not the file's",
	);
	assert.equal(bareCarrier, "\n\n# Operator Engraving", "the boundary is exactly one blank line + the trimmed body");

	// TINY is the billing axis, not a style rule (engraving.ts header): size, not
	// shape, is what reclassifies a Claude OAuth subscription call as metered
	// "extra usage". The boundary costs 2 bytes; the shipped carrier stays a
	// placeholder and rich context keeps riding the first-user augment.
	const CARRIER_BUDGET_BYTES = 512;
	const shippedBytes = Buffer.byteLength(shipped as string, "utf8");
	assert.ok(
		shippedBytes <= CARRIER_BUDGET_BYTES,
		`[QK:CARRIER-STAYS-TINY] the SHIPPED carrier must stay under ${CARRIER_BUDGET_BYTES} bytes — a carrier that grows ` +
			"materially past the SDK-default size routes subscription (OAuth) calls to metered extra usage, which is an " +
			"HTTP 400 for an operator with no metered balance. AGENTS.md, the bridge narrative and tool catalogs ride the " +
			`first-user-message augment, never this carrier. Got ${shippedBytes} bytes: ` +
			`${JSON.stringify((shipped as string).slice(0, 200))}`,
	);

	// The LAST hop. backend.ts folds the loadCarrier result into
	// bridgeConfigSignature (`appendSystemPrompt`) and hands the SAME string to
	// buildSessionMeta. A normalize here would strip the boundary back off on the
	// wire while the signature still folded the bounded value: the A-join returns
	// invisibly AND reuse keys on a string that was never sent.
	const metaFromShipped = buildClaudeSessionMeta(
		{
			modelId: "claude-x",
			tools: ["Read"],
			permissionAllow: ["Read(*)"],
			disallowedTools: [],
			settingSources: [],
			strictMcpConfig: false,
			skillPlugins: [],
		},
		shipped as string,
	);
	assert.equal(
		metaFromShipped.systemPrompt,
		shipped,
		"[QK:CARRIER-META-SENDS-CARRIER-VERBATIM] `_meta.systemPrompt` must be the loader's string BYTE-FOR-BYTE. " +
			"backend.ts folds that same string into bridgeConfigSignature's appendSystemPrompt slot, so any normalize at " +
			"this hop desynchronizes the wire from the signature — reuse would key on a carrier the backend never received, " +
			`and a trim in particular re-opens the A-join with every gate above still green. Got ${JSON.stringify(metaFromShipped.systemPrompt)}`,
	);

	// The boundary is signature-relevant, which is what makes the desync above
	// detectable at all: a build that silently dropped it is judged INCOMPATIBLE
	// (fresh ACP session with the corrected carrier), never quietly reused.
	const sigBase = {
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
	assert.notEqual(
		bridgeConfigSignature({ ...sigBase, appendSystemPrompt: shipped as string }),
		bridgeConfigSignature({ ...sigBase, appendSystemPrompt: (shipped as string).trim() }),
		"the boundary is part of the reuse signature — dropping it invalidates a live session instead of passing unnoticed",
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
		"undefined), and carrier/augment stay disjoint; A-join: the carrier opens its own block after the SDK's fixed " +
		"sentence, the boundary is a loader constant (not the template's whitespace, which trim eats) and does not " +
		"resurrect an opted-out carrier, the shipped carrier stays under the tiny budget, and the meta hop sends the " +
		"loader string byte-for-byte so the wire and the reuse signature cannot desynchronize",
);
