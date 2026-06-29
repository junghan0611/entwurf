// ACP plugin — operator provider-config loader (S2g).
//
// THE BASELINE FIX. Before S2g, backend.ts hardcoded `mcpServers:[]`,
// `settingSources:[]`, `tools:DEFAULT_CLAUDE_TOOLS`, `skillPlugins:[]` — so an
// operator who wrote `entwurfProvider.mcpServers` / `skillPlugins` into their
// `.pi/settings.json` (the very surface `./run.sh install` wires up) saw the ACP
// model boot with 4 tools and no MCP/skills. This module reads that operator
// config and hands it to the backend so the documented passthrough actually
// reaches `newSession`.
//
// Claude-only scope (NEXT §스코프). Ported from the v0.11.0 behavior oracle
// (index.ts `loadProviderSettings`/`readSettingsFile` + acp-bridge.ts
// `normalizeMcpServers`/`enrichMcpServersWithEnvelope`) — structure new, behavior
// preserved. Codex/Gemini fields (codexDisabledFeatures, …) are out of scope and
// deliberately NOT carried.
//
// PURITY / SIGNATURE contract (NEXT oracle C / 핀1 / GPT `…2f9325` boost):
//   - `normalizeMcpServers` is pure: a SORTED, validated server list + a sha256
//     `hash` of its canonical JSON. The HASH (not the name list) is what feeds
//     `bridgeConfigSignature`, so a change to a server's command/args/env/url/
//     headers — not just its name — invalidates a reused session.
//   - `enrichMcpServersWithEnvelope` injects the per-session PI_SESSION_ID /
//     PI_AGENT_ID into the entwurf-bridge stdio entry. It runs AFTER the hash is
//     taken (runtime wiring, not config), so a new session id alone never forces
//     a rebuild.
//
// FAIL-LOUD (GPT `…2f9325`): a config the bridge cannot honor must error before
// the session spawns, never silently degrade (the "warnings make agents flail"
// anti-pattern):
//   - bad mcpServers entry           → McpServerConfigError (names the server)
//   - bad skillPlugins path/manifest → settingsConfigError
//   - appendSystemPrompt: true       → unsupported (rich context = first-user
//                                      augment; tiny carrier = engraving)
//   - strictMcpConfig: false         → unsupported (Hard Rule #4: no ambient MCP)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { AcpBackendAdapter } from "./backend-adapter.js";

/** A normalized key/value pair (env var or HTTP header) — ACP wire shape. */
export interface AcpKeyValue {
	name: string;
	value: string;
}

/** A normalized MCP server entry — structurally the ACP SDK `McpServer`. */
export type AcpMcpServer =
	| { name: string; command: string; args: string[]; env: AcpKeyValue[] }
	| { type: "http"; name: string; url: string; headers: AcpKeyValue[] }
	| { type: "sse"; name: string; url: string; headers: AcpKeyValue[] };

export type ClaudeSettingSource = "user" | "project" | "local";

/** The raw, parsed `entwurfProvider` block (every field optional). */
export interface ProviderSettings {
	/** Operator-declared backend — a DIAGNOSTIC guard, not the routing authority.
	 *  The curated model-id prefix routes (backend-adapter.ts); this is only
	 *  cross-checked against the routed adapter in backend.ts. */
	backend?: string;
	appendSystemPrompt?: boolean;
	settingSources?: ClaudeSettingSource[];
	strictMcpConfig?: boolean;
	showToolNotifications?: boolean;
	mcpServers?: Record<string, unknown>;
	tools?: string[];
	skillPlugins?: string[];
	permissionAllow?: string[];
	disallowedTools?: string[];
}

