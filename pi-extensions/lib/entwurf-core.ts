/**
 * entwurf-core — sync entwurf execution, host-agnostic.
 *
 * Single implementation shared by:
 *   - pi-extensions/entwurf.ts (pi native tool surface)
 *   - mcp/entwurf-bridge/src/index.ts (MCP tool surface for ACP hosts)
 *
 * This module MUST NOT import anything from @earendil-works/pi-coding-agent or any
 * other pi runtime API. It is pure Node + @sinclair/typebox-free.  Anything that
 * requires pi's ExtensionAPI (sendMessage, appendEntry, sessionManager) belongs
 * in the async entwurf path, which stays in pi-extensions/entwurf.ts for now.
 *
 * Scope:
 *   - sync execution (spawn pi, collect message_end events, return summary)
 *   - local hosts only in 0.9.0. SSH-remote spawn/resume is fail-fast
 *     (garden-native session identity is local-FS — header scan / collision
 *     precheck cannot see a remote filesystem). The remote roots/isRemote
 *     plumbing is retained, parity-gated, for #11 revival (see RemoteSpec note
 *     below) — it is NOT a live path in this release.
 *   - project-context injection (cwd/AGENTS.md)
 *   - explicit compat extension resolution for Claude models + opt-in Codex ACP routing
 *
 * Provider bridge routing contract:
 *   - Claude models (claude-*)            — always routed through entwurf.
 *     If entwurf can't be resolved, falls back to pi-claude-code-use, then warns.
 *   - Codex models (openai-codex/*, gpt-5*) — default is the direct openai-codex provider.
 *     Opt-in via env var `ENTWURF_ACP_FOR_CODEX=1` routes Codex through entwurf,
 *     in which case `normalizeCodexEntwurfModelForAcp()` strips the `openai-codex/`
 *     prefix because the bridge forwards the model id verbatim to codex-acp, which
 *     only accepts the bare backend id (e.g. `gpt-5.4`) on ChatGPT accounts.
 *
 * The `modelOverride` return field communicates this normalization to the caller so
 * the spawned pi --model matches what the downstream ACP backend expects.
 */

import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ENTWURF_PROJECT_CONTEXT_OPEN_TAG } from "../../protocol.js";
import { formatSessionTimestamp, generateSessionId, isValidSessionId, SESSION_ID_RE } from "./session-id.js";

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
const PI_SETTINGS_PATH = process.env.PI_SETTINGS_PATH
	? expandTilde(process.env.PI_SETTINGS_PATH)
	: path.join(AGENT_DIR, "settings.json");
export const SESSIONS_BASE = path.join(AGENT_DIR, "sessions");
const ENTWURF_TARGETS_PATH = process.env.ENTWURF_TARGETS_PATH ?? path.join(AGENT_DIR, "entwurf-targets.json");
export const DEFAULT_ENTWURF_MODEL = "openai-codex/gpt-5.4";
export const ENTWURF_CODEX_ACP_ENV = "ENTWURF_ACP_FOR_CODEX";

// Currently unused: remote/SSH entwurf is fail-fast in 0.9.0 (garden-native
// identity is local-FS only). Retained for #11 remote revival; parity-gated by
// scripts/check-shell-quote.ts across entwurf.ts / entwurf-core.ts / entwurf-async.ts.
// biome-ignore lint/correctness/noUnusedVariables: retained for #11 remote revival; parity-gated.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ============================================================================
// Types
// ============================================================================

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
// File: ~/.pi/agent/entwurf-targets.json (override with ENTWURF_TARGETS_PATH).
// See entwurf/AGENTS.md §Entwurf Orchestration (Entwurf Target Registry) for principle and schema.
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

// Raised when a spawn is routed to provider=entwurf but the bridge extension
// cannot be resolved from settings package sources or the loaded module self-root.
// Fail-fast before spawning a child with `--no-extensions --provider entwurf`,
// which would otherwise die with `Unknown provider "entwurf"` (#29).
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
				`or create the file manually (see entwurf/pi/entwurf-targets.json for the canonical shape).`,
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
// Gated by env ENTWURF_CHILD_STDERR_LOG. When set, any entwurf child pi
// process spawned here also has its stderr appended to the given path. The
// sentinel uses this to grep for child-side `[entwurf:bootstrap]` bridge
// markers when asserting continuity — parent stderr can't see that signal
// because the bridge lives in the child when target provider is entwurf.
//
// Opt-in (env unset → no-op) so production runs pay nothing. A write failure
// surfaces on console.error instead of being silently swallowed (see the "No
// 면피" invariant in AGENTS.md): a misconfigured diagnostic should be visible.
// ============================================================================

