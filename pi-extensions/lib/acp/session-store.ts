// ACP plugin — session store / signature / bootstrap decision (S2d-1b-1).
//
// This is the DETERMINISTIC half of session reuse. It owns three pure concerns
// and the record persistence around them, with NO child/connection lifecycle
// (that is S2d-1b-2 live wiring):
//
//   1. bridgeConfigSignature      — a stable hash of the config that, if it
//      drifts, must invalidate a reused session (NEXT oracle C / 핀1). During
//      S2d-1b the carrier (appendSystemPrompt) is ABSENT, so the signature is a
//      per-model constant; engraving fills it in S2d-1c.
//   2. contextMessageSignatures   — one signature per pi message (role + content
//      shape), ported from 0.11.0 index.ts:432. Reuse is only safe when the
//      existing session's signatures are a PREFIX of the new turn's — i.e. the
//      new context continues the old one rather than diverging.
//   3. decideBootstrap            — maps (params, in-memory existing, persisted
//      record) to an AcpBootstrapPath, with bootstrapPath (history source) and
//      lifecyclePolicy (whether the child survives the turn) kept ORTHOGONAL
//      (GPT 73b44d). `turn-scoped` (pi -p one-shot) is always `new` — never an
//      in-memory child reuse, because a surviving child's stdio handle pins pi's
//      exit (the S2c hang). Only a long-lived `process-scoped` session reuses.
//
// 핀4 tie-in: the chosen path feeds buildAcpPrompt(context, path) so reuse sends
// a delta while new sends the full transcript. The prefix-compat gate here is
// what makes delta-only SAFE — a mismatch falls back to `new` + full transcript.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Context, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AcpBootstrapPath } from "./context.js";

// MUST equal event-mapper.ts `LIFECYCLE_NOTICE_SIGNATURE` (the SSOT/producer).
// Mirrored, not imported — the strip-types gates load this file by its `.ts`
// source and cannot resolve a cross-sibling VALUE import; lib modules share
// TYPES only. check-acp-session-reuse enforces equality behaviorally (a drift
// would let display-only notices perturb the reuse-compat signature).
const LIFECYCLE_NOTICE_SIGNATURE = "entwurf:lifecycle-notice-v1";

/** sha256 hex digest. Used so on-disk records carry digests, never raw prompt text. */
function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export const SESSION_RECORD_VERSION = 1;
export const SESSION_RECORD_PROVIDER = "entwurf" as const;

/** Where the child survives relative to a turn — ORTHOGONAL to bootstrapPath. */
export type LifecyclePolicy = "process-scoped" | "turn-scoped";

/** The exact argv token that marks a long-lived resident pi process. */
export const ENTWURF_CONTROL_FLAG = "--entwurf-control";

/**
 * Decide whether this pi process may keep an ACP child alive across turns. Only
 * an explicit long-lived resident (`--entwurf-control`) is `process-scoped`;
 * everything else — `pi -p` one-shot AND plain interactive — is `turn-scoped`
 * (new + teardown each turn), the S2c hang-safe default (a surviving child's
 * stdio handle would pin a one-shot pi's exit).
 *
 * Keyed on the resident flag, NEVER on `-p`: a resident may ALSO carry `-p`
 * (fire a first prompt, then stay alive), so a `-p` test would kill real
 * resident reuse. Exact-token match, not substring (`--not-entwurf-control`
 * must NOT qualify). A future explicit pi lifecycle/mode hint would take
 * precedence over argv, but argv is the most honest marker available today.
 */
export function resolveLifecyclePolicy(argv: readonly string[] = process.argv): LifecyclePolicy {
	return argv.includes(ENTWURF_CONTROL_FLAG) ? "process-scoped" : "turn-scoped";
}

/**
 * Inputs to the config signature. Order is FIXED so the serialized hash is
 * stable across turns (a drifting key order would force a rebuild every turn).
 * `appendSystemPrompt` is the carrier slot — the rendered engraving string
 * (empty when absent). `mcpServersHash` is the sha256 of the NORMALIZED server
 * list (NOT just names — S2g/GPT `…2f9325`), so a change to a server's
 * command/args/env/url/headers invalidates a reused session. The per-session
 * envelope (PI_SESSION_ID/PI_AGENT_ID) is deliberately NOT here: it is runtime
 * wiring injected after this hash is taken, so a new session id alone never
 * forces a rebuild.
 */
