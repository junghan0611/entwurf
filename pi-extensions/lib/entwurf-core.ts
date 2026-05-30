/**
 * entwurf-core — sync entwurf execution, host-agnostic.
 *
 * Single implementation shared by:
 *   - pi-extensions/entwurf.ts (pi native tool surface)
 *   - mcp/pi-tools-bridge/src/index.ts (MCP tool surface for ACP hosts)
 *
 * This module MUST NOT import anything from @earendil-works/pi-coding-agent or any
 * other pi runtime API. It is pure Node + @sinclair/typebox-free.  Anything that
 * requires pi's ExtensionAPI (sendMessage, appendEntry, sessionManager) belongs
 * in the async entwurf path, which stays in pi-extensions/entwurf.ts for now.
 *
 * Scope:
 *   - sync execution (spawn pi, collect message_end events, return summary)
 *   - local and SSH-remote hosts
 *   - project-context injection (cwd/AGENTS.md)
 *   - explicit compat extension resolution for Claude models + opt-in Codex ACP routing
 *
 * Provider bridge routing contract:
 *   - Claude models (claude-*)            — always routed through pi-shell-acp.
 *     If pi-shell-acp can't be resolved, falls back to pi-claude-code-use, then warns.
 *   - Codex models (openai-codex/*, gpt-5*) — default is the direct openai-codex provider.
 *     Opt-in via env var `PI_ENTWURF_ACP_FOR_CODEX=1` routes Codex through pi-shell-acp,
 *     in which case `normalizeCodexEntwurfModelForAcp()` strips the `openai-codex/`
 *     prefix because the bridge forwards the model id verbatim to codex-acp, which
 *     only accepts the bare backend id (e.g. `gpt-5.4`) on ChatGPT accounts.
 *
 * The `modelOverride` return field communicates this normalization to the caller so
 * the spawned pi --model matches what the downstream ACP backend expects.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTWURF_PROJECT_CONTEXT_OPEN_TAG } from "../../protocol.js";

// ============================================================================
// Constants
// ============================================================================

// Expand a leading ~ like pi's expandTildePath, so PI_CODING_AGENT_DIR=~/foo
// resolves the same way pi's getAgentDir() would.
function expandTilde(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

// Local agent dir honors PI_CODING_AGENT_DIR — the same env pi's getAgentDir()
// reads (config.ts: ENV_AGENT_DIR). Without this, an isolated install-topology
// smoke that points pi at a temp agent dir could not steer the entwurf resolver
// at the same synthetic install tree (#29 correction). Remote (SSH) roots are
// deliberately NOT env-derived — see packageSourceToRoots: a local override must
// not leak into the remote host's path.
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? expandTilde(process.env.PI_CODING_AGENT_DIR)
	: path.join(os.homedir(), ".pi", "agent");
const PI_SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");
const SESSIONS_BASE = path.join(AGENT_DIR, "sessions");
const ENTWURF_TARGETS_PATH = process.env.PI_ENTWURF_TARGETS_PATH ?? path.join(AGENT_DIR, "entwurf-targets.json");
export const DEFAULT_ENTWURF_MODEL = "openai-codex/gpt-5.4";
export const ENTWURF_CODEX_ACP_ENV = "PI_ENTWURF_ACP_FOR_CODEX";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ============================================================================
// Types
// ============================================================================

export interface EntwurfSyncOptions {
	host?: string;
	cwd?: string;
	/** Caller-provided provider id (e.g. "pi-shell-acp", "openai-codex"). Optional;
	 *  if model is qualified ("provider/name") or unambiguous in the registry,
	 *  this can be omitted. See resolveEntwurfTarget for resolution rules. */
	provider?: string;
	model?: string;
	signal?: AbortSignal;
	onUpdate?: (text: string) => void;
}

export interface EntwurfResult {
	task: string;
	host: string;
	exitCode: number;
	output: string;
	turns: number;
	cost: number;
	model?: string;
	error?: string;
	stopReason?: string;
	/** Short id (8 hex chars) embedded in the session filename. Use this to call entwurf_resume. */
	taskId: string;
	sessionFile?: string;
	explicitExtensions: string[];
	warnings: string[];
}

export interface AssistantMessageLike {
	role?: string;
	content?: unknown;
	usage?: { cost?: { total?: number } };
	model?: string;
	provider?: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface SessionAnalysis {
	lastAssistantText: string | null;
	lastError: string | null;
	lastStopReason: string | null;
	lastModel: string | null;
	lastProvider: string | null;
	turns: number;
	cost: number;
}

export interface ExplicitExtensionSpec {
	name: string;
	localPath: string;
	remotePath: string;
}

// ============================================================================
// Path / model helpers
// ============================================================================

export function cwdToSessionDir(cwd: string): string {
	const normalized = cwd.replace(/\/$/, "");
	const dirName = "--" + normalized.replace(/^\//, "").replace(/\//g, "-") + "--";
	return path.join(SESSIONS_BASE, dirName);
}

export function resolveEntwurfModel(model?: string): string {
	const trimmed = model?.trim();
	return trimmed ? trimmed : DEFAULT_ENTWURF_MODEL;
}

export function isClaudeModel(model?: string): boolean {
	return typeof model === "string" && /(^|\/)claude-/.test(model);
}

export function isCodexModel(model?: string): boolean {
	if (typeof model !== "string") return false;
	const trimmed = model.trim();
	if (!trimmed) return false;

	const [provider, basename = trimmed] = trimmed.includes("/") ? trimmed.split("/", 2) : ["", trimmed];
	return provider === "openai-codex" || /^gpt-5([.-]|$)/.test(basename) || basename.includes("codex");
}

export function shouldRouteCodexViaAcp(model?: string): boolean {
	return isCodexModel(model) && process.env[ENTWURF_CODEX_ACP_ENV] === "1";
}

export function normalizeCodexEntwurfModelForAcp(model?: string): string | undefined {
	if (!isCodexModel(model) || typeof model !== "string") return model;
	return model.startsWith("openai-codex/") ? model.slice("openai-codex/".length) : model;
}

// ============================================================================
// Entwurf Target Registry (v1) — narrow door
//
// SSOT for what (provider, model) pairs may be spawned via entwurf.
// File: ~/.pi/agent/entwurf-targets.json (override with PI_ENTWURF_TARGETS_PATH).
// See pi-shell-acp/AGENTS.md §Entwurf Orchestration (Entwurf Target Registry) for principle and schema.
//
// Spawn flow goes through this gate. Resume flow does NOT — Identity Preservation
// Rule states that an existing being is preserved as-is, regardless of current
// policy. Removing a target from the registry only stops new spawns; it does
// not retroactively forbid resuming sessions that were already created.
// ============================================================================

export interface EntwurfTarget {
	provider: string;
	model: string;
	enabled: boolean;
	/** When true, this target is excluded from bare-model auto-resolution. Caller
	 *  must specify provider explicitly to use it. Useful for test-only routings
	 *  (e.g. ACP GPT alongside default native GPT). */
	explicitOnly?: boolean;
}

export interface EntwurfRegistry {
	entwurfTargets: EntwurfTarget[];
}

export class EntwurfRegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EntwurfRegistryError";
	}
}