export function mirrorChildStderr(proc: ChildProcess): void {
	const logPath = process.env.ENTWURF_CHILD_STDERR_LOG;
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
// v1 target-use guard. Its callers (runEntwurfSync / runEntwurfAsync) were
// removed in the v1 sync-body sweep; this guard and the registry it consults are
// now reachable only through the RT-dead buildSessionName and are swept with the
// C3 name-authority cut. entwurf_v2 never used it.
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
		throw new Error(`entwurf to ${targetKey} already exists in this session. Use entwurf_v2 to continue.`);
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

const SESSION_HEADER_READ_BYTES = 8192;
const SESSION_ANALYSIS_CHUNK_BYTES = 64 * 1024;

export function readSessionHeader(sessionFile: string): { id?: string; cwd?: string } | null {
	let fd: number | undefined;
	try {
		fd = fs.openSync(sessionFile, "r");
		const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
		const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
		if (bytesRead <= 0) return null;

		// Session header is the first JSONL line. Read only a bounded prefix so
		// header scans over many large transcripts cannot load/split whole files.
		const prefix = buffer.subarray(0, bytesRead).toString("utf8");
		const newlineIdx = prefix.indexOf("\n");
		const trimmed = (newlineIdx >= 0 ? prefix.slice(0, newlineIdx) : prefix).trim();
		if (!trimmed) return null;

		const entry = JSON.parse(trimmed) as { type?: string; id?: unknown; cwd?: unknown };
		if (entry.type !== "session") return null;
		const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : undefined;
		const cwd = typeof entry.cwd === "string" && entry.cwd.length > 0 ? entry.cwd : undefined;
		return { id, cwd };
	} catch {
		return null;
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				/* best-effort close */
			}
		}
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

	// Per-line accumulation. Identical semantics to the old
	// `readFileSync().trim().split("\n")` pass (last-wins fields, turn/cost
	// accumulation, malformed lines skipped) but streamed so a multi-MB
	// transcript is never held whole in memory at once.
	const processLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed) return;
		try {
			const entry = JSON.parse(trimmed) as { type?: string; message?: AssistantMessageLike };
			if (entry.type !== "message" || entry.message?.role !== "assistant") return;

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
	};

	let fd: number | undefined;
	try {
		fd = fs.openSync(sessionFile, "r");
		const chunk = Buffer.alloc(SESSION_ANALYSIS_CHUNK_BYTES);
		// `leftover` holds a partial trailing line carried across chunk reads.
		// Splitting on the newline BYTE (0x0a) and decoding each complete line
		// independently keeps multibyte UTF-8 from being corrupted at a chunk
		// boundary (a newline never falls inside a multibyte sequence).
		let leftover = Buffer.alloc(0);
		let bytesRead = 0;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard read loop
		while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
			const buf =
				leftover.length > 0 ? Buffer.concat([leftover, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
			let start = 0;
			let nl = buf.indexOf(0x0a, start);
			while (nl !== -1) {
				processLine(buf.toString("utf8", start, nl));
				start = nl + 1;
				nl = buf.indexOf(0x0a, start);
			}
			// Copy the remainder before the next read overwrites `chunk`.
			leftover = Buffer.from(buf.subarray(start));
		}
		if (leftover.length > 0) processLine(leftover.toString("utf8"));
	} catch {
		/* file not readable */
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				/* best-effort close */
			}
		}
	}

	return analysis;
}

/**
 * Recorded session identity — the resume authority (locked grammar, NEXT.md
 * "Authority separation"):
 *   - model authority = the session's FIRST `model_change` (provider + modelId),
 *     NOT the last assistant message's `model` field. A session that drifted to
 *     a different model on a later `model_change` is corrupt for our purposes
 *     (entwurf children run `pi -p --model <M>` non-interactively, so a healthy
 *     entwurf session has exactly one model_change) — refuse rather than follow
 *     the drift.
 *   - the session_info `name` is a display/search/integrity mirror: if present
 *     and canonical, its sessionId / provider / model must mirror the header id
 *     and the first model_change, else the metadata is corrupt → fail-fast.
 */
export interface RecordedSessionIdentity {
	/** JSONL header `id` (the durable sessionId). */
	sessionId?: string;
	/** JSONL header `cwd` (cold-resume authority). */
	cwd?: string;
	/** First `model_change` provider. */
	provider: string;
	/** First `model_change` modelId. */
	modelId: string;
}

/**
 * Single streamed pass over a session JSONL extracting the resume identity.
 * Returns `null` when the session has no `model_change` (never reached an
 * identity) so callers can refuse with their own "no recorded model" result.
 * **Throws** `SessionIdentityError` on model-identity drift (a later
 * `model_change` differs from the first) or on a corrupt session-name mirror
 * (the name's sessionId / provider / model disagree with the header / first
 * model_change). This is the fail-fast that replaces the old "follow the last
 * assistant message's model" behavior.
 *
 * `requireEntwurf` (resume paths): tightens the contract to the locked 0.9.0
 * rule "entwurf 여부 = session name tag 중 'entwurf' 존재; 없으면 Entwurf 세션
 * 아님; compatibility 없음". A general pi session (no name, non-canonical name,
 * or canonical name without the `entwurf` tag) must NOT be resumable as an
 * Entwurf session — it throws instead. lookup/resume authority is still the
 * header id/cwd; the name is only the integrity/discovery mirror being asserted.
 */
