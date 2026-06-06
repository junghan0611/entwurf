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
	atomicWriteRecord(file, decision.record);
	return { action: decision.action, record: decision.record, dir, path: file };
}

/** tmp-file + rename so a crash never leaves a half-written record. */
function atomicWriteRecord(file: string, record: MetaRecord): void {
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, serializeMetaRecord(record), { mode: 0o600 });
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

/** Read + parse the meta-record for a garden id, or throw if that citizen is unknown. */
export function readMetaRecordByGardenId(gardenId: string, sessionsDir: string = defaultMetaSessionsDir()): MetaRecord {
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
	const record = readMetaRecordByGardenId(opts.gardenId, sessionsDir);
	if (typeof opts.body !== "string" || opts.body.length === 0) {
		throw new MetaRecordError("enqueueMetaMessage: body must be a non-empty string.");
	}

	const dir = path.join(path.resolve(expandTilde(opts.mailboxDir ?? defaultMetaMailboxDir())), record.gardenId);
	fs.mkdirSync(dir, { recursive: true });
	// Sortable + unique: ISO stamp (colons/dots flattened for a clean filename) +
	// a short random tag so two sends in the same millisecond never collide.
	const stamp = `${isoNow(now).replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
	const messagePath = path.join(dir, `${stamp}.msg`);
	fs.writeFileSync(messagePath, opts.body, { mode: 0o600 });

	atomicWriteRecord(recordFile, markEnqueued(record, now));

	// Poke LAST. Writing the timestamp changes the file's content+mtime, which is
	// what the plugin's FileChanged watch fires on.
	const signalPath = path.join(dir, "inbox.signal");
	fs.writeFileSync(signalPath, `${isoNow(now)}\n`, { mode: 0o600 });

	return { gardenId: record.gardenId, recordPath: recordFile, messagePath, signalPath };
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
 * was read — stamp `lastReadAt` (and backfill `lastDeliveredAt` if the doorbell
 * never got to). An empty inbox mutates nothing: reading nothing is not a receipt.
 */
export function readMetaInbox(opts: ReadMetaInboxOptions): ReadMetaInboxResult {
	const now = opts.now ?? new Date();
	const sessionsDir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const recordFile = recordFileFor(sessionsDir, opts.gardenId);
	const record = readMetaRecordByGardenId(opts.gardenId, sessionsDir);

	const dir = path.join(path.resolve(expandTilde(opts.mailboxDir ?? defaultMetaMailboxDir())), record.gardenId);
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
		return { gardenId: record.gardenId, messages, readAt: null, recordPath: recordFile };
	}

	// Stamp ONLY lastReadAt — the one receipt this layer can stamp honestly: it
	// KNOWS the body reached the reader. lastDeliveredAt is the doorbell's to own
	// (the moment the FileChanged hook rang); recording it here would report a
	// delivered-time of "read-time", later than the truth. So it is left as the
	// doorbell left it — null in the MVP, where the `.msg.delivered` FILE (not a
	// record field) is the delivery marker. lastDeliveredAt null + lastReadAt set
	// therefore means "delivery-time not recorded", NOT "read before delivered".
	const updated = markRead(record, now);
	atomicWriteRecord(recordFile, updated);
	return { gardenId: record.gardenId, messages, readAt: updated.delivery.lastReadAt, recordPath: recordFile };
}
