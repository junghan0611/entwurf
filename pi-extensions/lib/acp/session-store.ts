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

import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Message, ToolResultMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AcpHostFacts } from "../acp-host-facts.js";
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

/** 2 since #171 L16: the record carries `pendingDispatch`. A version-1 record reads as `outdated` and is never attached. */
export const SESSION_RECORD_VERSION = 2;
/** The version written before the dispatch marker existed (#171 L16 rule 5). */
const SESSION_RECORD_VERSION_BEFORE_MARKER = 1;
export const SESSION_RECORD_PROVIDER = "entwurf" as const;

/** Where the child survives relative to a turn — ORTHOGONAL to bootstrapPath. */
export type LifecyclePolicy = "process-scoped" | "turn-scoped";

/** The flag `entwurf pi` adds. The control extension owns its parsing; this constant is the spelling SSOT. */
export const ENTWURF_CONTROL_FLAG = "--entwurf-control";

/**
 * What this pi process is to an ACP row (#171 decision 18, GLG 2026-11-21): a resident
 * that keeps one vendor session (`process-scoped`), an explicit one-shot that opens and
 * closes one (`turn-scoped`), or neither (`unhosted`), where an ACP turn stops.
 */
export type HostLifecycle = LifecyclePolicy | "unhosted";

/**
 * Decide what this pi process is to an ACP row, from the two reported host facts
 * (lib/acp-host-facts.ts) — never from raw argv: `pi -- --entwurf-control` passes that
 * token as a prompt, and only Pi's parser knows whether the control flag is set.
 *
 * - The control extension reported its flag as set: a long-lived resident,
 *   `process-scoped`. Read first and alone: a resident may ALSO be in print mode (fire a
 *   first prompt, then stay alive).
 * - Otherwise, Pi-reported mode `print` or `json`: a one-shot, `turn-scoped` (new +
 *   teardown each turn). Pi also reports `print` for redirected stdio without `-p`.
 * - Otherwise, mode `tui` or `rpc`: `unhosted`. Such a process used to open a new vendor
 *   session on every turn and write no record, which is the internal `new` decision 17
 *   forbids. ACP runs under `entwurf pi`.
 * - A fact nobody reported grants nothing: no flag report is not a resident, and no mode
 *   report is not a one-shot.
 */