// Raised when a spawn is routed to provider=pi-shell-acp but the bridge extension
// cannot be resolved from settings package sources or the loaded module self-root.
// Fail-fast before spawning a child with `--no-extensions --provider pi-shell-acp`,
// which would otherwise die with `Unknown provider "pi-shell-acp"` (#29).
export class EntwurfRoutingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EntwurfRoutingError";
	}
}

// Positive-only cache. We intentionally do NOT cache EntwurfRegistryError —
// caching a missing/broken registry once would make the same MCP/pi process
// refuse every subsequent entwurf spawn even after the operator fixed the
// file (e.g. ran `./run.sh setup:links` to relink the canonical registry).
// That negative-cache trap was the root cause of the v0.4.x oracle install
// regression: a stale operator file produced an EntwurfRegistryError on
// first call, and the cached error survived the symlink repair.
//
// We keep a positive cache for hot-path performance, but invalidate it via
// the file's mtime so that operator edits to entwurf-targets.json are
// picked up on the next call without process restart.
interface CachedRegistry {
	registry: EntwurfRegistry;
	mtimeMs: number;
}
let cachedRegistry: CachedRegistry | null = null;

export function loadEntwurfTargets(): EntwurfRegistry {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(ENTWURF_TARGETS_PATH);
	} catch {
		// Missing — never cache. Operator may relink at any time and the next
		// call must see the new file.
		throw new EntwurfRegistryError(
			`Entwurf target registry not found at ${ENTWURF_TARGETS_PATH}. ` +
				`Without it, every entwurf spawn is refused. Run \`./run.sh setup:links\` ` +
				`or create the file manually (see pi-shell-acp/pi/entwurf-targets.json for the canonical shape).`,
		);
	}

	if (cachedRegistry && cachedRegistry.mtimeMs === stat.mtimeMs) {
		return cachedRegistry.registry;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(ENTWURF_TARGETS_PATH, "utf-8"));
	} catch (e) {
		throw new EntwurfRegistryError(
			`Failed to parse ${ENTWURF_TARGETS_PATH}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	if (typeof raw !== "object" || raw === null || !("entwurfTargets" in raw)) {
		throw new EntwurfRegistryError(
			`Invalid registry shape in ${ENTWURF_TARGETS_PATH}: expected { entwurfTargets: [...] }`,
		);
	}

	const targetsRaw = (raw as { entwurfTargets: unknown }).entwurfTargets;
	if (!Array.isArray(targetsRaw)) {
		throw new EntwurfRegistryError(`Invalid entwurfTargets in ${ENTWURF_TARGETS_PATH}: must be an array`);
	}

	const targets: EntwurfTarget[] = [];
	for (let i = 0; i < targetsRaw.length; i++) {
		const t = targetsRaw[i];
		if (typeof t !== "object" || t === null) {
			throw new EntwurfRegistryError(`Entry #${i} is not an object`);
		}
		const obj = t as Record<string, unknown>;
		if (typeof obj.provider !== "string" || !obj.provider.trim()) {
			throw new EntwurfRegistryError(`Entry #${i}: provider must be a non-empty string`);
		}
		if (typeof obj.model !== "string" || !obj.model.trim()) {
			throw new EntwurfRegistryError(`Entry #${i}: model must be a non-empty string`);
		}
		if (typeof obj.enabled !== "boolean") {
			throw new EntwurfRegistryError(`Entry #${i}: enabled must be a boolean`);
		}
		if (obj.explicitOnly !== undefined && typeof obj.explicitOnly !== "boolean") {
			throw new EntwurfRegistryError(`Entry #${i}: explicitOnly must be boolean if present`);
		}
		targets.push({
			provider: obj.provider.trim(),
			model: obj.model.trim(),
			enabled: obj.enabled,
			explicitOnly: obj.explicitOnly === true ? true : undefined,
		});
	}

	const registry: EntwurfRegistry = { entwurfTargets: targets };
	cachedRegistry = { registry, mtimeMs: stat.mtimeMs };
	return registry;
}

/** Test-only hook to reset the in-memory cache (e.g. between test runs). */
export function _resetEntwurfRegistryCache(): void {
	cachedRegistry = null;
}

// ============================================================================
// Child stderr mirror (opt-in, sentinel observability)
//
// Gated by env PI_ENTWURF_CHILD_STDERR_LOG. When set, any entwurf child pi
// process spawned here also has its stderr appended to the given path. The
// sentinel uses this to grep for child-side `[pi-shell-acp:bootstrap]` bridge
// markers when asserting continuity — parent stderr can't see that signal
// because the bridge lives in the child when target provider is pi-shell-acp.
//
// Opt-in (env unset → no-op) so production runs pay nothing. A write failure
// surfaces on console.error instead of being silently swallowed (see the "No
// 면피" invariant in AGENTS.md): a misconfigured diagnostic should be visible.
// ============================================================================

export function mirrorChildStderr(proc: ChildProcess): void {
	const logPath = process.env.PI_ENTWURF_CHILD_STDERR_LOG;
	if (!logPath || !proc.stderr) return;
	const writer = fs.createWriteStream(logPath, { flags: "a" });
	writer.on("error", (err) => {
		console.error(`[entwurf] child stderr mirror failed (${logPath}): ${err.message}`);
	});
	proc.stderr.on("data", (data: Buffer) => writer.write(data));
	proc.on("close", () => writer.end());
}

