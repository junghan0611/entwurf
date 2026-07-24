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

// The Entwurf Target Registry is GONE (#50 C3). `pi/entwurf-targets.json` and its
// reader chain (loadEntwurfTargets / resolveEntwurfTarget / EntwurfRegistryError +
// the ~/.pi/agent symlink machinery) were the v1 "narrow door" for spawn-model
// policy — but v2 never spawns from a model tuple: entwurf_v2 resumes an
// already-identified record-backed citizen, and the model axis is the citizen's
// own (Identity Preservation Rule). The last readers were the RT-dead
// buildSessionName mirror and the v1 spawn guard, both swept with this cut.
// Bridge-extension routing for provider=entwurf survives below (getRegistryRouting
// ← scripts/resolve-acp-bridge.ts) and takes a caller-supplied target — no file.

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

// The v1 spawn guard ("one entwurf spawn per (session, target) per process" —
// usedEntwurfTargets / ensureEntwurfOncePerTarget / markEntwurfTargetUsed /
// resolveGuardTargetKey) is GONE with the registry it consulted (#50 C3). Its
// callers died in the v1 sync-body sweep; entwurf_v2 never used it.

/** A caller-supplied (provider, model) tuple for bridge-extension routing.
 * The registry that used to resolve/validate these is gone (#50 C3); the one
 * live producer is scripts/resolve-acp-bridge.ts, which names its tuple inline. */
export interface ResolvedTarget {
	provider: string;
	model: string;
	explicitOnly: boolean;
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
 * Bridge-extension routing for a caller-supplied (provider, model) tuple. The
 * registry that used to validate the tuple is gone (#50 C3 — the name survives
 * for call-site stability); the live caller is OPS package routing
 * (scripts/resolve-acp-bridge.ts), which names its target inline.
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
	// `Unknown provider "entwurf"` before any session file exists (#29).
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
// Garden session identity (record era)
//
// The 0.9.0/1.0.0 "session identity & name grammar" block that stood here — the
// canonical name grammar `{sessionId}=={provider}/{model}--{titleSlug}__{tags}`
// with buildSessionName / parseSessionName / isEntwurfSessionName / slugifyTitle
// / isKnownProviderModel — is GONE (#50 C3). It existed to mirror the garden
// address into pi's session NAME while the address WAS pi's session id. The
// meta-record mints the address now (C2), the name is pi's alone (LOCKED
// PROTOCOL 2), and no code assembles or parses a session name anymore. The
// garden-id grammar itself (YYYYMMDDTHHMMSS-[0-9a-f]{6}) lives on in
// ./session-id.js as the RECORD's gardenId shape.
//
// Earlier in the same sweep (#50 C2): the resident-name builder
// (`buildGardenSessionName`), the garden-id resident guard
// (`assertGardenNativeSessionId`), the spawn collision pre-check and the
// in-process garden-session birth writer (`/gnew`) — all made pi's session id
// BE the garden address; the record owns it now.
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
