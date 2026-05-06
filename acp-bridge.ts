import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
	type AnyMessage,
	ClientSideConnection,
	type InitializeResponse,
	type McpServer,
	PROTOCOL_VERSION,
	type PromptResponse,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";

import { ENTWURF_PROJECT_CONTEXT_OPEN_TAG } from "./protocol.js";

type PromptContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data?: string; mimeType?: string; uri?: string };

export type BridgePromptEvent =
	| { type: "session_notification"; notification: SessionNotification }
	| {
			type: "permission_request";
			request: RequestPermissionRequest;
			response: RequestPermissionResponse;
	  };

type PendingPromptHandler = (event: BridgePromptEvent) => Promise<void> | void;

export type ClaudeSettingSource = "user" | "project" | "local";
export type AcpBackend = "claude" | "codex" | "gemini";

type EnvKvInput = Record<string, string> | Array<{ name: string; value: string }>;

type StdioMcpServerInput = {
	type?: "stdio";
	command: string;
	args?: string[];
	env?: EnvKvInput;
};

type HttpMcpServerInput = {
	type: "http";
	url: string;
	headers?: EnvKvInput;
};

type SseMcpServerInput = {
	type: "sse";
	url: string;
	headers?: EnvKvInput;
};

export type McpServerInput = StdioMcpServerInput | HttpMcpServerInput | SseMcpServerInput;
export type McpServerInputMap = Record<string, McpServerInput>;

export type NormalizedMcpServers = {
	servers: McpServer[];
	hash: string;
	signatureKey: string;
};

export type McpServerConfigIssue = {
	server: string;
	reason: string;
};

export class McpServerConfigError extends Error {
	readonly issues: McpServerConfigIssue[];
	constructor(issues: McpServerConfigIssue[]) {
		const lines = issues.map((issue) => `  - ${issue.server}: ${issue.reason}`).join("\n");
		super(`Invalid piShellAcpProvider.mcpServers:\n${lines}`);
		this.name = "McpServerConfigError";
		this.issues = issues;
	}
}

function validateKvEntries(
	server: string,
	field: "env" | "headers",
	input: unknown,
	issues: McpServerConfigIssue[],
): Array<{ name: string; value: string }> | undefined {
	if (input === undefined) return [];
	const entries: Array<{ name: string; value: string }> = [];
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
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return entries;
}

function normalizeMcpServerEntry(name: string, raw: unknown, issues: McpServerConfigIssue[]): McpServer | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		issues.push({ server: name, reason: "server entry must be an object" });
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const declaredType = obj["type"];
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
		const url = obj["url"];
		if (typeof url !== "string" || url.length === 0) {
			issues.push({ server: name, reason: `${type} server requires non-empty "url"` });
			return undefined;
		}
		const headers = validateKvEntries(name, "headers", obj["headers"], issues);
		if (headers === undefined) return undefined;
		return { type, name, url, headers } as McpServer;
	}

	const command = obj["command"];
	if (typeof command !== "string" || command.length === 0) {
		issues.push({ server: name, reason: `stdio server requires non-empty "command"` });
		return undefined;
	}
	let args: string[] = [];
	if (obj["args"] !== undefined) {
		if (!Array.isArray(obj["args"])) {
			issues.push({ server: name, reason: `"args" must be a string array` });
			return undefined;
		}
		const rawArgs = obj["args"] as unknown[];
		for (let i = 0; i < rawArgs.length; i++) {
			if (typeof rawArgs[i] !== "string") {
				issues.push({ server: name, reason: `"args[${i}]" must be a string` });
				return undefined;
			}
		}
		args = rawArgs as string[];
	}
	const env = validateKvEntries(name, "env", obj["env"], issues);
	if (env === undefined) return undefined;
	return { name, command, args, env } as McpServer;
}

export function normalizeMcpServers(input: McpServerInputMap | undefined): NormalizedMcpServers {
	if (input === undefined || input === null) {
		const empty = "[]";
		return {
			servers: [],
			hash: createHash("sha256").update(empty).digest("hex"),
			signatureKey: empty,
		};
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
	const names = Object.keys(input).sort();
	const servers: McpServer[] = [];
	for (const name of names) {
		const entry = normalizeMcpServerEntry(name, (input as Record<string, unknown>)[name], issues);
		if (entry) servers.push(entry);
	}
	if (issues.length > 0) {
		throw new McpServerConfigError(issues);
	}
	const signatureKey = JSON.stringify(servers);
	const hash = createHash("sha256").update(signatureKey).digest("hex");
	return { servers, hash, signatureKey };
}

type BridgeSessionCapabilities = {
	loadSession: boolean;
	resumeSession: boolean;
	closeSession: boolean;
};

type AcpLaunchSpec = {
	command: string;
	args: string[];
	source: string;
};

/**
 * Inputs to backend launch resolution. Consumed by the codex adapter
 * (`resolveCodexAcpLaunch`) to:
 *   - materialize `-c features.<key>=false` flags from the resolved
 *     `codexDisabledFeatures` settings.json field
 *   - inject `-c developer_instructions="<...>"` from
 *     `codexDeveloperInstructions` so pi-shell-acp can deliver its identity
 *     carrier (rendered engraving) at the highest stable config layer the
 *     codex stack exposes. Codex ACP does not honor `_meta.systemPrompt`,
 *     so the `developer_instructions` config slot — which lands inside the
 *     codex `developer` role between the binary's `permissions` /
 *     `apps` / `skills` instructions — is the equivalent of Claude's
 *     `_meta.systemPrompt` string-form preset replacement.
 *
 * The claude adapter ignores both fields. Defined here (not in
 * `EnsureBridgeSessionParams`) because the launch surface is also exercised
 * at test time by check-backends, which doesn't construct full session
 * params.
 */
export type AcpBackendLaunchParams = {
	codexDisabledFeatures: readonly string[];
	codexDeveloperInstructions?: string;
};

/**
 * Escape a string into a TOML basic-string quoted literal so it can be
 * embedded as the value half of a `-c key="<...>"` codex CLI argument.
 * JSON's escape rules are a strict subset of TOML's basic-string escapes
 * (\\, \", \n, \r, \t, \uXXXX), so JSON.stringify produces a TOML-valid
 * quoted form. The returned string includes the surrounding double quotes.
 *
 *   tomlBasicString("a\nb")  →  `"a\\nb"`  (suitable as `-c=key="a\\nb"`)
 *
 * Used by both the spawn-array path (resolveCodexAcpLaunch return) and the
 * CODEX_ACP_COMMAND shell-override path (which adds shellQuote on top).
 */
function tomlBasicString(value: string): string {
	return JSON.stringify(value);
}

type BackendSessionMetaParams = Pick<
	EnsureBridgeSessionParams,
	"modelId" | "settingSources" | "strictMcpConfig" | "tools" | "skillPlugins" | "permissionAllow" | "disallowedTools"
>;

type AcpBackendAdapter = {
	id: AcpBackend;
	stderrLabel: string;
	resolveLaunch(launchParams: AcpBackendLaunchParams): AcpLaunchSpec;
	buildSessionMeta(
		params: BackendSessionMetaParams,
		normalizedSystemPrompt: string | undefined,
	): Record<string, any> | undefined;
	/**
	 * Optional: turn a bootstrap-time augmentation string (e.g. the rendered
	 * engraving) into ContentBlocks that should be prepended to the FIRST
	 * prompt sent to a freshly-opened ACP session. Used for backends without
	 * a _meta.systemPrompt.append style extension (e.g. Codex ACP), so that
	 * this repo can still deliver identity context across ACP peers that only
	 * accept the spec-baseline ContentBlock carrier. Return undefined to skip.
	 */
	buildBootstrapPromptAugment?(augmentText: string): PromptContentBlock[] | undefined;
	/**
	 * Optional: backend-specific environment variable defaults injected into
	 * the spawned child process. process.env values win on conflict so the
	 * operator can always override from their shell. Used to enforce
	 * bridge-level safety defaults the backend wouldn't pick up on its own
	 * (e.g. disabling Claude Code's built-in auto-compaction so pi remains
	 * the single context-management authority).
	 */
	bridgeEnvDefaults?: Record<string, string>;
};

type PersistedBridgeSessionRecord = {
	sessionKey: string;
	acpSessionId: string;
	cwd: string;
	systemPromptAppend?: string | null;
	bootstrapPromptAugment?: string | null;
	codexDeveloperInstructions?: string | null;
	geminiSystemPromptText?: string | null;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
	updatedAt: string;
	version: number;
	provider: string;
};

type CloseBridgeSessionOptions = {
	closeRemote?: boolean;
	invalidatePersisted?: boolean;
};

export type BridgeBootstrapPath = "reuse" | "resume" | "load" | "new";

export type AcpBridgeSession = {
	key: string;
	cwd: string;
	backend: AcpBackend;
	launchSource: string;
	stderrLabel: string;
	child: ChildProcessByStdio<any, any, any>;
	connection: ClientSideConnection;
	initializeResult: InitializeResponse;
	capabilities: BridgeSessionCapabilities;
	acpSessionId: string;
	modelId?: string;
	systemPromptAppend?: string;
	/** Normalized augment string routed via adapter.buildBootstrapPromptAugment on the first prompt of a bootstrapPath="new" session. */
	bootstrapPromptAugment?: string;
	/** ContentBlocks to prepend to the NEXT sendPrompt call, then cleared. Populated on new-session bootstrap for backends whose adapter implements buildBootstrapPromptAugment. */
	bootstrapPromptAugmentPending?: PromptContentBlock[];
	/** Codex identity carrier — rendered engraving delivered as `-c developer_instructions="<...>"` at codex-acp child spawn time. Codex ACP exposes no `_meta.systemPrompt` surface; the codex `developer` role is the highest stable config layer pi-shell-acp can populate. Pinned on the session because changing it requires respawning the codex-acp child (launch-time arg). Compatibility checks include this field — see `isSessionCompatible`. The claude adapter ignores it. */
	codexDeveloperInstructions?: string;
	/** Gemini identity carrier — rendered engraving written into the overlay's `system.md` (target of the `GEMINI_SYSTEM_MD` env var) at every gemini-acp spawn by ensureGeminiConfigOverlay. Gemini-only. Pinned on the session for the same reason as codexDeveloperInstructions: the carrier is materialized at spawn time (here, a file the child reads on launch), so reusing an existing child against a changed engraving would surface the previous identity to the model. Compatibility checks include this field — see `isSessionCompatible`. The claude/codex adapters ignore it. */
	geminiSystemPromptText?: string;
	settingSources: ClaudeSettingSource[];
	strictMcpConfig: boolean;
	mcpServers: McpServer[];
	tools: string[];
	skillPlugins: string[];
	permissionAllow: string[];
	disallowedTools: string[];
	codexDisabledFeatures: string[];
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
	stderrTail: string[];
	closed: boolean;
	bootstrapPath: BridgeBootstrapPath;
	persistedAcpSessionId?: string;
	activePromptHandler?: PendingPromptHandler;
};

export type EnsureBridgeSessionParams = {
	sessionKey: string;
	cwd: string;
	backend: AcpBackend;
	modelId?: string;
	systemPromptAppend?: string;
	/** Augmentation text delivered to the backend on the first prompt of a new session via adapter.buildBootstrapPromptAugment. Retained as an interface point for future backends that lack a higher-authority carrier; both currently shipped backends use carrier-specific paths instead (Claude: systemPromptAppend; Codex: codexDeveloperInstructions). */
	bootstrapPromptAugment?: string;
	/** Codex identity carrier — see AcpBridgeSession.codexDeveloperInstructions. Required-for-codex when an engraving is configured; ignored by the claude adapter. */
	codexDeveloperInstructions?: string;
	/** Optional Emacs socket hint propagated to the ACP child as PI_EMACS_AGENT_SOCKET. */
	emacsAgentSocket?: string;
	settingSources: ClaudeSettingSource[];
	strictMcpConfig: boolean;
	mcpServers: McpServer[];
	/** Built-in Claude Code tools to expose. Defaults to pi baseline (Read/Bash/Edit/Write) so the system prompt's advertised tools and the SDK's actual tool surface match. */
	tools: string[];
	/** Absolute paths to Claude Code plugin directories injected via SDK `plugins: [{type:"local", path}]`. Used to deliver skills explicitly without opening up `~/.claude/skills/` via settingSources. */
	skillPlugins: string[];
	/** Wildcard rules passed to the SDK as `Options.settings.permissions.allow`. Combined with the user's `~/.claude/settings.json` `defaultMode` (resolved by claude-agent-acp), this gives explicit YOLO without flipping the user's native default mode. */
	permissionAllow: string[];
	/** Tool names passed to the SDK as `Options.disallowedTools`. Used to suppress the SDK's deferred-tool advertisement (Cron+Task+Worktree+PlanMode families plus WebFetch, WebSearch, Monitor, PushNotification, RemoteTrigger, NotebookEdit, AskUserQuestion) so the agent's awareness of available tools stays inside pi's declared baseline. claude-agent-acp merges its own ["AskUserQuestion"] default with this list. */
	disallowedTools: string[];
	/** codex-rs feature keys (e.g. "image_generation", "tool_suggest", "multi_agent", "apps") materialized as `-c features.<key>=false` flags at codex-acp launch. Codex-only — the claude adapter ignores this. Mirror of `disallowedTools` on the codex side: the sole operator-tunable knob for the codex tool surface. Defaults to `DEFAULT_CODEX_DISABLED_FEATURES` (defined in acp-bridge.ts). Set to `[]` in pi-shell-acp settings.json to opt fully out of bridge feature gating. */
	codexDisabledFeatures: string[];
	/** Gemini identity carrier — rendered engraving written into the overlay's `system.md` (`GEMINI_SYSTEM_MD` target) at spawn time by ensureGeminiConfigOverlay. Gemini-only — the claude/codex adapters ignore this. When omitted/empty, the overlay still authors a non-empty placeholder so gemini's `getCoreSystemPrompt` takes the override branch (replacing the native "Instruction and Memory Files" body). The override branch is gated by `systemMdResolution.value && !systemMdResolution.isDisabled` post the prompt-provider refactor — `isDisabled` is only ever true for the literal switch values `0`/`false`, which the bridge never uses (we always set `GEMINI_SYSTEM_MD` to a real path). Operator engravings with literal `${...}` text are run through `defuseGeminiSubstitutions` before write so gemini's `applySubstitutions` does not mutate them. */
	geminiSystemPromptText?: string;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
};

const bridgeSessions = new Map<string, AcpBridgeSession>();
const STDERR_TAIL_MAX_LINES = 120;
const PERSISTED_SESSION_VERSION = 1;
const PERSISTED_SESSION_PROVIDER = "pi-shell-acp";
const SESSION_CACHE_DIR = join(homedir(), ".pi", "agent", "cache", "pi-shell-acp", "sessions");

function normalizeText(text?: string | null): string | undefined {
	const trimmed = text?.trim();
	return trimmed ? trimmed : undefined;
}

function isChildAlive(child?: ChildProcessByStdio<any, any, any>): boolean {
	if (!child) return false;
	return child.exitCode == null && child.signalCode == null && !child.killed;
}

function appendStderrTail(target: string[], chunk: Buffer | string): void {
	const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
	for (const line of text.split(/\r?\n/)) {
		if (!line) continue;
		target.push(line);
	}
	while (target.length > STDERR_TAIL_MAX_LINES) {
		target.shift();
	}
}

function createNdJsonMessageStream(
	stdinWritable: WritableStream<Uint8Array>,
	stdoutReadable: ReadableStream<Uint8Array>,
): {
	readable: ReadableStream<AnyMessage>;
	writable: WritableStream<AnyMessage>;
} {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	const readable = new ReadableStream<AnyMessage>({
		async start(controller) {
			let buffered = "";
			const reader = stdoutReadable.getReader();
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (!value) continue;
					buffered += decoder.decode(value, { stream: true });
					const lines = buffered.split("\n");
					buffered = lines.pop() ?? "";
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							controller.enqueue(JSON.parse(trimmed) as AnyMessage);
						} catch {
							// claude-agent-acp logs to stderr, but ignore stray non-JSON stdout defensively.
						}
					}
				}
				const tail = buffered.trim();
				if (tail) {
					try {
						controller.enqueue(JSON.parse(tail) as AnyMessage);
					} catch {
						// ignore
					}
				}
			} finally {
				reader.releaseLock();
				controller.close();
			}
		},
	});

	const writable = new WritableStream<AnyMessage>({
		async write(message) {
			const writer = stdinWritable.getWriter();
			try {
				await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
			} finally {
				writer.releaseLock();
			}
		},
	});

	return { readable, writable };
}

function pickOption(options: Array<{ optionId: string; kind?: string }>, kinds: string[]): string | undefined {
	for (const kind of kinds) {
		const match = options.find((option) => option.kind === kind);
		if (match?.optionId) return match.optionId;
	}
	return undefined;
}

