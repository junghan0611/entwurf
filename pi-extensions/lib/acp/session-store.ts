// ACP plugin — session store, configuration signature and the resident guard.
//
// The deterministic half of session continuity: pure decisions and the record persistence around
// them, with no child or connection lifecycle (backend.ts owns that).
//
//   1. bridgeConfigSignature / bridgeConfigParts — a stable hash of the configuration a session was
//      opened with, and the three parts it is taken from, so a difference can be named: a changed
//      MCP server set, a changed setup text, or anything else (`configDrift`).
//   2. contextMessageSignatures — one signature per Pi message (role + content shape). A live session
//      is reused only while its signatures are a prefix of the new turn's.
//   3. the session record — the vendor session a Pi session id owns, where its first prompt stands,
//      the last answer it sealed, and every dispatch since whose outcome is unknown.
//   4. decideResident — what a resident's turn may do: reuse the live session, resume the recorded
//      one, give birth, or stop by name. A recorded session is never replaced by a new one.
//
// What a turn for an existing session sends is not decided here: branch-gate.ts proves it from the
// Pi session's branch.

import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Message, ToolResultMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AcpHostFacts } from "../acp-host-facts.js";

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
	/** The turn this marker belongs to (#171 step 8): the `responseId` its final message carries. */
	turnId?: string;
	/** The Pi session entry ids of the inputs this prompt carries, in order (#171 step 8). */
	inputEntryIds?: string[];
}

/** A dispatch whose outcome is unknown: its turn and exactly the inputs it carried (#171 step 8). */
export interface UnsealedDispatch {
	turnId: string;
	inputEntryIds: string[];
}

/**
 * #171 step 8 — the configuration a session was opened with, as three digests beside the one
 * signature, so a difference can be named: the MCP server set, the carrier text, and everything
 * else (tools, permissions, setting sources, plugins, backend extras).
 */
export interface ConfigParts {
	mcpServers: string;
	text: string;
	tools: string;
}

/** What differs between a session's configuration and this turn's. */
export type ConfigDrift = "same" | "mcpServers" | "text" | "other";

/**
 * #171 step 8 — where the session's first prompt stands. `pending`: the session was created and
 * nothing was sent to it. `dispatched`: its first prompt may have run. `sealed`: a turn was answered.
 */
export type FirstPromptState = "pending" | "dispatched" | "sealed";

const FIRST_PROMPT_STATES: readonly string[] = ["pending", "dispatched", "sealed"];

/**
 * #175: the vendor's own compaction of one Pi compaction boundary, asked for with a lone `/compact`.
 * `sent`: the request is (or may be) on the wire and no answer was accepted, so the next provider call
 * asks again. `done`: the answer was accepted and this boundary is not asked for again while this slot
 * names it — a suppression for as long as `done` holds, not an exactly-once (a reader that does not know
 * this field drops it, and then one more `/compact` may go out). `effect` is a separate axis, set only
 * with `done`: `confirmed` when the agent reported a completed compaction inside that prompt,
 * `unconfirmed` when it answered `end_turn` with no such report (agy always; GLG D-3 2026-11-25).
 */
export interface VendorCompaction {
	/** The Pi compaction entry (the latest after the anchor) this request was for. */
	compactionEntryId: string;
	/** The vendor session it was sent to. */
	acpSessionId: string;
	state: "sent" | "done";
	effect?: "confirmed" | "unconfirmed";
}

const VENDOR_COMPACTION_STATES: readonly string[] = ["sent", "done"];
const VENDOR_COMPACTION_EFFECTS: readonly string[] = ["confirmed", "unconfirmed"];

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
	/** #171 step 8: the turn the session last sealed. A stored session is attached only against it. */
	sealedTurnId?: string;
	/** #171 step 8: every dispatch since that seal whose outcome is unknown, oldest first. With the
	 *  marker it is the whole set of inputs that may have reached the session since the seal. */
	unsealed?: UnsealedDispatch[];
	/** #171 step 8: the parts `bridgeConfigSignature` was taken from. */
	config?: ConfigParts;
	/** #175: the one slot of the vendor's compaction state; absent means nothing is suppressed. */
	vendorCompaction?: VendorCompaction;
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
	config?: ConfigParts;
}