export interface BridgeConfigInput {
	backend: string;
	modelId: string;
	/** Backend-native model id (curation prefix stripped); claude: equals modelId. */
	nativeModelId: string;
	appendSystemPrompt: string;
	/** Backend-specific stable signature fields (e.g. a backend connection/profile id). Never secrets. */
	extra?: Record<string, unknown>;
	mcpServersHash: string;
	settingSources: string[];
	strictMcpConfig: boolean;
	tools: string[];
	skillPlugins: string[];
	permissionAllow: string[];
	disallowedTools: string[];
}

/** A persisted ACP session record (one file per sessionKey). */
export interface SessionRecord {
	version: number;
	provider: typeof SESSION_RECORD_PROVIDER;
	sessionKey: string;
	acpSessionId: string;
	cwd: string;
	modelId: string;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
	updatedAt: string;
}

/** The compat-relevant facts of a candidate session (in-memory or persisted). */
export interface SessionCompatFacts {
	cwd: string;
	modelId: string;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
}

/** An in-memory live session candidate (reuse path). */
export interface ExistingSession extends SessionCompatFacts {
	alive: boolean;
}

export interface BootstrapParams extends SessionCompatFacts {
	lifecyclePolicy: LifecyclePolicy;
}

export interface BootstrapDecision {
	path: AcpBootstrapPath;
	/** The ACP session id to resume/load (persisted paths only). */
	acpSessionId?: string;
	/** The persisted record must be deleted (it is stale/incompatible). */
	invalidatePersisted?: boolean;
	reason: string;
}

/** Thrown when a live session is asked to switch the model it is locked to. */
export class SessionModelLockedError extends Error {
	readonly fromModel: string;
	readonly toModel: string;
	constructor(fromModel: string, toModel: string) {
		super(`entwurf session is locked to model ${fromModel}; refusing switch to ${toModel}`);
		this.name = "SessionModelLockedError";
		this.fromModel = fromModel;
		this.toModel = toModel;
	}
}

const SESSION_CACHE_DIR = join(homedir(), ".pi", "agent", "cache", "entwurf", "sessions");

// ---------------------------------------------------------------------------
// 1) signatures
// ---------------------------------------------------------------------------

/**
 * Stable config hash. Pure — no clock/random/env. The serialized input is a
 * SMALL object with a FIXED key order so `JSON.stringify` is deterministic
 * across turns (a drifting order would force a rebuild every turn). The digest
 * keeps the carrier text (appendSystemPrompt) out of the on-disk record (GPT
 * `c617cb` hardening).
 */
export function bridgeConfigSignature(input: BridgeConfigInput): string {
	return sha256(
		JSON.stringify({
			backend: input.backend,
			modelId: input.modelId,
			nativeModelId: input.nativeModelId,
			appendSystemPrompt: input.appendSystemPrompt,
			mcpServersHash: input.mcpServersHash,
			settingSources: [...input.settingSources],
			strictMcpConfig: input.strictMcpConfig,
			tools: [...input.tools],
			skillPlugins: [...input.skillPlugins],
			permissionAllow: [...input.permissionAllow],
			disallowedTools: [...input.disallowedTools],
			extra: input.extra ?? {},
		}),
	);
}

/** One signature per content block — role-agnostic shape fingerprint. */
function messageContentSignature(content: unknown): string {
	if (typeof content === "string") return `text:${content}`;
	if (!Array.isArray(content)) return "";
	return (
		content
			// Exclude S2f lifecycle progress notices ENTIRELY (not as an empty entry) so
			// the per-message signature is byte-identical whether or not display-only
			// `[acp: …]` blocks were appended to this assistant message. A null/empty
			// map entry would shift the `|`-join and perturb the prefix-compat check.
			.filter(
				(block) =>
					!(
						block &&
						typeof block === "object" &&
						(block as { textSignature?: unknown }).textSignature === LIFECYCLE_NOTICE_SIGNATURE
					),
			)
			.map((block: Record<string, unknown>) => {
				if (!block || typeof block !== "object") return "";
				switch (block.type) {
					case "text":
						return `text:${String(block.text ?? "")}`;
					case "image":
						return `image:${String(block.mimeType ?? "")}`;
					case "thinking":
						return `thinking:${String(block.thinking ?? "")}`;
					case "toolCall":
						return `tool:${String(block.name ?? "")}:${JSON.stringify(block.arguments ?? {})}`;
					default:
						return `${String(block.type ?? "unknown")}:${JSON.stringify(block)}`;
				}
			})
			.join("|")
	);
}