// ============================================================================
// Spawn guard — one entwurf spawn per (session, target) per process.
//
// Shared by pi native tool (pi-extensions/entwurf.ts) and the MCP bridge
// (mcp/pi-tools-bridge). Both paths must go through this gate before calling
// runEntwurfSync / runEntwurfAsync. entwurf_resume deliberately bypasses it.
//
// Map key is the caller-provided sessionId:
//   - pi native: pi.sessionManager.getSessionId()
//   - MCP bridge: process.pid (the MCP subprocess is one Claude session)
// Resets on process restart, which is the intended lifetime.
// ============================================================================

const usedEntwurfTargets = new Map<string, Set<string>>();

export function ensureEntwurfOncePerTarget(sessionId: string, targetKey: string): void {
	const seen = usedEntwurfTargets.get(sessionId);
	if (seen && seen.has(targetKey)) {
		throw new Error(`entwurf to ${targetKey} already exists in this session. Use entwurf_resume to continue.`);
	}
}

export function markEntwurfTargetUsed(sessionId: string, targetKey: string): void {
	let seen = usedEntwurfTargets.get(sessionId);
	if (!seen) {
		seen = new Set();
		usedEntwurfTargets.set(sessionId, seen);
	}
	seen.add(targetKey);
}

export function resolveGuardTargetKey(provider: string | undefined, model: string | undefined): string {
	const fallbackModel = model && model.trim() ? model : DEFAULT_ENTWURF_MODEL;
	const target = resolveEntwurfTarget({ provider, model: fallbackModel });
	return `${target.provider}/${target.model}`;
}

/** Test-only: reset the guard state so unit tests can reuse a single process. */
export function _resetUsedEntwurfTargets(): void {
	usedEntwurfTargets.clear();
}

export interface ResolvedTarget {
	provider: string;
	model: string;
	explicitOnly: boolean;
}

/**
 * Resolve caller input to an exact (provider, model) tuple from the registry.
 *
 * Resolution rules (narrow door):
 *   1. Qualified `provider/model` in `model` → split, exact lookup.
 *   2. `provider` + `model` both given → exact lookup.
 *   3. Bare `model` only → registry entries matching that model name where
 *      `explicitOnly !== true`:
 *        - 0 candidates → reject.
 *        - 1 candidate → use it.
 *        - 2+ candidates → reject as ambiguous.
 *
 * In all paths the resolved tuple must be present in the registry with
 * `enabled: true`. Otherwise `EntwurfRegistryError` is thrown.
 */
export function resolveEntwurfTarget(input: { provider?: string; model?: string }): ResolvedTarget {
	const registry = loadEntwurfTargets();
	const enabled = registry.entwurfTargets.filter((t) => t.enabled);

	let provider = input.provider?.trim() || undefined;
	let model = input.model?.trim() || undefined;

	if (!model) {
		throw new EntwurfRegistryError("entwurf: model is required");
	}

	// Path 1: qualified `provider/model` in model field
	if (!provider && model.includes("/")) {
		const slash = model.indexOf("/");
		provider = model.slice(0, slash).trim();
		model = model.slice(slash + 1).trim();
		if (!provider || !model) {
			throw new EntwurfRegistryError(`entwurf: malformed qualified model id "${input.model}"`);
		}
	}

	// Paths 1 & 2: exact tuple lookup
	if (provider) {
		const found = enabled.find((t) => t.provider === provider && t.model === model);
		if (!found) {
			throw new EntwurfRegistryError(
				`entwurf: (provider="${provider}", model="${model}") is not in the entwurf target ` +
					`registry, or is disabled. Allowed: ${describeRegistryEntries(enabled)}`,
			);
		}
		return { provider: found.provider, model: found.model, explicitOnly: found.explicitOnly === true };
	}

	// Path 3: bare model — auto-resolve excluding explicitOnly
	const candidates = enabled.filter((t) => t.model === model && t.explicitOnly !== true);
	if (candidates.length === 0) {
		const sameModel = enabled.filter((t) => t.model === model);
		if (sameModel.length > 0) {
			throw new EntwurfRegistryError(
				`entwurf: model "${model}" exists in registry only as explicitOnly target(s). ` +
					`Specify provider explicitly. Available: ${describeRegistryEntries(sameModel)}`,
			);
		}
		throw new EntwurfRegistryError(
			`entwurf: model "${model}" is not in the entwurf target registry. ` +
				`Allowed: ${describeRegistryEntries(enabled)}`,
		);
	}
	if (candidates.length > 1) {
		throw new EntwurfRegistryError(
			`entwurf: bare model "${model}" is ambiguous (${candidates.length} candidates). ` +
				`Specify provider explicitly. Candidates: ${describeRegistryEntries(candidates)}`,
		);
	}
	const only = candidates[0];
	return { provider: only.provider, model: only.model, explicitOnly: false };
}

function describeRegistryEntries(entries: EntwurfTarget[]): string {
	if (entries.length === 0) return "(none)";
	return entries.map((t) => `${t.provider}/${t.model}${t.explicitOnly ? " [explicitOnly]" : ""}`).join(", ");
}

// ============================================================================
// Content extraction
// ============================================================================

export function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content) {
		if (
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			(block as { type?: unknown }).type === "text" &&
			"text" in block &&
			typeof (block as { text?: unknown }).text === "string"
		) {
			texts.push((block as { text: string }).text);
		}
	}
	return texts.join("\n\n");
}