export function resolveLifecyclePolicy(facts: AcpHostFacts): HostLifecycle {
	if (facts.controlEnabled === true) return "process-scoped";
	return facts.mode === "print" || facts.mode === "json" ? "turn-scoped" : "unhosted";
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

/**
 * #171 L16 — what may have run since the record was sealed. Written into the record atomically immediately
 * before `session/prompt`; the write that seals the turn clears it to `null`. Positions index the dispatch
 * context's messages, the same index space as its `contextMessageSignatures`; the range is the messages
 * after its last assistant (`userDeltaRange`), so `start + count` is always the signature count. It never
 * holds prompt text: whoever reads the range reads the text from Pi's transcript.
 */
export interface PendingDispatch {
	start: number;
	count: number;
	contextMessageSignatures: string[];
}

/**
 * #171 step 8 — where the session's first prompt stands. `pending`: the session was created and
 * nothing was sent to it. `dispatched`: its first prompt may have run. `sealed`: a turn was answered.
 */
export type FirstPromptState = "pending" | "dispatched" | "sealed";

const FIRST_PROMPT_STATES: readonly string[] = ["pending", "dispatched", "sealed"];

/** The agent that answered `initialize` for the session a record names (#171 step 8). */
export interface RecordWriter {
	name: string;
	version: string;
}

/** A persisted ACP session record (one file per sessionKey). */
export interface SessionRecord {
	version: number;
	provider: typeof SESSION_RECORD_PROVIDER;
	sessionKey: string;
	acpSessionId: string;
	/** Who created the vendor session; a resume is decided against measured writer and reader pairs. */
	writer: RecordWriter;
	firstPrompt: FirstPromptState;
	cwd: string;
	modelId: string;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
	/** `null` once the last dispatch was sealed; a marker while one may have run unanswered (#171 L16). */
	pendingDispatch: PendingDispatch | null;
	updatedAt: string;
}

/** A record whose last dispatch was sealed — the only shape a bootstrap decision may read (#171 L16). */
export type SealedSessionRecord = SessionRecord & { pendingDispatch: null };

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
	/** One role per message, from the same context as `contextMessageSignatures` (#171 L16 rule 6). */
	messageRoles: readonly string[];
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

function sessionCacheDir(): string {
	return join(getAgentDir(), "cache", "entwurf", "sessions");
}

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
export function contextMessageSignatures(context: TranscriptContext): string[] {
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

/**
 * #171 L16 rule 6, in the form R12 measured: the record is behind the transcript when, after its prefix, a
 * user message is followed by an assistant message — a turn ran that the record never sealed. The prefix is
 * taken at the start of a call, so the sealed turn's own answer is the first message after it: an assistant
 * before any user is no sign, and neither is a tail of users only (the unsent inputs, sent in order).
 */
export function recordIsBehind(prefixLength: number, messageRoles: readonly string[]): boolean {
	let sawUser = false;
	for (let i = prefixLength; i < messageRoles.length; i++) {
		if (messageRoles[i] === "user") sawUser = true;
		else if (messageRoles[i] === "assistant" && sawUser) return true;
	}
	return false;
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
		persisted?: SealedSessionRecord;
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
		if (recordIsBehind(persisted.contextMessageSignatures.length, params.messageRoles)) {
			return { path: "new", invalidatePersisted: true, reason: "persisted_behind" };
		}
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
	input: {
		sessionKey: string;
		acpSessionId: string;
		writer: RecordWriter;
		firstPrompt: FirstPromptState;
		pendingDispatch?: PendingDispatch | null;
	} & SessionCompatFacts,
	now: string,
): SessionRecord {
	return {
		version: SESSION_RECORD_VERSION,
		provider: SESSION_RECORD_PROVIDER,
		sessionKey: input.sessionKey,
		acpSessionId: input.acpSessionId,
		writer: { name: input.writer.name, version: input.writer.version },
		firstPrompt: input.firstPrompt,
		cwd: input.cwd,
		modelId: input.modelId,
		bridgeConfigSignature: input.bridgeConfigSignature,
		contextMessageSignatures: [...input.contextMessageSignatures],
		pendingDispatch: input.pendingDispatch
			? {
					start: input.pendingDispatch.start,
					count: input.pendingDispatch.count,
					contextMessageSignatures: [...input.pendingDispatch.contextMessageSignatures],
				}
			: null,
		updatedAt: now,
	};
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function isCount(v: unknown): v is number {
	return Number.isSafeInteger(v) && (v as number) >= 0;
}

/** `null`, a self-consistent marker, or `undefined` for anything else (the record is then invalid). */
function parsePendingDispatch(raw: unknown): PendingDispatch | null | undefined {
	if (raw === null) return null;
	if (!raw || typeof raw !== "object") return undefined;
	const m = raw as Record<string, unknown>;
	if (!isCount(m.start) || !isCount(m.count) || !isStringArray(m.contextMessageSignatures)) return undefined;
	if (m.start + m.count !== m.contextMessageSignatures.length) return undefined;
	return { start: m.start, count: m.count, contextMessageSignatures: [...m.contextMessageSignatures] };
}

/** Validate a parsed JSON object into a SessionRecord, or undefined if invalid. */
export function parseSessionRecord(raw: unknown, sessionKey: string): SessionRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	if (r.version !== SESSION_RECORD_VERSION) return undefined;
	if (r.provider !== SESSION_RECORD_PROVIDER) return undefined;
	if (r.sessionKey !== sessionKey) return undefined;
	if (!isNonEmptyString(r.acpSessionId)) return undefined;
	const writer = r.writer as { name?: unknown; version?: unknown } | null | undefined;
	if (typeof writer !== "object" || writer === null) return undefined;
	if (!isNonEmptyString(writer.name) || !isNonEmptyString(writer.version)) return undefined;
	if (typeof r.firstPrompt !== "string" || !FIRST_PROMPT_STATES.includes(r.firstPrompt)) return undefined;
	if (!isNonEmptyString(r.cwd)) return undefined;
	if (!isNonEmptyString(r.modelId)) return undefined;
	if (!isNonEmptyString(r.bridgeConfigSignature)) return undefined;
	if (!isStringArray(r.contextMessageSignatures)) return undefined;
	// Required key: a current record states its dispatch either way (#171 L16).
	if (!("pendingDispatch" in r)) return undefined;
	const pendingDispatch = parsePendingDispatch(r.pendingDispatch);
	if (pendingDispatch === undefined) return undefined;
	if (!isNonEmptyString(r.updatedAt)) return undefined;
	return {
		version: SESSION_RECORD_VERSION,
		provider: SESSION_RECORD_PROVIDER,
		sessionKey,
		acpSessionId: r.acpSessionId,
		writer: { name: writer.name, version: writer.version },
		firstPrompt: r.firstPrompt as FirstPromptState,
		cwd: r.cwd,
		modelId: r.modelId,
		bridgeConfigSignature: r.bridgeConfigSignature,
		contextMessageSignatures: [...r.contextMessageSignatures],
		pendingDispatch,
		updatedAt: r.updatedAt,
	};
}

export function sessionRecordPath(sessionKey: string, dir: string = sessionCacheDir()): string {
	// sessionKey is a pi-supplied id; sha256 it so the filename is fixed-length
	// and safe regardless of cwd length / path chars (GPT `c617cb` hardening —
	// the old encodeURIComponent was safe but unbounded in length).
	return join(dir, `${sha256(sessionKey)}.json`);
}

export type SessionRecordRead =
	| { status: "found"; record: SessionRecord }
	| { status: "missing" }
	| { status: "invalid" }
	/** Written before `pendingDispatch` existed: not evidence that nothing is pending, never attached (#171 L16). */
	| { status: "outdated" }
	| { status: "unreadable"; code?: string };

/** Classify without deleting or changing evidence, including unreadable files. */
export function readSessionRecord(sessionKey: string, dir: string = sessionCacheDir()): SessionRecordRead {
	let text: string;
	try {
		text = readFileSync(sessionRecordPath(sessionKey, dir), "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" ? { status: "missing" } : { status: "unreadable", code };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { status: "invalid" };
	}
	if ((raw as { version?: unknown } | null)?.version === SESSION_RECORD_VERSION_BEFORE_MARKER)
		return { status: "outdated" };
	const record = parseSessionRecord(raw, sessionKey);
	return record ? { status: "found", record } : { status: "invalid" };
}

/** The two durability calls of a record write, injectable so a test can see each one and make one fail. */
export interface RecordSync {
	file(fd: number): void;
	directory(path: string): void;
}

const REAL_RECORD_SYNC: RecordSync = {
	file: (fd) => fsyncSync(fd),
	directory: (path) => {
		const fd = openSync(path, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	},
};

/** Record directories whose whole chain of entries this process has synced, up to the filesystem root. */
const CERTIFIED_RECORD_DIRS = new Set<string>();

/**
 * Replace the record atomically and durably (#171 step 8): the record is the only place a vendor
 * session id and a dispatch marker live, so a write that returns has reached the disk — the new
 * bytes before the rename, the rename in its directory after it, and once per process and
 * directory every entry above it. A failure throws; the caller sends nothing on the strength of a
 * write that threw. A failed file sync leaves the previous record in place.
 */
export function writeSessionRecord(
	record: SessionRecord,
	dir: string = sessionCacheDir(),
	sync: RecordSync = REAL_RECORD_SYNC,
	certified: Set<string> = CERTIFIED_RECORD_DIRS,
): void {
	mkdirSync(dir, { recursive: true });
	const target = sessionRecordPath(record.sessionKey, dir);
	const temp = `${target}.${randomBytes(16).toString("hex")}.tmp`;
	const fd = openSync(temp, "wx", 0o600);
	try {
		try {
			writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
			sync.file(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temp, target);
	} finally {
		rmSync(temp, { force: true });
	}
	sync.directory(dir);
	if (!certified.has(dir)) {
		for (let at = dirname(dir); ; at = dirname(at)) {
			sync.directory(at);
			if (at === dirname(at)) break;
		}
		certified.add(dir);
	}
}

// ---------------------------------------------------------------------------
// 5) the resident guard (#171 step 8, decision 17)
// ---------------------------------------------------------------------------

/**
 * What a resident's turn may do. `birth` is the only verdict that reaches `session/new`, and it
 * needs every sign of an earlier ACP session to be absent: no live session, no record, no birth
 * reservation, and no completed Entwurf answer or ACP entry anywhere in the Pi session file.
 */
export type ResidentVerdict =
	| { kind: "reuse" }
	| { kind: "birth" }
	| {
			kind: "stop";
			stop: "model" | "cwd" | "config" | "changed" | "unreadable" | "invalid" | "interim" | "intent" | "noRecord";
			why: string;
			code?: string;
	  };

/**
 * Pure. `reserved` and `hasTrace` are read only when there is neither a live session nor a record,
 * so they are thunks: a store error in one of them is the caller's to turn into a stop.
 */
export function decideResident(
	params: SessionCompatFacts,
	sources: { existing?: ExistingSession; record: SessionRecordRead; reserved: () => boolean; hasTrace: () => boolean },
): ResidentVerdict {
	const { existing, record } = sources;
	if (existing?.alive) {
		// A live session is never abandoned for another: what it cannot take stops the turn, and it stays.
		if (existing.modelId !== params.modelId)
			return { kind: "stop", stop: "model", why: "the live session has another model" };
		if (existing.cwd !== params.cwd)
			return { kind: "stop", stop: "cwd", why: "the live session has another directory" };
		if (existing.bridgeConfigSignature !== params.bridgeConfigSignature) {
			return { kind: "stop", stop: "config", why: "the session configuration changed" };
		}
		if (!hasPrefix(existing.contextMessageSignatures, params.contextMessageSignatures)) {
			return {
				kind: "stop",
				stop: "changed",
				why: "the conversation no longer starts with what this session answered",
			};
		}
		return { kind: "reuse" };
	}
	if (record.status === "unreadable") {
		return { kind: "stop", stop: "unreadable", why: "session record unreadable", code: record.code };
	}
	if (record.status === "invalid") return { kind: "stop", stop: "invalid", why: "session record not valid" };
	// Attach is not enabled yet: a stored session is neither resumed nor replaced.
	if (record.status === "found" || record.status === "outdated") {
		return { kind: "stop", stop: "interim", why: "a stored ACP session exists for this conversation" };
	}
	if (sources.reserved()) return { kind: "stop", stop: "intent", why: "a birth was attempted and left no record" };
	if (sources.hasTrace()) return { kind: "stop", stop: "noRecord", why: "the Pi session holds ACP history" };
	return { kind: "birth" };
}

/** The type names Entwurf's ACP rail writes into a Pi session: `entwurf.acp…`, `entwurf-acp…`, `entwurf_acp…`. */
const ACP_TYPE_NAME = /^entwurf[._-]acp/;

function entryField(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Whether a Pi session file shows ACP activity: any Entwurf answer, an assistant carrying an
 * Entwurf diagnostic, or an `entwurf.acp` custom entry. A turn that failed or was aborted counts:
 * it may have reached a vendor session and left partial output. Only a failed or aborted answer
 * that `provenPreBirth` accepts does not — the caller names what it proves ended before any session.
 */
export function hasAcpTrace(
	entries: readonly unknown[],
	provenPreBirth: (message: unknown) => boolean = () => false,
): boolean {
	return entries.some((entry) => {
		const type = entryField(entry, "type");
		if (type === "custom") {
			const customType = entryField(entry, "customType");
			return typeof customType === "string" && ACP_TYPE_NAME.test(customType);
		}
		if (type !== "message") return false;
		const message = entryField(entry, "message");
		if (entryField(message, "role") !== "assistant") return false;
		const diagnostics = entryField(message, "diagnostics");
		if (
			Array.isArray(diagnostics) &&
			diagnostics.some((d) => {
				const t = entryField(d, "type");
				return typeof t === "string" && ACP_TYPE_NAME.test(t);
			})
		) {
			return true;
		}
		if (entryField(message, "provider") !== "entwurf") return false;
		// An Entwurf answer is history whatever way it ended: a turn that failed or was cut may have
		// reached a vendor session first. The one exception is an answer the caller proves ended before
		// any session could exist, and never one that completed.
		const stopReason = entryField(message, "stopReason");
		return !((stopReason === "error" || stopReason === "aborted") && provenPreBirth(message));
	});
}