function inferPermissionKind(params: RequestPermissionRequest): string | undefined {
	const explicitKind = (params as any)?.toolCall?.kind;
	if (typeof explicitKind === "string" && explicitKind.length > 0) return explicitKind;
	const title = String((params as any)?.toolCall?.title ?? "").toLowerCase();
	if (!title) return undefined;
	if (title.includes("read") || title.includes("cat")) return "read";
	if (title.includes("search") || title.includes("grep") || title.includes("find")) return "search";
	if (title.includes("edit") || title.includes("write") || title.includes("patch")) return "edit";
	if (title.includes("delete") || title.includes("remove")) return "delete";
	if (title.includes("move") || title.includes("rename")) return "move";
	if (title.includes("run") || title.includes("bash") || title.includes("execute")) return "execute";
	return "other";
}

function resolvePermissionResponse(params: RequestPermissionRequest): RequestPermissionResponse {
	const mode = (process.env.CLAUDE_ACP_PERMISSION_MODE ?? "approve-all").trim().toLowerCase();
	const options = Array.isArray((params as any)?.options)
		? ((params as any).options as Array<{ optionId: string; kind?: string }>)
		: [];
	if (options.length === 0) {
		return { outcome: { outcome: "cancelled" } };
	}

	const allowOptionId = pickOption(options, ["allow_once", "allow_always"]);
	const rejectOptionId = pickOption(options, ["reject_once", "reject_always"]);
	const kind = inferPermissionKind(params);

	if (mode === "deny-all") {
		return rejectOptionId
			? { outcome: { outcome: "selected", optionId: rejectOptionId } }
			: { outcome: { outcome: "cancelled" } };
	}

	if (mode === "approve-reads" && kind !== "read" && kind !== "search") {
		return rejectOptionId
			? { outcome: { outcome: "selected", optionId: rejectOptionId } }
			: { outcome: { outcome: "cancelled" } };
	}

	if (allowOptionId) {
		return { outcome: { outcome: "selected", optionId: allowOptionId } };
	}

	return { outcome: { outcome: "selected", optionId: options[0].optionId } };
}

// claude-side launch resolution ignores launchParams — Claude's tool surface
// is configured via `_meta.claudeCode.options.disallowedTools` at session
// open time (see buildClaudeSessionMeta), not via launch flags.
function resolveClaudeAcpLaunch(_launchParams: AcpBackendLaunchParams): AcpLaunchSpec {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) {
		return {
			command: "bash",
			args: ["-lc", override],
			source: "env:CLAUDE_AGENT_ACP_COMMAND",
		};
	}

	const require = createRequire(import.meta.url);
	try {
		const packageJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			bin?: string | Record<string, string>;
		};
		const binPath = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.["claude-agent-acp"];
		if (binPath) {
			return {
				command: process.execPath,
				args: [join(dirname(packageJsonPath), binPath)],
				source: "package:@agentclientprotocol/claude-agent-acp",
			};
		}
	} catch {
		// fall through
	}

	return {
		command: "claude-agent-acp",
		args: [],
		source: "PATH:claude-agent-acp",
	};
}

const CODEX_DISABLE_AUTO_COMPACT_ARGS = ["-c", "model_auto_compact_token_limit=9223372036854775807"] as const;

// Codex tool surface alignment — defense in depth.
//
// Pi advertises a fixed 4-tool baseline (Read/Bash/Edit/Write, mapped to
// the codex equivalents) in its system prompt. codex-rs registers extra
// tools that are not part of that baseline. The CODEX_HOME overlay above
// already prevents the operator's `~/.codex/config.toml` from re-enabling
// these via `[tools].web_search = "live"` or `[features].image_generation
// = true` — but pinning the same values via `-c` flags belt-and-suspenders
// the policy: even if a future codex-rs default flips, the bridge still
// says "off".
//
// codex-rs gates most non-baseline tools via the `[features]` table
// (codex-rs/tools/src/tool_config.rs:140-227 reads
// `features.enabled(Feature::X)` for each registration). The CLI parser
// at codex-rs/utils/cli/src/config_override.rs:42 accepts dotted-path
// `-c features.<key>=<bool>`, which merges into the same table.
//
// Live verification surfaces these tools when the corresponding feature
// gate is absent; each entry maps a single tool family to its feature key
// (consumed via `features.<key>=false` -c flags built dynamically from the
// `codexDisabledFeatures` launch param — see DEFAULT_CODEX_DISABLED_FEATURES
// below):
//
//   `image_gen`                  → features.image_generation
//   `tool_suggest`               → features.tool_suggest
//   deferred-MCP `tool_search`   → features.tool_search
//   `spawn_agent` / `send_input` / `wait_agent` / `close_agent` /
//   `resume_agent` (collab tools, both v1 and v2)
//                                → features.multi_agent (= Feature::Collab)
//   `mcp__codex_apps__*` server (the auto-injected GitHub etc. ChatGPT
//   connector bundle that codex-rs adds when chatgpt auth is present —
//   `with_codex_apps_mcp()` at codex-rs/codex-mcp/src/mcp/mod.rs:291
//   gates this on `config.apps_enabled && CodexAuth::is_chatgpt_auth`)
//                                → features.apps
//
// `web_search` — codex-rs 0.124.0 default is already off
// (WebSearchMode::Disabled, codex-rs/tools/src/tool_spec.rs:99-104 returns
// no tool when the mode is None or Disabled). Explicit `disabled` is
// defense-in-depth, not a behavioral change against the current default.
//
// `tools.view_image` — schema has the Option<bool> field
// (codex-rs/config/src/config_toml.rs:514-525) but no consumer in 0.124.0
// (the path that would gate registration at
// tool_registry_plan.rs:381 only checks `has_environment`, which is
// hardcoded true at tool_config.rs:210). Setting the field is a no-op
// today and survives only as future-proofing if codex-rs wires the
// consumption path. README known-limits row captures this.
//
// Tools that have no config gate in 0.124.0 and remain on after these
// flags — tracked as known limits, not addressable from the launch
// surface:
//
//   `update_plan`         tool_registry_plan.rs:214 — unconditional push.
//   `view_image`          tool_registry_plan.rs:381 — gated only on
//                         `has_environment` (hardcoded true).
//   `request_user_input`  tool_registry_plan.rs:236 — unconditional push.
//   `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`
//                         tool_registry_plan.rs:193 — gated on
//                         `params.mcp_tools.is_some()`. Pi always ships
//                         MCP servers, so always on. Read-only surface,
//                         lower risk than the others.
//
// Closing these requires patching codex-rs itself — out of scope for
// pi-shell-acp's launch-flag layer.
// Static portion of the codex tool-surface args — fields that are not
// operator-tunable from pi-shell-acp's settings.json layer. `web_search` is
// a top-level codex-rs option (not under [features]) and `tools.view_image`
// is a separate `[tools]` table entry whose consumption path is currently
// a no-op in 0.124.0 (kept for forward-compat). The feature-gate args are
// built dynamically from the resolved `codexDisabledFeatures` launch param
// — see codexFeatureGateArgs() below.
const CODEX_STATIC_TOOL_SURFACE_ARGS = ["-c", 'web_search="disabled"', "-c", "tools.view_image=false"] as const;

// Operator-isolation args for the codex backend. These complement the
// CODEX_HOME / CODEX_SQLITE_HOME overlay and the `memories` feature-gate
// entry: even if a future codex build flips the auto-load path or honors
// a different feature key, these `-c` overrides keep operator memory and
// command history out of pi-shell-acp's identity surface.
//
// - `memories.generate_memories=false`: never write a new memory entry
//   from inside a pi-shell-acp session.
// - `memories.use_memories=false`: never read existing memory entries
//   into the codex `developer` prompt.
// - `history.persistence="none"`: never append the operator's
//   `history.jsonl` from a pi-shell-acp session (also stops the codex
//   binary from materializing a leaky history file inside the overlay).
//
// Defense-in-depth alongside `features.memories=false` (which already
// rides on DEFAULT_CODEX_DISABLED_FEATURES). If codex ever drops the
// feature gate or renames the feature, these explicit `-c` flags still
// pin the desired isolation behavior at the config layer codex actually
// reads.
const CODEX_OPERATOR_ISOLATION_ARGS = [
	"-c",
	"memories.generate_memories=false",
	"-c",
	"memories.use_memories=false",
	"-c",
	'history.persistence="none"',
] as const;

// Default set of codex-rs feature flags pi-shell-acp disables at launch to
// align the codex tool surface with pi's advertised baseline. The Claude
// side mirror is `DEFAULT_CLAUDE_DISALLOWED_TOOLS` in index.ts; both lists
// are operator-overridable via the corresponding settings.json field
// (`disallowedTools` for Claude, `codexDisabledFeatures` for codex). Each
// entry below is a codex-rs feature key (codex-rs/features/src/lib.rs FEATURES
// table) — values are merged into `[features]` via `-c features.<key>=false`.
//
// To re-enable a feature: set `codexDisabledFeatures` in pi-shell-acp
// settings.json to a list that omits the entry (or `[]` to opt fully out
// of the bridge's feature-gate policy). To extend the default policy:
// override the array including the new key.
//
// When codex-rs adds a feature whose default registers a tool that does
// not match pi's advertised baseline, this list must follow.
export const DEFAULT_CODEX_DISABLED_FEATURES: readonly string[] = [
	"image_generation",
	"tool_suggest",
	"tool_search",
	"multi_agent",
	"apps",
	// `memories` toggles the codex memory subsystem (codex-rs/core/src/memories).
	// When the feature is on, codex loads operator memory entries into the
	// `developer` role context and writes new entries during sessions —
	// exactly the channel pi-shell-acp must keep operator-private from. The
	// overlay's empty `memories/` directory + this feature gate +
	// CODEX_OPERATOR_ISOLATION_ARGS form three layers of the same defense.
	"memories",
] as const;

// Build the dynamic `-c features.<key>=false` arg sequence from a resolved
// disabled-features list. Keys are passed through verbatim — codex-rs
// validates them at config-load time (`is_known_feature_key`), so a typo in
// settings.json will surface as a codex-acp startup warning, not a silent
// no-op.
function codexFeatureGateArgs(disabledFeatures: readonly string[]): string[] {
	const args: string[] = [];
	for (const key of disabledFeatures) {
		args.push("-c", `features.${key}=false`);
	}
	return args;
}

// codex-rs approval/sandbox preset table — kebab-case ids match
// codex-utils-approval-presets builtin_approval_presets() so the same
// vocabulary works on both sides of the bridge. We default to `full-access`
// for parity with pi-shell-acp's pi-YOLO model on the Claude side
// (permissionAllow wildcards, no auto-compaction). It is also the only
// codex preset that lets workspace-external files (e.g. ~/.gnupg/ which
// gogcli reads to decrypt tokens) come through, so pi-baseline skills
// continue to work without piecewise sandbox carve-outs.
//
// Operators who prefer a tighter default can opt in via
// PI_SHELL_ACP_CODEX_MODE=auto (codex-rs's own default — workspace-write
// sandbox, on-request approvals) or =read-only.
export type CodexMode = "read-only" | "auto" | "full-access";

const DEFAULT_CODEX_MODE: CodexMode = "full-access";

const CODEX_MODE_ARGS: Record<CodexMode, readonly string[]> = {
	"read-only": ["-c", "approval_policy=on-request", "-c", "sandbox_mode=read-only"],
	auto: ["-c", "approval_policy=on-request", "-c", "sandbox_mode=workspace-write"],
	"full-access": ["-c", "approval_policy=never", "-c", "sandbox_mode=danger-full-access"],
};

// Env-var keys used to disable backend-side auto-compaction (Claude only;
// codex's compaction guard is a launch-arg threshold, not an env var).
// `PI_SHELL_ACP_ALLOW_COMPACTION=1` strips these from the spawned child's
// env so the operator can opt out of pi-side compaction guards. Other
// keys in adapter.bridgeEnvDefaults — most importantly the CODEX_HOME /
// CODEX_SQLITE_HOME / CLAUDE_CONFIG_DIR isolation pins — are *not*
// affected by the compaction toggle. Those keys are identity-isolation
// invariants that must hold regardless of how compaction is configured.
const COMPACTION_GUARD_ENV_KEYS: ReadonlySet<string> = new Set(["DISABLE_AUTO_COMPACT", "DISABLE_COMPACT"]);

/**
 * Materialize the spawned child's env defaults for a backend, taking the
 * operator's PI_SHELL_ACP_ALLOW_COMPACTION knob into account.
 *
 * - allowCompaction === true: strip the compaction-guard keys
 *   (DISABLE_AUTO_COMPACT, DISABLE_COMPACT) so claude can fall back to
 *   its native auto-compaction. Identity-isolation keys
 *   (CLAUDE_CONFIG_DIR, CODEX_HOME, CODEX_SQLITE_HOME) stay.
 * - allowCompaction === false / unset: return the adapter's full set
 *   verbatim.
 *
 * Exported for check-backends so the contract is verified at unit-test
 * time, not just at production startup. Conflating the compaction
 * toggle with isolation env was a previous regression — the test
 * surface keeps it from drifting back.
 */
export function resolveBridgeEnvDefaults(
	backend: AcpBackend,
	options?: { allowCompaction?: boolean },
): Record<string, string> | undefined {
	const adapter = ACP_BACKEND_ADAPTERS[backend];
	const adapterEnv = adapter?.bridgeEnvDefaults;
	if (!adapterEnv) return undefined;
	if (!options?.allowCompaction) return adapterEnv;
	return Object.fromEntries(Object.entries(adapterEnv).filter(([key]) => !COMPACTION_GUARD_ENV_KEYS.has(key)));
}