export function parseMessages(messages: AssistantMessageLike[]): string {
	return messages
		.filter((msg) => msg.role === "assistant")
		.map((msg) => extractTextContent(msg.content).trim())
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Read the pi session JSONL header (first non-empty line, `type:"session"`).
 *
 * Returns the structural identity carried in the header: pi `id` (sessionId UUID)
 * and original `cwd`. This is the durable carrier for resume-time identity —
 * unlike the filename's `entwurf-<taskId>` marker, which is a lookup convenience.
 *
 * Why this exists (issue #9):
 *   `runEntwurfResumeSync` originally fell back to `process.cwd()` when no
 *   explicit `cwd` was passed. Through the MCP `entwurf_resume` surface, the
 *   resumer is a different process from the original spawner, so its cwd is
 *   unrelated to the saved session's cwd. The child pi then started in the
 *   resumer's cwd, the pi-shell-acp bridge persisted that cwd in its session
 *   cache, and on lookup `isPersistedSessionCompatible` saw a cwd mismatch
 *   against the Scene 1 record. The bridge discarded the record, started a
 *   `newSession`, and the backend lost all prior-turn memory — even though the
 *   pi JSONL itself was hydrated correctly.
 *
 *   Reading the header cwd here lets `runEntwurfResumeSync` align the child's
 *   spawn cwd with the original spawn, which keeps the bridge's
 *   `pi:<sessionId>` -> `acpSessionId` continuity intact.
 *
 * Invariant (see issue #10): the single identity carrier is `sessionId`. This
 * helper returns `id` alongside `cwd` so future peer-handle work can reuse it
 * without re-reading the file.
 */
export function readSessionHeader(sessionFile: string): { id?: string; cwd?: string } | null {
	try {
		const content = fs.readFileSync(sessionFile, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const entry = JSON.parse(trimmed) as { type?: string; id?: unknown; cwd?: unknown };
				if (entry.type !== "session") return null;
				const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : undefined;
				const cwd = typeof entry.cwd === "string" && entry.cwd.length > 0 ? entry.cwd : undefined;
				return { id, cwd };
			} catch {
				return null;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Parse a pi session JSONL file and extract the latest assistant state.
 * Pure file I/O — safe to use from MCP bridge or pi runtime.
 */
export function analyzeSessionFileLike(sessionFile: string): SessionAnalysis {
	const analysis: SessionAnalysis = {
		lastAssistantText: null,
		lastError: null,
		lastStopReason: null,
		lastModel: null,
		lastProvider: null,
		turns: 0,
		cost: 0,
	};

	try {
		const content = fs.readFileSync(sessionFile, "utf-8");
		for (const line of content.trim().split("\n")) {
			try {
				const entry = JSON.parse(line) as { type?: string; message?: AssistantMessageLike };
				if (entry.type !== "message" || entry.message?.role !== "assistant") continue;

				const msg = entry.message;
				analysis.turns++;

				const text = extractTextContent(msg.content).trim();
				if (text) analysis.lastAssistantText = text;
				if (typeof msg.errorMessage === "string" && msg.errorMessage.trim()) {
					analysis.lastError = msg.errorMessage.trim();
				}
				if (typeof msg.stopReason === "string") analysis.lastStopReason = msg.stopReason;
				if (typeof msg.model === "string") analysis.lastModel = msg.model;
				if (typeof msg.provider === "string") analysis.lastProvider = msg.provider;

				const c = msg.usage?.cost?.total;
				if (typeof c === "number") analysis.cost += c;
			} catch {
				/* skip malformed lines */
			}
		}
	} catch {
		/* file not readable */
	}

	return analysis;
}

// ============================================================================
// Explicit compat extensions (Claude + opt-in Codex ACP bridge routing)
// ============================================================================

function resolveConfiguredPackageSource(packageNeedle: string): string | null {
	try {
		if (!fs.existsSync(PI_SETTINGS_PATH)) return null;
		const settings = JSON.parse(fs.readFileSync(PI_SETTINGS_PATH, "utf-8")) as { packages?: unknown };
		const packages = Array.isArray(settings.packages) ? settings.packages : [];
		for (const pkg of packages) {
			if (typeof pkg === "string" && pkg.includes(packageNeedle)) return pkg;
		}
	} catch {
		/* invalid settings */
	}
	return null;
}

// Strip an optional trailing @version from an npm spec while preserving a leading
// @scope. "@junghanacs/pi-shell-acp@0.8.0" → "@junghanacs/pi-shell-acp";
// "pi-shell-acp@1.2.3" → "pi-shell-acp". The install root keys on the bare name,
// not the raw source string (#29 correction: never slice the version into the path).
function parseNpmPackageName(spec: string): string | null {
	const trimmed = spec.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("@")) {
		const slash = trimmed.indexOf("/");
		if (slash < 0) return null; // malformed scoped spec — no "/name"
		const versionAt = trimmed.indexOf("@", slash); // version separator sits after scope/name
		return versionAt < 0 ? trimmed : trimmed.slice(0, versionAt);
	}
	const versionAt = trimmed.indexOf("@");
	return versionAt < 0 ? trimmed : trimmed.slice(0, versionAt);
}

// Map a Pi settings package source to its installed root, replicating pi
// PackageManager's USER-scope layout WITHOUT importing pi internals (entwurf-core
// is pi-runtime-free by contract). Verified against pi-mono package-manager.ts
// getGitInstallPath / getNpmInstallPath (#29):
//   git:<host>/<path>      → <agentDir>/git/<host>/<path>
//   npm:@scope/name[@ver]  → <agentDir>/npm/node_modules/@scope/name
//   <relative-or-abs path> → resolved against the agent dir (legacy local source)
// Project (-l) scope (cwd/.pi/git|npm/...) is intentionally NOT resolved here —
// resolveConfiguredPackageSource only reads the user settings.json, so project
// sources are never even seen. Callers fail-fast rather than silently misroute.
function packageSourceToRoots(source: string): { localRoot: string; remoteRoot: string } | null {
	// Remote roots use the plain ~/.pi/agent layout (NOT the PI_CODING_AGENT_DIR
	// override) — a local agent-dir override must not leak into the SSH host path.
	const remoteAgent = path.posix.join(os.homedir(), ".pi", "agent");
	if (source.startsWith("git:")) {
		const rest = source.slice("git:".length).replace(/^\/+/, "");
		if (!rest) return null;
		const segs = rest.split("/");
		return {
			localRoot: path.join(AGENT_DIR, "git", ...segs),
			remoteRoot: path.posix.join(remoteAgent, "git", ...segs),
		};
	}
	if (source.startsWith("npm:")) {
		const name = parseNpmPackageName(source.slice("npm:".length));
		if (!name) return null;
		const segs = name.split("/");
		return {
			localRoot: path.join(AGENT_DIR, "npm", "node_modules", ...segs),
			remoteRoot: path.posix.join(remoteAgent, "npm", "node_modules", ...segs),
		};
	}
	// Local path package source, relative to the agent dir. Remote commands now
	// single-quote every argument, so `$HOME` can no longer be left for the remote
	// shell to expand — resolve relative sources against the canonical agent path.
	return {
		localRoot: path.resolve(AGENT_DIR, source),
		remoteRoot: source.startsWith("/") ? source : path.posix.resolve(remoteAgent, source),
	};
}

// Probe a candidate package root for a loadable extension entry. Shared by the
// settings-source path and the self-root fallback so both honor the same layout
// (root itself, index.ts, extensions/index.ts, dist/* for built packages).
function probeExtensionRoot(name: string, localRoot: string, remoteRoot: string): ExplicitExtensionSpec | null {
	const candidates = [
		{ localPath: localRoot, remotePath: remoteRoot },
		{ localPath: path.join(localRoot, "index.ts"), remotePath: `${remoteRoot}/index.ts` },
		{ localPath: path.join(localRoot, "extensions", "index.ts"), remotePath: `${remoteRoot}/extensions/index.ts` },
		{
			localPath: path.join(localRoot, "dist", "extensions", "index.js"),
			remotePath: `${remoteRoot}/dist/extensions/index.js`,
		},
		{ localPath: path.join(localRoot, "dist", "index.js"), remotePath: `${remoteRoot}/dist/index.js` },
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate.localPath)) {
			return { name, localPath: candidate.localPath, remotePath: candidate.remotePath };
		}
	}
	return null;
}

// <pkgroot>/pi-extensions/lib/entwurf-core.ts → <pkgroot>. entwurf-core runs from
// source in every surface (pi native + MCP, both via --experimental-strip-types),
// so import.meta.url always points at this source file, never a bundled copy.
function resolveSelfRoot(): string | null {
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		return path.resolve(here, "..", "..");
	} catch {
		return null;
	}
}

function resolveExplicitExtensionSpec(packageNeedle: string, isRemote: boolean): ExplicitExtensionSpec | null {
	const source = resolveConfiguredPackageSource(packageNeedle);
	if (source) {
		const roots = packageSourceToRoots(source);
		if (roots) {
			const spec = probeExtensionRoot(packageNeedle, roots.localRoot, roots.remoteRoot);
			if (spec) return spec;
		}
	}

	// Self-root fallback — LOCAL spawn only. When settings package-source
	// resolution misses (e.g. local-dev `pi -e /abs/path/pi-shell-acp` with no
	// matching settings source), the parent pi-shell-acp extension is still loaded
	// from disk and our own module path is a more accurate bridge root than
	// settings (#29 correction #5). Remote spawn cannot reach a local path across
	// SSH, so it is excluded — remote must rely on settings/source mapping.
	if (!isRemote && packageNeedle === "pi-shell-acp") {
		const selfRoot = resolveSelfRoot();
		if (selfRoot) {
			const spec = probeExtensionRoot(packageNeedle, selfRoot, selfRoot);
			if (spec) return spec;
		}
	}
	return null;
}

export function getEntwurfExplicitExtensions(
	model: string | undefined,
	isRemote: boolean,
	recordedProvider?: string,
): {
	args: string[];
	names: string[];
	warnings: string[];
	provider?: string;
	modelOverride?: string;
	/** Set when an explicit ACP intent (recorded provider=pi-shell-acp, or opt-in
	 *  Codex-via-ACP) cannot resolve the bridge. Resume callers MUST fail-fast on
	 *  this rather than spawning a guaranteed-broken `--provider pi-shell-acp`
	 *  child (#29). Claude-only heuristic stays warning-only (legacy fallback). */
	unresolvedAcpIntent?: boolean;
} {
	const args: string[] = [];
	const names: string[] = [];
	const warnings: string[] = [];

	const wantsClaudeBridge = isClaudeModel(model);
	const wantsCodexBridge = shouldRouteCodexViaAcp(model);
	// Resume-path signal: a session whose first spawn went through pi-shell-acp
	// MUST be resumed with the bridge extension loaded — otherwise pi cannot
	// resolve the "pi-shell-acp" provider and the resume dies silently (no
	// assistant turn gets appended). This guard is needed because resume
	// deliberately bypasses the Entwurf Target Registry (Identity Preservation
	// Rule) — so routing info has to come from the session's own recordedProvider.
	const wantsAcpByRecordedProvider = recordedProvider === "pi-shell-acp";
	if (!wantsClaudeBridge && !wantsCodexBridge && !wantsAcpByRecordedProvider) {
		return { args, names, warnings };
	}

	const acpBridge = resolveExplicitExtensionSpec("pi-shell-acp", isRemote);
	if (acpBridge) {
		args.push("-e", isRemote ? acpBridge.remotePath : acpBridge.localPath);
		names.push(acpBridge.name);
		return {
			args,
			names,
			warnings,
			provider: "pi-shell-acp",
			// Strip `openai-codex/` prefix when routing via ACP, for both opt-in Codex
			// routing and recorded-provider resume. For bare model ids the helper is
			// a no-op, so this is safe regardless of whether the prefix is present.
			modelOverride:
				wantsCodexBridge || wantsAcpByRecordedProvider ? normalizeCodexEntwurfModelForAcp(model) : undefined,
		};
	}

	// Bridge unresolved. Explicit ACP intent — recorded provider=pi-shell-acp on
	// resume, or opt-in Codex-via-ACP — cannot degrade: the child would be spawned
	// with `--provider pi-shell-acp` and die with `Unknown provider`. Signal
	// fail-fast to the caller (#29 correction #4: fail-fast scope = explicit ACP
	// intent). Checked BEFORE the Claude heuristic so a Claude model that also
	// recorded provider=pi-shell-acp fails fast instead of silently falling back
	// to the unrelated pi-claude-code-use bridge.
	if (wantsAcpByRecordedProvider) {
		warnings.push(
			"Resume recorded provider=pi-shell-acp but the bridge extension could not be resolved " +
				"(checked settings package source: local path / git install / npm install, plus module self-root). " +
				"Refusing to resume with an unknown provider.",
		);
		return { args, names, warnings, unresolvedAcpIntent: true };
	}

	if (wantsCodexBridge) {
		warnings.push(
			`Codex entwurf requested with ${ENTWURF_CODEX_ACP_ENV}=1 but pi-shell-acp could not be resolved. ` +
				"Refusing to spawn with --provider pi-shell-acp.",
		);
		return { args, names, warnings, unresolvedAcpIntent: true };
	}

	// Claude model heuristic with no recorded ACP signal: the legacy secondary
	// bridge pi-claude-code-use may be installed independently. Keep this as
	// warning-only graceful degradation (#29 correction #4 decision: do NOT
	// promote to fail-fast — a different provider package owns this path).
	const compat = resolveExplicitExtensionSpec("pi-claude-code-use", isRemote);
	if (compat) {
		args.push("-e", isRemote ? compat.remotePath : compat.localPath);
		names.push(compat.name);
		return { args, names, warnings };
	}

	warnings.push(
		"Claude entwurf requested but pi-shell-acp could not be resolved. Claude entwurfs may fail without an explicit provider bridge.",
	);
	return { args, names, warnings };
}

/**
 * Registry-driven routing — used by spawn (runEntwurfSync). Replaces the
 * heuristic getEntwurfExplicitExtensions for paths that have already gone
 * through resolveEntwurfTarget (i.e., the (provider, model) tuple is known
 * to be in the registry and is the explicit caller intent).
 *
 * Resume path (runEntwurfResumeSync) intentionally still uses the heuristic
 * helper — Identity Preservation Rule, no registry consultation.
 */
export function getRegistryRouting(
	target: ResolvedTarget,
	isRemote: boolean,
): { args: string[]; names: string[]; warnings: string[]; provider: string; modelOverride?: string } {
	const args: string[] = [];
	const names: string[] = [];
	const warnings: string[] = [];

	// Native providers (openai-codex, anthropic, etc.) — pi handles them directly.
	// No extension injection; just pass through provider + model.
	if (target.provider !== "pi-shell-acp") {
		return { args, names, warnings, provider: target.provider };
	}

	// pi-shell-acp targets need the bridge extension injected. If it can't be
	// resolved, fail-fast — NOT warning-only. A warning-then-spawn path puts a
	// child on `pi --no-extensions --provider pi-shell-acp`, which dies with
	// `Unknown provider "pi-shell-acp"` before any session file exists (#29). The
	// throw is caught by the same tool-surface try/catch that handles
	// EntwurfRegistryError, and surfaces as a failed entwurf.
	const acpBridge = resolveExplicitExtensionSpec("pi-shell-acp", isRemote);
	if (!acpBridge) {
		throw new EntwurfRoutingError(
			`pi-shell-acp target requested (provider=${target.provider}, model=${target.model}) but the ` +
				"bridge extension could not be resolved. Checked settings package source: local path / " +
				"git install (~/.pi/agent/git/...) / npm install (~/.pi/agent/npm/node_modules/...)" +
				(isRemote ? "" : " / loaded module self-root") +
				". Refusing to spawn a child with `--no-extensions --provider pi-shell-acp` (it would die " +
				'with `Unknown provider "pi-shell-acp"`). Install pi-shell-acp in pi settings packages, or ' +
				"check that the configured source's install directory exists.",
		);
	}

	args.push("-e", isRemote ? acpBridge.remotePath : acpBridge.localPath);
	names.push(acpBridge.name);
	return {
		args,
		names,
		warnings,
		provider: "pi-shell-acp",
		// Defensive: registry should already store bare basenames, but if a future
		// entry slips an `openai-codex/` prefix into a pi-shell-acp model field,
		// strip it before forwarding to codex-acp.
		modelOverride: target.model.startsWith("openai-codex/") ? target.model.slice("openai-codex/".length) : undefined,
	};
}

// ============================================================================
// Project-context injection (담당자 패턴)
// ============================================================================

export function enrichTaskWithProjectContext(task: string, cwd: string): string {
	const agentsPath = path.join(cwd, "AGENTS.md");
	try {
		if (!fs.existsSync(agentsPath)) return task;
		const content = fs.readFileSync(agentsPath, "utf-8");
		if (!content.trim()) return task;
		return [
			`${ENTWURF_PROJECT_CONTEXT_OPEN_TAG} path="${agentsPath}">`,
			content.trim(),
			`</project-context>`,
			"",
			task,
		].join("\n");
	} catch {
		return task;
	}
}

// ============================================================================
// Saved entwurf session lookup (for entwurf_resume)
//
// PM-mandated layer separation: this is the *saved-session* world. It must
// NOT consult any active control-socket state. Pure filesystem walk over
// ~/.pi/agent/sessions/**/*entwurf-<taskId>*.jsonl.
// ============================================================================

export function findEntwurfSessionFile(taskId: string): string | null {
	if (!taskId || /[/\\]|\.\./.test(taskId)) return null;
	try {
		const dirs = fs.readdirSync(SESSIONS_BASE);
		for (const dir of dirs) {
			const dirPath = path.join(SESSIONS_BASE, dir);
			let stat: fs.Stats;
			try {
				stat = fs.statSync(dirPath);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) continue;

			let files: string[];
			try {
				files = fs.readdirSync(dirPath);
			} catch {
				continue;
			}
			for (const file of files) {
				if (file.includes(`entwurf-${taskId}`) && file.endsWith(".jsonl")) {
					return path.join(dirPath, file);
				}
			}
		}
	} catch {
		/* sessions base missing */
	}
	return null;
}

export interface EntwurfResumeOptions {
	host?: string;
	// cwd is a debug/migration escape hatch only. The authority for cold resume
	// is the saved session header cwd (see INVARIANT block in
	// runEntwurfResumeSync and #9). Passing options.cwd routinely forfeits
	// backend continuity. The resumer's `process.cwd()` is NEVER a fallback.
	cwd?: string;
	// Identity Preservation Rule (see AGENTS.md): the resume API intentionally
	// does NOT accept a `model` override. The model identity is locked to the
	// session's recorded value. host may change (resume from a different
	// machine); model may not; cwd is bound to the saved session header.
	signal?: AbortSignal;
	onUpdate?: (text: string) => void;
}

// ============================================================================
// Internal: spawn pi and collect message_end events.  Shared by sync + resume.
// ============================================================================

interface CollectInput {
	command: string;
	args: string[];
	cwd?: string;
	signal?: AbortSignal;
	onUpdate?: (text: string) => void;
	result: EntwurfResult;
}

function collectPiRun({ command, args, cwd, signal, onUpdate, result }: CollectInput): Promise<EntwurfResult> {
	const messages: AssistantMessageLike[] = [];

	return new Promise<EntwurfResult>((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		mirrorChildStderr(proc);

		let buffer = "";
		let stderr = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: { type: string; message?: AssistantMessageLike; [k: string]: unknown };
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}

			if (event.type === "message_end" && event.message) {
				messages.push(event.message);
				if (event.message.role === "assistant") {
					result.turns++;
					const usage = event.message.usage;
					if (typeof usage?.cost?.total === "number") result.cost += usage.cost.total;
					if (event.message.model) result.model = event.message.model;
					if (typeof event.message.stopReason === "string") result.stopReason = event.message.stopReason;
					if (typeof event.message.errorMessage === "string" && event.message.errorMessage.trim()) {
						result.error = event.message.errorMessage.trim();
					}

					const latest = extractTextContent(event.message.content).trim();
					if (latest && onUpdate) onUpdate(latest);
				}
			}
		};

		proc.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			result.exitCode = code ?? 0;
			if (!result.error && result.stopReason === "error") {
				result.error = "Entwurf model returned stopReason=error";
			}
			const assistantText = parseMessages(messages).trim();
			result.output = assistantText || result.error || stderr || "(no output)";
			if (code !== 0 && stderr && !result.error) result.error = stderr.slice(0, 500);
			if ((result.error || result.stopReason === "error") && result.exitCode === 0) result.exitCode = 1;
			resolve(result);
		});

		proc.on("error", (err) => {
			result.exitCode = 1;
			result.error = err.message;
			result.output = "(spawn failed)";
			resolve(result);
		});

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});
}