/**
 * The pre-hash, human-readable signature of one message. A toolResult also
 * folds in `toolName` + `isError` so a same-text result from a different tool
 * (or a success vs an error) breaks the prefix (GPT `c617cb`).
 */
function rawMessageSignature(message: Message): string {
	const contentSig = messageContentSignature((message as { content: unknown }).content);
	if (message.role === "toolResult") {
		const tr = message as ToolResultMessage;
		return `toolResult:${tr.toolName ?? ""}:${tr.isError ? "1" : "0"}:${contentSig}`;
	}
	return `${message.role}:${contentSig}`;
}

/**
 * Per-message signatures: reuse is safe only when the existing list is a prefix
 * of the new turn's. Each entry is sha256(rawMessageSignature) so the persisted
 * record never stores raw prompt/tool text — the prefix check works the same on
 * the digest array (GPT `c617cb` hardening).
 */
export function contextMessageSignatures(context: Context): string[] {
	return context.messages.map((m: Message) => sha256(rawMessageSignature(m)));
}

/** True when `existing` is a (possibly equal) PREFIX of `params`. */
export function hasPrefix(existing: string[], params: string[]): boolean {
	if (existing.length > params.length) return false;
	for (let i = 0; i < existing.length; i++) {
		if (existing[i] !== params[i]) return false;
	}
	return true;
}

/**
 * Compatible = same cwd + same model + same config signature + the candidate's
 * message signatures are a prefix of the new turn's. A carrier drift changes the
 * signature → incompatible. An edited/compacted/reordered history breaks the
 * prefix → incompatible (so delta-only is never sent against divergent history).
 */
export function isCompatible(candidate: SessionCompatFacts, params: SessionCompatFacts): boolean {
	return (
		candidate.cwd === params.cwd &&
		candidate.modelId === params.modelId &&
		candidate.bridgeConfigSignature === params.bridgeConfigSignature &&
		hasPrefix(candidate.contextMessageSignatures, params.contextMessageSignatures)
	);
}

// ---------------------------------------------------------------------------
// 2) bootstrap decision (bootstrapPath ⟂ lifecyclePolicy)
// ---------------------------------------------------------------------------

/**
 * Decide the bootstrap path. Pure except for the fail-loud model-lock throw.
 *
 * - `turn-scoped` (pi -p one-shot): ALWAYS `new`. Never an in-memory reuse (a
 *   surviving child would pin pi's exit), and — for the first cut — never a
 *   persisted resume/load either (a turn-scoped persisted path is a later lane).
 * - `process-scoped` (long-lived): in-memory reuse if compatible+alive; else a
 *   compatible persisted record resumes/loads (by capability); else `new`. A
 *   live model mismatch is a fail-loud throw at the bridge boundary (a second
 *   guard beyond v2 model-lock). An incompatible existing also invalidates the
 *   persisted record (it can no longer be trusted to continue this session).
 */
export function decideBootstrap(
	params: BootstrapParams,
	sources: {
		existing?: ExistingSession;
		persisted?: SessionRecord;
		capabilities?: { resumeSession: boolean; loadSession: boolean };
	} = {},
): BootstrapDecision {
	const { existing, persisted, capabilities } = sources;

	// Fail-loud model lock: a LIVE session never silently re-targets its model.
	if (existing?.alive && existing.modelId !== params.modelId) {
		throw new SessionModelLockedError(existing.modelId, params.modelId);
	}

	if (params.lifecyclePolicy === "turn-scoped") {
		return { path: "new", reason: "turn_scoped_one_shot" };
	}

	// process-scoped
	if (existing?.alive && isCompatible(existing, params)) {
		return { path: "reuse", reason: "in_memory_compatible" };
	}

	// An incompatible existing (alive but drifted) can no longer anchor this
	// session — drop its persisted record too. A dead-but-compatible existing
	// leaves the persisted record intact so it can still resume.
	const existingIncompatible = !!existing && !isCompatible(existing, params);

	if (!existingIncompatible && persisted && isCompatible(persisted, params)) {
		if (capabilities?.resumeSession) {
			return { path: "resume", acpSessionId: persisted.acpSessionId, reason: "persisted_compatible_resume" };
		}
		if (capabilities?.loadSession) {
			return { path: "load", acpSessionId: persisted.acpSessionId, reason: "persisted_compatible_load" };
		}
		return { path: "new", reason: "persisted_compatible_no_capability" };
	}

	return {
		path: "new",
		invalidatePersisted: existingIncompatible || (!!persisted && !isCompatible(persisted, params)),
		reason: existingIncompatible
			? "existing_incompatible"
			: persisted
				? "persisted_incompatible"
				: "no_compatible_source",
	};
}

