/**
 * meta-session — 1.0.0 garden-native meta-bridge, step 2: the RECORD AUTHORITY.
 *
 * Backend-agnostic garden layer (#30). A *meta-session* is the bib card for a
 * native backend session (Claude Code / Antigravity / Codex) that has NO pi
 * JSONL of its own: an opaque pointer record that makes the native session a
 * garden citizen — addressable + wakeable by a garden id — WITHOUT pretending pi
 * owns its transcript (Hard Rule #8: reference the backend transcript, never
 * hydrate or replay it).
 *
 * Two layers, clearly sectioned:
 *   1. RECORD functions + types (mint / serialize / parse / scanByNativeId /
 *      decideUpsert / read-receipt mutators), the backend-agnostic authority.
 *      Pure beyond an injected `now`, with ONE exception since 3D-3: mint/parse
 *      read backend capability (wakeMode/deliveryLevel) from the packaged registry
 *      via a cached fs read (loadMetaCapabilityRegistry) — see that seam below.
 *   2. The thin FS-BOUND STORE (step 3): `upsertMetaSession` wraps the pure core
 *      (readdir → `scanByNativeId` → `decideUpsert` → atomic write) with the real
 *      filesystem. It lives in this module (not a sibling `*-store.ts`) on purpose:
 *      the typecheck fence forbids a root-config lib importing another `.ts` lib
 *      via a `.ts` specifier (tsc-emit) while the same `.js` specifier is
 *      unresolvable under `node --experimental-strip-types`, so a separate store
 *      file could not be unit-tested by the deterministic strip-types gate. Only
 *      node builtins are added here, so `check-meta-session` stays strip-types
 *      clean. The hook deploy + the thin CLI/argv shell that invokes this is
 *      step 4 (its stdin contract couples to the Claude `SessionStart` payload).
 *
 * Cutting the record/seam FIRST is deliberate ("record authority FIRST, hook
 * LAST"): the schema and the lookup authority are backend-agnostic, so the
 * per-backend adapter seam gets cut here, before any "hook = Claude Code"
 * assumption can ossify.
 *
 * Authority rules imported from the 0.9.0 substrate and #30 refinements:
 *   - garden id = `generateSessionId` (the single SSOT grammar), minted at the
 *     session's true birth. Reused, never re-derived.
 *   - lookup authority = SCAN the record bodies by top-level `native_session_id`
 *     (see scanByNativeId), symmetric with 0.9.0 `findSessionFileById`. Any
 *     native→garden index is an OPTIONAL derived cache, never the source of
 *     truth — "needs a DB" is the denote-instinct tripwire.
 *   - create-vs-attach keys on RECORD EXISTENCE, not the backend `source` field
 *     (decideUpsert). Idempotent: duplicate hook fires / same-id re-entry are
 *     absorbed. The CLI is named `upsert` so no one re-introduces `source`
 *     branching.
 *   - read-receipt is PRE-DRILLED into the schema now (bbot review #4). The
 *     mailbox/outbox is post-MVP, but retrofitting the receipt field later would
 *     touch the schema twice. The "last 1 cm" (did the body reach model-visible
 *     context?) is kept honest as per-peer metadata, never abstracted away.
 *
 * Crash, don't warn: every malformed record / bad id / bad backend throws
 * `MetaRecordError`. A broken meta-record must surface as a broken meta-record.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSessionId, SESSION_ID_RE } from "./session-id.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A meta-record is malformed, or an input violates the record contract. */
export class MetaRecordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MetaRecordError";
	}
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Bump only on a breaking record-shape change; parse refuses other versions. */
export const META_SCHEMA_VERSION = 1 as const;

/**
 * The three native meta-bridge backends, declared from the start so the
 * per-backend adapter seam is forced (a different native layout each — that
 * difference is the whole reason for a thin adapter). Discriminator field on
 * every record.
 */
export const META_BACKENDS = ["claude-code", "antigravity", "codex"] as const;
export type MetaBackend = (typeof META_BACKENDS)[number];

/**
 * How the body reaches model-visible context — the honest "last 1 cm". Claude's
 * doorbell wakes the model but the body is SELF-FETCHED (the model must
 * voluntarily call its inbox-read MCP tool); agy/codex DIRECT-INJECT the body
 * into the turn. This is exposed as peer metadata, never abstracted, so "I sent
 * it, why didn't it read?" never becomes a debugging hole.
 */
export type WakeMode = "self-fetch" | "direct-inject";

/**
 * Static, backend-derived honesty metadata (the data half of the adapter seam).
 * `wakeMode` + `deliveryLevel` ride onto each record at mint so the sender
 * contract can stay uniform on address/queue while being honest on HOW delivery
 * lands. `deliveryLevel` is a DELIVERY.md D-coordinate (a capability hint, not a
 * guarantee). `nativeIdLabel` documents what the join key actually is per
 * backend (Claude sessionId / agy conversationId / codex threadId) — naming, not
 * behavior; the behavioral half (where sessions live, how to read liveness, hook
 * deploy unit) lands with the step-4 adapters.
 */
export interface MetaBackendDescriptor {
	backend: MetaBackend;
	wakeMode: WakeMode;
	deliveryLevel: string;
	nativeIdLabel: string;
}

export const META_BACKEND_DESCRIPTORS: Record<MetaBackend, MetaBackendDescriptor> = {
	"claude-code": {
		backend: "claude-code",
		wakeMode: "self-fetch",
		deliveryLevel: "D6",
		nativeIdLabel: "sessionId",
	},
	antigravity: {
		backend: "antigravity",
		wakeMode: "direct-inject",
		deliveryLevel: "D6",
		nativeIdLabel: "conversationId",
	},
	codex: {
		backend: "codex",
		wakeMode: "direct-inject",
		deliveryLevel: "D6",
		nativeIdLabel: "threadId",
	},
};

/**
 * The read-receipt aspect, PRE-DRILLED (bbot review #4). The mailbox/outbox is
 * post-MVP — these timestamps stay null until that path lands — but the slot is
 * here so adding it later does not touch the schema twice.
 *   - lastEnqueuedAt : a sender wrote a message body to this peer's mailbox.
 *   - lastDeliveredAt: the doorbell rang / the body was injected ("`.delivered`"
 *     marker). For Claude self-fetch this means "doorbell rang", NOT "model read".
 *   - lastReadAt     : the inbox-read MCP call — THIS is the real read-receipt
 *     (makes Claude's D7 observable). For direct-inject backends delivered==read.
 */
export interface MetaDelivery {
	wakeMode: WakeMode;
	deliveryLevel: string;
	lastEnqueuedAt: string | null;
	lastDeliveredAt: string | null;
	lastReadAt: string | null;
}

/**
 * The opaque pointer record. Body is SSOT; the on-disk filename
 * (`<garden_id>.meta.json`) is only a denote-sortable surface (garden_id leads
 * with the birth timestamp). NEVER parse the filename for authority.
 */
export interface MetaRecord {
	schemaVersion: typeof META_SCHEMA_VERSION;
	gardenId: string;
	backend: MetaBackend;
	nativeSessionId: string;
	transcriptPath: string;
	cwd: string;
	createdAt: string;
	lastSeen: string;
	delivery: MetaDelivery;
}

/** Fields the caller supplies; garden id + timestamps + delivery are derived. */
export interface MetaMintInput {
	backend: MetaBackend;
	nativeSessionId: string;
	transcriptPath: string;
	cwd: string;
}

// ---------------------------------------------------------------------------
// Validation helpers (crash, don't warn)
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new MetaRecordError(`meta-record field "${field}" must be a non-empty string (got ${describe(value)}).`);
	}
	return value;
}

function requireBackend(value: unknown): MetaBackend {
	if (typeof value !== "string" || !META_BACKENDS.includes(value as MetaBackend)) {
		throw new MetaRecordError(
			`meta-record "backend" must be one of ${META_BACKENDS.join(" | ")} (got ${describe(value)}).`,
		);
	}
	return value as MetaBackend;
}

function requireGardenId(value: unknown): string {
	const id = requireNonEmptyString(value, "gardenId");
	if (!SESSION_ID_RE.test(id)) {
		throw new MetaRecordError(`meta-record "gardenId" must match YYYYMMDDTHHMMSS-[0-9a-f]{6} (got "${id}").`);
	}
	return id;
}

function requireNullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length === 0) {
		throw new MetaRecordError(
			`meta-record field "${field}" must be a non-empty string or null (got ${describe(value)}).`,
		);
	}
	return value;
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return `string ${JSON.stringify(value)}`;
	return `${typeof value}`;
}

function isoNow(now: Date): string {
	return now.toISOString();
}

// ---------------------------------------------------------------------------
// Record functions (pure beyond an injected `now`, except mint/parse read the
// packaged capability registry via the cached metaCapabilityFor seam — 3D-3)
// ---------------------------------------------------------------------------

/**
 * Mint a brand-new meta-record at the session's true birth. Generates the garden
 * id from the SSOT grammar, stamps createdAt == lastSeen, and seeds the
 * delivery/read-receipt slot from the backend descriptor (timestamps null).
 */