// ============================================================================
// runEntwurfResumeSync — revive a saved entwurf session by taskId
//
// Contract:
//   - Input: taskId (8 hex chars from a prior entwurf result) + prompt
//   - Looks up sessionFile via findEntwurfSessionFile (pure filesystem walk)
//   - Reads model + provider from the session's last assistant turn
//     (analyzeSessionFileLike) and reuses BOTH verbatim
//   - Spawns sync `pi --session <file> ... <prompt>` and waits for completion
//   - Does NOT touch ~/.pi/entwurf-control; works regardless of whether the
//     original entwurf process is still alive
//
// Identity Preservation Rule (AGENTS.md, intentionally hard-coded here):
//   - This API does NOT accept a `model` override. The model identity is
//     locked to whatever the session recorded at first spawn.
//   - host / cwd MAY change between spawn and resume — execution environment
//     is not identity. model MAY NOT change.
//   - If the session has no recorded model (empty / corrupted / never had an
//     assistant turn) we refuse the resume rather than fall back to a default.
//   - This guard exists at the API layer, not as runtime validation, because
//     the option itself is the thing we are saying no to.
//
// Verification status (planned rollout, see AGENTS.md test matrix):
//   1. local + Claude   — implemented, awaiting manual smoke
//   2. local + Codex    — same code path, awaiting smoke
//   3. async on Claude  — not implemented (separate design round)
//   4. async on Codex   — not implemented
//   5. remote (SSH)     — code path implemented but UNVERIFIED.
//                         Marked here because the SSH branch (cd <cwd> && pi ...)
//                         has not been exercised end-to-end against a real
//                         remote pi yet. Treat with care until smoke covers it.
// ============================================================================

