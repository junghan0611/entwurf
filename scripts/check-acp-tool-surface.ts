// Deterministic gate for the S2b Claude tool surface + truthfulness preflight.
//
// Matrix over assertExcludeToolsHonored (the preflight truthfulness check — NOT
// a wire read) and a shape lock on buildClaudeSessionMeta, including the carrier
// absent-branch guard (no _meta.systemPrompt unless a caller passes one). The
// shipped path passes the non-empty v1 engraving from loadEngraving.
//
// Pure/deterministic — IN pnpm check.

import { strict as assert } from "node:assert";
import {
	assertExcludeToolsHonored,
	buildClaudeSessionMeta,
	DEFAULT_CLAUDE_DISALLOWED_TOOLS,
	DEFAULT_CLAUDE_PERMISSION_ALLOW,
	DEFAULT_CLAUDE_TOOLS,
	PI_BUILTIN_BACKED_TOOLS,
} from "../pi-extensions/lib/acp/tool-surface.ts";

// ---------------------------------------------------------------------------
// assertExcludeToolsHonored — matrix
// ---------------------------------------------------------------------------

const claudeSurface = { backend: "claude" as const, tools: DEFAULT_CLAUDE_TOOLS };

// 1) full baseline active (+ an extension tool) → honored, no throw.
assert.doesNotThrow(
	() => assertExcludeToolsHonored([...PI_BUILTIN_BACKED_TOOLS, "entwurf"], claudeSurface),
	"full baseline + extension active must be honored",
);

// 2) pi excluded `read` while Claude still receives `Read` → divergence, throw.
let threw = false;
try {
	assertExcludeToolsHonored(["bash", "edit", "write"], claudeSurface);
} catch (err) {
	threw = true;
	assert.match(
		String((err as Error).message),
		/cannot honor --exclude-tools \(read\)/,
		"message must name the unhonored tool",
	);
	assert.match(
		String((err as Error).message),
		/provider settings 'tools' \/ 'disallowedTools'/,
		"message must point at the claude remedy",
	);
}
assert.ok(threw, "excluding a backend-exposed builtin (read) must throw");

// 3) excluded `read` AND removed `Read` from the backend tools → honest, no throw.
assert.doesNotThrow(
	() => assertExcludeToolsHonored(["bash", "edit", "write"], { backend: "claude", tools: ["Bash", "Edit", "Write"] }),
	"removing Read from the backend surface makes excluding `read` honest",
);

// 4) only an extension tool excluded (entwurf), all builtins active → honored.
assert.doesNotThrow(
	() => assertExcludeToolsHonored([...PI_BUILTIN_BACKED_TOOLS], claudeSurface),
	"excluding only extension tools never trips the guard",
);

// 5) multi-tool divergence → plural phrasing.
let multiThrew = false;
try {
	assertExcludeToolsHonored(["edit", "write"], claudeSurface);
} catch (err) {
	multiThrew = true;
	assert.match(String((err as Error).message), /\(read, bash\)/, "message must list all unhonored tools");
	assert.match(String((err as Error).message), /these capabilities/, "plural phrasing for multiple tools");
}
assert.ok(multiThrew, "multiple excluded builtins must throw");

// 6) non-claude backend assumes native exposure of the full builtin set.
let nativeThrew = false;
try {
	assertExcludeToolsHonored(["read", "bash", "edit"], { backend: "codex", tools: [] });
} catch (err) {
	nativeThrew = true;
	assert.match(
		String((err as Error).message),
		/\(write\)/,
		"native backend exposes the full builtin set regardless of tools",
	);
}
assert.ok(nativeThrew, "non-claude backend exposing write natively must throw when pi excludes it");

// ---------------------------------------------------------------------------
// buildClaudeSessionMeta — shape lock
// ---------------------------------------------------------------------------

const baseParams = {
	modelId: "claude-sonnet-4-6",
	tools: DEFAULT_CLAUDE_TOOLS,
	permissionAllow: DEFAULT_CLAUDE_PERMISSION_ALLOW,
	disallowedTools: DEFAULT_CLAUDE_DISALLOWED_TOOLS,
	settingSources: [] as string[],
	strictMcpConfig: false,
	skillPlugins: [] as string[],
};

const meta = buildClaudeSessionMeta(baseParams);
const opts = (meta.claudeCode as { options: Record<string, unknown> }).options;
assert.equal(opts.model, "claude-sonnet-4-6", "model must propagate");
assert.deepEqual(opts.tools, [...DEFAULT_CLAUDE_TOOLS], "tools must propagate (copied)");
assert.deepEqual(
	(opts.settings as { permissions: { allow: string[] } }).permissions.allow,
	[...DEFAULT_CLAUDE_PERMISSION_ALLOW],
	"permission allow must propagate",
);
// Auto-memory containment seal (Detour C). Assert the opt-out is IN THE META, not
// only in the overlay settings.json — production runs `settingSources: []` (SDK
// filesystem isolation), so the overlay copy never reaches the query; this inline
// settings layer is the one the query actually honors. `check-acp-overlay.ts`
// asserts the file copy; THIS asserts the live wire value.
assert.equal(
	(opts.settings as { autoMemoryEnabled?: unknown }).autoMemoryEnabled,
	false,
	"auto-memory containment: _meta.claudeCode.options.settings.autoMemoryEnabled must be false (live seal, survives settingSources:[])",
);
assert.deepEqual(
	opts.disallowedTools,
	[...DEFAULT_CLAUDE_DISALLOWED_TOOLS],
	"non-empty disallowedTools must propagate",
);

// Carrier contract: NO systemPrompt key unless a caller supplies one (the absent
// opt-out branch; the shipped default DOES supply the non-empty v1 engraving lever).
assert.ok(!("systemPrompt" in meta), "no-carrier-arg branch must omit _meta.systemPrompt (absent → no key)");

// empty disallowedTools → field omitted entirely (full opt-out).
const metaNoDisallow = buildClaudeSessionMeta({ ...baseParams, disallowedTools: [] });
const optsNoDisallow = (metaNoDisallow.claudeCode as { options: Record<string, unknown> }).options;
assert.ok(!("disallowedTools" in optsNoDisallow), "empty disallowedTools must be omitted, not sent as []");

// strictMcpConfig → extraArgs flag; skillPlugins → local plugin entries.
const metaStrict = buildClaudeSessionMeta({
	...baseParams,
	strictMcpConfig: true,
	skillPlugins: ["/abs/skill-a"],
});
const optsStrict = (metaStrict.claudeCode as { options: Record<string, unknown> }).options;
assert.deepEqual(optsStrict.extraArgs, { "strict-mcp-config": null }, "strictMcpConfig must emit the extraArgs flag");
assert.deepEqual(
	optsStrict.plugins,
	[{ type: "local", path: "/abs/skill-a" }],
	"skillPlugins must map to local plugin entries",
);

// explicit carrier passes through ONLY when supplied (S2d path — exercised here
// for completeness, never used by S2b callers).
const metaCarrier = buildClaudeSessionMeta(baseParams, "CARRIER");
assert.equal(metaCarrier.systemPrompt, "CARRIER", "an explicit carrier must pass through when supplied");

console.log(
	"[check-acp-tool-surface] ok — exclude-tools truthfulness matrix (claude narrows / native always-exposes / extension-free) " +
		"+ buildClaudeSessionMeta shape (tools/allow/disallowed/extraArgs/plugins) + carrier absent-branch guard " +
		"+ auto-memory containment seal (settings.autoMemoryEnabled=false IN THE META, live under settingSources:[])",
);