export function mintMetaRecord(input: MetaMintInput, now: Date = new Date()): MetaRecord {
	const backend = requireBackend(input.backend);
	// 3D-3: backend honesty metadata is sourced from the capability registry, not
	// META_BACKEND_DESCRIPTORS (which now survives only as the drift-guard reference).
	const capability = metaCapabilityFor(backend);
	const ts = isoNow(now);
	return {
		schemaVersion: META_SCHEMA_VERSION,
		gardenId: generateSessionId(now),
		backend,
		nativeSessionId: requireNonEmptyString(input.nativeSessionId, "nativeSessionId"),
		transcriptPath: requireNonEmptyString(input.transcriptPath, "transcriptPath"),
		cwd: requireNonEmptyString(input.cwd, "cwd"),
		createdAt: ts,
		lastSeen: ts,
		delivery: {
			wakeMode: capability.wakeMode,
			deliveryLevel: capability.deliveryLevel,
			lastEnqueuedAt: null,
			lastDeliveredAt: null,
			lastReadAt: null,
		},
	};
}

/**
 * Canonical serialization: stable key order (object built in order), 2-space
 * indent, trailing newline. Deterministic — the same record always serializes
 * byte-identically, so a temp-dir test can assert round-trip stability.
 */
export function serializeMetaRecord(record: MetaRecord): string {
	const ordered = {
		schemaVersion: record.schemaVersion,
		gardenId: record.gardenId,
		backend: record.backend,
		nativeSessionId: record.nativeSessionId,
		transcriptPath: record.transcriptPath,
		cwd: record.cwd,
		createdAt: record.createdAt,
		lastSeen: record.lastSeen,
		delivery: {
			wakeMode: record.delivery.wakeMode,
			deliveryLevel: record.delivery.deliveryLevel,
			lastEnqueuedAt: record.delivery.lastEnqueuedAt,
			lastDeliveredAt: record.delivery.lastDeliveredAt,
			lastReadAt: record.delivery.lastReadAt,
		},
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Parse + fully validate untrusted JSON text into a MetaRecord. Throws on any drift. */
export function parseMetaRecord(json: string): MetaRecord {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		throw new MetaRecordError(`meta-record is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MetaRecordError(`meta-record must be a JSON object (got ${describe(raw)}).`);
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== META_SCHEMA_VERSION) {
		throw new MetaRecordError(
			`meta-record "schemaVersion" must be ${META_SCHEMA_VERSION} (got ${describe(obj.schemaVersion)}).`,
		);
	}
	const delivery = obj.delivery;
	if (typeof delivery !== "object" || delivery === null || Array.isArray(delivery)) {
		throw new MetaRecordError(`meta-record "delivery" must be an object (got ${describe(delivery)}).`);
	}
	const d = delivery as Record<string, unknown>;
	const backend = requireBackend(obj.backend);
	const wakeMode = requireNonEmptyString(d.wakeMode, "delivery.wakeMode");
	if (wakeMode !== "self-fetch" && wakeMode !== "direct-inject") {
		throw new MetaRecordError(
			`meta-record "delivery.wakeMode" must be self-fetch | direct-inject (got "${wakeMode}").`,
		);
	}
	// wakeMode is backend-DETERMINED (Claude doorbell = self-fetch; agy/codex =
	// direct-inject). A record whose stored wakeMode contradicts its backend is
	// corrupt — a Claude record claiming direct-inject would silently mis-route
	// the "last 1 cm" delivery contract. Refuse it. 3D-3: the canonical is sourced
	// from the capability registry, not META_BACKEND_DESCRIPTORS.
	const canonicalWakeMode = metaCapabilityFor(backend).wakeMode;
	if (wakeMode !== canonicalWakeMode) {
		throw new MetaRecordError(
			`meta-record "delivery.wakeMode" (${wakeMode}) contradicts backend "${backend}" ` +
				`(canonical ${canonicalWakeMode}). Delivery mode is backend-determined; this record is corrupt.`,
		);
	}
	return {
		schemaVersion: META_SCHEMA_VERSION,
		gardenId: requireGardenId(obj.gardenId),
		backend,
		nativeSessionId: requireNonEmptyString(obj.nativeSessionId, "nativeSessionId"),
		transcriptPath: requireNonEmptyString(obj.transcriptPath, "transcriptPath"),
		cwd: requireNonEmptyString(obj.cwd, "cwd"),
		createdAt: requireNonEmptyString(obj.createdAt, "createdAt"),
		lastSeen: requireNonEmptyString(obj.lastSeen, "lastSeen"),
		delivery: {
			wakeMode,
			deliveryLevel: requireNonEmptyString(d.deliveryLevel, "delivery.deliveryLevel"),
			lastEnqueuedAt: requireNullableString(d.lastEnqueuedAt, "delivery.lastEnqueuedAt"),
			lastDeliveredAt: requireNullableString(d.lastDeliveredAt, "delivery.lastDeliveredAt"),
			lastReadAt: requireNullableString(d.lastReadAt, "delivery.lastReadAt"),
		},
	};
}

// ---------------------------------------------------------------------------
// meta-record v2 — identity-only shape (0.11 Stage 0 step 3A)
//
// v2 strips the delivery/read-receipt aspect OUT of the record (it moves to a
// separate mailbox state file in step 3B) and keeps only IDENTITY: who this
// citizen is, never its delivery bookkeeping. The deltas vs v1 (verified
// against the frozen ledger in NEXT.md):
//   - backend gains `pi` (the 4th meta backend — pi sessions become citizens)
//   - transcriptPath required → nullable (pi birth may not know it yet)
//   - new nullable identity fields: model, parentGardenId, isEntwurf
//   - lastSeen → recordUpdatedAt (a record touch time, NOT liveness)
//   - delivery{} removed entirely
//
// This block is READER + NORMALIZER ONLY. There is deliberately NO v2 writer /
// serializer / disk upsert here yet: step 3A's gate is "synthetic v1 fixture →
// normalized v2 identity golden GREEN", and 3A must not introduce a v2 writer
// before that golden + its GPT review (NEXT.md 끊을 지점 ①).
// ---------------------------------------------------------------------------

/** Bump only on a breaking v2 identity-shape change; the v2 parser refuses other versions. */
export const META_SCHEMA_VERSION_V2 = 2 as const;

/** v2 backends = the three v1 backends + `pi` (pi joins as the 4th meta citizen). */
export const META_BACKENDS_V2 = ["claude-code", "antigravity", "codex", "pi"] as const;
export type MetaBackendV2 = (typeof META_BACKENDS_V2)[number];

/**
 * The v2 identity-only record. Field order mirrors the frozen ledger's jsonc so
 * a future serializer stays byte-stable. No delivery aspect — that is mailbox
 * state (step 3B), referenced by gardenId, never embedded in identity.
 */
export interface MetaIdentity {
	schemaVersion: typeof META_SCHEMA_VERSION_V2;
	gardenId: string;
	backend: MetaBackendV2;
	nativeSessionId: string;
	cwd: string;
	model: string | null;
	transcriptPath: string | null;
	parentGardenId: string | null;
	isEntwurf: boolean;
	createdAt: string;
	recordUpdatedAt: string;
}

function requireBackendV2(value: unknown): MetaBackendV2 {
	if (typeof value !== "string" || !META_BACKENDS_V2.includes(value as MetaBackendV2)) {
		throw new MetaRecordError(
			`meta-record "backend" must be one of ${META_BACKENDS_V2.join(" | ")} (got ${describe(value)}).`,
		);
	}
	return value as MetaBackendV2;
}

function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw new MetaRecordError(`meta-record field "${field}" must be a boolean (got ${describe(value)}).`);
	}
	return value;
}

function requireNullableGardenId(value: unknown, field: string): string | null {
	if (value === null) return null;
	const id = requireNonEmptyString(value, field);
	if (!SESSION_ID_RE.test(id)) {
		throw new MetaRecordError(
			`meta-record "${field}" must be null or match YYYYMMDDTHHMMSS-[0-9a-f]{6} (got "${id}").`,
		);
	}
	return id;
}

/**
 * Explicit v1 name for the dual-read pair. `parseMetaRecord` predates the v2
 * split and stays the canonical v1 parser (existing callers untouched); this
 * alias makes the V1/V2 symmetry legible at call sites.
 */
export const parseMetaRecordV1 = parseMetaRecord;

/**
 * The EXACT key set a v2 identity record may carry. v2 is a fresh schema, so the
 * parser is strict: any key outside this set — including stale v1 fields like
 * `delivery` or `lastSeen` — is a half-migrated / corrupt record and must
 * fail-fast, never be silently normalized away. Frozen against the ledger jsonc.
 */
const META_IDENTITY_V2_KEYS: readonly string[] = [
	"schemaVersion",
	"gardenId",
	"backend",
	"nativeSessionId",
	"cwd",
	"model",
	"transcriptPath",
	"parentGardenId",
	"isEntwurf",
	"createdAt",
	"recordUpdatedAt",
];

/** Parse + fully validate untrusted JSON into a v2 MetaIdentity. Throws on any drift. */
export function parseMetaRecordV2(json: string): MetaIdentity {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		throw new MetaRecordError(`meta-record is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MetaRecordError(`meta-record must be a JSON object (got ${describe(raw)}).`);
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== META_SCHEMA_VERSION_V2) {
		throw new MetaRecordError(
			`meta-record "schemaVersion" must be ${META_SCHEMA_VERSION_V2} (got ${describe(obj.schemaVersion)}).`,
		);
	}
	// Strict keyset: reject stale v1 fields (delivery/lastSeen) and any unknown
	// key. A v2 record carrying v1 leftovers is half-migrated/corrupt — surface
	// it, do not silently drop it during normalize.
	const stray = Object.keys(obj).filter((k) => !META_IDENTITY_V2_KEYS.includes(k));
	if (stray.length > 0) {
		throw new MetaRecordError(
			`v2 meta-record carries unexpected key(s) ${stray.map((k) => `"${k}"`).join(", ")} ` +
				`(allowed: ${META_IDENTITY_V2_KEYS.join(", ")}). Stale v1 fields (delivery/lastSeen) or unknown keys are rejected.`,
		);
	}
	return {
		schemaVersion: META_SCHEMA_VERSION_V2,
		gardenId: requireGardenId(obj.gardenId),
		backend: requireBackendV2(obj.backend),
		nativeSessionId: requireNonEmptyString(obj.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(obj.cwd, "cwd"),
		model: requireNullableString(obj.model, "model"),
		transcriptPath: requireNullableString(obj.transcriptPath, "transcriptPath"),
		parentGardenId: requireNullableGardenId(obj.parentGardenId, "parentGardenId"),
		isEntwurf: requireBoolean(obj.isEntwurf, "isEntwurf"),
		createdAt: requireNonEmptyString(obj.createdAt, "createdAt"),
		recordUpdatedAt: requireNonEmptyString(obj.recordUpdatedAt, "recordUpdatedAt"),
	};
}

/**
 * Lazy-normalize a parsed v1 OR v2 record into the v2 identity shape. The dual-
 * read seam: consumers read either disk version and normalize to ONE identity
 * type. Discriminates on `schemaVersion` (TS narrows the union):
 *   - v1: lastSeen → recordUpdatedAt, delivery dropped, model/parentGardenId
 *     default null, isEntwurf default false, transcriptPath carried (v1 always
 *     has one).
 *   - v2: already identity — returned as a fresh, key-stable copy.
 * v1 identity is LOSSLESS through this (the golden gate proves it); the only v1
 * data not carried is delivery, which is intentionally out of identity.
 */
export function normalizeMetaIdentity(record: MetaRecord | MetaIdentity): MetaIdentity {
	if (record.schemaVersion === META_SCHEMA_VERSION_V2) {
		return {
			schemaVersion: META_SCHEMA_VERSION_V2,
			gardenId: record.gardenId,
			backend: record.backend,
			nativeSessionId: record.nativeSessionId,
			cwd: record.cwd,
			model: record.model,
			transcriptPath: record.transcriptPath,
			parentGardenId: record.parentGardenId,
			isEntwurf: record.isEntwurf,
			createdAt: record.createdAt,
			recordUpdatedAt: record.recordUpdatedAt,
		};
	}
	return {
		schemaVersion: META_SCHEMA_VERSION_V2,
		gardenId: record.gardenId,
		backend: record.backend,
		nativeSessionId: record.nativeSessionId,
		cwd: record.cwd,
		model: null,
		transcriptPath: record.transcriptPath,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: record.createdAt,
		recordUpdatedAt: record.lastSeen,
	};
}

// ---------------------------------------------------------------------------
// v2 write shape + dual-read dispatcher (0.11 Stage 0 step 3D-1)
//
// Pure functions only: the canonical v2 serializer and the version-dispatching
// reader. NO fs upsert, NO live readMetaInbox/enqueueMetaMessage change, NO
// record.delivery removal — those are 3D-2/3/4. This step just makes "write a v2
// identity" and "read any version into an identity" exist + gated, so 3D-4 can
// wire the FS upsert onto a proven writer.
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a v2 identity: stable key order (the frozen ledger
 * jsonc order), 2-space indent, trailing newline. Deterministic — re-serializing
 * the same identity is byte-identical, and the output round-trips through
 * parseMetaRecordV2. This is the v2 WRITE shape; the FS upsert that uses it is
 * step 3D-4, not here.
 */
export function serializeMetaIdentity(identity: MetaIdentity): string {
	const ordered = {
		schemaVersion: identity.schemaVersion,
		gardenId: identity.gardenId,
		backend: identity.backend,
		nativeSessionId: identity.nativeSessionId,
		cwd: identity.cwd,
		model: identity.model,
		transcriptPath: identity.transcriptPath,
		parentGardenId: identity.parentGardenId,
		isEntwurf: identity.isEntwurf,
		createdAt: identity.createdAt,
		recordUpdatedAt: identity.recordUpdatedAt,
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Fields a v2 caller supplies; garden id + timestamps are derived. The nullable
 * identity axes (model/transcriptPath/parentGardenId) are OPTIONAL at the input
 * boundary so attach can distinguish three intents (3D-4 G5): `undefined` = keep
 * the existing value, `null` = explicit unknown/clear, a string = set/refresh.
 * mint (create) has no existing value, so undefined collapses to null.
 */
export interface MetaIdentityMintInput {
	backend: MetaBackendV2;
	nativeSessionId: string;
	cwd: string;
	model?: string | null;
	transcriptPath?: string | null;
	parentGardenId?: string | null;
	isEntwurf?: boolean;
}

/**
 * Mint a brand-new v2 identity at the session's true birth (3D-4). The v2 analog
 * of mintMetaRecord — generates the garden id, stamps createdAt == recordUpdatedAt,
 * and carries identity only (no delivery; the receipt lives in mailbox state).
 * Omitted nullable axes default to null / isEntwurf false.
 */
export function mintMetaIdentity(input: MetaIdentityMintInput, now: Date = new Date()): MetaIdentity {
	const backend = requireBackendV2(input.backend);
	const ts = isoNow(now);
	return {
		schemaVersion: META_SCHEMA_VERSION_V2,
		gardenId: generateSessionId(now),
		backend,
		nativeSessionId: requireNonEmptyString(input.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(input.cwd, "cwd"),
		model: requireNullableString(input.model ?? null, "model"),
		transcriptPath: requireNullableString(input.transcriptPath ?? null, "transcriptPath"),
		parentGardenId: requireNullableGardenId(input.parentGardenId ?? null, "parentGardenId"),
		isEntwurf: input.isEntwurf === undefined ? false : requireBoolean(input.isEntwurf, "isEntwurf"),
		createdAt: ts,
		recordUpdatedAt: ts,
	};
}

/**
 * Dual-read dispatcher: peek schemaVersion on untrusted JSON and route to the
 * matching strict parser (v1 record or v2 identity). The lazy-normalize seam — a
 * consumer reads either on-disk version through ONE call. Returns the parsed
 * record in its OWN shape (v1 keeps delivery; v2 is identity); compose with
 * normalizeMetaIdentity, or use parseMetaIdentity, to collapse to identity.
 */
export function parseMetaRecordAny(json: string): MetaRecord | MetaIdentity {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		throw new MetaRecordError(`meta-record is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MetaRecordError(`meta-record must be a JSON object (got ${describe(raw)}).`);
	}
	const version = (raw as Record<string, unknown>).schemaVersion;
	if (version === META_SCHEMA_VERSION) return parseMetaRecordV1(json);
	if (version === META_SCHEMA_VERSION_V2) return parseMetaRecordV2(json);
	throw new MetaRecordError(
		`meta-record "schemaVersion" must be ${META_SCHEMA_VERSION} or ${META_SCHEMA_VERSION_V2} (got ${describe(version)}).`,
	);
}

/** Dual-read straight to a normalized v2 identity (parse any version, normalize). */
export function parseMetaIdentity(json: string): MetaIdentity {
	return normalizeMetaIdentity(parseMetaRecordAny(json));
}

// ---------------------------------------------------------------------------
// capability source — backend capability registry (0.11 Stage 0 step 3C)
//
// v2 identity (step 3A) drops the backend honesty metadata (wakeMode /
// deliveryLevel / nativeIdLabel) out of the per-session record: it is NOT per
// session, it is per BACKEND. Its new home is a registry data file
// `pi/entwurf-capabilities.json` (frozen decision 1 — a registry FILE, sibling
// concern to the launch-allowlist `entwurf-targets.json`). "이 시민은 self-fetch
// 인가 / pi 는 어떻게 깨우나" is answered by capability, not by identity.
//
// This block is the SCHEMA + PARSER + path resolver. As of 3C it did NOT re-wire
// the live consumers (`META_BACKEND_DESCRIPTORS` was the authority mint/parse read).
// 3D-3 then cut mint/parse over to this registry via the `metaCapabilityFor` seam
// (defined below `metaCapabilitiesFilePath`): the registry is now the LIVE source of
// wakeMode/deliveryLevel, and `META_BACKEND_DESCRIPTORS` survives only as the
// drift-guard reference. Removing wakeMode from the record itself lands in step 3D-4.
// The 3C gate (check-entwurf-capabilities) still asserts the JSON AGREES with the
// const for the three existing backends (the drift guard) and COVERS exactly
// META_BACKENDS_V2 (pi included).
//
// pi's wakeMode = direct-inject (NOT self-fetch): pi's live wake path is the
// entwurf-control socket — `pi.sendMessage(... triggerTurn ...)` injects the
// body straight into the model-visible turn, which is direct-inject by the
// WakeMode definition (the last-1cm: who puts the body in front of the model).
// self-fetch is Claude's mailbox path (the model must call its inbox-read MCP).
// pi's dormant→resume→mailbox path is self-fetch-shaped, so pi is really
// BIMODAL; a single wakeMode field cannot express both. Splitting it
// (mailboxWakeMode vs controlSocketWakeMode) is out of 3C scope — for now the
// single field reports pi's primary live capability (direct-inject) honestly.
// ---------------------------------------------------------------------------

/** Bump only on a breaking capability-registry shape change; the parser refuses other versions. */
export const CAPABILITY_SCHEMA_VERSION = 1 as const;

/** One backend's capability — the honesty metadata that leaves the v2 record. */
export interface MetaCapability {
	wakeMode: WakeMode;
	deliveryLevel: string;
	nativeIdLabel: string;
}

/** The whole registry: schema version + one capability per v2 backend. */
export interface MetaCapabilityRegistry {
	schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
	backends: Record<MetaBackendV2, MetaCapability>;
}

const CAPABILITY_TOP_KEYS: readonly string[] = ["schemaVersion", "backends"];
const CAPABILITY_ENTRY_KEYS: readonly string[] = ["wakeMode", "deliveryLevel", "nativeIdLabel"];

function requireWakeMode(value: unknown, field: string): WakeMode {
	if (value !== "self-fetch" && value !== "direct-inject") {
		throw new MetaRecordError(`capability "${field}" must be self-fetch | direct-inject (got ${describe(value)}).`);
	}
	return value;
}

function parseCapabilityEntry(value: unknown, backend: string): MetaCapability {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MetaRecordError(`capability for "${backend}" must be an object (got ${describe(value)}).`);
	}
	const obj = value as Record<string, unknown>;
	const stray = Object.keys(obj).filter((k) => !CAPABILITY_ENTRY_KEYS.includes(k));
	if (stray.length > 0) {
		throw new MetaRecordError(
			`capability for "${backend}" carries unexpected key(s) ${stray.map((k) => `"${k}"`).join(", ")} ` +
				`(allowed: ${CAPABILITY_ENTRY_KEYS.join(", ")}).`,
		);
	}
	return {
		wakeMode: requireWakeMode(obj.wakeMode, `${backend}.wakeMode`),
		deliveryLevel: requireNonEmptyString(obj.deliveryLevel, `${backend}.deliveryLevel`),
		nativeIdLabel: requireNonEmptyString(obj.nativeIdLabel, `${backend}.nativeIdLabel`),
	};
}

/**
 * Parse + fully validate untrusted JSON into a capability registry. Strict:
 * schemaVersion fence, top-level + per-entry keyset, and COVERAGE — the backend
 * keys must be exactly META_BACKENDS_V2 (no missing, no extra). A registry that
 * forgets pi, or smuggles an unknown backend, is rejected.
 */
export function parseMetaCapabilityRegistry(json: string): MetaCapabilityRegistry {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		throw new MetaRecordError(
			`capability registry is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MetaRecordError(`capability registry must be a JSON object (got ${describe(raw)}).`);
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
		throw new MetaRecordError(
			`capability registry "schemaVersion" must be ${CAPABILITY_SCHEMA_VERSION} (got ${describe(obj.schemaVersion)}).`,
		);
	}
	const topStray = Object.keys(obj).filter((k) => !CAPABILITY_TOP_KEYS.includes(k));
	if (topStray.length > 0) {
		throw new MetaRecordError(
			`capability registry carries unexpected key(s) ${topStray.map((k) => `"${k}"`).join(", ")} ` +
				`(allowed: ${CAPABILITY_TOP_KEYS.join(", ")}).`,
		);
	}
	const backends = obj.backends;
	if (typeof backends !== "object" || backends === null || Array.isArray(backends)) {
		throw new MetaRecordError(`capability registry "backends" must be an object (got ${describe(backends)}).`);
	}
	const present = Object.keys(backends).sort();
	const expected = [...META_BACKENDS_V2].sort();
	if (present.length !== expected.length || !expected.every((b, i) => b === present[i])) {
		throw new MetaRecordError(
			`capability registry must cover exactly ${expected.join(", ")} (got ${present.join(", ")}).`,
		);
	}
	const entries = backends as Record<string, unknown>;
	const out = {} as Record<MetaBackendV2, MetaCapability>;
	for (const backend of META_BACKENDS_V2) {
		out[backend] = parseCapabilityEntry(entries[backend], backend);
	}
	return { schemaVersion: CAPABILITY_SCHEMA_VERSION, backends: out };
}

/**
 * The packaged capability registry path. Two layouts resolve:
 *  - repo / npm package: `pi-extensions/lib/` → `<root>/pi/entwurf-capabilities.json`.
 *  - bundled meta-bridge plugin: `../../pi` would ESCAPE the plugin dir (the plugin
 *    is installed under a version dir in the Claude plugin cache), so the registry
 *    travels AT the plugin root and resolves via `../` from `lib/`.
 *    meta-bridge-install.sh copies it there; doctor-meta-bridge asserts its presence.
 * Repo path is tried first, so repo/package behaviour is unchanged; the bundle
 * fallback only engages where the repo layout is absent.
 */
export function metaCapabilitiesFilePath(): string {
	const repoPath = path.join(import.meta.dirname, "..", "..", "pi", "entwurf-capabilities.json");
	if (fs.existsSync(repoPath)) return repoPath;
	return path.join(import.meta.dirname, "..", "entwurf-capabilities.json");
}

// ---------------------------------------------------------------------------
// capability live source (0.11 Stage 0 step 3D-3)
//
// 3C shipped the registry FILE + parser but left META_BACKEND_DESCRIPTORS as the
// authority that mint/parse read (3C header: "Cutting the live const over to this
// registry ... lands in step 3D"). 3D-3 is that cut-over: mint/parse now read
// backend honesty metadata (wakeMode/deliveryLevel) from the registry via the seam
// below, NOT from the const. The const survives ONLY as the drift-guard reference
// in check-entwurf-capabilities (registry ≡ const for the 3 existing backends), so
// the cut-over is behaviour-preserving. The record.delivery.wakeMode SLOT stays
// (its removal is 3D-4); only its SOURCE moves.
// ---------------------------------------------------------------------------

/** Memoized packaged registry; the file is immutable at runtime, so caching is honest (not stateful lying). */
let cachedMetaCapabilities: MetaCapabilityRegistry | null = null;

/**
 * Load + memoize the packaged capability registry — the live source of backend
 * honesty metadata as of 3D-3. A missing/corrupt file throws (the registry is a
 * packaged invariant; check-pack guarantees its presence).
 */
export function loadMetaCapabilityRegistry(): MetaCapabilityRegistry {
	if (cachedMetaCapabilities === null) {
		cachedMetaCapabilities = parseMetaCapabilityRegistry(fs.readFileSync(metaCapabilitiesFilePath(), "utf8"));
	}
	return cachedMetaCapabilities;
}

/**
 * The capability for one backend, from the registry (3D-3 live source). The
 * optional `registry` injection lets a gate prove the value is registry-DRIVEN
 * (feed a doctored registry → the lookup follows it), distinguishing "read from
 * the registry" from "hardcoded off the const". MetaBackend ⊂ MetaBackendV2, so
 * the registry (which covers all 4) always has the 3 mint/parse backends.
 */
export function metaCapabilityFor(
	backend: MetaBackend,
	registry: MetaCapabilityRegistry = loadMetaCapabilityRegistry(),
): MetaCapability {
	return registry.backends[backend];
}

/** Denote-sortable on-disk filename. Body is SSOT; do NOT parse this for authority. Accepts v1 record or v2 identity. */
export function metaRecordFilename(record: MetaRecord | MetaIdentity): string {
	return `${record.gardenId}.meta.json`;
}

/**
 * THE lookup authority. Scan the record BODIES in a meta-session directory and
 * return the one whose top-level `nativeSessionId` matches, or null. This is the
 * `.meta.json` analog of 0.9.0 `findSessionFileById` (which header-scans pi
 * JSONLs). NOT a filename parse, NOT an index lookup — those are at best derived
 * caches. The directory listing + record reading is injected so this stays a
 * pure function (the step-3 CLI supplies the real fs).
 *
 * The scan runs to completion (does NOT stop at the first match): the
 * native→garden mapping MUST be unique, so two records claiming the same
 * `nativeSessionId` is an authority ambiguity — `MetaRecordError`, fail-fast,
 * never silently pick one (that would make `upsert` mint a second id / route a
 * message to the wrong garden citizen).
 *
 * Unreadable / malformed entries are surfaced honestly via `onSkip` (a corrupt
 * record is a real problem, not something to silently swallow); a throwing
 * reader for one file does not abort the whole scan.
 */
export function scanByNativeId(
	entries: readonly string[],
	nativeSessionId: string,
	readRecord: (filename: string) => string,
	onSkip?: (filename: string, err: Error) => void,
): MetaRecord | null {
	const target = requireNonEmptyString(nativeSessionId, "nativeSessionId");
	const matches: { filename: string; record: MetaRecord }[] = [];
	for (const filename of entries) {
		if (!filename.endsWith(".meta.json")) continue;
		let record: MetaRecord;
		try {
			record = parseMetaRecord(readRecord(filename));
		} catch (err) {
			onSkip?.(filename, err instanceof Error ? err : new Error(String(err)));
			continue;
		}
		if (record.nativeSessionId === target) matches.push({ filename, record });
	}
	if (matches.length > 1) {
		throw new MetaRecordError(
			`ambiguous meta-record authority: nativeSessionId "${target}" matched ${matches.length} records ` +
				`(${matches.map((m) => m.filename).join(", ")}). The native→garden mapping must be unique — ` +
				`fail-fast rather than silently picking one. Remove the duplicate(s).`,
		);
	}
	return matches.length === 1 ? (matches[0] as { record: MetaRecord }).record : null;
}

/**
 * The dual-read identity scan (0.11 Stage 0 step 3D-4 commit1, additive). Same
 * lookup authority as scanByNativeId — scan the BODIES, match on top-level
 * `nativeSessionId`, fail-fast on duplicates — but reads v1 AND v2 records (via
 * parseMetaIdentity) and returns normalized identity. This is the scan the v2
 * upsert uses (3D-4): once upsert writes v2, the existence check MUST recognize v2
 * records or it would mint a duplicate id for an existing citizen (G1). scanByNativeId
 * remains the v1-only raw scan for v1-fixture gates. Identity-only: it reads
 * backend/nativeSessionId, never delivery.
 */
export function scanIdentityByNativeId(
	entries: readonly string[],
	nativeSessionId: string,
	readRecord: (filename: string) => string,
	onSkip?: (filename: string, err: Error) => void,
): MetaIdentity | null {
	const target = requireNonEmptyString(nativeSessionId, "nativeSessionId");
	const matches: { filename: string; identity: MetaIdentity }[] = [];
	for (const filename of entries) {
		if (!filename.endsWith(".meta.json")) continue;
		let identity: MetaIdentity;
		try {
			identity = parseMetaIdentity(readRecord(filename));
		} catch (err) {
			onSkip?.(filename, err instanceof Error ? err : new Error(String(err)));
			continue;
		}
		if (identity.nativeSessionId === target) matches.push({ filename, identity });
	}
	if (matches.length > 1) {
		throw new MetaRecordError(
			`ambiguous meta-record authority: nativeSessionId "${target}" matched ${matches.length} records ` +
				`(${matches.map((m) => m.filename).join(", ")}). The native→garden mapping must be unique — ` +
				`fail-fast rather than silently picking one. Remove the duplicate(s).`,
		);
	}
	return matches.length === 1 ? (matches[0] as { identity: MetaIdentity }).identity : null;
}

export type UpsertAction = "create" | "attach";

export interface UpsertDecision {
	action: UpsertAction;
	record: MetaIdentity;
}

/**
 * The pure core of the `upsert` CLI (3D-4: v2 identity). Keyed on RECORD
 * EXISTENCE, never on a backend `source` field:
 *   - existing present → ATTACH: keep identity (gardenId, createdAt,
 *     nativeSessionId), bump recordUpdatedAt, and apply the 3-value merge to the
 *     nullable axes + always-refresh cwd. Identity drift (a different backend for
 *     the same nativeSessionId) is corruption → throw.
 *   - absent → CREATE: mint a fresh v2 identity.
 *
 * 3-value attach merge (G5): for model/transcriptPath/parentGardenId an input of
 * `undefined` KEEPS the existing value (a pi-birth caller that does not know the
 * transcript must not wipe a previously-recorded one), `null` explicitly clears
 * it, a string sets it. cwd is required and always refreshed.
 *
 * Idempotent by construction: calling it twice with the same input yields one
 * attach after the first create, never a second id. `existing` is the normalized
 * identity from scanIdentityByNativeId (dual-read v1+v2).
 */
export function decideUpsert(
	existing: MetaIdentity | null,
	input: MetaIdentityMintInput,
	now: Date = new Date(),
): UpsertDecision {
	const backend = requireBackendV2(input.backend);
	const nativeSessionId = requireNonEmptyString(input.nativeSessionId, "nativeSessionId");
	const cwd = requireNonEmptyString(input.cwd, "cwd");

	if (existing === null) {
		return { action: "create", record: mintMetaIdentity(input, now) };
	}
	if (existing.nativeSessionId !== nativeSessionId) {
		throw new MetaRecordError(
			`decideUpsert called with existing record for a different nativeSessionId ` +
				`(existing="${existing.nativeSessionId}", input="${nativeSessionId}"). ` +
				`The caller must pass the record found by scanIdentityByNativeId(input.nativeSessionId).`,
		);
	}
	if (existing.backend !== backend) {
		throw new MetaRecordError(
			`meta-record identity drift: nativeSessionId "${nativeSessionId}" is bound to backend ` +
				`"${existing.backend}" but upsert input says "${backend}". A native session cannot change backend.`,
		);
	}
	// 3-value merge (G5): undefined keeps existing, null clears, string sets. The
	// nullable axes are validated the same way mint validates them.
	const model = input.model === undefined ? existing.model : requireNullableString(input.model, "model");
	const transcriptPath =
		input.transcriptPath === undefined
			? existing.transcriptPath
			: requireNullableString(input.transcriptPath, "transcriptPath");
	const parentGardenId =
		input.parentGardenId === undefined
			? existing.parentGardenId
			: requireNullableGardenId(input.parentGardenId, "parentGardenId");
	const isEntwurf = input.isEntwurf === undefined ? existing.isEntwurf : requireBoolean(input.isEntwurf, "isEntwurf");
	return {
		action: "attach",
		record: { ...existing, cwd, model, transcriptPath, parentGardenId, isEntwurf, recordUpdatedAt: isoNow(now) },
	};
}

// ---------------------------------------------------------------------------
// read-receipt mutators — V1-RECORD ONLY (3D-4 H3). These mutate record.delivery,
// which exists only on the v1 schema. The LIVE enqueue/read path no longer calls
// them (3D-4 the cut: the receipt lives in the mailbox state store, stamped by
// stampMailboxReceipt). They are retained for the v1-fixture / dual-read gates that
// still exercise a raw v1 record; do NOT re-wire them into the live path.
// ---------------------------------------------------------------------------

/** A sender enqueued a body to this peer's mailbox. (v1-record only — see section note.) */
export function markEnqueued(record: MetaRecord, now: Date = new Date()): MetaRecord {
	return { ...record, delivery: { ...record.delivery, lastEnqueuedAt: isoNow(now) } };
}

/** The doorbell rang / body injected ("`.delivered`"). For self-fetch ≠ read. */
export function markDelivered(record: MetaRecord, now: Date = new Date()): MetaRecord {
	return { ...record, delivery: { ...record.delivery, lastDeliveredAt: isoNow(now) } };
}

/** The inbox-read MCP call — the real read-receipt (makes Claude D7 observable). */
export function markRead(record: MetaRecord, now: Date = new Date()): MetaRecord {
	return { ...record, delivery: { ...record.delivery, lastReadAt: isoNow(now) } };
}

// ---------------------------------------------------------------------------
// FS-bound store (step 3) — the thin real-filesystem wrapper around the pure
// core. Only node builtins beyond the pure layer, so the deterministic gate
// stays strip-types clean (see module header for why this is not a sibling file).
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

/**
 * The pi agent dir — the persistence root pi owns. `PI_CODING_AGENT_DIR` lets an
 * isolated install / test relocate it (symmetric with how pi's own sessions
 * isolate); otherwise it is the fixed `~/.pi/agent`. A stable `~/` path, so the
 * meta-bridge hook never needs this baked into config — it resolves at runtime.
 */
function piAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR
		? path.resolve(expandTilde(process.env.PI_CODING_AGENT_DIR))
		: path.join(os.homedir(), ".pi", "agent");
}

/**
 * Where meta-records live. Under the pi agent dir (pi owns persistence), so an
 * isolated install / test that sets `PI_CODING_AGENT_DIR` gets isolated
 * meta-sessions too — symmetric with how pi's own sessions isolate. A direct
 * `PI_META_SESSIONS_DIR` override wins (used by tests / unusual deployments).
 */
export function defaultMetaSessionsDir(): string {
	if (process.env.PI_META_SESSIONS_DIR) return path.resolve(expandTilde(process.env.PI_META_SESSIONS_DIR));
	return path.join(piAgentDir(), "meta-sessions");
}

/**
 * Where per-garden-id idle-wake mailboxes live: `<pi-agent-dir>/meta-mailbox`.
 * Deliberately a SIBLING of meta-sessions, not nested inside it — the record
 * store is the authority (scanned for identity) while the mailbox is volatile
 * signal/body traffic; keeping them apart means a mailbox poke never risks a
 * record-dir readdir picking up a non-record file. The watched signal for a
 * session is `<this>/<gardenId>/inbox.signal`. Same runtime resolution as
 * meta-sessions (no config baking); `PI_META_MAILBOX_DIR` overrides for tests.
 */
export function defaultMetaMailboxDir(): string {
	if (process.env.PI_META_MAILBOX_DIR) return path.resolve(expandTilde(process.env.PI_META_MAILBOX_DIR));
	return path.join(piAgentDir(), "meta-mailbox");
}

/**
 * Where native-backend SENDER markers live: `<pi-agent-dir>/meta-senders`.
 *
 * The problem this closes: a native Claude Code session that SENDS via the
 * user-scope pi-tools-bridge MCP has no `PI_SESSION_ID` — at tool-call time the
 * MCP process does not know which garden-id session it belongs to, so the sender
 * envelope degrades to anonymous `external-mcp` and the receiver has no reply
 * address. The hook DOES know the garden-id (it just minted the record), and the
 * hook + the MCP child run under the SAME Claude Code parent process. So the hook
 * writes a marker keyed by that parent pid; the MCP reads the marker for its OWN
 * `process.ppid` and promotes itself to a replyable meta-session sender. This
 * uses process ancestry, NOT cwd inference (same repo / multiple sessions would
 * make cwd ambiguous). `PI_META_SENDERS_DIR` overrides for tests.
 */
export function defaultMetaSendersDir(): string {
	if (process.env.PI_META_SENDERS_DIR) return path.resolve(expandTilde(process.env.PI_META_SENDERS_DIR));
	return path.join(piAgentDir(), "meta-senders");
}

/**
 * A boot-unique identity for a live process: pid is reused, but pid + start-time
 * is unique within a boot. Linux reads `/proc/<pid>/stat` field 22 (starttime in
 * clock ticks); macOS/BSD falls back to `ps -o lstart=`. Returns "" when the pid
 * is gone or unreadable — a "" key never matches, so a dead/reused owner fails
 * the marker check. This is what stops a stale marker (process exited, pid reused
 * by a new Claude session) from granting the wrong garden-id sender identity.
 */
export function processStartKey(pid: number): string {
	if (!Number.isInteger(pid) || pid <= 0) return "";
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		// comm (field 2) is parenthesized and may contain spaces/parens — split AFTER the last ')'.
		const fields = stat
			.slice(stat.lastIndexOf(")") + 1)
			.trim()
			.split(/\s+/);
		// after comm: index 0 = state(f3), 1 = ppid(f4), … 19 = starttime(f22).
		const starttime = fields[19];
		if (starttime && /^\d+$/.test(starttime)) return `linux:${starttime}`;
	} catch {
		// not Linux / no procfs
	}
	try {
		const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
		if (out) return `ps:${out}`;
	} catch {
		// pid gone or ps unavailable
	}
	return "";
}

/** The parent pid of a pid (one ancestry step), or null when unknown. */
export function parentPid(pid: number): number | null {
	if (!Number.isInteger(pid) || pid <= 0) return null;
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat
			.slice(stat.lastIndexOf(")") + 1)
			.trim()
			.split(/\s+/);
		const ppid = Number(fields[1]); // f4
		if (Number.isInteger(ppid) && ppid > 0) return ppid;
	} catch {
		// not Linux
	}
	try {
		const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim();
		const ppid = Number(out);
		if (Number.isInteger(ppid) && ppid > 0) return ppid;
	} catch {
		// pid gone
	}
	return null;
}

export interface MetaSenderMarker {
	backend: MetaBackend;
	gardenId: string;
	nativeSessionId: string;
	cwd: string;
	/** The pid this marker is keyed to (the shared native runner / Claude parent). */
	ownerPid: number;
	/** processStartKey(ownerPid) at write time — the pid-reuse guard. */
	ownerStartKey: string;
	updatedAt: string;
}

/** `<sendersDir>/<backend>/<ownerPid>.json` — keyed by the shared parent pid. */
export function metaSenderMarkerPath(
	backend: MetaBackend,
	ownerPid: number,
	sendersDir: string = defaultMetaSendersDir(),
): string {
	return path.join(sendersDir, backend, `${ownerPid}.json`);
}

export interface WriteMetaSenderMarkerOptions {
	backend: MetaBackend;
	gardenId: string;
	nativeSessionId: string;
	cwd: string;
	ownerPid: number;
	sendersDir?: string;
	now?: Date;
}

/** Write (atomically) the sender marker for a native session's parent pid. */
export function writeMetaSenderMarker(opts: WriteMetaSenderMarkerOptions): string {
	const backend = requireBackend(opts.backend);
	const gardenId = requireGardenId(opts.gardenId);
	const file = metaSenderMarkerPath(backend, opts.ownerPid, opts.sendersDir ?? defaultMetaSendersDir());
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const marker: MetaSenderMarker = {
		backend,
		gardenId,
		nativeSessionId: requireNonEmptyString(opts.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(opts.cwd, "cwd"),
		ownerPid: opts.ownerPid,
		ownerStartKey: processStartKey(opts.ownerPid),
		updatedAt: isoNow(opts.now ?? new Date()),
	};
	const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	return file;
}

export interface ReadMetaSenderMarkerOptions {
	/** Explicit marker file (test / explicit wiring). Wins over backend+ownerPid. */
	markerPath?: string;
	backend?: MetaBackend;
	ownerPid?: number;
	sendersDir?: string;
	/** Run the pid-reuse guard (verify the owner pid is still live). Default true —
	 * set false only for unit assertions that exercise the marker without a live owner. */
	verifyOwner?: boolean;
}

/**
 * Read the sender marker for this MCP process's owner. Returns null when absent
 * or corrupt — a marker we cannot trust means "no authoritative sender", which
 * the caller turns into external-non-replyable (or a hard reject under
 * REQUIRE_META_SENDER). Never throws: an unreadable marker must not break a send.
 */
export function readMetaSenderMarker(opts: ReadMetaSenderMarkerOptions): MetaSenderMarker | null {
	let file = opts.markerPath;
	if (!file && opts.backend && typeof opts.ownerPid === "number") {
		file = metaSenderMarkerPath(opts.backend, opts.ownerPid, opts.sendersDir ?? defaultMetaSendersDir());
	}
	if (!file || !fs.existsSync(file)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		const marker: MetaSenderMarker = {
			backend: requireBackend(raw.backend),
			gardenId: requireGardenId(raw.gardenId),
			nativeSessionId: requireNonEmptyString(raw.nativeSessionId, "nativeSessionId"),
			cwd: requireNonEmptyString(raw.cwd, "cwd"),
			ownerPid: typeof raw.ownerPid === "number" ? raw.ownerPid : Number.NaN,
			ownerStartKey: requireNonEmptyString(raw.ownerStartKey, "ownerStartKey"),
			updatedAt: requireNonEmptyString(raw.updatedAt, "updatedAt"),
		};
		// pid-reuse guard (unless explicitly disabled): the owner pid must STILL be
		// the same process that wrote the marker. A bare pid is reused; pid+startKey
		// is boot-unique, so a stale marker from a dead session fails here instead of
		// granting a wrong-identity send.
		if (opts.verifyOwner !== false) {
			if (!Number.isInteger(marker.ownerPid)) return null;
			const liveKey = processStartKey(marker.ownerPid);
			if (!liveKey || liveKey !== marker.ownerStartKey) return null;
		}
		return marker;
	} catch {
		return null;
	}
}

export interface UpsertMetaSessionOptions {
	input: MetaIdentityMintInput;
	/** Override the store directory (defaults to {@link defaultMetaSessionsDir}). */
	dir?: string;
	/** Override the mailbox dir (defaults to {@link defaultMetaMailboxDir}) — only the v1→v2 receipt migration touches it. */
	mailboxDir?: string;
	now?: Date;
	onSkip?: (filename: string, err: Error) => void;
}

export interface UpsertMetaSessionResult {
	action: UpsertAction;
	record: MetaIdentity;
	dir: string;
	/** Absolute path of the written record. */
	path: string;
}

/**
 * Idempotent fs upsert (3D-4: writes v2 identity). Scan the store by
 * `nativeSessionId` with the dual-read identity scan (sees v1 AND v2, so an
 * existing citizen is found regardless of schema — never duplicate-mint, G1),
 * decide create vs attach on EXISTENCE, and write atomically as v2. On attach the
 * file is the existing garden id's record (same path, rewritten in place, v1→v2);
 * on create it is a fresh `<gardenId>.meta.json`. A duplicate `nativeSessionId`
 * throws (via the scan) rather than silently picking one.
 *
 * Crash-order (3D-4): when the matched file is still v1, its delivery receipts are
 * migrated to the mailbox state store BEFORE the v2 rewrite. If the process dies
 * between the two, the record is still v1 → the next attach re-migrates (state-wins
 * merge is idempotent), so no receipt is lost. The reverse order would lose the
 * receipt permanently. The write is tmp-file + rename so a crash never leaves a
 * half-written record (#30 crash-safety).
 */
export function upsertMetaSession(opts: UpsertMetaSessionOptions): UpsertMetaSessionResult {
	const dir = path.resolve(expandTilde(opts.dir ?? defaultMetaSessionsDir()));
	fs.mkdirSync(dir, { recursive: true });
	const entries = fs.readdirSync(dir);
	const readRaw = (filename: string) => fs.readFileSync(path.join(dir, filename), "utf8");
	const existing = scanIdentityByNativeId(entries, opts.input.nativeSessionId, readRaw, opts.onSkip);

	// Crash-order: migrate a v1 file's receipts to mailbox state BEFORE rewriting it
	// as v2. Re-read the matched file raw to see if it is still v1 (carries delivery).
	if (existing !== null) {
		const raw = parseMetaRecordAny(readRaw(`${existing.gardenId}.meta.json`));
		if (raw.schemaVersion === META_SCHEMA_VERSION) {
			migrateV1DeliveryReceipts({ gardenId: existing.gardenId, delivery: raw.delivery, mailboxDir: opts.mailboxDir });
		}
	}

	const decision = decideUpsert(existing, opts.input, opts.now);
	const file = path.join(dir, metaRecordFilename(decision.record));
	atomicWriteIdentity(file, decision.record);
	return { action: decision.action, record: decision.record, dir, path: file };
}

/** tmp-file + rename so a crash never leaves a half-written record (v2 identity write). */
function atomicWriteIdentity(file: string, identity: MetaIdentity): void {
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, serializeMetaIdentity(identity), { mode: 0o600 });
	fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Mailbox delivery (step 6) — addressed by GARDEN ID. The record store is the
// authority (a sender may only deliver to a known garden citizen); the mailbox
// under defaultMetaMailboxDir() carries the volatile signal + message bodies.
//
// The honest delivery contract (do not blur these):
//   - enqueue        : a sender wrote a `.msg` body + poked `inbox.signal`
//                      (markEnqueued). The poke is what the plugin's FileChanged
//                      doorbell watches — it wakes an idle session.
//   - `.msg.delivered`: the doorbell rang (FileChanged moved `.msg` ->
//                      `.msg.delivered` and announced it). A FILESYSTEM marker =
//                      WAKE ATTEMPT, NOT a read.
//   - lastReadAt     : the model called readMetaInbox (the inbox-read tool) and
//                      the body actually reached model-visible context. THIS is
//                      the real D7 read-receipt. For Claude self-fetch, delivered
//                      != read; readMetaInbox is the only thing that sets it.
// ---------------------------------------------------------------------------

/** Resolve + validate a garden id and return its record file path under a store dir. */
function recordFileFor(sessionsDir: string, gardenId: string): string {
	const id = requireGardenId(gardenId);
	return path.join(path.resolve(expandTilde(sessionsDir)), `${id}.meta.json`);
}

/**
 * Read + parse a V1 meta-record by garden id, or throw if unknown (3D-4: renamed
 * from readMetaRecordByGardenId, demoted to v1-only — it uses the strict v1 parser
 * and throws on a v2 file). The live path reads identity via
 * readMetaIdentityByGardenId (dual-read); this stays for v1-fixture / dual-read
 * gates that need the raw v1 record (with delivery).
 */
export function readMetaRecordV1ByGardenId(
	gardenId: string,
	sessionsDir: string = defaultMetaSessionsDir(),
): MetaRecord {
	const id = requireGardenId(gardenId);
	const file = recordFileFor(sessionsDir, id);
	if (!fs.existsSync(file)) {
		throw new MetaRecordError(
			`no meta-record for garden id "${id}" under ${path.dirname(file)} — not a garden citizen, cannot deliver.`,
		);
	}
	const record = parseMetaRecord(fs.readFileSync(file, "utf8"));
	// The record BODY is the SSOT; the filename is only a denote-sortable surface.
	// A `<id>.meta.json` whose body carries a DIFFERENT gardenId is corrupt (a
	// renamed/clobbered file) and would misroute delivery — fail-fast, never trust
	// the filename over the body.
	if (record.gardenId !== id) {
		throw new MetaRecordError(
			`meta-record body/filename drift: ${id}.meta.json contains gardenId "${record.gardenId}". ` +
				`The body is the authority; this file is corrupt. Remove or fix it.`,
		);
	}
	return record;
}

/**
 * The dual-read identity read-by-gardenId (0.11 Stage 0 step 3D-4 commit1,
 * additive). Same contract as readMetaRecordByGardenId — read the file, body is
 * SSOT, fail-fast on body/filename gardenId drift — but reads v1 AND v2 (via
 * parseMetaIdentity) and returns normalized identity. This is what the live path
 * uses (enqueue/read, the MCP sender-marker check) so it survives the v2 cut;
 * readMetaRecordV1ByGardenId remains the v1-only raw reader for v1-fixture gates.
 */
export function readMetaIdentityByGardenId(
	gardenId: string,
	sessionsDir: string = defaultMetaSessionsDir(),
): MetaIdentity {
	const id = requireGardenId(gardenId);
	const file = recordFileFor(sessionsDir, id);
	if (!fs.existsSync(file)) {
		throw new MetaRecordError(
			`no meta-record for garden id "${id}" under ${path.dirname(file)} — not a garden citizen, cannot deliver.`,
		);
	}
	const identity = parseMetaIdentity(fs.readFileSync(file, "utf8"));
	if (identity.gardenId !== id) {
		throw new MetaRecordError(
			`meta-record body/filename drift: ${id}.meta.json contains gardenId "${identity.gardenId}". ` +
				`The body is the authority; this file is corrupt. Remove or fix it.`,
		);
	}
	return identity;
}

export interface EnqueueMetaMessageOptions {
	gardenId: string;
	body: string;
	sessionsDir?: string;
	mailboxDir?: string;
	now?: Date;
}

export interface EnqueueMetaMessageResult {
	gardenId: string;
	recordPath: string;
	messagePath: string;
	signalPath: string;
}

/**
 * Deliver a message body to a garden citizen's mailbox: validate the record
 * exists, write the `.msg` body FIRST, stamp `lastEnqueuedAt`, then poke
 * `inbox.signal` LAST so the doorbell that fires on the poke always finds the
 * body already on disk (no wake-with-empty-mailbox race). Returns the paths so a
 * sender can show exactly what was queued.
 */
export function enqueueMetaMessage(opts: EnqueueMetaMessageOptions): EnqueueMetaMessageResult {
	const now = opts.now ?? new Date();
	const sessionsDir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const recordFile = recordFileFor(sessionsDir, opts.gardenId);
	// 3D-4: read IDENTITY (dual-read v1+v2) — confirms the citizen exists and
	// normalizes the gardenId. The record is no longer mutated; the v2 record carries
	// no delivery, so the enqueue receipt lives SOLELY in the mailbox state store.
	const citizen = readMetaIdentityByGardenId(opts.gardenId, sessionsDir);
	if (typeof opts.body !== "string" || opts.body.length === 0) {
		throw new MetaRecordError("enqueueMetaMessage: body must be a non-empty string.");
	}

	const dir = path.join(path.resolve(expandTilde(opts.mailboxDir ?? defaultMetaMailboxDir())), citizen.gardenId);
	fs.mkdirSync(dir, { recursive: true });
	// Sortable + unique: ISO stamp (colons/dots flattened for a clean filename) +
	// a short random tag so two sends in the same millisecond never collide.
	const stamp = `${isoNow(now).replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
	const messagePath = path.join(dir, `${stamp}.msg`);
	fs.writeFileSync(messagePath, opts.body, { mode: 0o600 });

	// 3D-4 the cut: the enqueue receipt lives SOLELY in the mailbox state store now
	// (record.delivery removed from the v2 record). No record write. Stamped before the
	// signal poke so all state is settled before the watch fires. A state-stamp throw
	// surfaces fail-loud — no rollback: the `.msg` may already be written, but the
	// caller never gets a silent success.
	stampMailboxReceipt({
		gardenId: citizen.gardenId,
		mailboxDir: opts.mailboxDir ?? defaultMetaMailboxDir(),
		field: "lastEnqueuedAt",
		now,
	});

	// Poke LAST. Writing the timestamp changes the file's content+mtime, which is
	// what the plugin's FileChanged watch fires on.
	const signalPath = path.join(dir, "inbox.signal");
	fs.writeFileSync(signalPath, `${isoNow(now)}\n`, { mode: 0o600 });

	return { gardenId: citizen.gardenId, recordPath: recordFile, messagePath, signalPath };
}

export interface MetaInboxMessage {
	file: string;
	body: string;
}

export interface ReadMetaInboxOptions {
	gardenId: string;
	sessionsDir?: string;
	mailboxDir?: string;
	now?: Date;
}

export interface ReadMetaInboxResult {
	gardenId: string;
	messages: MetaInboxMessage[];
	/** The D7 read-receipt timestamp stamped on this read, or null if nothing was unread. */
	readAt: string | null;
	recordPath: string;
}

/**
 * Drain a garden citizen's mailbox: read every unread message (a fresh `.msg`
 * read before its doorbell, or a doorbell-rung `.msg.delivered`), archive each to
 * `*.read` so a re-read never double-returns, and — only if at least one message
 * was read — stamp `lastReadAt` (NOT `lastDeliveredAt`: the doorbell owns
 * delivery-time, see the stamp-site note below). An empty inbox mutates nothing:
 * reading nothing is not a receipt.
 */
export function readMetaInbox(opts: ReadMetaInboxOptions): ReadMetaInboxResult {
	const now = opts.now ?? new Date();
	const sessionsDir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const recordFile = recordFileFor(sessionsDir, opts.gardenId);
	// 3D-4: read IDENTITY (dual-read) — citizen-existence + normalized gardenId. The
	// record is not mutated; the read receipt lives solely in the mailbox state store.
	const citizen = readMetaIdentityByGardenId(opts.gardenId, sessionsDir);

	const dir = path.join(path.resolve(expandTilde(opts.mailboxDir ?? defaultMetaMailboxDir())), citizen.gardenId);
	const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
	// Unread = a body still ending in .msg or .msg.delivered (NOT yet .read).
	const unread = entries.filter((f) => f.endsWith(".msg") || f.endsWith(".msg.delivered")).sort();

	const messages: MetaInboxMessage[] = [];
	for (const f of unread) {
		const full = path.join(dir, f);
		messages.push({ file: f, body: fs.readFileSync(full, "utf8") });
		fs.renameSync(full, `${full}.read`); // archive; .read no longer matches the doorbell's *.msg glob
	}

	if (messages.length === 0) {
		return { gardenId: citizen.gardenId, messages, readAt: null, recordPath: recordFile };
	}

	// 3D-4 the cut: the read receipt lives SOLELY in the mailbox state store now.
	// Stamp lastReadAt — the one receipt this layer stamps honestly (it KNOWS the body
	// reached the reader). lastDeliveredAt is the doorbell's to own; stamping it here
	// would report read-time as delivery-time, so it is left as the doorbell left it.
	// The state stamp returns the updated state, whose lastReadAt IS the D7 read-receipt.
	// Inside the messages.length>0 branch by construction — an empty inbox already
	// early-returned (no .read archive, state untouched), so "read nothing" is no
	// receipt on the state either. A throw surfaces fail-loud — no rollback: the
	// messages are already archived (.read), but the caller never gets a silent success.
	const state = stampMailboxReceipt({
		gardenId: citizen.gardenId,
		mailboxDir: opts.mailboxDir ?? defaultMetaMailboxDir(),
		field: "lastReadAt",
		now,
	});
	return { gardenId: citizen.gardenId, messages, readAt: state.lastReadAt, recordPath: recordFile };
}

// ---------------------------------------------------------------------------
// mailbox receipt state — the receipt authority's new home (0.11 Stage 0 3B)
//
// Today the read-receipt lives at `record.delivery.lastReadAt` (stamped by
// readMetaInbox). v2 identity (step 3A) drops `delivery{}` out of the record, so
// the receipt timestamps need a new home BEFORE that removal (NEXT.md 고정순서
// 4: "delivery 제거 전 mailbox receipt state schema 먼저 못박음 ... 대체 state
// 없이 제거 금지"). That home is `<meta-mailbox>/<gardenId>/state.json` — a
// SIBLING of the inbox.signal/.msg traffic it accounts for, so the receipt lives
// with the mailbox (volatile delivery bookkeeping), not with identity.
//
// This block is the SCHEMA + STORE only. It does NOT yet re-wire the live
// enqueue/read path (that dual-write + the eventual record.delivery removal land
// in step 3D, behind NEXT.md 끊을 지점 ②, so the "정당한 update vs regression"
// gate-rewrite stays in one reviewed place). wakeMode/deliveryLevel are NOT here
// — those are capability, not receipt (step 3C).
// ---------------------------------------------------------------------------

/** Bump only on a breaking receipt-state shape change; the parser refuses other versions. */
export const MAILBOX_RECEIPT_SCHEMA_VERSION = 1 as const;

/**
 * The per-citizen mailbox receipt state. Holds exactly the three delivery
 * timestamps that move out of `record.delivery` (wakeMode/deliveryLevel are
 * capability, deliberately absent). Body is SSOT; the on-disk path is derived.
 */
export interface MailboxReceiptState {
	schemaVersion: typeof MAILBOX_RECEIPT_SCHEMA_VERSION;
	gardenId: string;
	lastEnqueuedAt: string | null;
	lastDeliveredAt: string | null;
	lastReadAt: string | null;
}

/** The receipt timestamp fields a mutator may stamp (runtime SSOT for validation). */
export const MAILBOX_RECEIPT_FIELDS = ["lastEnqueuedAt", "lastDeliveredAt", "lastReadAt"] as const;
export type MailboxReceiptField = (typeof MAILBOX_RECEIPT_FIELDS)[number];

/**
 * Validate an untrusted field name at runtime. The TS `MailboxReceiptField`
 * type does not survive a JS call site or an `as` cast — an invalid field would
 * otherwise create a stray key in memory that `serialize` silently drops. Crash
 * instead, mirroring the record layer's "crash, don't warn".
 */
function requireMailboxReceiptField(value: unknown): MailboxReceiptField {
	if (typeof value !== "string" || !MAILBOX_RECEIPT_FIELDS.includes(value as MailboxReceiptField)) {
		throw new MetaRecordError(
			`stampMailboxReceipt "field" must be one of ${MAILBOX_RECEIPT_FIELDS.join(" | ")} (got ${describe(value)}).`,
		);
	}
	return value as MailboxReceiptField;
}

/** A fresh, never-touched receipt state for a citizen (all timestamps null). */
export function emptyMailboxReceiptState(gardenId: string): MailboxReceiptState {
	return {
		schemaVersion: MAILBOX_RECEIPT_SCHEMA_VERSION,
		gardenId: requireGardenId(gardenId),
		lastEnqueuedAt: null,
		lastDeliveredAt: null,
		lastReadAt: null,
	};
}

/** Canonical serialization: stable key order, 2-space indent, trailing newline. */
export function serializeMailboxReceiptState(state: MailboxReceiptState): string {
	const ordered = {
		schemaVersion: state.schemaVersion,
		gardenId: state.gardenId,
		lastEnqueuedAt: state.lastEnqueuedAt,
		lastDeliveredAt: state.lastDeliveredAt,
		lastReadAt: state.lastReadAt,
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

const MAILBOX_RECEIPT_KEYS: readonly string[] = [
	"schemaVersion",
	"gardenId",
	"lastEnqueuedAt",
	"lastDeliveredAt",
	"lastReadAt",
];

/** Parse + fully validate untrusted JSON into a MailboxReceiptState. Throws on any drift. */
export function parseMailboxReceiptState(json: string): MailboxReceiptState {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		throw new MetaRecordError(
			`mailbox receipt state is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new MetaRecordError(`mailbox receipt state must be a JSON object (got ${describe(raw)}).`);
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== MAILBOX_RECEIPT_SCHEMA_VERSION) {
		throw new MetaRecordError(
			`mailbox receipt state "schemaVersion" must be ${MAILBOX_RECEIPT_SCHEMA_VERSION} (got ${describe(obj.schemaVersion)}).`,
		);
	}
	const stray = Object.keys(obj).filter((k) => !MAILBOX_RECEIPT_KEYS.includes(k));
	if (stray.length > 0) {
		throw new MetaRecordError(
			`mailbox receipt state carries unexpected key(s) ${stray.map((k) => `"${k}"`).join(", ")} ` +
				`(allowed: ${MAILBOX_RECEIPT_KEYS.join(", ")}).`,
		);
	}
	return {
		schemaVersion: MAILBOX_RECEIPT_SCHEMA_VERSION,
		gardenId: requireGardenId(obj.gardenId),
		lastEnqueuedAt: requireNullableString(obj.lastEnqueuedAt, "lastEnqueuedAt"),
		lastDeliveredAt: requireNullableString(obj.lastDeliveredAt, "lastDeliveredAt"),
		lastReadAt: requireNullableString(obj.lastReadAt, "lastReadAt"),
	};
}

/** The on-disk receipt-state path for a citizen: `<mailbox>/<gardenId>/state.json`. */
export function mailboxReceiptStatePath(mailboxDir: string, gardenId: string): string {
	return path.join(path.resolve(expandTilde(mailboxDir)), requireGardenId(gardenId), "state.json");
}

export interface MailboxReceiptOptions {
	gardenId: string;
	mailboxDir?: string;
}

/**
 * Read a citizen's receipt state from disk, or an empty state if none exists
 * yet. Reading-nothing is not an error — a citizen that has never had a receipt
 * stamped simply has all-null timestamps (parallel to readMetaInbox treating an
 * empty inbox as "no receipt", not a failure).
 */
export function readMailboxReceiptState(opts: MailboxReceiptOptions): MailboxReceiptState {
	const gardenId = requireGardenId(opts.gardenId);
	const file = mailboxReceiptStatePath(opts.mailboxDir ?? defaultMetaMailboxDir(), gardenId);
	if (!fs.existsSync(file)) return emptyMailboxReceiptState(gardenId);
	const state = parseMailboxReceiptState(fs.readFileSync(file, "utf8"));
	// Body is SSOT, and the body gardenId must agree with the path it was read
	// from — a state.json whose body claims a different citizen is corruption,
	// fail-fast (parallel to readMetaRecordByGardenId's body/filename drift rule).
	if (state.gardenId !== gardenId) {
		throw new MetaRecordError(
			`mailbox receipt state body/path gardenId drift — body gardenId=${state.gardenId}, read from <mailbox>/${gardenId}/state.json.`,
		);
	}
	return state;
}

/**
 * Stamp ONE receipt field to `now` and atomically persist the state (read-
 * modify-write; creates the state on first stamp). Returns the updated state.
 * The atomic tmp+rename mirrors atomicWriteRecord so a concurrent reader never
 * observes a half-written state.json.
 */
export function stampMailboxReceipt(
	opts: MailboxReceiptOptions & { field: MailboxReceiptField; now?: Date },
): MailboxReceiptState {
	const now = opts.now ?? new Date();
	const field = requireMailboxReceiptField(opts.field);
	const file = mailboxReceiptStatePath(opts.mailboxDir ?? defaultMetaMailboxDir(), opts.gardenId);
	const current = readMailboxReceiptState(opts);
	const updated: MailboxReceiptState = { ...current, [field]: isoNow(now) };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, serializeMailboxReceiptState(updated), { mode: 0o600 });
	fs.renameSync(tmp, file);
	return updated;
}

/** The v1 delivery receipt timestamps that migrate to mailbox state (the 3 only — wakeMode/deliveryLevel are capability). */
export interface V1DeliveryReceipts {
	lastEnqueuedAt: string | null;
	lastDeliveredAt: string | null;
	lastReadAt: string | null;
}

/**
 * Migrate a v1 record's delivery receipts into the mailbox state store (3D-4),
 * called by upsert BEFORE it rewrites a v1 file as v2 so a pre-3D-2 receipt is not
 * lost. Per-field merge, STATE WINS: a v1 timestamp only fills a state field that
 * is still null (`state[f] ?? v1[f]`); a state value already there is never
 * overwritten. ONLY the 3 timestamps move — wakeMode/deliveryLevel are capability
 * (registry), and a stray key would trip the receipt-state strict keyset (H2).
 *
 * "Migrating nothing is not a receipt": if no v1 value fills a null state field
 * (state already wins on every field, or v1 had nothing), this is a NO-OP — no
 * write, no state.json creation — returning null. Otherwise it writes the merged
 * state atomically (tmp+rename, mirroring stampMailboxReceipt) and returns it.
 */
export function migrateV1DeliveryReceipts(opts: {
	gardenId: string;
	delivery: V1DeliveryReceipts;
	mailboxDir?: string;
}): MailboxReceiptState | null {
	const gardenId = requireGardenId(opts.gardenId);
	const mailboxDir = opts.mailboxDir ?? defaultMetaMailboxDir();
	const current = readMailboxReceiptState({ gardenId, mailboxDir });
	const merged: MailboxReceiptState = {
		...current,
		lastEnqueuedAt: current.lastEnqueuedAt ?? opts.delivery.lastEnqueuedAt,
		lastDeliveredAt: current.lastDeliveredAt ?? opts.delivery.lastDeliveredAt,
		lastReadAt: current.lastReadAt ?? opts.delivery.lastReadAt,
	};
	if (
		merged.lastEnqueuedAt === current.lastEnqueuedAt &&
		merged.lastDeliveredAt === current.lastDeliveredAt &&
		merged.lastReadAt === current.lastReadAt
	) {
		return null; // no-write / no-create — migrating nothing is not a receipt
	}
	const file = mailboxReceiptStatePath(mailboxDir, gardenId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, serializeMailboxReceiptState(merged), { mode: 0o600 });
	fs.renameSync(tmp, file);
	return merged;
}