// ---------------------------------------------------------------------------
// 3) record build + persistence (clock injected — pure build, fs I/O thin)
// ---------------------------------------------------------------------------

/** Build a record from compat facts. `now` is injected so the build is pure. */
export function buildSessionRecord(
	input: { sessionKey: string; acpSessionId: string } & SessionCompatFacts,
	now: string,
): SessionRecord {
	return {
		version: SESSION_RECORD_VERSION,
		provider: SESSION_RECORD_PROVIDER,
		sessionKey: input.sessionKey,
		acpSessionId: input.acpSessionId,
		cwd: input.cwd,
		modelId: input.modelId,
		bridgeConfigSignature: input.bridgeConfigSignature,
		contextMessageSignatures: [...input.contextMessageSignatures],
		updatedAt: now,
	};
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

/** Validate a parsed JSON object into a SessionRecord, or undefined if invalid. */
export function parseSessionRecord(raw: unknown, sessionKey: string): SessionRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	if (r.version !== SESSION_RECORD_VERSION) return undefined;
	if (r.provider !== SESSION_RECORD_PROVIDER) return undefined;
	if (r.sessionKey !== sessionKey) return undefined;
	if (!isNonEmptyString(r.acpSessionId)) return undefined;
	if (!isNonEmptyString(r.cwd)) return undefined;
	if (!isNonEmptyString(r.modelId)) return undefined;
	if (!isNonEmptyString(r.bridgeConfigSignature)) return undefined;
	if (!Array.isArray(r.contextMessageSignatures) || !r.contextMessageSignatures.every((s) => typeof s === "string")) {
		return undefined;
	}
	if (!isNonEmptyString(r.updatedAt)) return undefined;
	return {
		version: SESSION_RECORD_VERSION,
		provider: SESSION_RECORD_PROVIDER,
		sessionKey,
		acpSessionId: r.acpSessionId,
		cwd: r.cwd,
		modelId: r.modelId,
		bridgeConfigSignature: r.bridgeConfigSignature,
		contextMessageSignatures: [...(r.contextMessageSignatures as string[])],
		updatedAt: r.updatedAt,
	};
}

export function sessionRecordPath(sessionKey: string, dir: string = SESSION_CACHE_DIR): string {
	// sessionKey is a pi-supplied id; sha256 it so the filename is fixed-length
	// and safe regardless of cwd length / path chars (GPT `c617cb` hardening —
	// the old encodeURIComponent was safe but unbounded in length).
	return join(dir, `${sha256(sessionKey)}.json`);
}

/** Read + validate a persisted record. A corrupt/incompatible file is deleted. */
export function readSessionRecord(sessionKey: string, dir: string = SESSION_CACHE_DIR): SessionRecord | undefined {
	const filePath = sessionRecordPath(sessionKey, dir);
	if (!existsSync(filePath)) return undefined;
	try {
		const record = parseSessionRecord(JSON.parse(readFileSync(filePath, "utf8")), sessionKey);
		if (!record) {
			deleteSessionRecord(sessionKey, dir);
			return undefined;
		}
		return record;
	} catch {
		deleteSessionRecord(sessionKey, dir);
		return undefined;
	}
}

export function writeSessionRecord(record: SessionRecord, dir: string = SESSION_CACHE_DIR): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(sessionRecordPath(record.sessionKey, dir), `${JSON.stringify(record, null, 2)}\n`);
}

export function deleteSessionRecord(sessionKey: string, dir: string = SESSION_CACHE_DIR): void {
	rmSync(sessionRecordPath(sessionKey, dir), { force: true });
}