/** The fully-resolved Claude provider config the backend hands to newSession. */
export interface ResolvedAcpConfig {
	/** Operator-declared backend (diagnostic guard only — see ProviderSettings.backend).
	 *  backend.ts asserts this matches the adapter the model id routes to. */
	backend?: string;
	settingSources: ClaudeSettingSource[];
	strictMcpConfig: boolean;
	showToolNotifications: boolean;
	/** Normalized + SORTED MCP servers (NOT envelope-enriched — that is runtime). */
	mcpServers: AcpMcpServer[];
	/** sha256 of the canonical normalized server list — feeds the config signature. */
	mcpServersHash: string;
	tools: string[];
	skillPlugins: string[];
	permissionAllow: string[];
	disallowedTools: string[];
	/** Opaque, backend-OWNED settings produced by `adapter.resolveAdapterSettings`.
	 *  backend.ts NEVER inspects this; only the routed adapter's methods read it
	 *  (casting their own type). This is the ONE seam that keeps backend-specific
	 *  keys (e.g. a connection id) OFF the common config. `undefined` for a backend
	 *  with no own settings (e.g. claude). */
	adapterSettings: unknown;
}

// Defaults are mirrored as local constants (NOT imported from tool-surface.ts):
// the strip-types gate loads this file by its `.ts` source and cannot resolve a
// cross-sibling VALUE import. check-acp-config + check-acp-tool-surface keep the
// two in lockstep behaviorally; a drift would diverge the resolved default
// surface from the declared one.
const DEFAULT_TOOLS: readonly string[] = ["Read", "Bash", "Edit", "Write"];
const DEFAULT_PERMISSION_ALLOW: readonly string[] = ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"];
const DEFAULT_DISALLOWED_TOOLS: readonly string[] = [
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

const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export interface McpServerConfigIssue {
	server: string;
	reason: string;
}

/** Thrown when one or more `mcpServers` entries are structurally invalid. */
export class McpServerConfigError extends Error {
	readonly issues: McpServerConfigIssue[];
	constructor(issues: McpServerConfigIssue[]) {
		super(`Invalid entwurfProvider.mcpServers:\n${issues.map((i) => `  - ${i.server}: ${i.reason}`).join("\n")}`);
		this.name = "McpServerConfigError";
		this.issues = issues;
	}
}

/** A settings-file validation error (non-mcpServers fields). */
export function settingsConfigError(filePath: string, message: string): Error {
	return new Error(`${filePath}: invalid entwurfProvider settings: ${message}`);
}

// ---------------------------------------------------------------------------
// mcpServers normalization (pure)
// ---------------------------------------------------------------------------

function validateKvEntries(
	server: string,
	field: "env" | "headers",
	input: unknown,
	issues: McpServerConfigIssue[],
): AcpKeyValue[] | undefined {
	if (input === undefined) return [];
	const entries: AcpKeyValue[] = [];
	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			const kv = input[i];
			if (!kv || typeof kv !== "object" || Array.isArray(kv)) {
				issues.push({ server, reason: `"${field}[${i}]" must be an object` });
				return undefined;
			}
			const pair = kv as { name?: unknown; value?: unknown };
			if (typeof pair.name !== "string" || typeof pair.value !== "string") {
				issues.push({ server, reason: `"${field}[${i}]" must have string "name" and "value"` });
				return undefined;
			}
			entries.push({ name: pair.name, value: pair.value });
		}
	} else if (typeof input === "object") {
		for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
			if (typeof value !== "string") {
				issues.push({ server, reason: `"${field}.${name}" must be a string` });
				return undefined;
			}
			entries.push({ name, value });
		}
	} else {
		issues.push({ server, reason: `"${field}" must be an object or array of {name,value}` });
		return undefined;
	}
	// Sort by name so a caller-side ordering difference never drifts the hash.
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return entries;
}

