// ACP plugin — Claude tool surface + exclude-tools truthfulness preflight (S2b).
//
// Two jobs:
//   1. The curated Claude tool surface the bridge declares to claude-agent-acp
//      via `_meta.claudeCode.options` (tools / permission allow / disallowed),
//      built by `buildClaudeSessionMeta`.
//   2. `assertExcludeToolsHonored` — a PREFLIGHT truthfulness check, NOT a wire
//      read. There is no stable ACP surface that reports the backend's ACTUAL
//      tool list (GPT S2b Q2), so the effective config WE supply is the SSOT:
//      if pi has excluded a built-in the backend will still expose, the declared
//      surface diverges from the actual one — we fail fast rather than lie.
//
// Claude-only scope (NEXT §스코프). The function keeps a `backend` field so the
// honest-divergence logic stays explicit and the matrix gate can exercise both
// the "claude narrows via tools" and "native always exposes" branches, but the
// only backend this lane supplies is claude.
//
// Carrier guard (NEXT §S2-scout 핀1): `buildClaudeSessionMeta` only attaches
// `_meta.systemPrompt` when a caller passes one. The shipped S2d path passes the
// tiny non-empty engraving carrier (v1 preset replacement / memory containment);
// an absent argument remains a true opt-out branch. Rich context is never carried
// here — it rides the S2d first-user-message augment.

/**
 * pi baseline tools (Claude-capitalized) — mirrors what pi advertises as
 * "Available tools:". Lowercase pi names map 1:1; keeping them aligned is the
 * whole point of the truthfulness constraint.
 */
export const DEFAULT_CLAUDE_TOOLS: readonly string[] = ["Read", "Bash", "Edit", "Write"];

/** Permission allow list = the baseline surface + `mcp__*` (bridge MCP auto-allow). */
export const DEFAULT_CLAUDE_PERMISSION_ALLOW: readonly string[] = [
	"Read(*)",
	"Bash(*)",
	"Edit(*)",
	"Write(*)",
	"mcp__*",
];

/**
 * Deferred/extra tools the SDK advertises (via the ToolSearch system-reminder)
 * that pi does NOT advertise in its fixed baseline — disallow them so the
 * declared-vs-actual surfaces match. pi's own equivalents cover each
 * (Cron→/schedule, Web→brave-search/summarize, Task+RemoteTrigger→entwurf, …).
 * When the SDK adds a deferred tool, this list must follow.
 */
export const DEFAULT_CLAUDE_DISALLOWED_TOOLS: readonly string[] = [
	"AskUserQuestion",
	"CronCreate",
	"CronDelete",
	"CronList",
	"EnterPlanMode",
	"EnterWorktree",
	"ExitPlanMode",
	"ExitWorktree",
	"Monitor",
	"NotebookEdit",
	"PushNotification",
	"RemoteTrigger",
	"TaskCreate",
	"TaskGet",
	"TaskList",
	"TaskOutput",
	"TaskStop",
	"TaskUpdate",
	"WebFetch",
	"WebSearch",
];

/**
 * pi built-in tool names (lowercase) that map 1:1 onto a backend capability the
 * ACP child ALWAYS provides. Extension tools (entwurf_v2, entwurf_peers, …) are
 * pi-side and never reach the backend — excluding THEM is honest, so they are
 * deliberately not listed here.
 */
export const PI_BUILTIN_BACKED_TOOLS: readonly string[] = ["read", "bash", "edit", "write"];

/** The effective backend tool surface — the SSOT for the truthfulness preflight. */
export interface ResolvedToolSurface {
	backend: "claude" | (string & {});
	/** What the backend will receive (Claude-capitalized for the claude backend). */
	tools: readonly string[];
}

/**
 * Fail-fast on a tool-surface lie. If pi has excluded a built-in the backend
 * will still expose, the declared surface diverges from the actual one — reject
 * up front instead of telling the model a tool is gone while the backend can
 * still run it. Pure function (no IO).
 *
 * - Claude: backend builtins = `resolved.tools` ∩ the pi-backed builtin set
 *   (lowercased). Drop `Read` from `tools` and excluding `read` becomes honest.
 * - Other backends: assumed to always expose the full builtin set natively.
 */