export function readSessionIdentity(
	sessionFile: string,
	opts?: { requireEntwurf?: boolean },
): RecordedSessionIdentity | null {
	const requireEntwurf = opts?.requireEntwurf === true;
	let headerId: string | undefined;
	let headerCwd: string | undefined;
	let first: { provider: string; modelId: string } | undefined;
	let drift: { provider: string; modelId: string } | undefined;
	let latestName: string | undefined;

	const onLine = (line: string): void => {
		const t = line.trim();
		if (!t) return;
		let e: { type?: string; id?: unknown; cwd?: unknown; provider?: unknown; modelId?: unknown; name?: unknown };
		try {
			e = JSON.parse(t);
		} catch {
			return;
		}
		if (e.type === "session") {
			if (typeof e.id === "string" && e.id) headerId = e.id;
			if (typeof e.cwd === "string" && e.cwd) headerCwd = e.cwd;
		} else if (e.type === "model_change") {
			const provider = typeof e.provider === "string" ? e.provider : "";
			const modelId = typeof e.modelId === "string" ? e.modelId : "";
			if (!provider || !modelId) return;
			if (!first) first = { provider, modelId };
			else if ((provider !== first.provider || modelId !== first.modelId) && !drift) drift = { provider, modelId };
		} else if (e.type === "session_info") {
			if (typeof e.name === "string" && e.name) latestName = e.name;
		}
	};

	let fd: number | undefined;
	try {
		fd = fs.openSync(sessionFile, "r");
		const chunk = Buffer.alloc(SESSION_ANALYSIS_CHUNK_BYTES);
		let leftover = Buffer.alloc(0);
		let bytesRead = 0;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard read loop
		while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
			const buf =
				leftover.length > 0 ? Buffer.concat([leftover, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
			let start = 0;
			let nl = buf.indexOf(0x0a, start);
			while (nl !== -1) {
				onLine(buf.toString("utf8", start, nl));
				start = nl + 1;
				nl = buf.indexOf(0x0a, start);
			}
			leftover = Buffer.from(buf.subarray(start));
		}
		if (leftover.length > 0) onLine(leftover.toString("utf8"));
	} catch {
		/* file not readable */
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				/* best-effort close */
			}
		}
	}

	if (!first) return null;

	if (drift) {
		throw new SessionIdentityError(
			`Session "${sessionFile}" model-identity drift: first model_change=${first.provider}/${first.modelId} ` +
				`but a later model_change=${drift.provider}/${drift.modelId}. Resume identity is locked to the first ` +
				`model_change; a differing later change is treated as corrupt/drift — refusing to resume.`,
		);
	}

	// Name integrity mirror. In the general path a missing/non-canonical name is
	// not itself a failure; only a canonical name that disagrees is corrupt.
	const parsed = latestName ? parseSessionName(latestName) : null;
	if (parsed) {
		if (headerId && parsed.sessionId !== headerId) {
			throw new SessionIdentityError(
				`Session name sessionId mirror mismatch: name carries "${parsed.sessionId}" but header id is ` +
					`"${headerId}" (corrupt metadata).`,
			);
		}
		if (parsed.provider !== first.provider || parsed.model !== first.modelId) {
			throw new SessionIdentityError(
				`Session name provider/model mirror mismatch: name carries "${parsed.provider}/${parsed.model}" but ` +
					`first model_change is "${first.provider}/${first.modelId}" (corrupt metadata).`,
			);
		}
	}

	// Entwurf-resume strictness (locked 0.9.0 rule). A session is an Entwurf
	// session ONLY if its canonical name carries the `entwurf` tag — there is no
	// compatibility path for the old `*_entwurf-<taskId>.jsonl` filename species.
	if (requireEntwurf) {
		if (!headerId) {
			throw new SessionIdentityError(
				`Refusing Entwurf resume of "${sessionFile}": session header has no id. Not an Entwurf session.`,
			);
		}
		if (!latestName) {
			throw new SessionIdentityError(
				`Refusing Entwurf resume of sessionId "${headerId}": no session_info name. The Entwurf marker is the ` +
					`name's \`entwurf\` tag; a session with no name is not an Entwurf session (no compatibility path).`,
			);
		}
		if (!parsed) {
			throw new SessionIdentityError(
				`Refusing Entwurf resume of sessionId "${headerId}": session name "${latestName}" is not canonical ` +
					`(cannot parse the locked grammar). Not an Entwurf session.`,
			);
		}
		if (!parsed.tags.includes("entwurf")) {
			throw new SessionIdentityError(
				`Refusing Entwurf resume of sessionId "${headerId}": session name tags [${parsed.tags.join(", ")}] do not ` +
					`include "entwurf". The Entwurf marker is the name's \`entwurf\` tag — this is a general pi session.`,
			);
		}
	}

	return { sessionId: headerId, cwd: headerCwd, provider: first.provider, modelId: first.modelId };
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
// @scope. "@junghanacs/entwurf@0.8.0" → "@junghanacs/entwurf";
// "entwurf@1.2.3" → "entwurf". The install root keys on the bare name,
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
	// resolution misses (e.g. local-dev `pi -e /abs/path/entwurf` with no
	// matching settings source), the parent entwurf extension is still loaded
	// from disk and our own module path is a more accurate bridge root than
	// settings (#29 correction #5). Remote spawn cannot reach a local path across
	// SSH, so it is excluded — remote must rely on settings/source mapping.
	if (!isRemote && packageNeedle === "entwurf") {
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
	/** Set when an explicit ACP intent (recorded provider=entwurf, or opt-in
	 *  Codex-via-ACP) cannot resolve the bridge. Resume callers MUST fail-fast on
	 *  this rather than spawning a guaranteed-broken `--provider entwurf`
	 *  child (#29). Claude-only heuristic stays warning-only (legacy fallback). */
	unresolvedAcpIntent?: boolean;
} {
	const args: string[] = [];
	const names: string[] = [];
	const warnings: string[] = [];

	const wantsClaudeBridge = isClaudeModel(model);
	const wantsCodexBridge = shouldRouteCodexViaAcp(model);
	// Resume-path signal: a session whose first spawn went through entwurf
	// MUST be resumed with the bridge extension loaded — otherwise pi cannot
	// resolve the "entwurf" provider and the resume dies silently (no
	// assistant turn gets appended). This guard is needed because resume
	// deliberately bypasses the Entwurf Target Registry (Identity Preservation
	// Rule) — so routing info has to come from the session's own recordedProvider.
	const wantsAcpByRecordedProvider = recordedProvider === "entwurf";
	if (!wantsClaudeBridge && !wantsCodexBridge && !wantsAcpByRecordedProvider) {
		return { args, names, warnings };
	}

	const acpBridge = resolveExplicitExtensionSpec("entwurf", isRemote);
	if (acpBridge) {
		args.push("-e", isRemote ? acpBridge.remotePath : acpBridge.localPath);
		names.push(acpBridge.name);
		return {
			args,
			names,
			warnings,
			provider: "entwurf",
			// Strip `openai-codex/` prefix when routing via ACP, for both opt-in Codex
			// routing and recorded-provider resume. For bare model ids the helper is
			// a no-op, so this is safe regardless of whether the prefix is present.
			modelOverride:
				wantsCodexBridge || wantsAcpByRecordedProvider ? normalizeCodexEntwurfModelForAcp(model) : undefined,
		};
	}

	// Bridge unresolved. Explicit ACP intent — recorded provider=entwurf on
	// resume, or opt-in Codex-via-ACP — cannot degrade: the child would be spawned
	// with `--provider entwurf` and die with `Unknown provider`. Signal
	// fail-fast to the caller (#29 correction #4: fail-fast scope = explicit ACP
	// intent). Checked BEFORE the Claude heuristic so a Claude model that also
	// recorded provider=entwurf fails fast instead of silently falling back
	// to the unrelated pi-claude-code-use bridge.
	if (wantsAcpByRecordedProvider) {
		warnings.push(
			"Resume recorded provider=entwurf but the bridge extension could not be resolved " +
				"(checked settings package source: local path / git install / npm install, plus module self-root). " +
				"Refusing to resume with an unknown provider.",
		);
		return { args, names, warnings, unresolvedAcpIntent: true };
	}

	if (wantsCodexBridge) {
		warnings.push(
			`Codex entwurf requested with ${ENTWURF_CODEX_ACP_ENV}=1 but entwurf could not be resolved. ` +
				"Refusing to spawn with --provider entwurf.",
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
		"Claude entwurf requested but entwurf could not be resolved. Claude entwurfs may fail without an explicit provider bridge.",
	);
	return { args, names, warnings };
}

/**
 * Registry-driven routing. The v1 spawn caller (runEntwurfSync) was removed in
 * the sync-body sweep; the live caller is now OPS package routing
 * (scripts/resolve-acp-bridge.ts). Resolves the explicit extension spec for a
 * (provider, model) tuple already validated against the registry.
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
	if (target.provider !== "entwurf") {
		return { args, names, warnings, provider: target.provider };
	}

	// entwurf targets need the bridge extension injected. If it can't be
	// resolved, fail-fast — NOT warning-only. A warning-then-spawn path puts a
	// child on `pi --no-extensions --provider entwurf`, which dies with
	// `Unknown provider "entwurf"` before any session file exists (#29). The
	// throw is caught by the same tool-surface try/catch that handles
	// EntwurfRegistryError, and surfaces as a failed entwurf.
	const acpBridge = resolveExplicitExtensionSpec("entwurf", isRemote);
	if (!acpBridge) {
		throw new EntwurfRoutingError(
			`entwurf target requested (provider=${target.provider}, model=${target.model}) but the ` +
				"bridge extension could not be resolved. Checked settings package source: local path / " +
				"git install (~/.pi/agent/git/...) / npm install (~/.pi/agent/npm/node_modules/...)" +
				(isRemote ? "" : " / loaded module self-root") +
				". Refusing to spawn a child with `--no-extensions --provider entwurf` (it would die " +
				'with `Unknown provider "entwurf"`). Install entwurf in pi settings packages, or ' +
				"check that the configured source's install directory exists.",
		);
	}

	args.push("-e", isRemote ? acpBridge.remotePath : acpBridge.localPath);
	names.push(acpBridge.name);
	return {
		args,
		names,
		warnings,
		provider: "entwurf",
		// Defensive: registry should already store bare basenames, but if a future
		// entry slips an `openai-codex/` prefix into a entwurf model field,
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

// Saved entwurf session lookup is by JSONL header `id` (= sessionId), not by
// filename species. See findSessionFileById / findSessionFilesById below in the
// "Garden session identity & name grammar" block — header scan is the sole
// authority; filenames are a Pi artifact and are never parsed for logic.

// ============================================================================
// Garden session identity & name grammar (0.9.0 / 1.0.0) — locked SSOT
//
// See NEXT.md "Locked — session identity & name grammar". This block is the
// ONLY place that assembles or parses a session name; nothing builds it by hand.
//
// Authority separation (do not blur):
//   - lookup / resume authority  = JSONL header `id` + header `cwd`. Filenames
//     are a Pi artifact and are NEVER parsed for logic.
//   - model authority            = JSONL first `model_change` + the
//     provider/model re-supplied on resume.
//   - session name               = display / search / integrity-mirror only.
//     title and tags carry zero logic. A name's provider/model mismatch is NOT
//     a routing signal — it is corrupt-metadata, surfaced via fail-fast.
//
// Grammar:
//   sessionId = YYYYMMDDTHHMMSS-[0-9a-f]{6}          (= JSONL header id)
//   name      = {sessionId}=={provider}/{model}--{titleSlug}__{tag}_{tag}
//     ==  signature delimiter | --  title delimiter
//     __  tag-section start   | _   tag separator
//   provider/model = entwurf-targets.json EXACT tuple (no regex model
//                    invention; `.`-bearing models gpt-5.5 / gemini-3.1-pro-preview
//                    are real).
//   titleSlug      = ascii slug, lowercase, hyphen ok, NO underscore. Raw title
//                    is free input; the builder canonicalizes it.
//   tags           = lowercase alnum, `_`-separated. `entwurf` tag ⇒ Entwurf.
// ============================================================================

export class SessionIdentityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionIdentityError";
	}
}

// Garden session-id grammar SSOT now lives in ./session-id.js (a real `.js`
// leaf, resolvable from both the tsc-emit and `node --experimental-strip-types`
// runtimes — same rationale as protocol.js). Imported above for internal use and
// re-exported here so every existing `entwurf-core` importer keeps working.
export { formatSessionTimestamp, generateSessionId, isValidSessionId, SESSION_ID_RE };

const SESSION_TAG_RE = /^[a-z0-9]+$/;
/** Canonical titleSlug: lowercase-alnum words joined by single hyphens, no edges. */
const TITLE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Canonicalize a human/agent raw title into an ascii slug. lowercase; every
 * non-`[a-z0-9]` run (spaces, unicode, punctuation, `_`, `__`) collapses to a
 * single `-`; trimmed. Empty → fallback (`untitled`). underscore is destroyed
 * here so a raw title can never smuggle a tag delimiter into the slug.
 */
export function slugifyTitle(rawTitle: string | undefined, fallback = "untitled"): string {
	const norm = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	return norm(rawTitle ?? "") || norm(fallback) || "untitled";
}

/**
 * Exact-tuple membership against the entwurf target registry. Existence, not
 * `enabled` — a session may have been spawned while the target was enabled and
 * later disabled; its name must still validate. Integrity mirror, not a routing gate.
 */
export function isKnownProviderModel(provider: string, model: string): boolean {
	let targets: EntwurfTarget[];
	try {
		targets = loadEntwurfTargets().entwurfTargets;
	} catch {
		return false;
	}
	return targets.some((t) => t.provider === provider && t.model === model);
}

export interface BuildSessionNameInput {
	sessionId: string;
	provider: string;
	model: string;
	/** Free human/agent input; canonicalized to a slug by the builder. */
	rawTitle?: string;
	/** lowercase-alnum tags. `entwurf` marks an Entwurf session. */
	tags?: string[];
}

export interface ParsedSessionName {
	sessionId: string;
	provider: string;
	model: string;
	titleSlug: string;
	tags: string[];
}

/**
 * Assemble a canonical session name — the ONLY way to produce a `--name` value.
 * Validates sessionId grammar, registry tuple, tag charset; canonicalizes title.
 * Throws SessionIdentityError on any violation; corrupt metadata must never reach `--name`.
 */
export function buildSessionName(input: BuildSessionNameInput): string {
	const { sessionId, provider, model, rawTitle, tags = [] } = input;

	if (!isValidSessionId(sessionId)) {
		throw new SessionIdentityError(`Invalid sessionId "${sessionId}": expected YYYYMMDDTHHMMSS-[0-9a-f]{6}.`);
	}
	if (!provider || provider.includes("/") || provider.includes("=") || provider.includes("--")) {
		throw new SessionIdentityError(`Invalid provider "${provider}" for session name.`);
	}
	if (!model || model.includes("/") || model.includes("=") || model.includes("--")) {
		throw new SessionIdentityError(`Invalid model "${model}" for session name.`);
	}
	if (!isKnownProviderModel(provider, model)) {
		throw new SessionIdentityError(
			`provider/model "${provider}/${model}" is not an exact tuple in the entwurf target registry. ` +
				`Session names mirror a real (provider, model); do not invent one.`,
		);
	}
	for (const tag of tags) {
		if (!SESSION_TAG_RE.test(tag)) {
			throw new SessionIdentityError(`Invalid tag "${tag}": tags must match /^[a-z0-9]+$/.`);
		}
	}

	const titleSlug = slugifyTitle(rawTitle);
	const base = `${sessionId}==${provider}/${model}--${titleSlug}`;
	return tags.length > 0 ? `${base}__${tags.join("_")}` : base;
}

/**
 * Parse a canonical session name into its fields. Returns `null` on any
 * structural violation. Pure string work — does NOT consult the registry, so it
 * stays usable for diagnostics on a name whose target was later removed.
 */
export function parseSessionName(name: string): ParsedSessionName | null {
	if (typeof name !== "string") return null;

	const sigIdx = name.indexOf("==");
	if (sigIdx < 0) return null;
	const sessionId = name.slice(0, sigIdx);
	if (!isValidSessionId(sessionId)) return null;

	const rest = name.slice(sigIdx + 2);

	// First `--` is the title delimiter. provider/model and titleSlug each carry
	// only single hyphens (registry models have no `--`; slugify collapses runs),
	// so the first `--` is unambiguous.
	const titleIdx = rest.indexOf("--");
	if (titleIdx < 0) return null;
	const providerModel = rest.slice(0, titleIdx);
	const titleAndTags = rest.slice(titleIdx + 2);

	const slashIdx = providerModel.indexOf("/");
	if (slashIdx < 0) return null;
	const provider = providerModel.slice(0, slashIdx);
	const model = providerModel.slice(slashIdx + 1);
	if (!provider || !model || model.includes("/")) return null;

	let titleSlug = titleAndTags;
	let tags: string[] = [];
	const tagIdx = titleAndTags.indexOf("__");
	if (tagIdx >= 0) {
		titleSlug = titleAndTags.slice(0, tagIdx);
		tags = titleAndTags.slice(tagIdx + 2).split("_");
		if (tags.some((t) => !SESSION_TAG_RE.test(t))) return null;
	}
	// canonical-only: a parseable name must carry a slug the builder could emit
	// (lowercase-alnum + single hyphens). Rejects spaces/uppercase/unicode and
	// any raw delimiter that slipped through.
	if (!TITLE_SLUG_RE.test(titleSlug)) return null;

	return { sessionId, provider, model, titleSlug, tags };
}

/** `entwurf` tag present ⇒ Entwurf session. Reads name as a discovery hint only. */
export function isEntwurfSessionName(name: string): boolean {
	const parsed = parseSessionName(name);
	return parsed ? parsed.tags.includes("entwurf") : false;
}

/** Resident-session tag. The top-level `--entwurf-control` operator session. */
export const RESIDENT_SESSION_TAG = "control";

/**
 * Garden-native session name for a TOP-LEVEL operator session (the resident
 * `--entwurf-control` session), NOT an Entwurf child.
 *
 * Same locked grammar as buildSessionName, with two deliberate differences:
 *   - provider/model are validated by charset + presence only, NOT against the
 *     Entwurf Target Registry. The operator's own session may run any native
 *     model (e.g. deepseek/deepseek-v4-pro) that is not an Entwurf spawn target;
 *     mirroring the live ctx.model must not be gated by the spawn registry
 *     (readSessionIdentity's name mirror is registry-free, so this parses fine).
 *   - the `entwurf` tag is FORBIDDEN. `entwurf` is the resume marker
 *     (readSessionIdentity `requireEntwurf`) — a resident session must never be
 *     resumable as an Entwurf child. The resident tag is `control`.
 *
 * Symmetric safety: buildSessionName (child) carries `entwurf`; this builder
 * refuses it. The two name species cannot be confused.
 */
export function buildGardenSessionName(input: BuildSessionNameInput): string {
	const { sessionId, provider, model, rawTitle, tags = [] } = input;

	if (!isValidSessionId(sessionId)) {
		throw new SessionIdentityError(`Invalid sessionId "${sessionId}": expected YYYYMMDDTHHMMSS-[0-9a-f]{6}.`);
	}
	if (!provider || provider.includes("/") || provider.includes("=") || provider.includes("--")) {
		throw new SessionIdentityError(`Invalid provider "${provider}" for garden session name.`);
	}
	if (!model || model.includes("/") || model.includes("=") || model.includes("--")) {
		throw new SessionIdentityError(`Invalid model "${model}" for garden session name.`);
	}
	for (const tag of tags) {
		if (!SESSION_TAG_RE.test(tag)) {
			throw new SessionIdentityError(`Invalid tag "${tag}": tags must match /^[a-z0-9]+$/.`);
		}
		if (tag === "entwurf") {
			throw new SessionIdentityError(
				`A resident garden session name must not carry the "entwurf" tag — that tag is the Entwurf resume ` +
					`marker and would make this operator session resumable as an Entwurf child. Use "${RESIDENT_SESSION_TAG}".`,
			);
		}
	}

	const titleSlug = slugifyTitle(rawTitle);
	const base = `${sessionId}==${provider}/${model}--${titleSlug}`;
	return tags.length > 0 ? `${base}__${tags.join("_")}` : base;
}

/**
 * Garden-native enforcement for the resident `--entwurf-control` session: the
 * session header id MUST be a garden sessionId. pi assigns a uuidv7 when the
 * launcher did not pass `--session-id` (session-manager `newSession`), so a
 * non-garden id here means the session was not born through the garden launcher.
 * Throws — there is no backward-compatibility path for uuid sessions under
 * `--entwurf-control`. The caller escalates (notify + refuse server + shutdown);
 * a bare throw from a session_start handler is swallowed by the extension runner.
 */
export function assertGardenNativeSessionId(sessionId: string | undefined): void {
	if (!isValidSessionId(sessionId)) {
		throw new SessionIdentityError(
			`Non-garden session id "${sessionId ?? "(none)"}" under --entwurf-control. Expected ` +
				`YYYYMMDDTHHMMSS-[0-9a-f]{6}. Launch through the garden launcher that passes ` +
				`--session-id "<generated>" (see entwurf README §Garden launcher / run.sh new-session-id) ` +
				`so every --entwurf-control session is a garden citizen. No uuid / back-compat path.`,
		);
	}
}

/** Screwdriver icon for the resident-session status label (GLGMAN's tool). */
export const RESIDENT_STATUS_ICON = "🪛";

/**
 * Screwdriver (🪛) status-bar label for the resident session. The garden id
 * appears ONLY once the session file exists on disk (= first assistant turn
 * done = model locked; pi's `_persist` defers the file until the first assistant
 * message). Before that it reads `ready`: the session is live and the model is
 * still changeable. The id's presence is the model-lock lifecycle signal, not
 * just an identifier. Pure — UI theming is the caller's concern.
 */
export function computeResidentStatusLabel(input: { sessionId: string; sessionFileExists: boolean }): string {
	return input.sessionFileExists ? `${RESIDENT_STATUS_ICON} ${input.sessionId}` : `${RESIDENT_STATUS_ICON} ready`;
}

/**
 * All session files whose JSONL header `id` equals `sessionId`, across every
 * cwd-encoded session dir. Header is the sole authority — every `.jsonl` header
 * is read; the filename is NOT used to pre-filter (a renamed/relocated file with
 * the right header still matches, a filename-only match with a different header
 * does not). Returns `[]` on invalid id or missing base.
 */
export function findSessionFilesById(sessionId: string): string[] {
	if (!isValidSessionId(sessionId)) return [];
	let dirs: string[];
	try {
		dirs = fs.readdirSync(SESSIONS_BASE);
	} catch {
		return [];
	}
	const matches: string[] = [];
	for (const dir of dirs) {
		const dirPath = path.join(SESSIONS_BASE, dir);
		let files: string[];
		try {
			if (!fs.statSync(dirPath).isDirectory()) continue;
			files = fs.readdirSync(dirPath);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const full = path.join(dirPath, file);
			if (readSessionHeader(full)?.id === sessionId) matches.push(full);
		}
	}
	return matches;
}

/**
 * Resolve a sessionId to its single session file by header scan. `null` if none,
 * the path if exactly one, and **throws** `SessionIdentityError` if the same
 * header id exists in more than one session (the wrong-cwd duplicate footgun) —
 * resume must never silently pick one of several ambiguous sessions.
 */
export function findSessionFileById(sessionId: string): string | null {
	const matches = findSessionFilesById(sessionId);
	if (matches.length === 0) return null;
	if (matches.length > 1) {
		throw new SessionIdentityError(
			`sessionId "${sessionId}" is ambiguous: ${matches.length} sessions carry this header id ` +
				`(${matches.join(", ")}). This is the wrong-cwd duplicate footgun; refuse rather than guess.`,
		);
	}
	return matches[0] ?? null;
}

/**
 * Parent-side collision pre-check before spawning with `--session-id`. Throws if
 * any existing session (in ANY cwd dir) already carries this header id —
 * `--session-id` would otherwise silently open/append to it. Duplicate-across-cwd
 * is included on purpose (the wrong-cwd footgun).
 */
export function assertSessionIdAvailableForSpawn(sessionId: string): void {
	if (!isValidSessionId(sessionId)) {
		throw new SessionIdentityError(`Refusing to spawn with invalid sessionId "${sessionId}".`);
	}
	const existing = findSessionFilesById(sessionId);
	if (existing.length > 0) {
		throw new SessionIdentityError(
			`sessionId "${sessionId}" already exists (${existing.length}): ${existing.join(", ")}. ` +
				`Spawning with this id would append to an existing session, not create a new one.`,
		);
	}
}

// ============================================================================
// In-process garden-native session birth (/gnew)
// ============================================================================

/**
 * pi's `CURRENT_SESSION_VERSION` at our pinned dep (0.78). This module MUST NOT
 * import pi (see file header), so the version is mirrored here. A header written
 * at the current version avoids a migrate-on-open rewrite; if pi later bumps the
 * version, the dep-bump track owns this constant. The garden id survives a
 * migration rewrite either way (migration preserves the header id), so a stale
 * version is a cosmetic rewrite, never a torn identity.
 */
export const GARDEN_SESSION_FILE_VERSION = 3;

export interface CreateGardenSessionFileInput {
	/** Absolute cwd recorded in the header. Must be the live session cwd. */
	cwd: string;
	/**
	 * The live session dir to write into — pass `ctx.sessionManager.getSessionDir()`,
	 * NOT a value recomputed from cwd. The live dir is the authority; recomputing it
	 * risks a mismatch with where pi actually keeps this session family.
	 */
	sessionDir: string;
	/** Test seam — a fixed id to force the collision path. Defaults to a fresh one. */
	sessionId?: string;
	/** Test seam for the file timestamp / id stamp. Defaults to now. */
	now?: Date;
}

export interface CreatedGardenSessionFile {
	sessionId: string;
	sessionFile: string;
}

/**
 * Pre-create an EMPTY garden-native session JSONL (header only) that
 * `ctx.switchSession(file)` can adopt in-process WITHOUT a torn identity.
 *
 * Why a precreated file + switchSession, and not `ctx.newSession({setup})`:
 * pi's `newSession()` runs `SessionManager.create()` (which mints a fresh uuid)
 * and fires `session_start` BEFORE the `setup` callback could re-stamp the id —
 * so the backend/bridge identity (PI_SESSION_ID, control socket, ACP stream
 * sessionId) binds to the uuid first and a later header rewrite only tears it.
 * `switchSession()` instead runs `SessionManager.open(file)`, which reads the
 * header id BEFORE `session_start`, so the garden id is the identity from the
 * very first bind. No uuid moment ever exists.
 *
 * THE TRAP this guards: `SessionManager.setSessionFile()` silently calls
 * `newSession()` (→ a fresh uuid, and rewrites the file) if it opens a file whose
 * header is empty/invalid. So the ONLY thing standing between us and a torn
 * identity is this header being perfectly valid. We therefore write with `wx`
 * (never overwrite), then read the bytes back and assert they parse to the exact
 * header — unlinking and throwing on ANY mismatch so a corrupt header can never
 * reach `switchSession`. Fail-closed: a broken write yields no session, not a uuid.
 *
 * Filename mirrors pi's own convention (`<iso-with-:.replaced>_<id>.jsonl`) so the
 * file is indistinguishable from a launcher-born garden session on disk.
 */
export function createGardenSessionFile(input: CreateGardenSessionFileInput): CreatedGardenSessionFile {
	const { cwd, sessionDir, now = new Date() } = input;
	const sessionId = input.sessionId ?? generateSessionId(now);

	if (!isValidSessionId(sessionId)) {
		throw new SessionIdentityError(`Refusing to create garden session file with invalid id "${sessionId}".`);
	}
	if (!cwd || !path.isAbsolute(cwd)) {
		throw new SessionIdentityError(`createGardenSessionFile requires an absolute cwd, got "${cwd}".`);
	}
	if (!sessionDir || !path.isAbsolute(sessionDir)) {
		throw new SessionIdentityError(
			`createGardenSessionFile requires an absolute sessionDir (ctx.sessionManager.getSessionDir()), got "${sessionDir}".`,
		);
	}

	// Collision pre-check (header scan across ALL cwd dirs): switching into an id
	// that already exists would APPEND to that session, not create a new one.
	assertSessionIdAvailableForSpawn(sessionId);

	const timestamp = now.toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-"); // pi's filename convention
	const sessionFile = path.join(sessionDir, `${fileTimestamp}_${sessionId}.jsonl`);

	const header = { type: "session", version: GARDEN_SESSION_FILE_VERSION, id: sessionId, timestamp, cwd };
	const line = `${JSON.stringify(header)}\n`;

	fs.mkdirSync(sessionDir, { recursive: true });

	// wx — never overwrite. A file already at this exact path is a hard refuse (an
	// in-flight same-ms collision the header scan could miss). Fail-closed.
	try {
		fs.writeFileSync(sessionFile, line, { flag: "wx" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
			throw new SessionIdentityError(
				`Garden session file already exists at ${sessionFile}; refusing to overwrite (wx).`,
			);
		}
		throw err;
	}

	// Fail-closed read-back: parse the bytes we just wrote and assert the full
	// header shape. ANY mismatch → unlink + throw, so switchSession never opens a
	// header that would re-mint a uuid (the setSessionFile trap above).
	let readBack: { type?: unknown; version?: unknown; id?: unknown; cwd?: unknown; timestamp?: unknown };
	try {
		const raw = fs.readFileSync(sessionFile, "utf8");
		const firstLine = raw.split("\n", 1)[0] ?? "";
		readBack = JSON.parse(firstLine) as typeof readBack;
	} catch (err) {
		try {
			fs.unlinkSync(sessionFile);
		} catch {
			/* best-effort */
		}
		throw new SessionIdentityError(
			`Garden session file read-back failed for ${sessionFile}: ${err instanceof Error ? err.message : String(err)}.`,
		);
	}
	if (
		readBack.type !== "session" ||
		readBack.version !== GARDEN_SESSION_FILE_VERSION ||
		readBack.id !== sessionId ||
		readBack.cwd !== cwd ||
		readBack.timestamp !== timestamp
	) {
		try {
			fs.unlinkSync(sessionFile);
		} catch {
			/* best-effort */
		}
		throw new SessionIdentityError(
			`Garden session file read-back mismatch for ${sessionFile}: wrote ` +
				`{type:session,version:${GARDEN_SESSION_FILE_VERSION},id:${sessionId},timestamp:${timestamp},cwd:${cwd}} but read ` +
				`${JSON.stringify(readBack)}. Refusing to switch into a header that would re-mint a uuid.`,
		);
	}

	return { sessionId, sessionFile };
}

/**
 * Best-effort removal of a garden session file we created but never adopted —
 * the `switchSession` was cancelled or threw, so the file is an orphan. Guarded:
 * only unlinks if the file STILL carries our header id AND has no entries beyond
 * the header, so we never delete a session that meanwhile gained content or a
 * different identity (a successful switch leaves a legitimate empty session that
 * we keep, exactly like a launcher-born session quit before its first turn).
 */
export function removeUnadoptedGardenSessionFile(sessionFile: string, sessionId: string): void {
	try {
		if (readSessionHeader(sessionFile)?.id !== sessionId) return; // not ours / re-minted — leave it
		const raw = fs.readFileSync(sessionFile, "utf8");
		const nonEmptyLines = raw.split("\n").filter((l) => l.trim().length > 0);
		if (nonEmptyLines.length > 1) return; // gained entries — it's a real session now
		fs.unlinkSync(sessionFile);
	} catch {
		/* best-effort; an orphan header-only file is harmless litter, not a leak */
	}
}

/**
 * Scope lock for 0.9.0 garden-native session identity: spawn/resume/status are
 * local-FS only. The sessionId collision pre-check (`assertSessionIdAvailableForSpawn`)
 * and the resume header scan (`findSessionFileById`) walk `~/.pi/agent/sessions`
 * on the local machine; they cannot see a remote host's filesystem. Remote (SSH)
 * entwurf identity is parked under #11. Fail-fast here rather than silently spawn
 * a remote session whose id we can neither pre-check nor later resume.
 */
export function assertLocalOnlyEntwurf(host: string | undefined): void {
	if (host && host !== "local") {
		throw new SessionIdentityError(
			`Remote entwurf host "${host}" is out of scope in 0.9.0 garden-native session identity (#11). ` +
				`sessionId collision pre-check and header-scan resume are local-filesystem only. ` +
				`Run the entwurf locally; remote/SSH identity is a later phase.`,
		);
	}
}