function normalizeMcpServerEntry(name: string, raw: unknown, issues: McpServerConfigIssue[]): AcpMcpServer | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		issues.push({ server: name, reason: "server entry must be an object" });
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const declaredType = obj.type;
	let type: "stdio" | "http" | "sse";
	if (declaredType === undefined) {
		type = "stdio";
	} else if (declaredType === "stdio" || declaredType === "http" || declaredType === "sse") {
		type = declaredType;
	} else {
		issues.push({
			server: name,
			reason: `unsupported "type" ${JSON.stringify(declaredType)} (expected "stdio" | "http" | "sse")`,
		});
		return undefined;
	}

	if (type === "http" || type === "sse") {
		const url = obj.url;
		if (typeof url !== "string" || url.length === 0) {
			issues.push({ server: name, reason: `${type} server requires non-empty "url"` });
			return undefined;
		}
		const headers = validateKvEntries(name, "headers", obj.headers, issues);
		if (headers === undefined) return undefined;
		return { type, name, url, headers };
	}

	const command = obj.command;
	if (typeof command !== "string" || command.length === 0) {
		issues.push({ server: name, reason: `stdio server requires non-empty "command"` });
		return undefined;
	}
	let args: string[] = [];
	if (obj.args !== undefined) {
		if (!Array.isArray(obj.args)) {
			issues.push({ server: name, reason: `"args" must be a string array` });
			return undefined;
		}
		for (let i = 0; i < obj.args.length; i++) {
			if (typeof obj.args[i] !== "string") {
				issues.push({ server: name, reason: `"args[${i}]" must be a string` });
				return undefined;
			}
		}
		args = obj.args as string[];
	}
	const env = validateKvEntries(name, "env", obj.env, issues);
	if (env === undefined) return undefined;
	return { name, command, args, env };
}

/**
 * Normalize an `mcpServers` map into a SORTED, validated server list plus a
 * sha256 hash of its canonical JSON. Pure. Throws McpServerConfigError listing
 * every bad entry (so a typo names the offending server, not just "invalid").
 */
export function normalizeMcpServers(input: Record<string, unknown> | undefined): {
	servers: AcpMcpServer[];
	hash: string;
} {
	if (input === undefined || input === null) {
		return { servers: [], hash: createHash("sha256").update("[]").digest("hex") };
	}
	if (typeof input !== "object" || Array.isArray(input)) {
		throw new McpServerConfigError([
			{
				server: "<root>",
				reason: `mcpServers must be an object (got ${Array.isArray(input) ? "array" : typeof input})`,
			},
		]);
	}
	const issues: McpServerConfigIssue[] = [];
	const servers: AcpMcpServer[] = [];
	for (const name of Object.keys(input).sort()) {
		const entry = normalizeMcpServerEntry(name, (input as Record<string, unknown>)[name], issues);
		if (entry) servers.push(entry);
	}
	if (issues.length > 0) throw new McpServerConfigError(issues);
	const canonical = JSON.stringify(servers);
	return { servers, hash: createHash("sha256").update(canonical).digest("hex") };
}

/**
 * Inject the per-session entwurf envelope (PI_SESSION_ID + PI_AGENT_ID) into the
 * `entwurf-bridge` stdio MCP entry so the bridge's MCP child can resolve the
 * caller identity (entwurf_self / entwurf_v2). Runs AFTER the config hash is
 * taken — this is runtime wiring, not config, so a new session id alone must not
 * invalidate a reused session. http/sse have no env carrier; other stdio servers
 * are left untouched. Pre-existing PI_SESSION_ID/PI_AGENT_ID env are filtered so
 * the bridge-supplied values always win (mid-session model switch surfaces the
 * new PI_AGENT_ID at the next spawn).
 */