export async function runEntwurfResumeSync(
	taskId: string,
	prompt: string,
	options: EntwurfResumeOptions,
): Promise<EntwurfResult> {
	const host = options.host ?? "local";
	const isRemote = host !== "local";

	const sessionFile = findEntwurfSessionFile(taskId);
	if (!sessionFile) {
		return {
			task: prompt,
			host,
			exitCode: 1,
			output: `No saved entwurf session found for taskId "${taskId}" under ${SESSIONS_BASE}`,
			turns: 0,
			cost: 0,
			taskId,
			sessionFile: undefined,
			explicitExtensions: [],
			warnings: [],
			error: "session_not_found",
		};
	}

	if (!isRemote && !fs.existsSync(sessionFile)) {
		return {
			task: prompt,
			host,
			exitCode: 1,
			output: `Session file vanished between lookup and spawn: ${sessionFile}`,
			turns: 0,
			cost: 0,
			taskId,
			sessionFile,
			explicitExtensions: [],
			warnings: [],
			error: "session_file_missing",
		};
	}

	// Identity Preservation Rule (AGENTS.md): the session's recorded model is
	// the only legitimate source of identity for a resume. We never invent one
	// and never accept a caller override. If we cannot read it, we refuse.
	const sessionAnalysis = !isRemote ? analyzeSessionFileLike(sessionFile) : null;
	const recordedModel = sessionAnalysis?.lastModel ?? undefined;
	const recordedProvider = sessionAnalysis?.lastProvider ?? undefined;

	if (!isRemote && !recordedModel) {
		return {
			task: prompt,
			host,
			exitCode: 1,
			output:
				`Cannot resume taskId "${taskId}": session has no recorded model ` +
				`(file empty, corrupted, or never reached an assistant turn). ` +
				`Start a fresh entwurf instead — identity must come from the session.`,
			turns: 0,
			cost: 0,
			taskId,
			sessionFile,
			explicitExtensions: [],
			warnings: [],
			error: "session_identity_missing",
		};
	}

	const effectiveModel = resolveEntwurfModel(recordedModel);
	// Pass recordedProvider so the resume path re-injects pi-shell-acp when the
	// original spawn went through it (registry is bypassed on resume per Identity
	// Preservation Rule — so the bridge signal must come from the session itself).
	const explicitExtensions = getEntwurfExplicitExtensions(effectiveModel, isRemote, recordedProvider);
	// Explicit ACP intent that can't resolve the bridge — fail-fast rather than
	// spawn a guaranteed-broken `--provider pi-shell-acp` child (#29). Returned as
	// an error result to match this function's other pre-spawn guards (session
	// identity / cwd), which the tool surface renders as a failed resume.
	if (explicitExtensions.unresolvedAcpIntent) {
		return {
			task: prompt,
			host,
			exitCode: 1,
			output: explicitExtensions.warnings.join(" "),
			turns: 0,
			cost: 0,
			taskId,
			sessionFile,
			explicitExtensions: [],
			warnings: explicitExtensions.warnings,
			error: "acp_bridge_unresolved",
		};
	}
	const resumeProvider = explicitExtensions.provider ?? recordedProvider;

	const piArgs = ["--mode", "json", "-p", "--no-extensions", ...explicitExtensions.args, "--session", sessionFile];
	if (resumeProvider) piArgs.push("--provider", resumeProvider);
	piArgs.push("--model", explicitExtensions.modelOverride ?? effectiveModel);
	piArgs.push(prompt);

	// INVARIANT (#9 / #10): saved session header cwd is the authority for cold
	// resume. The pi-shell-acp bridge keys persistence by `pi:<sessionId>` but
	// `isPersistedSessionCompatible` also requires `record.cwd === params.cwd`.
	// If the cwds diverge the bridge silently drops the persisted `acpSessionId`
	// and starts a `newSession`, losing backend-side memory of every prior turn —
	// the regression #9 traces. `options.cwd` is a debug/migration escape hatch
	// only; passing it routinely forfeits backend continuity. Caller's
	// `process.cwd()` is NEVER a fallback — if Node spawn receives `cwd:
	// undefined` it inherits the resumer's cwd, which re-introduces #9 silently.
	// We fail-fast here instead so the failure cannot be confused with a
	// successful resume into the wrong cwd. The remote SSH branch keeps its
	// prior `~` fallback — remote resume is in an unverified state already
	// (see runEntwurfResumeSync block header) and this silhouette has only
	// been observed locally.
	const headerCwd = isRemote ? undefined : (readSessionHeader(sessionFile)?.cwd ?? undefined);
	if (!isRemote && !options.cwd && !headerCwd) {
		return {
			task: prompt,
			host,
			exitCode: 1,
			output:
				`Cannot resume taskId "${taskId}": saved session header has no cwd ` +
				`and no explicit cwd override was provided. The header cwd is the ` +
				`authority for cold resume (see #9). Re-spawn from the original cwd, ` +
				`or pass an explicit options.cwd if you are intentionally migrating.`,
			turns: 0,
			cost: 0,
			taskId,
			sessionFile,
			explicitExtensions: [],
			warnings: [],
			error: "session_cwd_missing",
		};
	}
	const effectiveCwd = options.cwd ?? headerCwd;

	let command: string;
	let args: string[];
	if (isRemote) {
		command = "ssh";
		const connectTimeout = Number.parseInt(process.env.PI_ENTWURF_SSH_CONNECT_TIMEOUT ?? "10", 10);
		const sshOptions = [
			"-o",
			"BatchMode=yes",
			"-o",
			`ConnectTimeout=${Number.isFinite(connectTimeout) && connectTimeout > 0 ? connectTimeout : 10}`,
		];
		// Remote resume cwd still intentionally preserves the pre-existing `~`
		// fallback when no explicit override is provided; saved-header cwd alignment
		// is tracked separately in issue #11.
		const remoteCwd = options.cwd ? shellQuote(options.cwd) : "~";
		const remoteCmd = `cd ${remoteCwd} && pi ${piArgs.map(shellQuote).join(" ")}`;
		args = [...sshOptions, host, remoteCmd];
	} else {
		command = "pi";
		args = piArgs;
	}

	const result: EntwurfResult = {
		task: prompt,
		host,
		exitCode: 0,
		output: "",
		turns: 0,
		cost: 0,
		taskId,
		sessionFile,
		explicitExtensions: [...explicitExtensions.names],
		warnings: [...explicitExtensions.warnings],
	};

	return collectPiRun({
		command,
		args,
		cwd: isRemote ? undefined : effectiveCwd,
		signal: options.signal,
		onUpdate: options.onUpdate,
		result,
	});
}