function isCompactionAllowedByOperator(): boolean {
	const allow = process.env.PI_SHELL_ACP_ALLOW_COMPACTION?.trim().toLowerCase();
	return allow === "1" || allow === "true" || allow === "yes";
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function codexAutoCompactArgs(): string[] {
	return isCompactionAllowedByOperator() ? [] : [...CODEX_DISABLE_AUTO_COMPACT_ARGS];
}

export function resolveCodexMode(): CodexMode {
	const raw = process.env.PI_SHELL_ACP_CODEX_MODE?.trim().toLowerCase();
	if (raw === undefined || raw === "") return DEFAULT_CODEX_MODE;
	if (raw === "read-only" || raw === "auto" || raw === "full-access") return raw;
	// "Never warn. Throw." — silently falling back to DEFAULT_CODEX_MODE
	// (which is full-access) on a typo would land the operator on the most
	// permissive sandbox when they likely intended a tighter one. Make the
	// failure loud at the launch surface so the typo is fixed, not papered
	// over.
	throw new Error(
		`Invalid PI_SHELL_ACP_CODEX_MODE=${process.env.PI_SHELL_ACP_CODEX_MODE}: expected one of "read-only", "auto", "full-access".`,
	);
}

function codexModeArgs(): string[] {
	return [...CODEX_MODE_ARGS[resolveCodexMode()]];
}

function resolveCodexAcpLaunch(launchParams: AcpBackendLaunchParams): AcpLaunchSpec {
	const override = process.env.CODEX_ACP_COMMAND?.trim();
	// codex-rs merges `-c key=value` flags left-to-right, with later values
	// for the same key winning. We append our mode + compaction guard *after*
	// the operator's CODEX_ACP_COMMAND override (see the override branch
	// below: `${override} ${ourFlags}`), so pi-shell-acp's policy always wins
	// against any `-c approval_policy=…` / `-c sandbox_mode=…` /
	// `-c model_auto_compact_token_limit=…` the operator may have inlined.
	// This is intentional — the env knobs (PI_SHELL_ACP_CODEX_MODE,
	// PI_SHELL_ACP_ALLOW_COMPACTION) are the supported way to change these
	// policies, not CODEX_ACP_COMMAND. The feature-gate args are built from
	// the launch param so operators who set `codexDisabledFeatures` in
	// settings.json control the policy from there, mirroring how Claude's
	// `disallowedTools` is operator-tunable on the other side.
	const allArgs = [
		...codexModeArgs(),
		...codexAutoCompactArgs(),
		...CODEX_STATIC_TOOL_SURFACE_ARGS,
		...CODEX_OPERATOR_ISOLATION_ARGS,
		...codexFeatureGateArgs(launchParams.codexDisabledFeatures),
		...codexDeveloperInstructionsArgs(launchParams.codexDeveloperInstructions),
	];
	if (override) {
		const command = allArgs.length > 0 ? `${override} ${allArgs.map(shellQuote).join(" ")}` : override;
		return {
			command: "bash",
			args: ["-lc", command],
			source: "env:CODEX_ACP_COMMAND",
		};
	}

	return {
		command: "codex-acp",
		args: allArgs,
		source: "PATH:codex-acp",
	};
}

/**
 * Resolve the Gemini CLI ACP launch spec.
 *
 * Gemini CLI exposes ACP via its `--acp` flag (PATH:gemini --acp), launching
 * the same CLI binary in stdio JSON-RPC mode. Unlike Claude/Codex, this is
 * NOT a separate `*-acp` server package; the gemini CLI itself is the ACP
 * server. We therefore resolve from PATH only — there is no node-package
 * fallback like `@google/gemini-cli` to unpack into our dependency graph.
 *
 * Operators install via:
 *   pnpm add -g @google/gemini-cli
 *   # or: npm i -g @google/gemini-cli
 *
 * Override path: GEMINI_ACP_COMMAND lets operators inline a different
 * launch (e.g. `gemini --acp --debug`, or a wrapper script). The override
 * runs through `bash -lc` so shell tokenization matches the operator's
 * shell environment, mirroring CODEX_ACP_COMMAND.
 *
 * Identity carrier: gemini-cli does not honor ACP's `_meta.systemPrompt` and
 * has no `-c developer_instructions` equivalent, but it does honor a path-
 * valued env var `GEMINI_SYSTEM_MD` that fully replaces the native system-
 * prompt body when the file exists (packages/core/src/prompts/promptProvider.ts:111).
 * The overlay (ensureGeminiConfigOverlay) authors that file with the operator
 * engraving as body and `GEMINI_CLI_HOME` + `GEMINI_SYSTEM_MD` are pinned at
 * spawn through the adapter's `bridgeEnvDefaults` — equivalent in role to
 * Claude's `_meta.systemPrompt` replacement and Codex's `developer_instructions`.
 *
 * Tool surface narrowing: `--admin-policy <path>` loads a TOML rule file at
 * priority tier 5.x, beating every other tier (Default<Extension<Workspace<
 * User<Admin). The overlay authors `policies/admin.toml` with a deny-all
 * catch-all plus explicit allows for the pi baseline (read_file = Read,
 * write_file = Write, replace = Edit, run_shell_command = Bash) and a
 * whitelist of MCP servers we inject through `mcpServers`. The flag
 * accepts comma-separated paths and may also be repeated (gemini --help).
 *
 * The launchParams are accepted for adapter signature compatibility but
 * deliberately unused on the gemini backend (no operator-tunable knobs
 * surface here yet — codexDeveloperInstructions and codexDisabledFeatures
 * are codex-only).
 */
function resolveGeminiAcpLaunch(_launchParams: AcpBackendLaunchParams): AcpLaunchSpec {
	const override = process.env.GEMINI_ACP_COMMAND?.trim();
	// Bridge args we always pin — `--admin-policy` loads the overlay's TOML
	// at priority tier 5.x (Admin > User > Workspace > Extension > Default),
	// so even with the override path the tool-surface narrowing wins. Mirror
	// of the Codex `${override} ${ourFlags}` pattern in resolveCodexAcpLaunch.
	const bridgeArgs = ["--admin-policy", GEMINI_OVERLAY_ADMIN_POLICY_PATH];
	if (override) {
		const command = `${override} ${bridgeArgs.map(shellQuote).join(" ")}`;
		return {
			command: "bash",
			args: ["-lc", command],
			source: "env:GEMINI_ACP_COMMAND",
		};
	}
	return {
		command: "gemini",
		args: ["--acp", ...bridgeArgs],
		source: "PATH:gemini --acp --admin-policy <overlay>",
	};
}

/**
 * Render the codex `-c developer_instructions="<...>"` argument pair from
 * the rendered engraving. Codex ACP does not honor `_meta.systemPrompt`,
 * so this is the highest stable config-layer carrier available to
 * pi-shell-acp on the codex backend. The instruction lands inside the
 * codex `developer` role between the binary's `permissions` / `apps` /
 * `skills` instruction blocks — high authority, but a layer below the
 * Claude `system_prompt` replacement we use on the other backend
 * (codex-acp simply does not expose that layer).
 *
 * Empty / undefined → no flag emitted, codex defaults apply (no
 * pi-authored developer instruction present).
 */
function codexDeveloperInstructionsArgs(value: string | undefined): string[] {
	const trimmed = value?.trim();
	if (!trimmed) return [];
	return ["-c", `developer_instructions=${tomlBasicString(trimmed)}`];
}

// Cached so we run ldd at most once per process — libc never changes mid-run.
let cachedClaudeCodeExecutable: string | null | undefined;

function detectLinuxLibc(): "glibc" | "musl" {
	// `ldd --version` prints "(GNU libc) X.Y" on glibc and the literal token
	// "musl libc" on musl. The check is deliberately tolerant — anything we
	// can't classify falls through to glibc, which is the default on every
	// mainstream Linux distro this bridge is run on.
	try {
		const out = execFileSync("ldd", ["--version"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (/musl/i.test(out)) return "musl";
	} catch {
		// ldd missing or non-zero: musl distros sometimes exit non-zero from
		// `ldd --version`; check the captured stderr opportunistically too.
	}
	return "glibc";
}

function resolveClaudeCodeExecutable(): string | undefined {
	if (cachedClaudeCodeExecutable !== undefined) {
		return cachedClaudeCodeExecutable ?? undefined;
	}

	const envOverride = process.env.PI_SHELL_ACP_CLAUDE_CODE_PATH?.trim();
	if (envOverride) {
		cachedClaudeCodeExecutable = envOverride;
		return envOverride;
	}

	// Why we override at all:
	// claude-agent-sdk@0.2.114+ ships a libc-aware native binary as a sibling
	// optionalDependency (e.g. `claude-agent-sdk-linux-arm64-musl`). Its
	// auto-detect probes `[musl, glibc]` in that fixed order, picks whichever
	// is hoisted into node_modules, and treats finding *either* package as
	// success. pnpm — including pi's global install — does not filter
	// optionalDependencies by `libc`, so on a glibc host both variants land in
	// the store and the musl ELF wins. Spawning it then fails with ENOENT
	// because the musl interpreter (`/lib/ld-musl-<arch>.so.1`) is absent on
	// glibc systems (NixOS, Debian, etc.), surfacing through the ACP bridge as
	// "Internal error" with no useful tail. We sidestep the auto-detect by
	// resolving the variant ourselves with libc taken into account, then fall
	// back to the bundled pure-JS `cli.js` if no native variant is reachable.
	const require = createRequire(import.meta.url);
	const arch = process.arch;
	let nativeCandidates: string[];
	if (process.platform === "linux") {
		const libc = detectLinuxLibc();
		nativeCandidates =
			libc === "musl" ? [`linux-${arch}-musl`, `linux-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`];
	} else {
		nativeCandidates = [`${process.platform}-${arch}`];
	}

	const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
	for (const variant of nativeCandidates) {
		try {
			const pkgJsonPath = require.resolve(`@anthropic-ai/claude-agent-sdk-${variant}/package.json`);
			const candidate = join(dirname(pkgJsonPath), binaryName);
			if (existsSync(candidate)) {
				cachedClaudeCodeExecutable = candidate;
				return candidate;
			}
		} catch {
			// Package not present for this variant — try the next.
		}
	}

	try {
		const sdkPkgPath = require.resolve("@anthropic-ai/claude-agent-sdk/package.json");
		const cliJs = join(dirname(sdkPkgPath), "cli.js");
		if (existsSync(cliJs)) {
			cachedClaudeCodeExecutable = cliJs;
			return cliJs;
		}
	} catch {
		// SDK is required by claude-agent-acp; if it's truly missing there is
		// nothing we can repair from here. Let the SDK's own auto-detect run.
	}

	cachedClaudeCodeExecutable = null;
	return undefined;
}

// Build the `_meta.claudeCode.options` payload that pi-shell-acp hands to
// claude-agent-acp on session_new / session_resume / session_load.
//
// Design contract (see AGENTS.md "Identity preservation, not config inheritance"):
//   - Tool surface is restricted to the pi baseline by default (Read/Bash/
//     Edit/Write) so the system prompt's advertised toolset and the SDK's
//     actual toolset match. Users can override per-config.
//   - Skills are injected explicitly via `plugins: [{type:"local", path}]`,
//     not by opening `settingSources` to read `~/.claude/skills/`.
//   - Permissions are granted explicitly via `settings.permissions.allow`
//     wildcards. Combined with claude-agent-acp's own `permissionMode`
//     resolution (which it derives from the user's filesystem
//     `~/.claude/settings.json` `defaultMode` and we cannot override via
//     `_meta`), this delivers de facto YOLO for the listed tools without
//     touching the user's native Claude Code permission default.
//   - `settingSources` defaults to `[]` (SDK isolation mode): no
//     filesystem-sourced settings, MCP, hooks, env, or plugins from
//     `~/.claude/`. The bridge's `mcpServers` argument and the explicit
//     plugin paths above are the only injection surface.
//   - `strict-mcp-config` is on by default at the index.ts layer so the
//     bridge MCP servers are the only MCP source.
//
// Claude Code's auto-injected identity (its built-in system prompt preset,
// model behavior, tool implementations) is not touched. Only the *operating
// surface* — what tools, MCP, skills, and permissions are present — is
// constrained to a pi-shaped envelope.
function buildClaudeSessionMeta(
	params: BackendSessionMetaParams,
	normalizedSystemPrompt: string | undefined,
): Record<string, any> {
	const claudeCodeOptions: Record<string, any> = {
		...(params.modelId ? { model: params.modelId } : {}),
		tools: [...params.tools],
		settingSources: [...params.settingSources],
		settings: {
			permissions: {
				allow: [...params.permissionAllow],
			},
		},
	};
	if (params.skillPlugins.length > 0) {
		claudeCodeOptions.plugins = params.skillPlugins.map((path) => ({ type: "local", path }));
	}
	// Disallowed tools — passed through to claude-agent-acp's userProvidedOptions
	// spread (acp-agent.ts:1768), where the agent merges its own default
	// ["AskUserQuestion"] on top. We only emit the field when non-empty so
	// operators who set `disallowedTools: []` in pi-shell-acp config opt fully
	// out of the bridge's deferred-tool muting (the agent's own
	// AskUserQuestion mute still applies — that's claude-agent-acp's call,
	// not ours).
	if (params.disallowedTools.length > 0) {
		claudeCodeOptions.disallowedTools = [...params.disallowedTools];
	}
	const claudeCodeExecutable = resolveClaudeCodeExecutable();
	if (claudeCodeExecutable) {
		claudeCodeOptions.pathToClaudeCodeExecutable = claudeCodeExecutable;
	}
	if (params.strictMcpConfig) {
		claudeCodeOptions.extraArgs = {
			...(claudeCodeOptions.extraArgs ?? {}),
			"strict-mcp-config": null,
		};
	}

	const meta: Record<string, any> = {
		claudeCode: {
			options: claudeCodeOptions,
		},
	};

	// Replace the claude_code preset entirely with engraving-as-system-prompt.
	// claude-agent-acp's _meta.systemPrompt accepts a string for full preset
	// replacement (acp-agent.ts:1685-1686), and the SDK's Options.systemPrompt
	// union has `string` as a first-class form (sdk.d.ts:1695). Result: the
	// claude_code preset disappears entirely — including its `# auto memory`
	// guidance section and per-cwd MEMORY.md auto-load reference — and the
	// engraving alone carries whatever identity context the agent gets.
	//
	// Anthropic's SDK still prepends a one-line minimum identity claim
	// ("You are a Claude agent, built on Anthropic's Claude Agent SDK.") at
	// the binary level — that boundary is intentionally respected. Above
	// that line, pi-shell-acp authors the operating surface entirely.
	//
	// We do not author additional identity-stamping copy on purpose: the
	// agent's identity comes through the engraving and the visible MCP/tool
	// surface, not through preset replacement boilerplate.
	if (normalizedSystemPrompt) {
		meta.systemPrompt = normalizedSystemPrompt;
	}
	return meta;
}

// ============================================================================
// Claude config overlay — isolate claude-agent-acp's SettingsManager from
// the operator's `~/.claude/settings.json` permissionMode pickup.
// ============================================================================
//
// claude-agent-acp's SettingsManager loads `~/.claude/settings.json` directly
// (independent of the SDK's `settingSources` option) and resolves
// `permissions.defaultMode` into the SDK's top-level `Options.permissionMode`.
// pi-shell-acp cannot override this via `_meta.claudeCode.options` — the
// agent hardcodes the resolved value after spreading user-provided options
// (acp-agent.ts:1761). The operator's preferred native default mode (often
// `"auto"`) therefore leaks into pi-shell-acp sessions even when we set
// `settingSources: []`.
//
// CLAUDE_CONFIG_DIR is the env var that determines where SettingsManager
// looks for the user-level `settings.json`. By spawning claude-agent-acp
// with CLAUDE_CONFIG_DIR pointing at a pi-owned overlay directory, we
// redirect the SettingsManager read to a settings.json *we* control while
// keeping the rest of `~/.claude/` (credentials, projects, agents, plugins,
// skills caches) reachable through symlinks. The overlay's settings.json is
// minimal — only the fields we need to override. No filesystem inheritance
// of hooks, env, or other ambient values.
//
// Overlay structure:
//
//   ~/.pi/agent/claude-config-overlay/
//   ├── settings.json         (pi-shell-acp authored — minimal override)
//   ├── .credentials.json     -> ~/.claude/.credentials.json (symlink)
//   ├── projects/             -> ~/.claude/projects/        (symlink)
//   ├── agents/               -> ~/.claude/agents/          (symlink)
//   └── ... (every other entry of ~/.claude/ symlinked to its real path)
//
// The overlay is rebuilt on every claude session bootstrap (idempotent), so
// new entries appearing in `~/.claude/` later (a new project directory, etc.)
// surface on the next launch without manual intervention.
const CLAUDE_REAL_CONFIG_DIR = join(homedir(), ".claude");
export const CLAUDE_CONFIG_OVERLAY_DIR = join(homedir(), ".pi", "agent", "claude-config-overlay");

// Minimal settings.json content for the overlay. Only fields we have a
// reason to pin live here. Current overrides:
//
// - `permissions.defaultMode`: neutralize the operator's native `"auto"`
//   setting, which would otherwise apply to pi-shell-acp sessions and
//   (a) trigger Claude Code's auto mode classifier inside an ACP session,
//   (b) be invisible to operators who only set it for their direct Claude
//   Code use. With our explicit `tools` surface and `permissionAllow`
//   wildcard list, `"default"` mode auto-passes every tool we actually
//   expose — no prompts in practice — and degrades gracefully if the
//   surface ever expands without an allow update.
//
// - `autoMemoryEnabled: false`: SDK-level opt-out for the auto-memory
//   subsystem (sdk.d.ts:4913). On its own this does not fully close the
//   per-cwd MEMORY.md leak — the binary v2.1.121 auto-injects MEMORY.md
//   content via a separate channel — so the real closure is the empty
//   `projects/` tree below. We still pin this field as a defense-in-depth
//   layer: it disables agent-side memory R/W via the SDK contract and
//   stays effective if a future binary version honors the field more
//   strictly.
function overlaySettingsJson(): string {
	return `${JSON.stringify(
		{
			permissions: { defaultMode: "default" },
			autoMemoryEnabled: false,
		},
		null,
		2,
	)}\n`;
}

// Whitelist of operator's ~/.claude/ entries we expose to pi-shell-acp
// sessions via symlink. Anything not in here is intentionally hidden:
// operator personal config (CLAUDE.md, hooks, agents, sessions data,
// settings.local.json with personal env / GitHub PAT, plugin enablement,
// command history, todos, tasks, keybindings, ...) does not leak into
// pi-shell-acp's model context, hook execution surface, or environment.
//
// Entries here are limited to:
//   - what backend authentication needs (`.credentials.json`)
//   - Claude Code's runtime caches and telemetry (cache, debug,
//     stats-cache.json, statsig, telemetry, session-env)
//   - the bridge's own scratch surfaces (session-bridge, shell-snapshots)
//   - built-in (non-operator-defined) skill content (skills)
//
// `plugins` is deliberately excluded: plugin enablement is operator
// personal config, and pi-shell-acp injects its own plugin set via
// `claudeCodeOptions.plugins` (see buildClaudeSessionMeta), not via
// filesystem inheritance.
const OVERLAY_PASSTHROUGH = new Set([
	".credentials.json",
	"cache",
	"debug",
	"session-bridge",
	"session-env",
	"shell-snapshots",
	"skills",
	"stats-cache.json",
	"statsig",
	"telemetry",
]);

// Empty directories owned by the overlay itself. The Claude Code binary
// auto-creates and writes per-cwd state under these paths; we give it
// empty trees scoped to the overlay so:
// - operator's existing data at ~/.claude/{projects,sessions}/ is never
//   read or written from pi-shell-acp.
// - the binary's missing-path-graceful behavior closes the auto-memory
//   leak: if it would have read MEMORY.md from
//   <projects>/<sanitized-cwd>/memory/MEMORY.md, it finds an empty tree
//   and silently injects nothing.
const OVERLAY_EMPTY_DIRS = new Set(["projects", "sessions"]);

// Entries the Claude Code binary creates inside the overlay itself
// (feature-flag cache, automatic backups of `.claude.json`, ...). These
// are *not* present in the operator's real `~/.claude/` — the binary
// makes them in whatever `CLAUDE_CONFIG_DIR` it is pointed at. We exempt
// them from stale-cleanup so the binary's runtime self-management is
// preserved across session bootstraps; deleting them would force a
// rewrite-then-cleanup cycle every session.
//
// `settings.json` is overlay-authored (overlaySettingsJson above) but
// listed here for symmetry — we never want the cleanup loop to nuke it.
const OVERLAY_BINARY_OWNED = new Set([".claude.json", "backups", "settings.json"]);

export function ensureClaudeConfigOverlay(
	realDir: string = CLAUDE_REAL_CONFIG_DIR,
	overlayDir: string = CLAUDE_CONFIG_OVERLAY_DIR,
): void {
	mkdirSync(overlayDir, { recursive: true });

	// Settings.json — always written. Cheap, unconditional rewrite ensures the
	// override is in place even if a prior process or operator edited it.
	writeFileSync(join(overlayDir, "settings.json"), overlaySettingsJson(), "utf8");

	// Empty dirs — owned by the overlay, replace any prior symlink.
	for (const entry of OVERLAY_EMPTY_DIRS) {
		const overlayPath = join(overlayDir, entry);
		try {
			const existing = lstatSync(overlayPath);
			if (existing.isSymbolicLink() || !existing.isDirectory()) {
				rmSync(overlayPath, { recursive: true, force: true });
				mkdirSync(overlayPath, { recursive: true });
			}
		} catch {
			mkdirSync(overlayPath, { recursive: true });
		}
	}

	// Symlinked passthrough — only entries on the whitelist, only if they
	// exist in the operator's real ~/.claude/. Idempotent: keeps correct
	// symlinks, replaces wrong ones, removes stale entries cleanly.
	if (existsSync(realDir)) {
		for (const entry of OVERLAY_PASSTHROUGH) {
			const realPath = join(realDir, entry);
			const overlayPath = join(overlayDir, entry);

			if (!existsSync(realPath)) {
				try {
					lstatSync(overlayPath);
					rmSync(overlayPath, { recursive: true, force: true });
				} catch {
					// Doesn't exist — fine.
				}
				continue;
			}

			try {
				const existing = lstatSync(overlayPath);
				if (existing.isSymbolicLink()) {
					if (readlinkSync(overlayPath) === realPath) continue;
					unlinkSync(overlayPath);
				} else {
					rmSync(overlayPath, { recursive: true, force: true });
				}
			} catch {
				// Doesn't exist — fall through to symlink.
			}

			try {
				symlinkSync(realPath, overlayPath);
			} catch (error) {
				console.error(
					`[pi-shell-acp:claude-overlay] symlink failed for ${entry}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	// Stale entry cleanup — remove anything that's not on the current
	// allowlist. Handles migration from earlier overlay code that
	// blindly symlinked every ~/.claude/ entry, and keeps the overlay
	// surface tight if the whitelist shrinks in a future release.
	//
	// Binary-owned entries get a separate pass: preserve them only if
	// they are real files/dirs (claude authored them inside the
	// overlay). Stale symlinks pointing at operator data are torn
	// down so claude re-initializes fresh state inside the overlay.
	// Mirrors the codex overlay cleanup contract — Claude's
	// binary-owned set (`.claude.json`, `backups/`, `settings.json`)
	// has no operator-side counterparts in the current claude binary
	// so this branch is mostly defensive, but the symmetry guards
	// against any future binary version that creates corresponding
	// entries operator-side.
	for (const entry of readdirSync(overlayDir)) {
		if (OVERLAY_PASSTHROUGH.has(entry)) continue;
		if (OVERLAY_EMPTY_DIRS.has(entry)) continue;
		const overlayPath = join(overlayDir, entry);

		if (OVERLAY_BINARY_OWNED.has(entry)) {
			try {
				const stat = lstatSync(overlayPath);
				if (stat.isSymbolicLink()) {
					rmSync(overlayPath, { force: true });
				}
			} catch {
				// Doesn't exist — fine; binary will create it on first launch.
			}
			continue;
		}

		try {
			rmSync(overlayPath, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup; a stuck stale entry is annoying but not fatal.
		}
	}
}

// ============================================================================
// Codex config overlay — isolate codex-acp's Config loader from the
// operator's `~/.codex/config.toml` field pickup.
// ============================================================================
//
// codex-acp loads the codex-rs `Config` struct via
// `Config::load_with_cli_overrides_and_harness_overrides`
// (codex-acp/src/lib.rs:47). That call reads
// `${CODEX_HOME:-~/.codex}/config.toml` and merges in our `-c key=value`
// flags. Fields the operator sets in their personal config.toml that we do
// NOT cover with `-c` flags — `model`, `model_reasoning_effort`,
// `personality`, `[projects."*"].trust_level`, `[notice.*]` — therefore
// leak straight into pi-shell-acp sessions.
//
// We mirror the Claude-side `CLAUDE_CONFIG_DIR` overlay shape: point
// `CODEX_HOME` at a pi-owned overlay directory, write a minimal
// `config.toml` there, and symlink every other entry from `~/.codex/`
// (`auth.json`, `sessions`, `history.jsonl`, `skills`, `memories`,
// `rules`, `cache`, ...) so nothing operator-facing breaks. The overlay is
// rebuilt idempotently on every codex spawn so newly-created entries in
// `~/.codex/` show up on the next launch automatically. process.env wins
// over bridgeEnvDefaults, so an operator who explicitly exports CODEX_HOME
// keeps full control.
const CODEX_REAL_CONFIG_DIR = join(homedir(), ".codex");
export const CODEX_CONFIG_OVERLAY_DIR = join(homedir(), ".pi", "agent", "codex-config-overlay");

// Minimal codex config.toml content for the overlay.
//
// We do NOT inherit the operator's personal config.toml (model,
// personality, model_reasoning_effort, projects.trust_level, etc.).
// pi-shell-acp pins every operating-surface value it cares about via `-c`
// CLI overrides at launch (approval_policy, sandbox_mode,
// model_auto_compact_token_limit, model where needed). Anything not pinned
// falls through to codex-rs's own hard-coded defaults — by design.
//
// The header is the only required content; codex-rs accepts an effectively
// empty TOML file. We keep the comment so an operator who inspects the
// overlay knows it is pi-managed and any manual edit will be overwritten.
function overlayCodexConfigToml(): string {
	return "# pi-shell-acp managed overlay — do not edit manually.\n# Operator config at ~/.codex/config.toml is intentionally NOT inherited.\n";
}

// Whitelist of operator's ~/.codex/ entries we expose to pi-shell-acp
// sessions via symlink. Anything not in here is intentionally hidden:
// operator personal config (history.jsonl, memories/, rules/, sessions/
// data, AGENTS.md auto-loaded by codex-rs/agents_md.rs as user
// instructions, ...) does not leak into the codex `developer` role
// context, the agent's prior-conversation recall, or the bridge's
// spawned codex-acp child process state.
//
// The whitelist is deliberately narrow. Entries that look "harmless" at
// the filesystem layer can hide deep leak channels — most notably
// `state_5.sqlite*`, which is codex's thread/memory state DB
// (codex-rs/state/runtime.rs); passing that through would expose the
// operator's persistent thread + memory store to any pi-shell-acp
// session resumed in the same cwd. Such files belong in
// OVERLAY_BINARY_OWNED_CODEX instead, so the codex binary materializes
// fresh state inside the overlay rather than reading the operator's.
//
// Entries here are limited to:
//   - what backend authentication needs (`auth.json`)
//   - codex install/version metadata (installation_id, version.json,
//     .personality_migration)
//   - non-data runtime caches whose contents are not operator-keyed
//     (cache, models_cache.json, .tmp, tmp)
//   - skill content (skills) — this is intentional. Codex's skill
//     registry under ~/.codex/skills holds both the binary's built-in
//     `.system/*` skills and the operator's chosen agent-config skill
//     symlinks; both are surfaces pi-shell-acp deliberately wants the
//     agent to see, not "operator personal config" in the leak-surface
//     sense.
const OVERLAY_PASSTHROUGH_CODEX = new Set([
	"auth.json",
	"cache",
	"installation_id",
	"models_cache.json",
	".personality_migration",
	"skills",
	".tmp",
	"tmp",
	"version.json",
]);

// Empty directories owned by the overlay itself. The codex binary
// auto-creates and writes per-cwd state under these paths; we give it
// empty trees scoped to the overlay so:
// - operator's existing data at ~/.codex/{memories,sessions,log,
//   shell_snapshots}/ is never read or written from pi-shell-acp.
// - the binary's missing-path-graceful behavior closes the per-cwd
//   memory / session / log / shell-history leak channels: a fresh
//   codex bootstrap finds empty trees and silently writes new state
//   into the overlay without inheriting any operator-side payload.
const OVERLAY_EMPTY_DIRS_CODEX = new Set(["log", "memories", "sessions", "shell_snapshots"]);

// Files the codex binary self-manages inside the overlay. The cleanup
// loop preserves these *if they are real files/dirs* (binary already
// initialized them inside the overlay). However, an overlay built by
// an earlier blacklist-style version of pi-shell-acp would have
// *symlinked* these to the operator's real `~/.codex/` — those stale
// symlinks must be torn down on first run with the new code, or the
// migration silently leaves the operator's persistent thread/memory
// state DB reachable through the overlay. The cleanup pass strips
// symlinks pointing into operator data while leaving binary-authored
// regular files untouched.
//
// Crucially this list contains the codex state DB (`state_5.sqlite`
// + WAL/SHM siblings) and the telemetry DB (`logs_2.sqlite` + WAL/SHM
// siblings — sqlite WAL mode creates -shm/-wal files alongside the
// main DB and they must travel together; missing one of them would
// either let an operator-side -wal slip through or corrupt the
// overlay-side DB on next open). Both DBs are *not* in
// OVERLAY_PASSTHROUGH_CODEX above; codex initializes fresh copies
// inside the overlay on first launch (CODEX_HOME + CODEX_SQLITE_HOME
// both pointed at the overlay in bridgeEnvDefaults). `config.toml` is
// overlay-authored (overlayCodexConfigToml above) but listed here so
// the cleanup loop never wipes it.
const OVERLAY_BINARY_OWNED_CODEX = new Set([
	"config.toml",
	"logs_2.sqlite",
	"logs_2.sqlite-shm",
	"logs_2.sqlite-wal",
	"state_5.sqlite",
	"state_5.sqlite-shm",
	"state_5.sqlite-wal",
]);

export function ensureCodexConfigOverlay(
	realDir: string = CODEX_REAL_CONFIG_DIR,
	overlayDir: string = CODEX_CONFIG_OVERLAY_DIR,
): void {
	mkdirSync(overlayDir, { recursive: true });

	// config.toml — always written. Cheap, unconditional rewrite ensures the
	// override is in place even if a prior process or operator edited it.
	writeFileSync(join(overlayDir, "config.toml"), overlayCodexConfigToml(), "utf8");

	// Empty dirs — overlay-private, replace any prior symlink to operator data.
	for (const entry of OVERLAY_EMPTY_DIRS_CODEX) {
		const overlayPath = join(overlayDir, entry);
		try {
			const existing = lstatSync(overlayPath);
			if (existing.isSymbolicLink() || !existing.isDirectory()) {
				rmSync(overlayPath, { recursive: true, force: true });
				mkdirSync(overlayPath, { recursive: true });
			}
		} catch {
			mkdirSync(overlayPath, { recursive: true });
		}
	}

	// Symlinked passthrough — only entries on the whitelist, only if they
	// exist in the operator's real ~/.codex/. Idempotent: keeps correct
	// symlinks, replaces wrong ones, removes stale entries cleanly.
	if (existsSync(realDir)) {
		for (const entry of OVERLAY_PASSTHROUGH_CODEX) {
			const realPath = join(realDir, entry);
			const overlayPath = join(overlayDir, entry);

			if (!existsSync(realPath)) {
				try {
					lstatSync(overlayPath);
					rmSync(overlayPath, { recursive: true, force: true });
				} catch {
					// Doesn't exist — fine.
				}
				continue;
			}

			try {
				const existing = lstatSync(overlayPath);
				if (existing.isSymbolicLink()) {
					if (readlinkSync(overlayPath) === realPath) continue;
					unlinkSync(overlayPath);
				} else {
					rmSync(overlayPath, { recursive: true, force: true });
				}
			} catch {
				// Doesn't exist — fall through to symlink.
			}

			try {
				symlinkSync(realPath, overlayPath);
			} catch (error) {
				console.error(
					`[pi-shell-acp:codex-overlay] symlink failed for ${entry}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	// Stale entry cleanup — remove anything that's not on the current
	// allowlist. Handles migration from earlier overlay code that
	// blindly symlinked every ~/.codex/ entry (including history.jsonl
	// with operator command history, memories/ with operator memory,
	// rules/ with operator policy, AGENTS.md auto-loaded as user
	// instructions, ...) and keeps the overlay surface tight if the
	// whitelist shrinks in a future release.
	//
	// Binary-owned entries get a separate pass: we preserve them only
	// if they are real files/directories (codex authored them inside
	// the overlay on a prior run). A pre-migration overlay built by
	// the blacklist version would have *symlinked* them to operator
	// state — those stale symlinks must be removed so codex
	// re-initializes fresh state inside the overlay on next launch.
	// Otherwise the migration would leave operator thread/memory state
	// (state_5.sqlite*) and telemetry (logs_2.sqlite*) reachable
	// through the overlay even after this commit ships.
	for (const entry of readdirSync(overlayDir)) {
		if (OVERLAY_PASSTHROUGH_CODEX.has(entry)) continue;
		if (OVERLAY_EMPTY_DIRS_CODEX.has(entry)) continue;
		const overlayPath = join(overlayDir, entry);

		if (OVERLAY_BINARY_OWNED_CODEX.has(entry)) {
			try {
				const stat = lstatSync(overlayPath);
				if (stat.isSymbolicLink()) {
					rmSync(overlayPath, { force: true });
				}
			} catch {
				// Doesn't exist — fine; codex will create it on first launch.
			}
			continue;
		}

		try {
			rmSync(overlayPath, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup; a stuck stale entry is annoying but not fatal.
		}
	}
}

// ============================================================================
// Gemini config overlay — isolate gemini --acp's config + memory + tool surface
// from the operator's `~/.gemini/`.
// ============================================================================
//
// Path-resolution invariant (verified against gemini-cli 0.40.x source):
//
//   homedir()              = process.env.GEMINI_CLI_HOME ?? os.homedir()
//                            (packages/core/src/utils/paths.ts:22-28)
//   Storage.getGlobalGeminiDir() = path.join(homedir(), ".gemini")
//                                  (packages/core/src/config/storage.ts:54)
//
// → Setting GEMINI_CLI_HOME swaps `homedir()` *itself*, and the binary
//   then constructs its real config dir as `${homedir()}/.gemini`. The
//   overlay therefore needs TWO directories:
//
//     fakeHome  = ~/.pi/agent/gemini-config-overlay        (= GEMINI_CLI_HOME)
//     configDir = ~/.pi/agent/gemini-config-overlay/.gemini (= what the
//                 binary actually reads via Storage.getGlobalGeminiDir())
//
//   All overlay state — settings.json, system.md, policies/admin.toml,
//   oauth symlinks, empty tmp/history/projects — lives under `configDir`,
//   not under `fakeHome`. (Earlier overlay shapes wrote to fakeHome root;
//   the binary silently ignored those files because production code paths
//   take the `${homedir()}/.gemini/...` route, not `${homedir()}/...`.)
//
// This isolation closes four leak channels at the same level Claude and
// Codex backends do:
//
//  ① Operator config dir leak — `~/.gemini/settings.json` (model/UI prefs),
//    `history/` (per-cwd command history), `projects.json` (cwd → shortId
//    map exposing every directory the operator opened gemini in),
//    `trustedFolders.json` (workspace trust prompts), and `tmp/<shortId>/
//    memory/MEMORY.md` (per-cwd persisted memory). Closed by GEMINI_CLI_HOME
//    redirect + overlay-authored settings.json + overlay-private empty
//    tmp/history/projects directories. Note: `tmp/<shortId>/` segments come
//    from `Storage.getProjectIdentifier()` which slugs the cwd, not the
//    operator username — the 2026-05-01 baseline `tmp/junghan/` was the
//    `/home/junghan` cwd's slug, not a username field.
//
//  ② Native system-prompt body leak — `getCoreSystemPrompt`
//    (packages/core/src/prompts/promptProvider.ts:47-119) embeds the
//    bundled "Instruction and Memory Files" body (and ~30 KB of native
//    rules) by default. The 2026-05-01 baseline captured the model
//    quoting that body verbatim. With overlay we set
//    `GEMINI_SYSTEM_MD=<configDir>/system.md` and write our own engraving-
//    derived prompt; gemini's `systemMdResolution.value && !systemMdResolution.isDisabled`
//    branch (post the prompt-provider refactor that landed alongside
//    0.42-nightly) then completely replaces the native body with our file.
//    `isDisabled` is only ever true for the switch values `0`/`false`, which
//    the bridge never sets — we always point at a real overlay path.
//    Equivalent in role to Claude's `_meta.systemPrompt` replacement and
//    Codex's `-c developer_instructions=<...>`.
//
//  ③ Native tool registry advertise-and-invoke surface — gemini's bundled
//    tool surface includes (at minimum) read_file, write_file, replace,
//    run_shell_command, glob, grep_search, list_directory, web_fetch,
//    google_web_search, save_memory, write_todos, ask_user, enter/exit_
//    plan_mode, plus subagents (`codebase_investigator`, `cli_help`,
//    `tracker_*`, `update_topic`, ...) and `activate_skill` /
//    `read_mcp_resource` / `list_mcp_resources`. Without narrowing, the
//    agent sees every one of these in its tool list. We close the surface
//    on TWO layers (mirroring Claude's `tools` + `disallowedTools` split):
//      - **registry layer** (advertise side): `tools.core` allowlist in
//        settings.json restricts the *built-in* registry to the four
//        pi-baseline names (read_file/write_file/replace/run_shell_command)
//        → Claude's `tools: ["Read","Bash","Edit","Write"]` analog
//      - **policy layer** (invoke side): `--admin-policy <path>` at spawn
//        loads a deny-all-then-explicit-allow TOML at priority tier 5.x
//        (Admin > User > Workspace > Extension > Default). Defense in
//        depth — even if a future binary ignores `tools.core`, the policy
//        engine still blocks the call.
//    Plus complementary settings flags: `useWriteTodos: false`,
//    `skills.enabled: false`, `hooksConfig.enabled: false`,
//    `agents.overrides.<id>.enabled: false` for the subagents pi does
//    not want to surface, `mcp.allowed: [...]` whitelisting only the
//    bridge-injected MCP servers, `mcp.excluded: ["*"]` for everything
//    else — the gemini equivalent of Codex's `codexDisabledFeatures`.
//
//  ④ Hierarchical GEMINI.md discovery — by default gemini walks cwd → its
//    parents (stopping at `.git`) → user home, picking up every `GEMINI.md`
//    on the way (packages/core/src/utils/memoryDiscovery.ts:loadServer
//    HierarchicalMemory). Closed by `context.fileName` set to a sentinel
//    string that no real file uses + `memoryBoundaryMarkers: []` to kill
//    parent traversal entirely + `includeDirectoryTree: false` so the
//    cwd dir-tree is not auto-attached to the model's first request.
//    (Equivalent to Claude not auto-loading `CLAUDE.md` in pi-shell-acp.)
//
// The overlay layout that results, mirroring the Claude/Codex shape:
//
//   ~/.pi/agent/gemini-config-overlay/                      (= fakeHome)
//   └── .gemini/                                            (= configDir)
//       ├── settings.json         (overlay-authored)
//       ├── system.md             (overlay-authored — GEMINI_SYSTEM_MD)
//       ├── policies/
//       │   └── admin.toml        (overlay-authored — --admin-policy)
//       ├── oauth_creds.json      → ~/.gemini/oauth_creds.json (symlink)
//       ├── google_accounts.json  → ~/.gemini/google_accounts.json
//       ├── installation_id       → ~/.gemini/installation_id
//       ├── mcp-oauth-tokens-v2.json → ~/.gemini/...
//       ├── tmp/                  (empty, overlay-private)
//       ├── history/              (empty, overlay-private)
//       └── projects/             (empty, overlay-private)
//
// The overlay is rebuilt on every gemini session bootstrap (idempotent), so
// new auth files appearing in ~/.gemini/ later (e.g. operator re-auth)
// surface on the next launch without manual intervention.
const GEMINI_REAL_CONFIG_DIR = join(homedir(), ".gemini");
export const GEMINI_CONFIG_OVERLAY_HOME = join(homedir(), ".pi", "agent", "gemini-config-overlay");
export const GEMINI_CONFIG_OVERLAY_DIR = join(GEMINI_CONFIG_OVERLAY_HOME, ".gemini");
export const GEMINI_OVERLAY_SYSTEM_MD_PATH = join(GEMINI_CONFIG_OVERLAY_DIR, "system.md");
export const GEMINI_OVERLAY_ADMIN_POLICY_PATH = join(GEMINI_CONFIG_OVERLAY_DIR, "policies", "admin.toml");

// Whitelist: only auth + runtime credential entries are surfaced from the
// operator's ~/.gemini/ via symlink. Operator personal config (settings.json
// with model/UI prefs), session history, project-id maps, and trust state
// are NOT exposed.
const GEMINI_OVERLAY_PASSTHROUGH = new Set([
	"oauth_creds.json", // Google OAuth credentials for `gemini --acp`
	"google_accounts.json", // active account selection (oauth)
	"installation_id", // stable per-install identifier
	"mcp-oauth-tokens-v2.json", // operator's MCP OAuth tokens (auth)
]);

// Cross-session-swept directories owned by the overlay. The gemini CLI
// auto-creates per-cwd state under these paths (memory subtree, command
// history, project-id mappings). Owning them as empty trees scoped to the
// overlay means the operator's `~/.gemini/{tmp,history,projects.json}` is
// never read; nuking the overlay copies at every spawn (L5 — Memory
// containment) means whatever gemini wrote in the previous session does not
// survive into the next one. pi-shell-acp owns memory persistence on the pi
// side (semantic-memory + Denote llmlog); the backend must not accumulate a
// parallel memory layer. tmp/ holds the per-project memory subtree, the
// .inbox/ patch files when autoMemory is on, plus checkpoints / plans /
// tracker / chats / shell_history — none of which pi relies on, so a clean
// nuke is preferable to selective sweeping.
const GEMINI_OVERLAY_SWEPT_DIRS = new Set(["tmp", "history", "projects"]);

// Entries the gemini CLI may create inside the overlay itself once it runs
// against `GEMINI_CLI_HOME=<fakeHome>`. Plus the overlay-authored entries —
// listed here so the stale-cleanup loop never deletes them. Mirrors the
// claude/codex `OVERLAY_BINARY_OWNED` exemption pattern.
const GEMINI_OVERLAY_BINARY_OWNED = new Set([
	"settings.json", // overlay-authored
	"system.md", // overlay-authored (GEMINI_SYSTEM_MD target)
	"policies", // overlay-authored directory
	"state.json", // gemini-binary-owned runtime state
	"projects.json", // gemini-binary-owned project map
	"google_accounts.json", // may also appear as binary-rewritten regular file
]);

// Subagents we explicitly disable in addition to keeping them off the
// `tools.core` allowlist. The CLI may register subagents via channels other
// than `tools.core` (settings-time subagent loaders), so a defensive
// `agents.overrides.<id>.enabled = false` keeps them out regardless.
const GEMINI_DISABLED_SUBAGENTS = [
	"codebase_investigator",
	"cli_help",
	"tracker_create_task",
	"tracker_update_task",
	"tracker_get_task",
	"tracker_list_tasks",
	"tracker_add_dependency",
	"tracker_visualize",
	"update_topic",
	"browser",
] as const;

// Built-in tools we want the model to actually see and call — pi baseline.
// Mapped to Claude's `tools: ["Read","Bash","Edit","Write"]` by *capability
// class*, not by literal name. Gemini splits the Read class into four
// concrete tools (read_file for files, list_directory for directories, glob
// for shell-glob enumeration, grep_search for content search); the other
// three classes stay 1:1. The pi-context augment already advertises tool
// naming as backend-specific ("Read 또는 read_file" framing), so the rule is
// **same operating-surface classes, not same literal names**.
//   Read-class:  read_file / list_directory / glob / grep_search ↔ Read
//   Write-class: write_file                                       ↔ Write
//   Edit-class:  replace                                          ↔ Edit
//   Exec-class:  run_shell_command                                ↔ Bash
//
// Allowing all four read-class tools removes the "visible but deny'd"
// asymmetry that would otherwise show: with a 4-name allowlist the model
// would still see the 7 native tools (Gemini's fine-tuned tool advertise
// surface; not narrowed by `tools.core` in the binaries we tested), but
// `list_directory` / `glob` / `grep_search` would deny at invoke. Cleaner
// to admit the read-class split honestly.
const GEMINI_TOOLS_CORE_ALLOWLIST = [
	"read_file",
	"list_directory",
	"glob",
	"grep_search",
	"write_file",
	"replace",
	"run_shell_command",
] as const;

// MCP servers we explicitly allow at the gemini level. Only the two stdio
// servers pi-shell-acp injects through `mcpServers`. Anything else (operator-
// configured stdio MCPs in their personal `~/.gemini/settings.json`,
// http/sse servers in extensions, etc.) is filtered out by gemini before
// the policy engine even sees it.
const GEMINI_MCP_ALLOWLIST = ["pi-tools-bridge", "session-bridge"] as const;

// Sentinel filename for `context.fileName`. Chosen so no real file in the
// universe matches — neutralizes hierarchical GEMINI.md discovery without
// disabling the discovery machinery itself (which the binary still wires up).
const GEMINI_CONTEXT_FILENAME_SENTINEL = "__pi_shell_acp_disabled_context__";

// Minimal settings.json for the overlay. Authored as a tight allowlist —
// every operator preference for model/UI/memory/skills/extensions/agents is
// closed off. Mirrors the Claude `tools` + `permissionAllow` +
// `disallowedTools` + `skillPlugins` + `settingSources: []` shape and the
// Codex `codexDisabledFeatures` + `-c features.<key>=false` feature gates.
function geminiOverlaySettingsJson(): string {
	const agentsOverrides: Record<string, { enabled: boolean }> = {};
	for (const id of GEMINI_DISABLED_SUBAGENTS) agentsOverrides[id] = { enabled: false };
	return `${JSON.stringify(
		{
			advanced: { autoConfigureMemory: false },
			security: {
				auth: { selectedType: "oauth-personal" },
				folderTrust: { enabled: false }, // disable trust prompt + trustedFolders.json read
			},
			context: {
				fileName: GEMINI_CONTEXT_FILENAME_SENTINEL,
				includeDirectoryTree: false,
				memoryBoundaryMarkers: [], // kill parent traversal
				includeDirectories: [],
				loadMemoryFromIncludeDirectories: false,
			},
			tools: {
				core: [...GEMINI_TOOLS_CORE_ALLOWLIST], // Claude `tools` analog
			},
			useWriteTodos: false, // disable write_todos tool
			skills: { enabled: false }, // disable agent skills (Claude `skillPlugins: []` analog)
			hooksConfig: { enabled: false }, // disable hooks system
			extensions: { disabled: [] }, // we do not pre-blacklist extensions; extensions auto-load is gated by `--extensions` flag and we do not pass it
			agents: { overrides: agentsOverrides }, // disable subagents we do not surface
			mcp: {
				allowed: [...GEMINI_MCP_ALLOWLIST],
				excluded: ["*"], // catch-all — only allowed[] survives
			},
			// L5 — Memory containment. pi-shell-acp owns memory persistence on the
			// pi side (semantic-memory + Denote llmlog); the backend must not run
			// its own parallel memory layer. memoryV2 (default true) flips the
			// system prompt into "edit GEMINI.md / MEMORY.md directly via
			// edit/write_file" mode — overridden by GEMINI_SYSTEM_MD anyway, but
			// pinned here as defense-in-depth so the prompt steering is also off if
			// the override path ever breaks. autoMemory (default false) is the
			// background extraction agent that writes .patch files into a project
			// memory inbox; pinned false to make absence explicit. Both are
			// experimental keys — schema lives at packages/cli/src/config/settingsSchema.ts.
			experimental: {
				memoryV2: false,
				autoMemory: false,
			},
		},
		null,
		2,
	)}\n`;
}

// Admin-policy TOML written into the overlay. Loaded by gemini at spawn time
// via `--admin-policy <path>` (priority tier 5.x — overrides Default,
// Extension, Workspace, and User policies unconditionally; see
// packages/core/src/policy/config.ts).
//
// Defense-in-depth: even if `tools.core` ever stops shrinking the registry
// in a future gemini binary, the policy engine still blocks the call.
function geminiOverlayAdminPolicyToml(): string {
	const allowedTools = GEMINI_TOOLS_CORE_ALLOWLIST.map((n) => JSON.stringify(n)).join(", ");
	const allowedMcp = GEMINI_MCP_ALLOWLIST.map((n) => JSON.stringify(n)).join(", ");
	return [
		"# pi-shell-acp admin policy (priority tier 5.x — beats every other tier).",
		"# Authored by acp-bridge.ts geminiOverlayAdminPolicyToml(); do not edit by hand.",
		"# Strategy: deny-all catch-all, then explicit allows for the pi baseline",
		"# capability classes (Read/Write/Edit/Bash) — read-class is split into",
		"# Gemini's four concrete read tools so visible-but-deny'd asymmetry does",
		"# not show. Plus a whitelist of injected MCP servers.",
		"",
		"# Catch-all DENY — every native tool, every MCP, blocked unless re-allowed below.",
		"[[rule]]",
		'toolName = "*"',
		'decision = "deny"',
		"priority = 50",
		"",
		"# pi baseline native tools by capability class (Read/Write/Edit/Bash):",
		"# Read-class  = read_file / list_directory / glob / grep_search",
		"# Write-class = write_file",
		"# Edit-class  = replace",
		"# Exec-class  = run_shell_command",
		"[[rule]]",
		`toolName = [${allowedTools}]`,
		'decision = "allow"',
		"priority = 100",
		"",
		"# MCP catch-all DENY — any MCP server we did not inject is blocked.",
		"[[rule]]",
		'toolName = "*"',
		'mcpName = "*"',
		'decision = "deny"',
		"priority = 50",
		"",
		"# MCP whitelist — pi-shell-acp's two injected stdio servers.",
		"[[rule]]",
		'toolName = "*"',
		`mcpName = [${allowedMcp}]`,
		'decision = "allow"',
		"priority = 100",
		"",
	].join("\n");
}

// Carrier-isolation canary appended to system.md. A baseline operator can
// ask the model to quote this string (and only this string) to confirm
// `GEMINI_SYSTEM_MD` actually replaced the bundled native "Instruction and
// Memory Files" body — i.e. that the file we author here reaches the same
// prompt slot as Claude's `_meta.systemPrompt` and Codex's
// `-c developer_instructions`. If the model can't see the canary, the
// carrier is not landing where we think it is, regardless of what stale
// AGENTS / augment text the model otherwise repeats.
const GEMINI_OVERLAY_SYSTEM_MD_CANARY = "GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1";

// Defuse `${...}` literals in engraving body before writing system.md.
//
// gemini-cli (packages/core/src/prompts/utils.ts: applySubstitutions, post
// 0.42-nightly) walks the override file and rewrites `${AgentSkills}`,
// `${SubAgents}`, `${AvailableTools}`, and `${<toolName>_ToolName}` with their
// runtime values. That substitution is intended for gemini-shipped templates
// — but the same pass runs over the operator-supplied `GEMINI_SYSTEM_MD`
// override file, so any `${...}` literal inside an engraving (e.g. a shell
// example) silently mutates on the gemini backend only, while landing
// verbatim on Claude (`_meta.systemPrompt`) and Codex (`developer_instructions`).
// pi-shell-acp's invariant is that Gemini must not semantically interpolate
// engraving literals differently from Claude/Codex; sliding the `$` and `{`
// apart with a zero-width space (U+200B) stops every substitution regex without
// changing what the model visually reads. Byte-level identity is intentionally
// not claimed for affected `${...}` literals on the Gemini carrier.
function defuseGeminiSubstitutions(text: string): string {
	return text.replace(/\$\{/g, "$​{");
}

// system.md content for the overlay. Receives the operator engraving (when
// configured) as the body, plus the carrier-isolation canary line. Empty
// engraving still produces a non-empty placeholder file so gemini's
// `getCoreSystemPrompt` takes the override branch (replacing the native
// "Instruction and Memory Files" body) instead of falling back to the
// bundled default.
//
// The bridge identity narrative + pi context + ~/AGENTS.md + cwd/AGENTS.md
// + date/cwd ride the first-user augment (pi-context-augment.ts), not this
// system-prompt carrier — same split as claude (`_meta.systemPrompt`) and
// codex (`-c developer_instructions`). Keeping system.md small avoids the
// metered-billing routing risk that motivated the same split on Claude.
function geminiOverlaySystemMd(engravingText: string | undefined): string {
	const engraving = defuseGeminiSubstitutions((engravingText ?? "").trim());
	const canaryLine = `[carrier-canary] ${GEMINI_OVERLAY_SYSTEM_MD_CANARY}`;
	if (engraving.length > 0) {
		return `${engraving}\n\n${canaryLine}\n`;
	}
	// Placeholder when no operator engraving — file must exist non-empty so
	// gemini's `getCoreSystemPrompt` override branch is taken
	// (`systemMdResolution.value && !systemMdResolution.isDisabled`, which the
	// bridge satisfies because GEMINI_SYSTEM_MD is set to a real path, not the
	// disable-switch values "0"/"false"). The canary line both keeps the file
	// non-empty and gives baseline a deterministic quote target.
	return `You are an agent operating under pi-shell-acp. Follow the operating context delivered in the first user message.\n\n${canaryLine}\n`;
}

// Sweep the fake-home root (one level above configDir) of any leftover
// entries from earlier overlay shapes that wrote settings/oauth/tmp/etc. at
// fakeHome top level rather than inside `.gemini/`. Those files were
// silently ignored by the binary (production code paths take the
// `${homedir()}/.gemini/...` route) but they still pollute the overlay
// filesystem and confuse anyone inspecting it. Best-effort: anything that
// is not the `.gemini/` directory itself is removed.
function cleanFakeHomeRoot(fakeHome: string, configDirName: string): void {
	let entries: string[];
	try {
		entries = readdirSync(fakeHome);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry === configDirName) continue;
		const target = join(fakeHome, entry);
		try {
			rmSync(target, { recursive: true, force: true });
		} catch {
			// Best-effort; a stuck stale entry is annoying but not fatal.
		}
	}
}

export function ensureGeminiConfigOverlay(
	engravingText?: string,
	realDir: string = GEMINI_REAL_CONFIG_DIR,
	fakeHome: string = GEMINI_CONFIG_OVERLAY_HOME,
	configDir: string = join(fakeHome, ".gemini"),
): void {
	mkdirSync(fakeHome, { recursive: true });
	cleanFakeHomeRoot(fakeHome, ".gemini");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(join(configDir, "policies"), { recursive: true });

	// Overlay-authored files — always rewritten. Cheap, unconditional rewrite
	// ensures the overrides are in place even if a prior process or operator
	// edited them. Paths are derived from the supplied configDir so the
	// function is testable against a synthetic root.
	writeFileSync(join(configDir, "settings.json"), geminiOverlaySettingsJson(), "utf8");
	writeFileSync(join(configDir, "system.md"), geminiOverlaySystemMd(engravingText), "utf8");
	writeFileSync(join(configDir, "policies", "admin.toml"), geminiOverlayAdminPolicyToml(), "utf8");

	// L5 — Memory containment. Sweep the gemini-side ephemeral state dirs at
	// every spawn so no MEMORY.md / GEMINI.md / memory inbox patch survives
	// across sessions. pi owns memory persistence (semantic-memory + Denote
	// llmlog); the backend must not run a parallel memory layer. Unconditional
	// rmSync — replaces any prior symlink to operator data, plus discards any
	// gemini-written content (tmp/<slug>/memory/MEMORY.md,
	// tmp/<slug>/.inbox/<kind>/*.patch, history, projects map). Then recreate
	// empty so the gemini binary can repopulate within-session as needed.
	for (const entry of GEMINI_OVERLAY_SWEPT_DIRS) {
		const overlayPath = join(configDir, entry);
		rmSync(overlayPath, { recursive: true, force: true });
		mkdirSync(overlayPath, { recursive: true });
	}

	// Symlinked passthrough — only entries on the whitelist, only if they
	// exist in the operator's real ~/.gemini/. Idempotent: keeps correct
	// symlinks, replaces wrong ones, removes stale entries cleanly.
	if (existsSync(realDir)) {
		for (const entry of GEMINI_OVERLAY_PASSTHROUGH) {
			const realPath = join(realDir, entry);
			const overlayPath = join(configDir, entry);

			if (!existsSync(realPath)) {
				try {
					lstatSync(overlayPath);
					rmSync(overlayPath, { recursive: true, force: true });
				} catch {
					// Doesn't exist — fine.
				}
				continue;
			}

			try {
				const existing = lstatSync(overlayPath);
				if (existing.isSymbolicLink()) {
					if (readlinkSync(overlayPath) === realPath) continue;
					unlinkSync(overlayPath);
				} else {
					rmSync(overlayPath, { recursive: true, force: true });
				}
			} catch {
				// Doesn't exist — fall through to symlink.
			}

			try {
				symlinkSync(realPath, overlayPath);
			} catch (error) {
				console.error(
					`[pi-shell-acp:gemini-overlay] symlink failed for ${entry}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	// Stale entry cleanup — remove anything not on the current allowlist.
	// Mirrors the claude/codex cleanup: any pre-overlay symlink pointing at
	// operator state (e.g. a stale `history` symlink to ~/.gemini/history
	// from a prior iteration) is torn down so the overlay reverts to the
	// authored shape on every session.
	for (const entry of readdirSync(configDir)) {
		if (GEMINI_OVERLAY_PASSTHROUGH.has(entry)) continue;
		if (GEMINI_OVERLAY_SWEPT_DIRS.has(entry)) continue;
		const overlayPath = join(configDir, entry);

		if (GEMINI_OVERLAY_BINARY_OWNED.has(entry)) {
			try {
				const stat = lstatSync(overlayPath);
				if (stat.isSymbolicLink()) {
					rmSync(overlayPath, { force: true });
				}
			} catch {
				// Doesn't exist — fine; binary will create it on first launch.
			}
			continue;
		}

		try {
			rmSync(overlayPath, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup; a stuck stale entry is annoying but not fatal.
		}
	}
}

const ACP_BACKEND_ADAPTERS: Record<AcpBackend, AcpBackendAdapter> = {
	claude: {
		id: "claude",
		stderrLabel: "claude-agent-acp stderr",
		resolveLaunch: resolveClaudeAcpLaunch,
		buildSessionMeta: buildClaudeSessionMeta,
		// First-prompt augment carries the bridge-identity narrative + pi base
		// intro + ~/AGENTS.md + cwd/AGENTS.md + date/cwd. The system-prompt
		// carrier (`_meta.systemPrompt = engraving`) deliberately stays small
		// to keep the call inside Anthropic subscription billing — the rich
		// context rides this user-message surface instead. See
		// `pi-context-augment.ts` for the rationale.
		buildBootstrapPromptAugment: (text) => [{ type: "text", text }],
		bridgeEnvDefaults: {
			// Disable Claude Code's built-in auto-compaction. pi-shell-acp keeps pi
			// as the single context-management authority; if the backend silently
			// compacts inside the same ACP session, pi has no way to react and
			// session continuity drifts. Operators can override these from their
			// shell — process.env wins below.
			DISABLE_AUTO_COMPACT: "1",
			DISABLE_COMPACT: "1",
			// Redirect claude-agent-acp's SettingsManager away from
			// ~/.claude/settings.json so the operator's native `permissions.defaultMode`
			// (often "auto") does not silently apply to pi-shell-acp sessions. The
			// overlay directory is rebuilt at every spawn (see
			// ensureClaudeConfigOverlay below). process.env wins, so an operator who
			// explicitly exports CLAUDE_CONFIG_DIR keeps full control.
			CLAUDE_CONFIG_DIR: CLAUDE_CONFIG_OVERLAY_DIR,
		},
	},
	gemini: {
		id: "gemini",
		stderrLabel: "gemini --acp stderr",
		resolveLaunch: resolveGeminiAcpLaunch,
		// Gemini ACP newSession does not expose a `_meta.systemPrompt` carrier,
		// but Gemini CLI exposes `GEMINI_SYSTEM_MD=<path>` which fully replaces
		// the native "Instruction and Memory Files" body with the file content
		// (packages/core/src/prompts/promptProvider.ts:111). pi-shell-acp uses
		// that env var to point at the overlay's `system.md` (authored by
		// ensureGeminiConfigOverlay with the operator engraving as body). The
		// engraving therefore reaches gemini through the same kind of replace-
		// the-system-prompt carrier as Claude (`_meta.systemPrompt`) and codex
		// (`-c developer_instructions`) — not via the first-user augment any
		// more. The richer context (bridge narrative + pi base + ~/AGENTS.md +
		// cwd/AGENTS.md + date/cwd) still rides the first-user augment, same
		// split as the other two backends.
		buildSessionMeta: () => undefined,
		buildBootstrapPromptAugment: (text) => [{ type: "text", text }],
		bridgeEnvDefaults: {
			// Redirect gemini-cli's `homedir()` (packages/core/src/utils/paths.ts:22)
			// to the overlay's fakeHome. The binary then resolves
			// `Storage.getGlobalGeminiDir() = path.join(homedir(), ".gemini")`
			// (storage.ts:54) → `<fakeHome>/.gemini/`, where ensureGeminiConfigOverlay
			// has authored settings.json / system.md / policies/admin.toml and
			// symlinked oauth credentials. The operator's real ~/.gemini/ — with
			// model/UI prefs, history/, projects.json (cwd → shortId map exposing
			// every directory the operator opened gemini in), trustedFolders.json,
			// and tmp/<shortId>/memory/MEMORY.md per-cwd memory — is never read.
			// process.env wins, so an operator who explicitly exports
			// GEMINI_CLI_HOME keeps full control.
			GEMINI_CLI_HOME: GEMINI_CONFIG_OVERLAY_HOME,
			// Replace the gemini native system prompt body. Without this, the
			// model surfaces native "Instruction and Memory Files" rules verbatim
			// (observed L1 baseline 2026-05-01). With this, the overlay-authored
			// system.md (operator engraving) is the only system-level content the
			// model sees. gemini-cli may apply template substitutions to this file;
			// operator engraving literals are defused with U+200B before write so
			// backend-only interpolation does not mutate them.
			GEMINI_SYSTEM_MD: GEMINI_OVERLAY_SYSTEM_MD_PATH,
		},
	},
	codex: {
		id: "codex",
		stderrLabel: "codex-acp stderr",
		resolveLaunch: resolveCodexAcpLaunch,
		buildSessionMeta: () => undefined,
		// Engraving (operator-personal) rides on `-c developer_instructions=...`
		// at codex-acp child spawn time — see codexDeveloperInstructionsArgs in
		// resolveCodexAcpLaunch. The richer first-prompt augment (bridge
		// identity narrative + pi base + ~/AGENTS.md + cwd/AGENTS.md + date/cwd)
		// rides this user-message surface, identical to the Claude path. See
		// `pi-context-augment.ts` for the rationale (subscription-billing
		// classification stays tied to the system-prompt-shape carrier, not
		// to the user-message body).
		buildBootstrapPromptAugment: (text) => [{ type: "text", text }],
		bridgeEnvDefaults: {
			// Redirect codex-rs's Config loader away from ~/.codex/config.toml so
			// the operator's personal model/personality/reasoning_effort etc. do
			// NOT silently apply to pi-shell-acp sessions. The overlay directory
			// is rebuilt at every spawn (see ensureCodexConfigOverlay above).
			// process.env wins, so an operator who explicitly exports CODEX_HOME
			// keeps full control.
			CODEX_HOME: CODEX_CONFIG_OVERLAY_DIR,
			// Pin the codex sqlite home (thread/memory state DB) to the same
			// overlay so future codex builds — or any code path that lets
			// `state_5.sqlite` drift to a separate location — cannot reach
			// the operator's real `~/.codex/state_5.sqlite*` from a
			// pi-shell-acp session. Without this, the operator's persistent
			// thread/memory state would be the deepest leak channel on the
			// codex backend (codex-rs/state/runtime.rs).
			CODEX_SQLITE_HOME: CODEX_CONFIG_OVERLAY_DIR,
		},
		// codex-rs does not expose a boolean/env auto-compaction toggle like
		// Claude Code. It does expose the same behavior as a config threshold:
		// model_auto_compact_token_limit. resolveCodexAcpLaunch() raises that
		// threshold to i64::MAX via `-c`, keeping manual `/compact` available
		// while preventing silent backend compaction in daily ACP sessions.
	},
};

export function resolveAcpBackendAdapter(backend: AcpBackend): AcpBackendAdapter {
	if (backend == null) {
		throw new Error("ACP backend is required.");
	}
	const adapter = ACP_BACKEND_ADAPTERS[backend];
	if (!adapter) {
		throw new Error(`Unknown ACP backend: ${String(backend)}. Expected one of: claude, codex, gemini`);
	}
	return adapter;
}

export function resolveAcpBackendLaunch(
	backend: AcpBackend,
	launchParams: AcpBackendLaunchParams = { codexDisabledFeatures: DEFAULT_CODEX_DISABLED_FEATURES },
): AcpLaunchSpec {
	return resolveAcpBackendAdapter(backend).resolveLaunch(launchParams);
}

export function buildSessionMetaForBackend(
	backend: AcpBackend,
	params: BackendSessionMetaParams,
	normalizedSystemPrompt: string | undefined,
): Record<string, any> | undefined {
	return resolveAcpBackendAdapter(backend).buildSessionMeta(params, normalizedSystemPrompt);
}

function hasPrefix<T>(prefix: T[], value: T[]): boolean {
	if (prefix.length > value.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (prefix[i] !== value[i]) return false;
	}
	return true;
}

function isPersistableSessionKey(sessionKey: string): boolean {
	return sessionKey.startsWith("pi:");
}

function getPersistedSessionPath(sessionKey: string): string {
	const digest = createHash("sha256").update(sessionKey).digest("hex");
	return join(SESSION_CACHE_DIR, `${digest}.json`);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function deletePersistedSessionRecord(sessionKey: string): void {
	if (!isPersistableSessionKey(sessionKey)) return;
	rmSync(getPersistedSessionPath(sessionKey), { force: true });
}

function parsePersistedSessionRecord(raw: unknown, sessionKey: string): PersistedBridgeSessionRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	if (record["version"] !== PERSISTED_SESSION_VERSION) return undefined;
	if (record["provider"] !== PERSISTED_SESSION_PROVIDER) return undefined;
	if (record["sessionKey"] !== sessionKey) return undefined;
	if (!isNonEmptyString(record["acpSessionId"])) return undefined;
	if (!isNonEmptyString(record["cwd"])) return undefined;
	if (!isNonEmptyString(record["bridgeConfigSignature"])) return undefined;
	if (!isStringArray(record["contextMessageSignatures"])) return undefined;
	if (!isNonEmptyString(record["updatedAt"])) return undefined;
	const systemPromptAppend = record["systemPromptAppend"];
	if (!(systemPromptAppend == null || typeof systemPromptAppend === "string")) return undefined;
	const bootstrapPromptAugment = record["bootstrapPromptAugment"];
	if (!(bootstrapPromptAugment == null || typeof bootstrapPromptAugment === "string")) return undefined;
	const codexDeveloperInstructions = record["codexDeveloperInstructions"];
	if (!(codexDeveloperInstructions == null || typeof codexDeveloperInstructions === "string")) return undefined;
	const geminiSystemPromptText = record["geminiSystemPromptText"];
	if (!(geminiSystemPromptText == null || typeof geminiSystemPromptText === "string")) return undefined;
	return {
		sessionKey,
		acpSessionId: record["acpSessionId"] as string,
		cwd: record["cwd"] as string,
		systemPromptAppend: (systemPromptAppend ?? null) as string | null,
		bootstrapPromptAugment: (bootstrapPromptAugment ?? null) as string | null,
		codexDeveloperInstructions: (codexDeveloperInstructions ?? null) as string | null,
		geminiSystemPromptText: (geminiSystemPromptText ?? null) as string | null,
		bridgeConfigSignature: record["bridgeConfigSignature"] as string,
		contextMessageSignatures: [...(record["contextMessageSignatures"] as string[])],
		updatedAt: record["updatedAt"] as string,
		version: PERSISTED_SESSION_VERSION,
		provider: PERSISTED_SESSION_PROVIDER,
	};
}

function readPersistedSessionRecord(sessionKey: string): PersistedBridgeSessionRecord | undefined {
	if (!isPersistableSessionKey(sessionKey)) return undefined;
	const filePath = getPersistedSessionPath(sessionKey);
	if (!existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		const record = parsePersistedSessionRecord(parsed, sessionKey);
		if (!record) {
			deletePersistedSessionRecord(sessionKey);
			return undefined;
		}
		return record;
	} catch {
		deletePersistedSessionRecord(sessionKey);
		return undefined;
	}
}

function persistBridgeSessionRecord(session: AcpBridgeSession): void {
	if (!isPersistableSessionKey(session.key)) return;
	mkdirSync(SESSION_CACHE_DIR, { recursive: true });
	const record: PersistedBridgeSessionRecord = {
		sessionKey: session.key,
		acpSessionId: session.acpSessionId,
		cwd: session.cwd,
		systemPromptAppend: session.systemPromptAppend ?? null,
		bootstrapPromptAugment: session.bootstrapPromptAugment ?? null,
		codexDeveloperInstructions: session.codexDeveloperInstructions ?? null,
		geminiSystemPromptText: session.geminiSystemPromptText ?? null,
		bridgeConfigSignature: session.bridgeConfigSignature,
		contextMessageSignatures: [...session.contextMessageSignatures],
		updatedAt: new Date().toISOString(),
		version: PERSISTED_SESSION_VERSION,
		provider: PERSISTED_SESSION_PROVIDER,
	};
	writeFileSync(getPersistedSessionPath(session.key), `${JSON.stringify(record, null, 2)}\n`);
}

function capabilityEnabled(value: unknown): boolean {
	return value === true || (!!value && typeof value === "object");
}

function detectSessionCapabilities(initializeResult: InitializeResponse): BridgeSessionCapabilities {
	const topLevel = initializeResult as any;
	const nestedAgentCapabilities = topLevel?.agentCapabilities;
	const nestedSessionCapabilities = nestedAgentCapabilities?.sessionCapabilities;
	const topLevelSessionCapabilities = topLevel?.sessionCapabilities;
	const nestedSession = nestedAgentCapabilities?.session;
	const topLevelSession = topLevel?.session;
	return {
		loadSession: nestedAgentCapabilities?.loadSession === true || topLevel?.loadSession === true,
		resumeSession:
			capabilityEnabled(nestedSessionCapabilities?.resume) ||
			capabilityEnabled(topLevelSessionCapabilities?.resume) ||
			capabilityEnabled(nestedSession?.resume) ||
			capabilityEnabled(topLevelSession?.resume),
		closeSession:
			capabilityEnabled(nestedSessionCapabilities?.close) ||
			capabilityEnabled(topLevelSessionCapabilities?.close) ||
			capabilityEnabled(nestedSession?.close) ||
			capabilityEnabled(topLevelSession?.close),
	};
}

// bootstrapPromptAugment is intentionally NOT part of compatibility checks.
// It is a one-shot prepend consumed exactly once at session bootstrap
// (see armBootstrapPromptAugment + bootstrapPromptAugmentPending). Once the
// first prompt of a new session has been sent, the augment value no longer
// affects anything the backend sees on later turns, so comparing it across
// turns would force a fresh session for any caller that chose to vary the
// augment over time. Excluding it keeps the bridge prompt cache alive across
// reuse turns while preserving the fire-and-forget delivery contract.
//
// codexDeveloperInstructions IS part of compatibility checks. Unlike the
// per-turn augment, it is materialized as a child-process launch arg
// (`-c developer_instructions=...`) at codex-acp spawn time and is therefore
// fixed for the lifetime of the spawned child. Reusing an existing child
// against a changed engraving would surface the *previous* identity carrier
// to the model — exactly the leak we are closing. Including the field here
// forces a fresh codex-acp spawn whenever the engraving changes.
//
// geminiSystemPromptText IS part of compatibility checks for the same
// reason: it is materialized as a file the gemini child reads at launch
// (`GEMINI_SYSTEM_MD=<overlay-home>/.gemini/system.md`, written by ensureGeminiConfigOverlay
// at spawn time). Reusing an existing gemini child against a changed
// engraving would leave the previously-written system.md content in front
// of the model.
function isSessionCompatible(
	session: Pick<
		AcpBridgeSession,
		| "cwd"
		| "backend"
		| "systemPromptAppend"
		| "codexDeveloperInstructions"
		| "geminiSystemPromptText"
		| "bridgeConfigSignature"
		| "contextMessageSignatures"
	>,
	params: EnsureBridgeSessionParams,
	normalizedSystemPrompt: string | undefined,
): boolean {
	return (
		session.cwd === params.cwd &&
		session.backend === params.backend &&
		session.systemPromptAppend === normalizedSystemPrompt &&
		normalizeText(session.codexDeveloperInstructions) === normalizeText(params.codexDeveloperInstructions) &&
		normalizeText(session.geminiSystemPromptText) === normalizeText(params.geminiSystemPromptText) &&
		session.bridgeConfigSignature === params.bridgeConfigSignature &&
		hasPrefix(session.contextMessageSignatures, params.contextMessageSignatures)
	);
}

function isPersistedSessionCompatible(
	record: PersistedBridgeSessionRecord,
	params: EnsureBridgeSessionParams,
	normalizedSystemPrompt: string | undefined,
): boolean {
	return (
		record.cwd === params.cwd &&
		normalizeText(record.systemPromptAppend) === normalizedSystemPrompt &&
		normalizeText(record.codexDeveloperInstructions) === normalizeText(params.codexDeveloperInstructions) &&
		normalizeText(record.geminiSystemPromptText) === normalizeText(params.geminiSystemPromptText) &&
		record.bridgeConfigSignature === params.bridgeConfigSignature &&
		hasPrefix(record.contextMessageSignatures, params.contextMessageSignatures)
	);
}

function buildSessionMeta(
	params: EnsureBridgeSessionParams,
	normalizedSystemPrompt: string | undefined,
): Record<string, any> | undefined {
	return buildSessionMetaForBackend(params.backend, params, normalizedSystemPrompt);
}

function resolveModelIdFromSessionResponse(response: any, fallback?: string): string | undefined {
	const currentModelId = response?.models?.currentModelId;
	return typeof currentModelId === "string" && currentModelId.length > 0 ? currentModelId : fallback;
}

async function enforceRequestedSessionModel(
	session: AcpBridgeSession,
	requestedModelId: string | undefined,
): Promise<void> {
	if (!requestedModelId) return;
	const fromModel = session.modelId;
	const setModel = session.connection.unstable_setSessionModel;
	if (typeof setModel !== "function") {
		logBridgeModelSwitch(session, {
			path: "bootstrap",
			outcome: "unsupported",
			fromModel,
			toModel: requestedModelId,
		});
		return;
	}
	try {
		await setModel.call(session.connection, {
			sessionId: session.acpSessionId,
			modelId: requestedModelId,
		});
		session.modelId = requestedModelId;
		logBridgeModelSwitch(session, {
			path: "bootstrap",
			outcome: "applied",
			fromModel,
			toModel: requestedModelId,
		});
	} catch (error) {
		logBridgeModelSwitch(session, {
			path: "bootstrap",
			outcome: "failed",
			fromModel,
			toModel: requestedModelId,
			reason: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function isChildExited(child: ChildProcessByStdio<any, any, any>): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function awaitChildExit(child: ChildProcessByStdio<any, any, any>, timeoutMs: number): Promise<"exited" | "timeout"> {
	if (isChildExited(child)) return Promise.resolve("exited");
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve("timeout"), timeoutMs);
		timer.unref?.();
		child.once("exit", () => {
			clearTimeout(timer);
			resolve("exited");
		});
	});
}

function killProcessTree(child: ChildProcessByStdio<any, any, any>, sessionKey: string, backend: AcpBackend): void {
	const pid = child.pid;
	if (!pid) return;
	if (process.platform !== "win32") {
		try {
			process.kill(-pid, "SIGTERM");
			const timer = setTimeout(() => {
				if (isChildExited(child)) return;
				try {
					process.kill(-pid, "SIGKILL");
					logBridgeOrphanKill(sessionKey, pid, backend);
				} catch {
					// ignore
				}
			}, 1500);
			timer.unref?.();
			return;
		} catch {
			// fall through to direct kill
		}
	}
	try {
		child.kill("SIGTERM");
	} catch {
		// ignore
	}
}

async function destroyBridgeSession(
	session: AcpBridgeSession,
	options: Required<CloseBridgeSessionOptions>,
): Promise<void> {
	if (bridgeSessions.get(session.key) === session) {
		bridgeSessions.delete(session.key);
	}
	session.closed = true;
	session.activePromptHandler = undefined;
	if (options.invalidatePersisted) {
		deletePersistedSessionRecord(session.key);
	}
	let closedRemote: "ok" | "fail" | "skip" = "skip";
	if (options.closeRemote && session.capabilities.closeSession && session.acpSessionId) {
		try {
			await session.connection.closeSession({ sessionId: session.acpSessionId });
			closedRemote = "ok";
		} catch {
			closedRemote = "fail";
		}
	}
	const childPid = session.child.pid;
	killProcessTree(session.child, session.key, session.backend);
	const childExit = await awaitChildExit(session.child, 2000);
	logBridgeShutdown(session, {
		closeRemote: options.closeRemote,
		invalidatePersisted: options.invalidatePersisted,
		childPid,
		closedRemote,
		childExit,
	});
}

function formatBootstrapPayload(payload: Record<string, unknown>): string {
	return Object.entries(payload)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => {
			const str = typeof v === "string" ? v : String(v);
			return /[\s"]/.test(str) ? `${k}="${str.replace(/"/g, '\\"')}"` : `${k}=${str}`;
		})
		.join(" ");
}

type BootstrapInvalidationReason = "incompatible_config" | "bootstrap_exhausted";

function logBridgeBootstrap(session: AcpBridgeSession, extra?: Record<string, unknown>): void {
	const line = formatBootstrapPayload({
		path: session.bootstrapPath,
		backend: session.backend,
		sessionKey: session.key,
		acpSessionId: session.acpSessionId,
		persistedAcpSessionId: session.persistedAcpSessionId,
		...(extra || {}),
	});
	console.error(`[pi-shell-acp:bootstrap] ${line}`);
}

function logBridgeBootstrapFallback(sessionKey: string, from: "resume" | "load", error: unknown): void {
	const reason = error instanceof Error ? error.message : String(error);
	const line = formatBootstrapPayload({
		from,
		sessionKey,
		reason: reason.slice(0, 200),
	});
	console.error(`[pi-shell-acp:bootstrap-fallback] ${line}`);
}

function logBridgeBootstrapInvalidate(
	sessionKey: string,
	reason: BootstrapInvalidationReason,
	previousAcpSessionId?: string,
): void {
	const line = formatBootstrapPayload({
		sessionKey,
		reason,
		previousAcpSessionId,
	});
	console.error(`[pi-shell-acp:bootstrap-invalidate] ${line}`);
}

export type CancelOutcome = "dispatched" | "unsupported" | "failed";

export type ModelSwitchOutcome = "applied" | "unsupported" | "failed";
export type ModelSwitchPath = "bootstrap" | "reuse";

function logBridgeModelSwitch(
	session: AcpBridgeSession,
	extra: {
		path: ModelSwitchPath;
		outcome: ModelSwitchOutcome;
		fromModel?: string;
		toModel?: string;
		reason?: string;
		fallback?: "new_session" | "none";
	},
): void {
	const line = formatBootstrapPayload({
		path: extra.path,
		outcome: extra.outcome,
		sessionKey: session.key,
		backend: session.backend,
		acpSessionId: session.acpSessionId,
		fromModel: extra.fromModel,
		toModel: extra.toModel,
		fallback: extra.fallback,
		reason: extra.reason ? extra.reason.slice(0, 200) : undefined,
	});
	console.error(`[pi-shell-acp:model-switch] ${line}`);
}

function logBridgeCancel(session: AcpBridgeSession, outcome: CancelOutcome, reason?: string): void {
	const line = formatBootstrapPayload({
		sessionKey: session.key,
		backend: session.backend,
		acpSessionId: session.acpSessionId,
		outcome,
		reason: reason ? reason.slice(0, 200) : undefined,
	});
	console.error(`[pi-shell-acp:cancel] ${line}`);
}

function logBridgeShutdown(
	session: AcpBridgeSession,
	extra: {
		closeRemote: boolean;
		invalidatePersisted: boolean;
		childPid: number | undefined;
		closedRemote: "ok" | "fail" | "skip";
		childExit: "exited" | "timeout";
	},
): void {
	const line = formatBootstrapPayload({
		sessionKey: session.key,
		backend: session.backend,
		acpSessionId: session.acpSessionId,
		...extra,
	});
	console.error(`[pi-shell-acp:shutdown] ${line}`);
}

function logBridgeOrphanKill(sessionKey: string, pid: number, backend: AcpBackend): void {
	const line = formatBootstrapPayload({
		sessionKey,
		backend,
		pid,
		signal: "SIGKILL",
	});
	console.error(`[pi-shell-acp:orphan-kill] ${line}`);
}

function isStrictBootstrapEnabled(): boolean {
	const v = process.env.PI_SHELL_ACP_STRICT_BOOTSTRAP?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

async function createBridgeProcess(params: EnsureBridgeSessionParams): Promise<AcpBridgeSession> {
	const adapter = resolveAcpBackendAdapter(params.backend);
	// run.sh smoke embed scripts call ensureBridgeSession directly without
	// going through loadProviderSettings, so codexDisabledFeatures may be
	// undefined here. Normalize once with the same default that
	// loadProviderSettings would have applied (DEFAULT_CODEX_DISABLED_FEATURES)
	// so smoke and production paths see identical behavior. Backend-agnostic:
	// the claude adapter ignores this field, so the default is harmless even
	// for claude smoke runs.
	const codexDisabledFeatures = params.codexDisabledFeatures ?? [...DEFAULT_CODEX_DISABLED_FEATURES];
	const launch = adapter.resolveLaunch({
		codexDisabledFeatures,
		codexDeveloperInstructions: normalizeText(params.codexDeveloperInstructions),
	});
	// Adapter defaults first, process.env last → operator's shell always wins.
	// PI_SHELL_ACP_ALLOW_COMPACTION=1 disables both pi-side and backend-side
	// compaction guards for this process.
	// Resolve the spawned child's env defaults. PI_SHELL_ACP_ALLOW_COMPACTION=1
	// removes only the compaction-guard keys (Claude's
	// DISABLE_AUTO_COMPACT / DISABLE_COMPACT). Identity-isolation keys
	// (CODEX_HOME, CODEX_SQLITE_HOME, CLAUDE_CONFIG_DIR) stay regardless —
	// they are invariants required by the operator-config-isolation
	// design, not policy choices an operator can opt out of via the
	// compaction toggle. Conflating the two would silently leak the
	// operator's ~/.codex or ~/.claude into the bridge child process the
	// moment compaction is allowed.
	const bridgeEnvDefaults = resolveBridgeEnvDefaults(params.backend, {
		allowCompaction: isCompactionAllowedByOperator(),
	});
	// Refresh the claude config overlay before every claude session bootstrap.
	// Idempotent — picks up any new entries that appeared in ~/.claude/ since
	// the last run (e.g. a freshly created project) without manual intervention.
	if (params.backend === "claude" && bridgeEnvDefaults?.CLAUDE_CONFIG_DIR === CLAUDE_CONFIG_OVERLAY_DIR) {
		try {
			ensureClaudeConfigOverlay();
		} catch (error) {
			console.error(
				`[pi-shell-acp:claude-overlay] failed to prepare overlay; falling back to operator's CLAUDE_CONFIG_DIR if any: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (params.backend === "codex" && bridgeEnvDefaults?.CODEX_HOME === CODEX_CONFIG_OVERLAY_DIR) {
		try {
			ensureCodexConfigOverlay();
		} catch (error) {
			console.error(
				`[pi-shell-acp:codex-overlay] failed to prepare overlay; falling back to operator's CODEX_HOME if any: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	// Refresh the gemini config overlay before every gemini session bootstrap.
	// Idempotent — picks up any new auth files appearing in ~/.gemini/ since
	// the last run (e.g. operator re-auth) without manual intervention. The
	// engraving is rewritten into system.md every spawn; keeping the file
	// content fresh matches the codex `developer_instructions` / claude
	// `_meta.systemPrompt` re-delivery cadence (one per spawn).
	if (params.backend === "gemini" && bridgeEnvDefaults?.GEMINI_CLI_HOME === GEMINI_CONFIG_OVERLAY_HOME) {
		try {
			ensureGeminiConfigOverlay(params.geminiSystemPromptText);
		} catch (error) {
			console.error(
				`[pi-shell-acp:gemini-overlay] failed to prepare overlay; falling back to operator's GEMINI_CLI_HOME if any: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	// claude-agent-acp 0.31.0 (dist/acp-agent.js:1298) reads
	// `process.env.CLAUDE_CODE_EXECUTABLE` only and ignores the
	// `_meta.claudeCode.options.pathToClaudeCodeExecutable` we pass. Without
	// the env var, the SDK's auto-detect (`[musl, glibc]` order) resolves
	// the musl variant first via NODE_PATH (pnpm-installed pi-coding-agent
	// hoists both variants, no libc filter) and spawn fails with ENOENT on
	// glibc hosts. Force the libc-aware path through the env so the SDK's
	// auto-detect is bypassed entirely. process.env spread last —
	// operator's exported var still wins.
	const claudeCodeExe = params.backend === "claude" ? resolveClaudeCodeExecutable() : undefined;
	const childEnv = {
		...bridgeEnvDefaults,
		...(claudeCodeExe ? { CLAUDE_CODE_EXECUTABLE: claudeCodeExe } : {}),
		...process.env,
		...(params.emacsAgentSocket ? { PI_EMACS_AGENT_SOCKET: params.emacsAgentSocket } : {}),
	};
	const child = spawn(launch.command, launch.args, {
		cwd: params.cwd,
		env: childEnv,
		stdio: ["pipe", "pipe", "pipe"],
		detached: process.platform !== "win32",
	});

	const stderrTail: string[] = [];
	child.stderr.on("data", (chunk) => appendStderrTail(stderrTail, chunk));

	const stdoutReadable = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
	const stdinWritable = Writable.toWeb(child.stdin);
	// TODO(acp-mitigation): wrap stdoutReadable to coerce ToolCallLocation.line.
	//
	// Tracked under README "Upstream Dependencies":
	//   claude-agent-acp@0.31.0 — Read tool offset shape coercion (2026-04-29).
	//
	// Symptom: claude-agent-acp/src/tools.ts:165~181 maps Read tool input.offset
	// into ACP locations[0].line without coercion to Number. When the model
	// emits offset as a non-numeric shape (string range "1010, 1075", array,
	// etc.), locations[0].line ends up non-numeric. ACP SDK 0.20.0
	// zToolCallLocation requires line: z.number().int().gte(0); the
	// notification fails zod.parse and is silently dropped after a stderr log
	// "Error handling notification ... -32602 Invalid params". The session
	// survives; only that one tool_call_update is lost. Operator follow-along
	// breaks for that call.
	//
	// Local mitigation (when applied): TransformStream that, for each NDJSON
	// frame matching method === "session/update" && update.locations: array,
	// coerces each locations[i].line via Number() if string|array. If
	// coercion yields NaN we omit the line field rather than passing junk
	// downstream. Every coercion is logged to stderrTail — fail-loud, not
	// fail-silent. Other frames pass through untouched.
	//
	// Trigger to apply: a second incident with the same shape-error
	// signature, OR an explicit decision that silent-drop is unacceptable
	// now. If upstream resolves it on its own first, drop this TODO without
	// sending a PR — that is the intended outcome, not a regression of the
	// plan.
	const transport = createNdJsonMessageStream(stdinWritable, stdoutReadable);

	let session: AcpBridgeSession;
	const connection = new ClientSideConnection(
		() => ({
			sessionUpdate: async (notification: SessionNotification) => {
				await session.activePromptHandler?.({
					type: "session_notification",
					notification,
				});
			},
			requestPermission: async (request: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
				const response = resolvePermissionResponse(request);
				await session.activePromptHandler?.({
					type: "permission_request",
					request,
					response,
				});
				return response;
			},
			readTextFile: async (request: any): Promise<any> => {
				const content = readFileSync(request.path, "utf8");
				return { content };
			},
			writeTextFile: async (): Promise<any> => {
				throw new Error("Client-side writeTextFile is not supported in pi-shell-acp ACP mode.");
			},
		}),
		transport,
	);

	session = {
		key: params.sessionKey,
		cwd: params.cwd,
		backend: params.backend,
		launchSource: launch.source,
		stderrLabel: adapter.stderrLabel,
		child,
		connection,
		initializeResult: undefined as any,
		capabilities: {
			loadSession: false,
			resumeSession: false,
			closeSession: false,
		},
		acpSessionId: "",
		modelId: params.modelId,
		systemPromptAppend: normalizeText(params.systemPromptAppend),
		bootstrapPromptAugment: normalizeText(params.bootstrapPromptAugment),
		codexDeveloperInstructions: normalizeText(params.codexDeveloperInstructions),
		geminiSystemPromptText: normalizeText(params.geminiSystemPromptText),
		settingSources: [...params.settingSources],
		strictMcpConfig: params.strictMcpConfig,
		mcpServers: [...params.mcpServers],
		tools: [...params.tools],
		skillPlugins: [...params.skillPlugins],
		permissionAllow: [...params.permissionAllow],
		disallowedTools: [...params.disallowedTools],
		codexDisabledFeatures: [...codexDisabledFeatures],
		bridgeConfigSignature: params.bridgeConfigSignature,
		contextMessageSignatures: [...params.contextMessageSignatures],
		stderrTail,
		closed: false,
		bootstrapPath: "new",
	};

	child.once("exit", () => {
		session.closed = true;
		if (bridgeSessions.get(session.key) === session) {
			bridgeSessions.delete(session.key);
		}
	});
	child.once("error", () => {
		session.closed = true;
		if (bridgeSessions.get(session.key) === session) {
			bridgeSessions.delete(session.key);
		}
	});

	const initializeResult = await connection.initialize({
		protocolVersion: PROTOCOL_VERSION,
		clientCapabilities: {},
		clientInfo: {
			name: "pi-shell-acp",
			version: "2.0.0-acp",
		},
	});
	session.initializeResult = initializeResult;
	session.capabilities = detectSessionCapabilities(initializeResult);
	return session;
}

function armBootstrapPromptAugment(session: AcpBridgeSession): void {
	if (session.bootstrapPath !== "new") return;
	const augmentText = session.bootstrapPromptAugment;
	if (!augmentText) return;
	const adapter = resolveAcpBackendAdapter(session.backend);
	const blocks = adapter.buildBootstrapPromptAugment?.(augmentText);
	if (blocks && blocks.length > 0) {
		session.bootstrapPromptAugmentPending = blocks;
	}
}

async function startNewBridgeSession(
	params: EnsureBridgeSessionParams,
	invalidationHint?: { reason: BootstrapInvalidationReason; previousAcpSessionId: string },
): Promise<AcpBridgeSession> {
	const session = await createBridgeProcess(params);
	try {
		const meta = buildSessionMeta(params, session.systemPromptAppend);
		const created = await session.connection.newSession({
			cwd: params.cwd,
			mcpServers: [...params.mcpServers],
			...(meta ? { _meta: meta } : {}),
		});
		if (!created?.sessionId) {
			throw new Error(`ACP newSession returned no sessionId (${session.launchSource})`);
		}
		session.acpSessionId = created.sessionId;
		session.modelId = resolveModelIdFromSessionResponse(created, params.modelId);
		session.bootstrapPath = "new";
		if (invalidationHint) {
			session.persistedAcpSessionId = invalidationHint.previousAcpSessionId;
		}
		armBootstrapPromptAugment(session);
		await enforceRequestedSessionModel(session, params.modelId);
		bridgeSessions.set(params.sessionKey, session);
		persistBridgeSessionRecord(session);
		logBridgeBootstrap(
			session,
			invalidationHint ? { invalidated: true, invalidationReason: invalidationHint.reason } : undefined,
		);
		return session;
	} catch (error) {
		await destroyBridgeSession(session, {
			closeRemote: false,
			invalidatePersisted: false,
		});
		throw error;
	}
}

async function bootstrapPersistedBridgeSession(
	params: EnsureBridgeSessionParams,
	record: PersistedBridgeSessionRecord,
): Promise<AcpBridgeSession> {
	const session = await createBridgeProcess(params);
	const meta = buildSessionMeta(params, session.systemPromptAppend);
	let shouldInvalidatePersisted = false;
	try {
		if (session.capabilities.resumeSession) {
			try {
				const resumed = await session.connection.resumeSession({
					sessionId: record.acpSessionId,
					cwd: params.cwd,
					mcpServers: [...params.mcpServers],
					...(meta ? { _meta: meta } : {}),
				});
				session.acpSessionId = record.acpSessionId;
				session.modelId = resolveModelIdFromSessionResponse(resumed, params.modelId);
				session.bootstrapPath = "resume";
				session.persistedAcpSessionId = record.acpSessionId;
				await enforceRequestedSessionModel(session, params.modelId);
				bridgeSessions.set(params.sessionKey, session);
				persistBridgeSessionRecord(session);
				logBridgeBootstrap(session);
				return session;
			} catch (error) {
				shouldInvalidatePersisted = true;
				logBridgeBootstrapFallback(params.sessionKey, "resume", error);
			}
		}

		if (session.capabilities.loadSession) {
			try {
				const loaded = await session.connection.loadSession({
					sessionId: record.acpSessionId,
					cwd: params.cwd,
					mcpServers: [...params.mcpServers],
					...(meta ? { _meta: meta } : {}),
				});
				session.acpSessionId = record.acpSessionId;
				session.modelId = resolveModelIdFromSessionResponse(loaded, params.modelId);
				session.bootstrapPath = "load";
				session.persistedAcpSessionId = record.acpSessionId;
				await enforceRequestedSessionModel(session, params.modelId);
				bridgeSessions.set(params.sessionKey, session);
				persistBridgeSessionRecord(session);
				logBridgeBootstrap(session);
				return session;
			} catch (error) {
				shouldInvalidatePersisted = true;
				logBridgeBootstrapFallback(params.sessionKey, "load", error);
			}
		}

		if (shouldInvalidatePersisted) {
			logBridgeBootstrapInvalidate(params.sessionKey, "bootstrap_exhausted", record.acpSessionId);
			deletePersistedSessionRecord(params.sessionKey);
			if (isStrictBootstrapEnabled()) {
				throw new Error(
					`[pi-shell-acp] bootstrap_exhausted: resume and load both failed for sessionKey=${params.sessionKey} previousAcpSessionId=${record.acpSessionId}`,
				);
			}
		}

		const created = await session.connection.newSession({
			cwd: params.cwd,
			mcpServers: [...params.mcpServers],
			...(meta ? { _meta: meta } : {}),
		});
		if (!created?.sessionId) {
			throw new Error(`ACP newSession returned no sessionId (${session.launchSource})`);
		}
		session.acpSessionId = created.sessionId;
		session.modelId = resolveModelIdFromSessionResponse(created, params.modelId);
		session.bootstrapPath = "new";
		session.persistedAcpSessionId = shouldInvalidatePersisted ? record.acpSessionId : undefined;
		armBootstrapPromptAugment(session);
		await enforceRequestedSessionModel(session, params.modelId);
		bridgeSessions.set(params.sessionKey, session);
		persistBridgeSessionRecord(session);
		logBridgeBootstrap(
			session,
			shouldInvalidatePersisted ? { invalidated: true, invalidationReason: "bootstrap_exhausted" } : undefined,
		);
		return session;
	} catch (error) {
		await destroyBridgeSession(session, {
			closeRemote: false,
			invalidatePersisted: false,
		});
		throw error;
	}
}

export async function ensureBridgeSession(params: EnsureBridgeSessionParams): Promise<AcpBridgeSession> {
	const normalizedSystemPrompt = normalizeText(params.systemPromptAppend);
	const normalizedBootstrapAugment = normalizeText(params.bootstrapPromptAugment);
	const normalizedParams: EnsureBridgeSessionParams = {
		...params,
		systemPromptAppend: normalizedSystemPrompt,
		bootstrapPromptAugment: normalizedBootstrapAugment,
	};
	const existing = bridgeSessions.get(params.sessionKey);
	const existingCompatible = existing ? isSessionCompatible(existing, normalizedParams, normalizedSystemPrompt) : false;
	if (existing && existingCompatible && !existing.closed && isChildAlive(existing.child)) {
		if (params.modelId && existing.modelId !== params.modelId) {
			const fromModel = existing.modelId;
			const toModel = params.modelId;
			const setModel = existing.connection.unstable_setSessionModel;
			if (typeof setModel !== "function") {
				logBridgeModelSwitch(existing, {
					path: "reuse",
					outcome: "unsupported",
					fromModel,
					toModel,
					fallback: "new_session",
				});
				await closeBridgeSession(params.sessionKey);
				return await startNewBridgeSession(normalizedParams);
			}
			try {
				await setModel.call(existing.connection, {
					sessionId: existing.acpSessionId,
					modelId: toModel,
				});
				existing.modelId = toModel;
				logBridgeModelSwitch(existing, {
					path: "reuse",
					outcome: "applied",
					fromModel,
					toModel,
				});
			} catch (error) {
				logBridgeModelSwitch(existing, {
					path: "reuse",
					outcome: "failed",
					fromModel,
					toModel,
					fallback: "new_session",
					reason: error instanceof Error ? error.message : String(error),
				});
				await closeBridgeSession(params.sessionKey);
				return await startNewBridgeSession(normalizedParams);
			}
		}
		existing.settingSources = [...params.settingSources];
		existing.strictMcpConfig = params.strictMcpConfig;
		existing.tools = [...params.tools];
		existing.skillPlugins = [...params.skillPlugins];
		existing.permissionAllow = [...params.permissionAllow];
		existing.disallowedTools = [...params.disallowedTools];
		// Same normalization as createBridgeProcess: smoke embed callers may
		// omit this field; default to DEFAULT_CODEX_DISABLED_FEATURES so reuse
		// path stays consistent with the launch path.
		existing.codexDisabledFeatures = [...(params.codexDisabledFeatures ?? DEFAULT_CODEX_DISABLED_FEATURES)];
		existing.bridgeConfigSignature = params.bridgeConfigSignature;
		existing.contextMessageSignatures = [...params.contextMessageSignatures];
		existing.bootstrapPath = "reuse";
		persistBridgeSessionRecord(existing);
		logBridgeBootstrap(existing);
		return existing;
	}

	if (existing) {
		await closeBridgeSession(params.sessionKey, {
			closeRemote: isChildAlive(existing.child),
			invalidatePersisted: !existingCompatible,
		});
	}

	const persisted = readPersistedSessionRecord(params.sessionKey);
	if (persisted) {
		if (!isPersistedSessionCompatible(persisted, normalizedParams, normalizedSystemPrompt)) {
			logBridgeBootstrapInvalidate(params.sessionKey, "incompatible_config", persisted.acpSessionId);
			deletePersistedSessionRecord(params.sessionKey);
			return await startNewBridgeSession(normalizedParams, {
				reason: "incompatible_config",
				previousAcpSessionId: persisted.acpSessionId,
			});
		}
		return await bootstrapPersistedBridgeSession(normalizedParams, persisted);
	}

	return await startNewBridgeSession(normalizedParams);
}

export function setActivePromptHandler(session: AcpBridgeSession, handler: PendingPromptHandler | undefined): void {
	session.activePromptHandler = handler;
}

function ensurePromptSeparator(text: string): string {
	const trimmed = text.trimEnd();
	return trimmed.length > 0 ? `${trimmed}\n\n` : trimmed;
}

function removeCwdAgentsSectionFromAugment(text: string, cwd: string): string {
	const heading = `## ${join(cwd, "AGENTS.md")}\n\n`;
	const start = text.indexOf(heading);
	if (start < 0) return text;

	const afterHeading = start + heading.length;
	const nextProjectHeading = text.indexOf("\n\n## ", afterHeading);
	const currentDateSection = text.indexOf("\n\nCurrent date:", afterHeading);
	const candidates = [nextProjectHeading, currentDateSection].filter((idx) => idx >= 0);
	const end = candidates.length > 0 ? Math.min(...candidates) : text.length;
	let result = `${text.slice(0, start).trimEnd()}${text.slice(end)}`;

	const projectHeader = "# Project Context\n\nProject-specific instructions and guidelines:";
	const projectStart = result.indexOf(projectHeader);
	if (projectStart >= 0) {
		const projectEnd = result.indexOf("\n\nCurrent date:", projectStart + projectHeader.length);
		const projectBody =
			projectEnd >= 0
				? result.slice(projectStart + projectHeader.length, projectEnd)
				: result.slice(projectStart + projectHeader.length);
		if (!projectBody.includes("\n## ")) {
			result =
				projectEnd >= 0
					? `${result.slice(0, projectStart).trimEnd()}${result.slice(projectEnd)}`
					: result.slice(0, projectStart).trimEnd();
		}
	}

	return result.trim();
}

export async function sendPrompt(session: AcpBridgeSession, prompt: PromptContentBlock[]): Promise<PromptResponse> {
	// First prompt after a bootstrapPath="new" session may carry an adapter-
	// supplied ContentBlock prepend — the pi-context augment (bridge identity
	// narrative + pi base + ~/AGENTS.md + cwd/AGENTS.md + date/cwd). Consume
	// the pending slot exactly once so subsequent turns stay clean.
	//
	// Entwurf de-dup: when this ACP session is the one spawned by
	// `entwurf(...)` and the caller's `enrichTaskWithProjectContext` already
	// prepended a `<project-context path=…>` block to the task, the cwd
	// AGENTS.md content is already present. Keep the rest of the augment
	// (bridge narrative, pi base, home AGENTS.md, date/cwd) but remove only
	// the duplicate cwd AGENTS.md section. Still clear the pending slot so
	// future turns stay clean either way.
	const pending = session.bootstrapPromptAugmentPending;
	session.bootstrapPromptAugmentPending = undefined;
	const firstText = prompt.find((b): b is { type: "text"; text: string } => b.type === "text")?.text ?? "";
	const hasEntwurfProjectContext = firstText.trimStart().startsWith(ENTWURF_PROJECT_CONTEXT_OPEN_TAG);
	const effectivePending = pending?.map((block) => {
		if (block.type !== "text") return block;
		const text = hasEntwurfProjectContext ? removeCwdAgentsSectionFromAugment(block.text, session.cwd) : block.text;
		return { ...block, text: ensurePromptSeparator(text) };
	});
	const effectivePrompt = effectivePending && effectivePending.length > 0 ? [...effectivePending, ...prompt] : prompt;
	return await session.connection.prompt({
		sessionId: session.acpSessionId,
		prompt: effectivePrompt,
	});
}

export async function cancelActivePrompt(session: AcpBridgeSession): Promise<CancelOutcome> {
	const cancel = session.connection.cancel;
	if (typeof cancel !== "function") {
		logBridgeCancel(session, "unsupported");
		return "unsupported";
	}
	try {
		await cancel.call(session.connection, { sessionId: session.acpSessionId });
		logBridgeCancel(session, "dispatched");
		return "dispatched";
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logBridgeCancel(session, "failed", reason);
		return "failed";
	}
}

export async function closeBridgeSession(sessionKey: string, options: CloseBridgeSessionOptions = {}): Promise<void> {
	const session = bridgeSessions.get(sessionKey);
	if (!session) {
		if (options.invalidatePersisted !== false) {
			deletePersistedSessionRecord(sessionKey);
		}
		return;
	}
	await destroyBridgeSession(session, {
		closeRemote: options.closeRemote ?? true,
		invalidatePersisted: options.invalidatePersisted ?? true,
	});
}

export async function cleanupBridgeSessionProcess(sessionKey: string): Promise<void> {
	await closeBridgeSession(sessionKey, {
		closeRemote: false,
		invalidatePersisted: false,
	});
}

export function describeBridgeSession(session: AcpBridgeSession): Record<string, unknown> {
	return {
		sessionKey: session.key,
		cwd: session.cwd,
		bootstrapPath: session.bootstrapPath,
		acpSessionId: session.acpSessionId,
		persistedAcpSessionId: session.persistedAcpSessionId,
		backend: session.backend,
		launchSource: session.launchSource,
		modelId: session.modelId,
		capabilities: {
			resumeSession: session.capabilities.resumeSession,
			loadSession: session.capabilities.loadSession,
			closeSession: session.capabilities.closeSession,
		},
	};
}

export function getBridgeErrorDetails(error: unknown, session?: AcpBridgeSession): string {
	const message = error instanceof Error ? error.message : String(error);
	const diagnostic = session
		? `\n\n[pi-shell-acp session]\n${JSON.stringify(describeBridgeSession(session), null, 2)}`
		: "";
	const stderrTail = session?.stderrTail?.slice(-20)?.join("\n");
	const stderrBlock = stderrTail ? `\n\n[${session?.stderrLabel ?? "acp stderr"}]\n${stderrTail}` : "";
	return `${message}${diagnostic}${stderrBlock}`;
}