export function enrichMcpServersWithEnvelope(
	servers: readonly AcpMcpServer[],
	envelope: { modelId?: string; piSessionId?: string },
): AcpMcpServer[] {
	const piAgentId = envelope.modelId ? `entwurf/${envelope.modelId}` : undefined;
	const piSessionId = envelope.piSessionId;
	if (!piSessionId && !piAgentId) return [...servers];
	return servers.map((s) => {
		if ("type" in s && (s.type === "http" || s.type === "sse")) return s;
		if (s.name !== "entwurf-bridge") return s;
		const stdio = s as { name: string; command: string; args: string[]; env: AcpKeyValue[] };
		const baseEnv = stdio.env.filter((e) => e.name !== "PI_SESSION_ID" && e.name !== "PI_AGENT_ID");
		const extras: AcpKeyValue[] = [];
		if (piSessionId) extras.push({ name: "PI_SESSION_ID", value: piSessionId });
		if (piAgentId) extras.push({ name: "PI_AGENT_ID", value: piAgentId });
		return { ...stdio, env: [...baseEnv, ...extras] };
	});
}

// ---------------------------------------------------------------------------
// settings file parse + validate
// ---------------------------------------------------------------------------

function assertOptionalBoolean(settings: Record<string, unknown>, key: string, filePath: string): boolean | undefined {
	const value = settings[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw settingsConfigError(filePath, `${key} must be a boolean`);
	return value;
}

function parseStringArray(settings: Record<string, unknown>, key: string, filePath: string): string[] | undefined {
	const value = settings[key];
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw settingsConfigError(filePath, `${key} must be an array of strings`);
	}
	return value as string[];
}

/**
 * Validate `skillPlugins` paths: each must be an absolute path to an existing
 * directory containing `.claude-plugin/plugin.json`. The Claude Agent SDK
 * silently drops anything else at spawn time — leaving the operator's skill
 * invisible with no failure signal — so we fail fast here instead (oracle G).
 */
export function validateSkillPluginPaths(paths: readonly string[], filePath: string): void {
	for (let index = 0; index < paths.length; index++) {
		const pluginPath = paths[index];
		const label = `skillPlugins[${index}]`;
		if (!isAbsolute(pluginPath)) {
			throw settingsConfigError(filePath, `${label} must be an absolute path (got ${JSON.stringify(pluginPath)})`);
		}
		let isDir = false;
		try {
			isDir = statSync(pluginPath).isDirectory();
		} catch {
			throw settingsConfigError(filePath, `${label} does not exist: ${pluginPath}`);
		}
		if (!isDir) throw settingsConfigError(filePath, `${label} must point at a directory: ${pluginPath}`);
		const manifestPath = join(pluginPath, ".claude-plugin", "plugin.json");
		if (!existsSync(manifestPath)) {
			throw settingsConfigError(
				filePath,
				`${label} is missing .claude-plugin/plugin.json — expected ${manifestPath}. ` +
					`See README §Custom Skills for the minimum plugin shape.`,
			);
		}
	}
}

/**
 * Read + validate the `entwurfProvider` block of one settings file. Returns BOTH
 * the typed (common) `settings` and the `raw` untyped block — the raw block feeds
 * `adapter.resolveAdapterSettings` so a backend can read its OWN keys (which the
 * typed ProviderSettings deliberately drops). Missing file or absent block → empty
 * both. Malformed JSON / wrong shapes throw a settingsConfigError naming the file.
 */