/** What this turn asks of a session: the compat facts and the parts its signature was taken from. */
export interface ResidentParams extends SessionCompatFacts {
	config: ConfigParts;
	/** #176: the signature and parts of this turn's configuration with its allow list as a build before
	 *  #176 wrote it (`residentConfigFacts`). Read for a stored record only. */
	before176?: { bridgeConfigSignature: string; config: ConfigParts };
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

/** #176: the entwurf-bridge allow rule, and how a build before #176 spelled it (the default through
 *  v0.63.0, which claude-agent-acp 0.112.0 skips). */
const BRIDGE_ALLOW = "mcp__entwurf-bridge__*";
const BRIDGE_ALLOW_BEFORE_176 = "mcp__*";

/**
 * The configuration facts a turn asks a session with: the signature and its parts, and (#176) the same
 * configuration with `mcp__entwurf-bridge__*` spelled `mcp__*`, as a build before #176 wrote it. A stored
 * signature taken under that spelling is read as if taken under this one, and any other difference is
 * judged as before (GLG 2026-11-26: a version bump alone does not ask for `/new`). A one-way reading of
 * the stored signature, not a claim that the two rules allow the same tools. Pure.
 */
export function residentConfigFacts(
	input: BridgeConfigInput,
): Pick<ResidentParams, "bridgeConfigSignature" | "config" | "before176"> {
	const facts = { bridgeConfigSignature: bridgeConfigSignature(input), config: bridgeConfigParts(input) };
	if (!input.permissionAllow.includes(BRIDGE_ALLOW)) return facts;
	const before = {
		...input,
		permissionAllow: input.permissionAllow.map((rule) => (rule === BRIDGE_ALLOW ? BRIDGE_ALLOW_BEFORE_176 : rule)),
	};
	return {
		...facts,
		before176: { bridgeConfigSignature: bridgeConfigSignature(before), config: bridgeConfigParts(before) },
	};
}

/** The three digests of `ConfigParts`, from the same input as `bridgeConfigSignature`. Pure. */
export function bridgeConfigParts(input: BridgeConfigInput): ConfigParts {
	return {
		mcpServers: input.mcpServersHash,
		// The carrier as sent. It names the MCP servers, so a server added or removed changes this part too
		// and is no longer a difference of one part: only a change inside a named server is `mcpServers` alone.
		text: sha256(input.appendSystemPrompt),
		tools: sha256(
			JSON.stringify({
				backend: input.backend,
				modelId: input.modelId,
				nativeModelId: input.nativeModelId,
				settingSources: [...input.settingSources],
				strictMcpConfig: input.strictMcpConfig,
				tools: [...input.tools],
				skillPlugins: [...input.skillPlugins],
				permissionAllow: [...input.permissionAllow],
				disallowedTools: [...input.disallowedTools],
				extra: input.extra ?? {},
			}),
		),
	};
}

/**
 * Name what differs. Equal signatures are `same` whatever the parts say. With no recorded parts a
 * difference cannot be named and is `other`; so is a difference in more than one part.
 */
export function configDrift(
	was: { bridgeConfigSignature: string; config?: ConfigParts },
	now: { bridgeConfigSignature: string; config: ConfigParts },
): ConfigDrift {
	if (was.bridgeConfigSignature === now.bridgeConfigSignature) return "same";
	if (!was.config) return "other";
	const differs = (["mcpServers", "text", "tools"] as const).filter((part) => was.config?.[part] !== now.config[part]);
	if (differs.length !== 1 || differs[0] === "tools") return "other";
	return differs[0];
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
		sealedTurnId?: string;
		unsealed?: readonly UnsealedDispatch[];
		config?: ConfigParts;
		vendorCompaction?: VendorCompaction;
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
					...(input.pendingDispatch.turnId === undefined ? {} : { turnId: input.pendingDispatch.turnId }),
					...(input.pendingDispatch.inputEntryIds === undefined
						? {}
						: { inputEntryIds: [...input.pendingDispatch.inputEntryIds] }),
				}
			: null,
		...(input.sealedTurnId === undefined ? {} : { sealedTurnId: input.sealedTurnId }),
		...(input.unsealed && input.unsealed.length > 0
			? { unsealed: input.unsealed.map((u) => ({ turnId: u.turnId, inputEntryIds: [...u.inputEntryIds] })) }
			: {}),
		...(input.config ? { config: { ...input.config } } : {}),
		...(input.vendorCompaction ? { vendorCompaction: copyVendorCompaction(input.vendorCompaction) } : {}),
		updatedAt: now,
	};
}

function copyVendorCompaction(v: VendorCompaction): VendorCompaction {
	return {
		compactionEntryId: v.compactionEntryId,
		acpSessionId: v.acpSessionId,
		state: v.state,
		...(v.effect === undefined ? {} : { effect: v.effect }),
	};
}

