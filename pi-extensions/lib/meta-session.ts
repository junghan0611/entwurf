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
 *   1. PURE record functions + types (mint / serialize / parse / scanByNativeId /
 *      decideUpsert / read-receipt mutators). No fs, no clock beyond an injected
 *      `now`. These are the backend-agnostic authority.
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
// Pure record functions
// ---------------------------------------------------------------------------

/**
 * Mint a brand-new meta-record at the session's true birth. Generates the garden
 * id from the SSOT grammar, stamps createdAt == lastSeen, and seeds the
 * delivery/read-receipt slot from the backend descriptor (timestamps null).
 */
export function mintMetaRecord(input: MetaMintInput, now: Date = new Date()): MetaRecord {
	const backend = requireBackend(input.backend);
	const descriptor = META_BACKEND_DESCRIPTORS[backend];
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
			wakeMode: descriptor.wakeMode,
			deliveryLevel: descriptor.deliveryLevel,
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
	// the "last 1 cm" delivery contract. Refuse it.
	const canonicalWakeMode = META_BACKEND_DESCRIPTORS[backend].wakeMode;
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

/** Denote-sortable on-disk filename. Body is SSOT; do NOT parse this for authority. */
export function metaRecordFilename(record: MetaRecord): string {
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

export type UpsertAction = "create" | "attach";

export interface UpsertDecision {
	action: UpsertAction;
	record: MetaRecord;
}

/**
 * The pure core of the step-3 `upsert` CLI. Keyed on RECORD EXISTENCE, never on a
 * backend `source` field:
 *   - existing record present → ATTACH: keep the identity (gardenId, createdAt,
 *     nativeSessionId), refresh lastSeen, and refresh the cheap mutable pointers
 *     (transcriptPath, cwd) in case the backend moved them. Identity drift (a
 *     different backend for the same nativeSessionId) is corruption → throw.
 *   - absent → CREATE: mint a fresh record.
 *
 * Idempotent by construction: calling it twice with the same input yields one
 * attach after the first create, never a second id.
 */
export function decideUpsert(
	existing: MetaRecord | null,
	input: MetaMintInput,
	now: Date = new Date(),
): UpsertDecision {
	const backend = requireBackend(input.backend);
	const nativeSessionId = requireNonEmptyString(input.nativeSessionId, "nativeSessionId");
	const transcriptPath = requireNonEmptyString(input.transcriptPath, "transcriptPath");
	const cwd = requireNonEmptyString(input.cwd, "cwd");

	if (existing === null) {
		return { action: "create", record: mintMetaRecord({ backend, nativeSessionId, transcriptPath, cwd }, now) };
	}
	if (existing.nativeSessionId !== nativeSessionId) {
		throw new MetaRecordError(
			`decideUpsert called with existing record for a different nativeSessionId ` +
				`(existing="${existing.nativeSessionId}", input="${nativeSessionId}"). ` +
				`The caller must pass the record found by scanByNativeId(input.nativeSessionId).`,
		);
	}
	if (existing.backend !== backend) {
		throw new MetaRecordError(
			`meta-record identity drift: nativeSessionId "${nativeSessionId}" is bound to backend ` +
				`"${existing.backend}" but upsert input says "${backend}". A native session cannot change backend.`,
		);
	}
	return {
		action: "attach",
		record: { ...existing, transcriptPath, cwd, lastSeen: isoNow(now) },
	};
}

// ---------------------------------------------------------------------------
// read-receipt mutators (pre-drilled; mailbox path is post-MVP but these keep
// the schema untouched when it lands)
// ---------------------------------------------------------------------------

/** A sender enqueued a body to this peer's mailbox. */
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

export interface UpsertMetaSessionOptions {
	input: MetaMintInput;
	/** Override the store directory (defaults to {@link defaultMetaSessionsDir}). */
	dir?: string;
	now?: Date;
	onSkip?: (filename: string, err: Error) => void;
}

export interface UpsertMetaSessionResult {
	action: UpsertAction;
	record: MetaRecord;
	dir: string;
	/** Absolute path of the written record. */
	path: string;
}

/**
 * Idempotent fs upsert: scan the store by `nativeSessionId`, decide create vs
 * attach on record EXISTENCE, and write atomically. On attach the file is the
 * existing garden id's record (same path, rewritten in place); on create it is a
 * fresh `<gardenId>.meta.json`. A duplicate `nativeSessionId` in the store throws
 * (via `scanByNativeId`) rather than silently picking one. The write is
 * tmp-file + rename so a crash never leaves a half-written record (the #30
 * "write the record before the session takes over" crash-safety gate).
 */
export function upsertMetaSession(opts: UpsertMetaSessionOptions): UpsertMetaSessionResult {
	const dir = path.resolve(expandTilde(opts.dir ?? defaultMetaSessionsDir()));
	fs.mkdirSync(dir, { recursive: true });
	const entries = fs.readdirSync(dir);
	const existing = scanByNativeId(
		entries,
		opts.input.nativeSessionId,
		(filename) => fs.readFileSync(path.join(dir, filename), "utf8"),
		opts.onSkip,
	);
	const decision = decideUpsert(existing, opts.input, opts.now);
	const file = path.join(dir, metaRecordFilename(decision.record));
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, serializeMetaRecord(decision.record), { mode: 0o600 });
	fs.renameSync(tmp, file);
	return { action: decision.action, record: decision.record, dir, path: file };
}