export function readProviderSettingsFile(filePath: string): {
	settings: ProviderSettings;
	raw: Record<string, unknown>;
} {
	if (!existsSync(filePath)) return { settings: {}, raw: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		throw settingsConfigError(filePath, `malformed JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw settingsConfigError(filePath, "settings file root must be an object");
	}
	const block = (parsed as Record<string, unknown>).entwurfProvider;
	if (block === undefined) return { settings: {}, raw: {} };
	if (!block || typeof block !== "object" || Array.isArray(block)) {
		throw settingsConfigError(filePath, "entwurfProvider must be an object");
	}
	const settings = block as Record<string, unknown>;

	// `backend` is the operator's DECLARED backend — a diagnostic guard, NOT the
	// routing authority (the curated model-id prefix is; see backend-adapter.ts).
	// config.ts validates only that it is a string and does NOT whitelist values:
	// the adapter registry owns the set of valid backends, so a new backend never
	// needs a config.ts edit. The semantic cross-check (declared backend must match
	// the adapter the model id routes to) lives at the routing site in backend.ts —
	// keeping config a pure syntactic parser and the model id the SINGLE routing
	// authority (no duplicate authority).
	const backendRaw = settings.backend;
	if (backendRaw !== undefined && typeof backendRaw !== "string") {
		throw settingsConfigError(filePath, "backend must be a string");
	}

	const settingSourcesRaw = settings.settingSources;
	let settingSources: ClaudeSettingSource[] | undefined;
	if (settingSourcesRaw !== undefined) {
		if (!Array.isArray(settingSourcesRaw)) throw settingsConfigError(filePath, "settingSources must be an array");
		if (!settingSourcesRaw.every((v) => v === "user" || v === "project" || v === "local")) {
			throw settingsConfigError(filePath, "settingSources entries must be one of: user, project, local");
		}
		settingSources = settingSourcesRaw as ClaudeSettingSource[];
	}

	const mcpServersRaw = settings.mcpServers;
	let mcpServers: Record<string, unknown> | undefined;
	if (mcpServersRaw !== undefined) {
		if (!mcpServersRaw || typeof mcpServersRaw !== "object" || Array.isArray(mcpServersRaw)) {
			throw settingsConfigError(filePath, "mcpServers must be an object");
		}
		mcpServers = mcpServersRaw as Record<string, unknown>;
	}

	const skillPlugins = parseStringArray(settings, "skillPlugins", filePath);
	if (skillPlugins) validateSkillPluginPaths(skillPlugins, filePath);

	return {
		settings: {
			backend: backendRaw?.trim() || undefined,
			appendSystemPrompt: assertOptionalBoolean(settings, "appendSystemPrompt", filePath),
			settingSources,
			strictMcpConfig: assertOptionalBoolean(settings, "strictMcpConfig", filePath),
			showToolNotifications: assertOptionalBoolean(settings, "showToolNotifications", filePath),
			mcpServers,
			tools: parseStringArray(settings, "tools", filePath),
			skillPlugins,
			permissionAllow: parseStringArray(settings, "permissionAllow", filePath),
			disallowedTools: parseStringArray(settings, "disallowedTools", filePath),
		},
		raw: settings,
	};
}

// ---------------------------------------------------------------------------
// resolve (merge global + project, apply defaults, fail-loud on unsupported)
// ---------------------------------------------------------------------------

export interface ResolveProviderConfigParams {
	cwd: string;
	modelId: string;
	/** The adapter the model id already routed to (resolved ONCE at turn entry in
	 *  backend.ts and threaded here — config.ts never re-routes, so the model id stays
	 *  the single routing authority). Used only to parse this backend's own settings. */
	adapter: AcpBackendAdapter;
	/** Override the global settings path (tests). Defaults to ~/.pi/agent/settings.json. */
	globalSettingsPath?: string;
	/** Override the project settings path (tests). Defaults to <cwd>/.pi/settings.json. */
	projectSettingsPath?: string;
}

/**
 * Resolve the effective Claude provider config from global + project settings.
 *
 * Merge: project overrides global, but ONLY for keys the project actually sets
 * (an absent key must not nuke the global value). `mcpServers` is a special
 * shallow MERGE — `{...global, ...project}` — so a project adds/overrides
 * individual servers without dropping the global set.
 *
 * Fail-loud: `appendSystemPrompt: true` and `strictMcpConfig: false` are
 * unsupported on this lane (see file header).
 */
export function resolveProviderConfig(params: ResolveProviderConfigParams): ResolvedAcpConfig {
	const globalPath = params.globalSettingsPath ?? GLOBAL_SETTINGS_PATH;
	const projectPath = params.projectSettingsPath ?? join(params.cwd, ".pi", "settings.json");
	const { settings: globalSettings, raw: globalRaw } = readProviderSettingsFile(globalPath);
	const { settings: projectSettings, raw: projectRaw } = readProviderSettingsFile(projectPath);

	// Project overrides global only for keys it actually defines (undefined =
	// "unset", which JS spread would otherwise treat as an override).
	const projectDefined = Object.fromEntries(
		Object.entries(projectSettings).filter(([, v]) => v !== undefined),
	) as ProviderSettings;
	const merged = { ...globalSettings, ...projectDefined };

	if (merged.appendSystemPrompt === true) {
		throw settingsConfigError(
			projectSettings.appendSystemPrompt !== undefined ? projectPath : globalPath,
			"appendSystemPrompt: true is unsupported on acp-on-v2 — rich context rides the first-user augment and the " +
				"tiny system-prompt carrier is the engraving (ENTWURF_ACP_ENGRAVING_PATH). Remove the key.",
		);
	}

	const strictMcpConfig = merged.strictMcpConfig ?? true;
	if (strictMcpConfig === false) {
		throw settingsConfigError(
			projectSettings.strictMcpConfig !== undefined ? projectPath : globalPath,
			"strictMcpConfig: false is unsupported on acp-on-v2 — ambient MCP inheritance (~/.mcp.json, project .mcp.json, " +
				"~/.claude settings) is disallowed (Hard Rule #4). Declare every server explicitly under mcpServers.",
		);
	}

	const settingSources = merged.settingSources ?? [];
	const showToolNotifications = merged.showToolNotifications ?? true;
	const skillPlugins = merged.skillPlugins ?? [];
	const baseTools = merged.tools ?? [...DEFAULT_TOOLS];
	const baseAllow = merged.permissionAllow ?? [...DEFAULT_PERMISSION_ALLOW];
	// When skillPlugins is non-empty the SDK's skill-listing emitter is gated on
	// `tools.some(name === "Skill")` — without it the listing returns empty and
	// skills never reach the system prompt, even though the plugin loaded them.
	// Auto-allow `Skill(*)` too so the listing surface is not denied at the
	// permission layer (oracle G, verified against claude-agent-sdk 0.2.114/119).
	const tools = skillPlugins.length > 0 && !baseTools.includes("Skill") ? [...baseTools, "Skill"] : baseTools;
	const permissionAllow =
		skillPlugins.length > 0 && !baseAllow.includes("Skill(*)") ? [...baseAllow, "Skill(*)"] : baseAllow;
	const disallowedTools = merged.disallowedTools ?? [...DEFAULT_DISALLOWED_TOOLS];

	// mcpServers: shallow per-name merge across global + project, then normalize.
	const mergedMcpServersRaw: Record<string, unknown> = {
		...(globalSettings.mcpServers ?? {}),
		...(projectSettings.mcpServers ?? {}),
	};
	const { servers: mcpServers, hash: mcpServersHash } = normalizeMcpServers(mergedMcpServersRaw);

	// Backend-OWNED settings seam: the routed adapter parses its own keys off the RAW
	// blocks (project-over-global merge). The result is opaque to config.ts and backend.ts
	// — only the adapter's own methods read it. claude returns undefined (no own settings).
	const adapterSettings = params.adapter.resolveAdapterSettings({
		globalBlock: globalRaw,
		projectBlock: projectRaw,
		mergedBlock: { ...globalRaw, ...projectRaw },
		globalPath,
		projectPath,
	});

	return {
		backend: merged.backend,
		settingSources,
		strictMcpConfig,
		showToolNotifications,
		mcpServers,
		mcpServersHash,
		tools,
		skillPlugins,
		permissionAllow,
		disallowedTools,
		adapterSettings,
	};
}

/** The MCP server names exposed to a session (for engraving + augment). */
export function mcpServerNames(config: ResolvedAcpConfig): string[] {
	return config.mcpServers.map((s) => s.name);
}