/** #175: the same record with only its vendor compaction slot replaced, stamped `now`. Pure. */
export function withVendorCompaction(record: SessionRecord, value: VendorCompaction, now: string): SessionRecord {
	return { ...record, vendorCompaction: copyVendorCompaction(value), updatedAt: now };
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function isIdArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every(isNonEmptyString);
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
	if (m.turnId !== undefined && !isNonEmptyString(m.turnId)) return undefined;
	if (m.inputEntryIds !== undefined && !isIdArray(m.inputEntryIds)) return undefined;
	return {
		start: m.start,
		count: m.count,
		contextMessageSignatures: [...m.contextMessageSignatures],
		...(m.turnId === undefined ? {} : { turnId: m.turnId }),
		...(m.inputEntryIds === undefined ? {} : { inputEntryIds: [...m.inputEntryIds] }),
	};
}

/** The optional step-8 fields: absent, or well formed. `undefined` means the record is invalid. */
function parseContinuity(
	r: Record<string, unknown>,
): Pick<SessionRecord, "sealedTurnId" | "unsealed" | "config" | "vendorCompaction"> | undefined {
	if (r.sealedTurnId !== undefined && !isNonEmptyString(r.sealedTurnId)) return undefined;
	let unsealed: UnsealedDispatch[] | undefined;
	if (r.unsealed !== undefined) {
		if (!Array.isArray(r.unsealed)) return undefined;
		unsealed = [];
		for (const item of r.unsealed as unknown[]) {
			const u = item as { turnId?: unknown; inputEntryIds?: unknown } | null;
			if (typeof u !== "object" || u === null) return undefined;
			if (!isNonEmptyString(u.turnId) || !isIdArray(u.inputEntryIds)) return undefined;
			unsealed.push({ turnId: u.turnId, inputEntryIds: [...u.inputEntryIds] });
		}
	}
	let config: ConfigParts | undefined;
	if (r.config !== undefined) {
		const c = r.config as Record<string, unknown> | null;
		if (typeof c !== "object" || c === null) return undefined;
		if (!isNonEmptyString(c.mcpServers) || !isNonEmptyString(c.text) || !isNonEmptyString(c.tools)) return undefined;
		config = { mcpServers: c.mcpServers, text: c.text, tools: c.tools };
	}
	let vendorCompaction: VendorCompaction | undefined;
	if (r.vendorCompaction !== undefined) {
		// #175: a value this build does not know is not read as "nothing to suppress": the record is invalid.
		const v = r.vendorCompaction as Record<string, unknown> | null;
		if (typeof v !== "object" || v === null) return undefined;
		if (!isNonEmptyString(v.compactionEntryId) || !isNonEmptyString(v.acpSessionId)) return undefined;
		if (typeof v.state !== "string" || !VENDOR_COMPACTION_STATES.includes(v.state)) return undefined;
		if (v.effect !== undefined) {
			if (v.state !== "done") return undefined;
			if (typeof v.effect !== "string" || !VENDOR_COMPACTION_EFFECTS.includes(v.effect)) return undefined;
		} else if (v.state === "done") return undefined;
		vendorCompaction = {
			compactionEntryId: v.compactionEntryId,
			acpSessionId: v.acpSessionId,
			state: v.state as VendorCompaction["state"],
			...(v.effect === undefined ? {} : { effect: v.effect as NonNullable<VendorCompaction["effect"]> }),
		};
	}
	return {
		...(r.sealedTurnId === undefined ? {} : { sealedTurnId: r.sealedTurnId as string }),
		...(unsealed && unsealed.length > 0 ? { unsealed } : {}),
		...(config ? { config } : {}),
		...(vendorCompaction ? { vendorCompaction } : {}),
	};
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
	const continuity = parseContinuity(r);
	if (continuity === undefined) return undefined;
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
		...continuity,
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
 * reservation, and no Entwurf answer or ACP entry anywhere in the Pi session file. `attach` resumes
 * the stored session under the same id; it never creates one.
 */
export type ResidentVerdict =
	/** `textDrift`: the carrier text changed and the session keeps the one it was opened with. */
	| { kind: "reuse"; textDrift: boolean }
	/**
	 * Resume the recorded session. `closeLive`: a live session whose MCP server set changed is closed
	 * first. `mcpServersChanged`: the attach carries this turn's server set, under the same carrier.
	 */
	| { kind: "attach"; record: SessionRecord; closeLive: boolean; mcpServersChanged: boolean }
	| { kind: "birth" }
	| {
			kind: "stop";
			stop:
				| "model"
				| "cwd"
				| "config"
				| "changed"
				| "unreadable"
				| "invalid"
				| "version"
				| "resume"
				| "firstUnknown"
				| "intent"
				| "noRecord";
			why: string;
			code?: string;
	  };

type ResidentStop = Extract<ResidentVerdict, { kind: "stop" }>;

/** Model, directory and configuration: what a session cannot change, and what it can. */
function compatibility(
	was: { cwd: string; modelId: string; bridgeConfigSignature: string; config?: ConfigParts },
	params: ResidentParams,
	which: string,
): ResidentStop | { drift: Exclude<ConfigDrift, "other"> } {
	if (was.modelId !== params.modelId)
		return { kind: "stop", stop: "model", why: `the ${which} session has another model` };
	if (was.cwd !== params.cwd) return { kind: "stop", stop: "cwd", why: `the ${which} session has another directory` };
	let drift = configDrift(was, params);
	// #176: a stored signature taken under the earlier spelling of the bridge allow rule is read as if taken
	// under this one; whatever else differs is judged as before (an MCP server change alone resumes).
	if (drift === "other" && which === "stored" && params.before176) {
		const before = configDrift(was, params.before176);
		if (before !== "other") drift = before;
	}
	if (drift === "other") return { kind: "stop", stop: "config", why: "the session configuration changed" };
	return { drift };
}

/**
 * Pure. `reserved` and `hasTrace` are read only when there is neither a live session nor a record,
 * so they are thunks: a store error in one of them is the caller's to turn into a stop.
 */
export function decideResident(
	params: ResidentParams,
	sources: {
		existing?: ExistingSession;
		record: SessionRecordRead;
		reserved: () => boolean;
		hasTrace: () => boolean;
		/** The Pi branch shows a compaction after the live session's last answer. Read only on a prefix break. */
		compacted?: () => boolean;
	},
): ResidentVerdict {
	const { existing, record } = sources;
	let closeLive = false;
	if (existing?.alive) {
		// A live session is never abandoned for another: what it cannot take stops the turn, and it stays.
		const live = compatibility(existing, params, "live");
		if ("kind" in live) return live;
		// A context that no longer starts with what the session answered is explained by one thing only: a
		// Pi compaction after its last answer (decision 16). The delta proof then holds the new context.
		if (
			!hasPrefix(existing.contextMessageSignatures, params.contextMessageSignatures) &&
			!(sources.compacted?.() ?? false)
		) {
			return {
				kind: "stop",
				stop: "changed",
				why: "the conversation no longer starts with what this session answered",
			};
		}
		if (live.drift !== "mcpServers") return { kind: "reuse", textDrift: live.drift === "text" };
		// A changed MCP server set is given to the same session by resuming it: the live child is closed
		// and the record below decides the attach.
		closeLive = true;
	}
	if (record.status === "unreadable") {
		return { kind: "stop", stop: "unreadable", why: "session record unreadable", code: record.code };
	}
	if (record.status === "invalid") return { kind: "stop", stop: "invalid", why: "session record not valid" };
	// GLG 2026-11-22: a record written before the dispatch marker existed is never attached.
	if (record.status === "outdated") {
		return { kind: "stop", stop: "version", why: "the session record is from before resume was supported" };
	}
	if (record.status === "found") {
		const stored = compatibility(record.record, params, "stored");
		if ("kind" in stored) return stored;
		if (record.record.firstPrompt === "pending") {
			return { kind: "stop", stop: "resume", why: "the stored session was never given a prompt" };
		}
		if (record.record.firstPrompt === "dispatched") {
			return { kind: "stop", stop: "firstUnknown", why: "the stored session's first prompt has no confirmed answer" };
		}
		// A resume request carries this turn's carrier. Whether a vendor applies it to a session opened with
		// another is not measured, so a stored session is resumed only with the text it was opened with.
		if (stored.drift === "text") {
			return { kind: "stop", stop: "config", why: "the setup text changed since this session was opened" };
		}
		// A sealed record of a build that kept no anchor cannot say which answer the session gave last.
		if (!record.record.sealedTurnId) {
			return { kind: "stop", stop: "version", why: "the session record names no last answer" };
		}
		return {
			kind: "attach",
			record: record.record,
			closeLive,
			mcpServersChanged: stored.drift === "mcpServers",
		};
	}
	if (closeLive) return { kind: "stop", stop: "noRecord", why: "the live session has no record to resume from" };
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