export function assertExcludeToolsHonored(activeToolNames: readonly string[], resolved: ResolvedToolSurface): void {
	const active = new Set(activeToolNames);
	const backendBuiltins =
		resolved.backend === "claude"
			? resolved.tools.map((t) => t.toLowerCase()).filter((t) => PI_BUILTIN_BACKED_TOOLS.includes(t))
			: [...PI_BUILTIN_BACKED_TOOLS];
	const unhonored = backendBuiltins.filter((t) => !active.has(t));
	if (unhonored.length > 0) {
		const many = unhonored.length > 1;
		throw new Error(
			`entwurf cannot honor --exclude-tools (${unhonored.join(", ")}) on the ${resolved.backend} backend: ` +
				`the backend CLI still exposes ${many ? "these capabilities" : "this capability"} natively, so excluding ` +
				`${many ? "them" : "it"} from pi's surface would make the declared tool set diverge from what the backend can ` +
				`actually do. Restrict ${many ? "them" : "it"} via the backend's own tool config instead` +
				(resolved.backend === "claude" ? " (provider settings 'tools' / 'disallowedTools')" : "") +
				". Extension tools (entwurf_v2, entwurf_peers) can be excluded freely — they are pi-side and never reach the backend.",
		);
	}
}

/** Inputs to the Claude `_meta` builder. */
export interface ClaudeSessionMetaParams {
	modelId?: string;
	tools: readonly string[];
	permissionAllow: readonly string[];
	disallowedTools: readonly string[];
	settingSources: readonly string[];
	strictMcpConfig: boolean;
	skillPlugins: readonly string[];
}

/**
 * Build the `_meta` object handed to `newSession` for a Claude ACP session.
 *
 * `normalizedSystemPrompt` is OPTIONAL. The SHIPPED default supplies it (the
 * non-empty v1 engraving): a string carrier makes claude-agent-acp REPLACE its
 * `claude_code` preset, stripping auto-memory (see engraving.ts). When absent
 * (operator opt-out — emptied engraving), the result carries NO `systemPrompt`
 * key and claude-agent-acp keeps its default preset. Either way the carrier stays
 * SHORT so it never grows past the SDK-default size (NEXT §S2-scout 핀1). Rich
 * identity/context rides a first-user-message prepend, never this carrier.
 */
export function buildClaudeSessionMeta(
	params: ClaudeSessionMetaParams,
	normalizedSystemPrompt?: string,
): Record<string, unknown> {
	const claudeCodeOptions: Record<string, unknown> = {
		...(params.modelId ? { model: params.modelId } : {}),
		tools: [...params.tools],
		settingSources: [...params.settingSources],
		settings: {
			permissions: {
				allow: [...params.permissionAllow],
			},
			// Auto-memory containment, defense-in-depth (Detour C). The overlay's
			// settings.json also pins `autoMemoryEnabled:false`, but production runs the
			// query in SDK filesystem-isolation mode (`settingSources: []`), so that
			// on-disk copy is never loaded — claude-agent-acp forwards our options
			// verbatim (acp-agent.js: `...userProvidedOptions`) and the SDK skips
			// ~/.claude/settings.json. This INLINE settings layer is independent of
			// `settingSources`, so it IS honored — the live seal. Backstop only: the
			// primary write-containment lever is the non-empty engraving carrier
			// replacing the claude_code preset (which strips the auto-memory
			// advertisement the model would otherwise act on). "knows-but-can't" here vs
			// the carrier's "doesn't-know" — keeping both means a future preset/SDK
			// change cannot silently re-open memory through a channel the strip misses.
			autoMemoryEnabled: false,
		},
	};
	if (params.skillPlugins.length > 0) {
		claudeCodeOptions.plugins = params.skillPlugins.map((path) => ({ type: "local", path }));
	}
	// Only emit when non-empty so `disallowedTools: []` opts fully out of the
	// bridge's deferred-tool muting (the agent's own AskUserQuestion mute still
	// applies — that is claude-agent-acp's call, not ours).
	if (params.disallowedTools.length > 0) {
		claudeCodeOptions.disallowedTools = [...params.disallowedTools];
	}
	if (params.strictMcpConfig) {
		claudeCodeOptions.extraArgs = { "strict-mcp-config": null };
	}

	const meta: Record<string, unknown> = {
		claudeCode: { options: claudeCodeOptions },
	};
	if (normalizedSystemPrompt) {
		meta.systemPrompt = normalizedSystemPrompt;
	}
	return meta;
}