// ============================================================================
// runEntwurfSync — spawn pi and collect result
// ============================================================================

export async function runEntwurfSync(task: string, options: EntwurfSyncOptions): Promise<EntwurfResult> {
	const host = options.host ?? "local";
	const isRemote = host !== "local";
	const effectiveCwd = options.cwd ?? process.cwd();
	const enrichedTask = enrichTaskWithProjectContext(task, effectiveCwd);
	const taskId = crypto.randomUUID().slice(0, 8);

	// Resolve through the Entwurf Target Registry. This is the spawn gate:
	// unregistered (provider, model) pairs are rejected here. Resume path does
	// NOT pass through this — Identity Preservation Rule.
	const fallbackModel = options.model && options.model.trim() ? options.model : DEFAULT_ENTWURF_MODEL;
	const target = resolveEntwurfTarget({ provider: options.provider, model: fallbackModel });

	const sessionDir = cwdToSessionDir(effectiveCwd);
	fs.mkdirSync(sessionDir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const sessionFile = path.join(sessionDir, `${timestamp}_entwurf-${taskId}.jsonl`);
	const routing = getRegistryRouting(target, isRemote);

	const piArgs = [
		"--mode",
		"json",
		"-p",
		"--no-extensions",
		...routing.args,
		"--session",
		sessionFile,
		"--provider",
		routing.provider,
		"--model",
		routing.modelOverride ?? target.model,
		enrichedTask,
	];

	let command: string;
	let args: string[];
	if (isRemote) {
		command = "ssh";
		const connectTimeout = Number.parseInt(process.env.PI_ENTWURF_SSH_CONNECT_TIMEOUT ?? "10", 10);
		const sshOptions = [
			"-o",
			"BatchMode=yes",
			"-o",
			`ConnectTimeout=${Number.isFinite(connectTimeout) && connectTimeout > 0 ? connectTimeout : 10}`,
		];
		const remoteCmd = `cd ${shellQuote(effectiveCwd)} && pi ${piArgs.map(shellQuote).join(" ")}`;
		args = [...sshOptions, host, remoteCmd];
	} else {
		command = "pi";
		args = piArgs;
	}

	const result: EntwurfResult = {
		task,
		host,
		exitCode: 0,
		output: "",
		turns: 0,
		cost: 0,
		taskId,
		sessionFile,
		explicitExtensions: [...routing.names],
		warnings: [...routing.warnings],
	};

	return collectPiRun({
		command,
		args,
		cwd: isRemote ? undefined : effectiveCwd,
		signal: options.signal,
		onUpdate: options.onUpdate,
		result,
	});
}

// ============================================================================
// Shared summary formatter (used by both pi native and MCP surfaces)
// ============================================================================

export function formatSyncSummary(result: EntwurfResult): string {
	return [
		`Task ID: ${result.taskId}`,
		`Host: ${result.host}`,
		`Turns: ${result.turns}`,
		`Cost: $${result.cost.toFixed(4)}`,
		result.model ? `Model: ${result.model}` : null,
		result.stopReason ? `Stop reason: ${result.stopReason}` : null,
		result.explicitExtensions.length ? `Compat: ${result.explicitExtensions.join(", ")}` : null,
		result.warnings.length ? `Warnings: ${result.warnings.join(" | ")}` : null,
		result.error ? `Error: ${result.error}` : null,
		"",
		result.output,
	]
		.filter(Boolean)
		.join("\n");
}
