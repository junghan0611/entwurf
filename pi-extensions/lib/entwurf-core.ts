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

export interface ExplicitExtensionSpec {
	name: string;
	localPath: string;
	remotePath: string;
}

// ============================================================================
// Path / model helpers
// ============================================================================

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

// The v1 session-file readers that used to sit here — extractTextContent,
// readSessionHeader (the bounded header read), analyzeSessionFileLike (the
// streamed last-assistant-state scan) — are GONE (#50 C3). Their last consumers
// were the header-scan lookup below and the retired --session-id/--name
// substrate smoke; the record owns lookup now and nothing analyzes a transcript
// body from this module anymore. readSessionIdentity below is the one surviving
// transcript reader (resume identity only).

const SESSION_READ_CHUNK_BYTES = 64 * 1024;

/**
 * Recorded session identity — the resume authority (NEXT.md "Authority
 * separation"):
 *   - model authority = the session's FIRST `model_change` (provider + modelId),
 *     NOT the last assistant message's `model` field. A session that drifted to
 *     a different model on a later `model_change` is corrupt for our purposes
 *     (entwurf children run `pi -p --model <M>` non-interactively, so a healthy
 *     entwurf session has exactly one model_change) — refuse rather than follow
 *     the drift.
 *   - the session NAME is pi's (LOCKED PROTOCOL 2) and is not read at all. The
 *     old name-mirror integrity check and the `requireEntwurf` name-tag
 *     authorization are gone (#50 C3): resume authorization is record existence,
 *     and transcript integrity is the caller's header-id ↔ record.nativeSessionId
 *     check (entwurf-v2-spawn-production.resolveResumeLaunchIdentity).
 */
export interface RecordedSessionIdentity {
	/** JSONL header `id` (pi's own session id — the record's `nativeSessionId`). */
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
 * `model_change` differs from the first). This is the fail-fast that replaces
 * the old "follow the last assistant message's model" behavior.
 */
export function readSessionIdentity(sessionFile: string): RecordedSessionIdentity | null {
	let headerId: string | undefined;
	let headerCwd: string | undefined;
	let first: { provider: string; modelId: string } | undefined;
	let drift: { provider: string; modelId: string } | undefined;

	const onLine = (line: string): void => {
		const t = line.trim();
		if (!t) return;
		let e: { type?: string; id?: unknown; cwd?: unknown; provider?: unknown; modelId?: unknown };
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
		}
	};

	let fd: number | undefined;
	try {
		fd = fs.openSync(sessionFile, "r");
		const chunk = Buffer.alloc(SESSION_READ_CHUNK_BYTES);
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

// <pkgroot>/pi-extensions/lib/entwurf-core.ts → <pkgroot>.
//
// The "runs from source in every surface, never a bundled copy" claim that used to
// stand here is FALSE and was false from 0.12.1: the bridge build emits a copy at
// mcp/entwurf-bridge/dist/pi-extensions/lib/entwurf-core.js, three levels deeper, where
// `../..` lands inside dist/ instead of the package root. That is the SAME location-
// arithmetic class as the capability-registry corpse (a function whose whole behaviour
// is arithmetic on its own path is only as correct as the layout it is executed from).
//
// It is not the same bug: this seam is a BEST-EFFORT local-extension probe reached only
// for `packageNeedle === "entwurf"` on a non-remote spawn, and a wrong root returns null
// from probeExtensionRoot() and falls through to the settings/source mapping — it does
// not throw the way a missing registry did. Nothing has verified what the emitted copy
// resolves to at runtime, so do not upgrade this comment to a claim of correctness
// without a gate that asks the shipped copy from where it lives.
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

// The resident-name builder (`buildGardenSessionName`) and its `control` tag, the
// garden-id resident guard (`assertGardenNativeSessionId`), the spawn collision
// pre-check (`assertSessionIdAvailableForSpawn`) and the whole in-process
// garden-session birth writer (`/gnew`: createGardenSessionFile +
// removeUnadoptedGardenSessionFile + GARDEN_SESSION_FILE_VERSION) are GONE (#50 C2).
// All five existed to make pi's session id BE the garden address — mint it, enforce
// it, mirror it into a name, and pre-create a file carrying it. The meta-record mints
// the address now, so pi's id is just `nativeSessionId` and none of that machinery
// has a subject. The name-authority chain that remains (buildSessionName →
// isKnownProviderModel → the registry) is C3's.

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

// The global header-scan lookup (`findSessionFilesById` / `findSessionFileById` —
// "every cwd dir, header id is the authority") and its remote scope-lock
// (`assertLocalOnlyEntwurf`) are GONE (#50 C3). They existed to resolve a garden id
// to a pi session FILE while the garden id WAS pi's session id; the meta-record now
// carries `transcriptPath` directly (resolveResumeLaunchIdentity), so nothing scans
// `~/.pi/agent/sessions` anymore and the wrong-cwd duplicate footgun has no subject.
