/**
 * meta-session — the shared V3 garden-citizen RECORD AUTHORITY.
 *
 * This module entered through the native meta-bridge (#30), then became the one
 * identity store for every addressable citizen, including `backend:"pi"` (#50).
 * A record is a backend-owned-session bib card: it binds the backend's native id
 * and transcript pointer to a garden id without taking over that backend's runtime,
 * auth, or transcript. The module name is history; the live identity schema is not
 * a native-only or pi-exception axis.
 *
 * Two layers, clearly sectioned:
 *   1. RECORD functions + types (mint / serialize / parse / certifyActiveStore /
 *      decideUpsert), the backend-agnostic authority. Pure beyond an injected
 *      `now`; backend capability (wakeMode/deliveryLevel) comes from the packaged
 *      registry via a cached fs read (loadMetaCapabilityRegistry) — see that seam
 *      below.
 *   2. The thin FS-BOUND STORE (step 3): `upsertMetaSession` wraps the pure core
 *      (readdir → `certifyActiveStore` → `decideUpsert` → atomic write) with the real
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
 *     (see certifyActiveStore), symmetric with 0.9.0 `findSessionFileById`. Any
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

/** A garden-citizen record is malformed, or an input violates the record contract. */
export class MetaRecordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MetaRecordError";
	}
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Validation helpers (crash, don't warn)
// ---------------------------------------------------------------------------

export function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new MetaRecordError(`meta-record field "${field}" must be a non-empty string (got ${describe(value)}).`);
	}
	return value;
}

/** Validate the 3-backend NATIVE bridge axis (sender/receiver markers, capability
 * drift guard). Not a record-schema validator: identity records take
 * `requireCitizenBackend` (which admits `pi`). Markers stay native-3 because the
 * pi adapter carries its record-established garden id into children via env rather
 * than using the native-hook pid marker rail. */
export function requireBackend(value: unknown): MetaBackend {
	if (typeof value !== "string" || !META_BACKENDS.includes(value as MetaBackend)) {
		throw new MetaRecordError(
			`meta-record "backend" must be one of ${META_BACKENDS.join(" | ")} (got ${describe(value)}).`,
		);
	}
	return value as MetaBackend;
}

export function requireGardenId(value: unknown): string {
	const id = requireNonEmptyString(value, "gardenId");
	if (!SESSION_ID_RE.test(id)) {
		throw new MetaRecordError(`meta-record "gardenId" must match YYYYMMDDTHHMMSS-[0-9a-f]{6} (got "${id}").`);
	}
	return id;
}

export function requireNullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length === 0) {
		throw new MetaRecordError(
			`meta-record field "${field}" must be a non-empty string or null (got ${describe(value)}).`,
		);
	}
	return value;
}

export function describe(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return `string ${JSON.stringify(value)}`;
	// Primitives carry their VALUE, not just their type: `got number` cannot say
	// WHICH foreign schemaVersion a rejected record carried, and the operator
	// deciding on a fresh cut deserves the actual number (F9).
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return `${typeof value} ${String(value)}`;
	}
	return `${typeof value}`;
}

function isoNow(now: Date): string {
	return now.toISOString();
}

// ---------------------------------------------------------------------------
// meta-record identity shape — the LIVE schema is v3, the ONLY schema this repo
// can read (#50 hard cut, completed by the fresh-cut subtraction).
//
// There is no history ladder here on purpose. The bridge is a call-relay: a
// record is routing state for a LIVE session, never memory (memory lives in the
// native transcript and the andenken embedding axes). Sessions flow — a session
// from before a schema generation is never resumed through this store, so the
// repo carries NO reader, migrator or fixture for any earlier shape. When the
// schema next changes, bump the version, and the upgrade story stays the same
// one sentence: quiesce → fresh-cut (archive the whole generation) → go.
// (#50: a call is not parentage and there is no species boolean — LOCKED
// PROTOCOL 5/6 — which is why v3 carries no parentage/species axis.)
//
// WHAT LIVES HERE: the whole v3 axis — reader, normalizer, canonical
// serializer, minter and the FS upsert (`upsertMetaSession`, below).
// ---------------------------------------------------------------------------

/** The one live identity schema number. */
export const META_SCHEMA_VERSION_V3 = 3 as const;

/** Every backend admitted by the one V3 record-citizen schema. */
export const META_CITIZEN_BACKENDS = ["claude-code", "antigravity", "codex", "pi"] as const;
export type MetaCitizenBackend = (typeof META_CITIZEN_BACKENDS)[number];

/**
 * The LIVE identity record — v3 (`schemaVersion: 3`). The name carries no
 * version suffix on purpose: this is the ONE shape the repo mints, reads and
 * writes. Field order mirrors the frozen ledger's jsonc so the serializer
 * stays byte-stable. No delivery aspect — that is mailbox state (step 3B),
 * referenced by gardenId, never embedded in identity. No parentage/species axis
 * — #50 dropped `parentGardenId` + `isEntwurf`, and the v3 parser REJECTS them
 * as stray keys.
 */
export interface MetaIdentity {
	schemaVersion: typeof META_SCHEMA_VERSION_V3;
	gardenId: string;
	backend: MetaCitizenBackend;
	nativeSessionId: string;
	cwd: string;
	model: string | null;
	transcriptPath: string | null;
	createdAt: string;
	recordUpdatedAt: string;
}

export function requireCitizenBackend(value: unknown): MetaCitizenBackend {
	if (typeof value !== "string" || !META_CITIZEN_BACKENDS.includes(value as MetaCitizenBackend)) {
		throw new MetaRecordError(
			`meta-record "backend" must be one of ${META_CITIZEN_BACKENDS.join(" | ")} (got ${describe(value)}).`,
		);
	}
	return value as MetaCitizenBackend;
}

/**
 * The name of the fresh-cut operator command. The bridge is a call-relay, not a
 * memory layer: sessions flow, memory lives in the transcript + embedding axes,
 * and the active store provides NO continuity across schema generations. So the
 * moment production meets a record it cannot read, the honest fix is not a
 * migration — it is an explicit generation cut: archive the whole previous
 * generation and open an empty v3 store. run.sh dispatches this name to
 * scripts/meta-bridge-fresh-cut.ts.
 */
export const FRESH_CUT_COMMAND = "./run.sh meta-bridge-fresh-cut";

/**
 * The installed-package form of the same verb: the npm bin `entwurf` IS run.sh,
 * so both strings dispatch the identical surface. Named separately because the
 * hosts that actually meet a previous-generation store are INSTALLED hosts with
 * no checkout — a `./run.sh …` prescription is not typeable there.
 */
export const FRESH_CUT_COMMAND_INSTALLED = "entwurf meta-bridge-fresh-cut";

/**
 * The one prescription every rejection surface prints — names BOTH invocation
 * forms so the fix is typeable on a dev clone AND an installed host. Extends
 * (never replaces) the `FRESH_CUT_COMMAND` substring the gates assert.
 */
export const FRESH_CUT_PRESCRIPTION = `\`${FRESH_CUT_COMMAND}\` (from an installed package: \`${FRESH_CUT_COMMAND_INSTALLED}\`)`;

/**
 * THE fresh-cut EXIT CONTRACT (#54) — the store doctor's `0/1/2/3` has a sibling here.
 *
 * The cut used to answer `1` for three world-states that are not each other, and the
 * documented chain `fresh-cut && setup` therefore stopped on all of them alike. What
 * distinguishes them is not severity, it is **what already moved**:
 *
 *   - `COMPLETE` (0) — the generation is archived (or there was none), the fresh v3
 *     store is open, and every dead/refuted marker and socket is gone. `&& setup` is
 *     exactly right here.
 *   - `NO_MOVE` (1) — the cut REFUSED before touching anything: a live or unprovable
 *     surface, an occupied archive destination, a surface that could not be read or
 *     planned, or a first rename that failed. The host is what it was; fix the named
 *     cause and re-run the same command. Nothing downstream may proceed, because the
 *     store the install refused is still there.
 *   - `USAGE` (2) — the operator asked for something this verb does not have. Same
 *     number the `-h` path and the store doctor use, so a wrapper never has to learn a
 *     second convention.
 *   - `HALF_CUT` (3) — a failure arrived AFTER at least one archive move, so the cut
 *     transition is incomplete and the fresh generation is not confirmed open. This
 *     state wants inspection before anything else runs; a re-run can finish the cut
 *     under its own stamp.
 *   - `CLEANUP_INCOMPLETE` (4) — the cut IS done: the generation moved, the fresh
 *     generation is open, install and citizen birth are no longer blocked by the
 *     store. What survived is disposable process state (marker/socket residue) that
 *     could not be unlinked. A runbook may run `setup` here but may not call the host
 *     clean. Re-running fresh-cut is safe only before a new citizen is born; after
 *     that, repair the named residue manually rather than archiving the new generation.
 *
 * Still fail-closed: only `COMPLETE` is zero. #54 asked for the states to become
 * distinguishable, not for cleanup failure to become success.
 *
 * Frozen numbers. A caller — a shell runbook, CI, another agent — reads these, so
 * renumbering is a breaking change to every chain that branches on them.
 */
export const FRESH_CUT_EXIT = {
	COMPLETE: 0,
	NO_MOVE: 1,
	USAGE: 2,
	HALF_CUT: 3,
	CLEANUP_INCOMPLETE: 4,
} as const;

export type FreshCutExit = (typeof FRESH_CUT_EXIT)[keyof typeof FRESH_CUT_EXIT];

/**
 * The mid-cut verdict, as a function rather than a branch, so the distinction #54 is
 * about can be EXECUTED by a gate instead of grepped for.
 *
 * A rename that fails is not one event: if nothing had moved yet it is a refusal that
 * happens to arrive late ({@link FRESH_CUT_EXIT.NO_MOVE} — the host is untouched), and
 * if something had, it is a genuine {@link FRESH_CUT_EXIT.HALF_CUT}. The old code said
 * both of those in prose and neither of them in its exit status.
 */
export function midCutExit(archivedCount: number): typeof FRESH_CUT_EXIT.NO_MOVE | typeof FRESH_CUT_EXIT.HALF_CUT {
	return archivedCount === 0 ? FRESH_CUT_EXIT.NO_MOVE : FRESH_CUT_EXIT.HALF_CUT;
}

/** The uniform "this record is not a live-generation v3 record" error, naming the fresh-cut fix. */
function nonV3RecordMessage(version: unknown): string {
	return (
		`meta-record "schemaVersion" must be ${META_SCHEMA_VERSION_V3} (got ${describe(version)}). ` +
		`The active store is v3-only and carries no cross-generation continuity (sessions flow; ` +
		`memory lives in the transcript and embedding axes, never here) — archive the previous ` +
		`generation and open a fresh one with ${FRESH_CUT_PRESCRIPTION}.`
	);
}

/**
 * The EXACT key set a v3 identity record may carry. v3 is strict: any key
 * outside this set fails fast — a record from a previous generation (or any
 * foreign shape) is simply unreadable here, never coerced. There is no legacy
 * reader anywhere in the repo; the fresh-cut command is the only answer to an
 * unreadable store.
 */
const META_IDENTITY_KEYS: readonly string[] = [
	"schemaVersion",
	"gardenId",
	"backend",
	"nativeSessionId",
	"cwd",
	"model",
	"transcriptPath",
	"createdAt",
	"recordUpdatedAt",
];

/** Parse + fully validate untrusted JSON into a v3 MetaIdentity. Throws on any drift. */
export function parseMetaRecordV3(json: string): MetaIdentity {
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
	if (obj.schemaVersion !== META_SCHEMA_VERSION_V3) {
		throw new MetaRecordError(nonV3RecordMessage(obj.schemaVersion));
	}
	// Strict keyset: any key outside the v3 set makes the record unreadable —
	// stray keys are never coerced away. A record from a previous generation
	// carrying retired fields lands here, and the fix is the generation cut.
	const stray = Object.keys(obj).filter((k) => !META_IDENTITY_KEYS.includes(k));
	if (stray.length > 0) {
		throw new MetaRecordError(
			`v3 meta-record carries unexpected key(s) ${stray.map((k) => `"${k}"`).join(", ")} ` +
				`(allowed: ${META_IDENTITY_KEYS.join(", ")}). A record from a previous generation is ` +
				`never read or coerced — archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
		);
	}
	return {
		schemaVersion: META_SCHEMA_VERSION_V3,
		gardenId: requireGardenId(obj.gardenId),
		backend: requireCitizenBackend(obj.backend),
		nativeSessionId: requireNonEmptyString(obj.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(obj.cwd, "cwd"),
		model: requireNullableString(obj.model, "model"),
		transcriptPath: requireNullableString(obj.transcriptPath, "transcriptPath"),
		createdAt: requireNonEmptyString(obj.createdAt, "createdAt"),
		recordUpdatedAt: requireNonEmptyString(obj.recordUpdatedAt, "recordUpdatedAt"),
	};
}

/**
 * Normalize a parsed v3 identity into a fresh, key-stable copy — the one place
 * that hands every consumer a canonical, key-ordered identity object, so a
 * caller never depends on incidental key order.
 */
export function normalizeMetaIdentity(record: MetaIdentity): MetaIdentity {
	return {
		schemaVersion: META_SCHEMA_VERSION_V3,
		gardenId: record.gardenId,
		backend: record.backend,
		nativeSessionId: record.nativeSessionId,
		cwd: record.cwd,
		model: record.model,
		transcriptPath: record.transcriptPath,
		createdAt: record.createdAt,
		recordUpdatedAt: record.recordUpdatedAt,
	};
}

// ---------------------------------------------------------------------------
// v3 write shape + reader — pure functions: the canonical serializer and the
// one reader. The fs upsert that consumes this serializer is
// `upsertMetaSession`, further down this file.
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a v3 identity: stable key order (the frozen ledger
 * jsonc order), 2-space indent, trailing newline. Deterministic — re-serializing
 * the same identity is byte-identical, and the output round-trips through
 * `parseMetaRecordV3`. This is the ONE write shape in the repo.
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
		createdAt: identity.createdAt,
		recordUpdatedAt: identity.recordUpdatedAt,
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Fields a writer supplies; garden id + timestamps are derived. The nullable
 * identity axes (model/transcriptPath) are OPTIONAL at the input
 * boundary so attach can distinguish three intents (3D-4 G5): `undefined` = keep
 * the existing value, `null` = explicit unknown/clear, a string = set/refresh.
 * mint (create) has no existing value, so undefined collapses to null.
 */
export interface MetaIdentityMintInput {
	backend: MetaCitizenBackend;
	nativeSessionId: string;
	cwd: string;
	model?: string | null;
	transcriptPath?: string | null;
}

/**
 * Mint a brand-new v3 identity at the session's true birth (3D-4). Generates the
 * garden id, stamps createdAt == recordUpdatedAt, and carries identity only (no
 * delivery; the receipt lives in mailbox state). Omitted nullable axes
 * (model/transcriptPath) default to null — the two axes a birth caller may not
 * know yet. There is no parentage or species axis to default: #50 deleted both.
 */
export function mintMetaIdentity(input: MetaIdentityMintInput, now: Date = new Date()): MetaIdentity {
	const backend = requireCitizenBackend(input.backend);
	const ts = isoNow(now);
	return {
		schemaVersion: META_SCHEMA_VERSION_V3,
		gardenId: generateSessionId(now),
		backend,
		nativeSessionId: requireNonEmptyString(input.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(input.cwd, "cwd"),
		model: requireNullableString(input.model ?? null, "model"),
		transcriptPath: requireNullableString(input.transcriptPath ?? null, "transcriptPath"),
		createdAt: ts,
		recordUpdatedAt: ts,
	};
}

/**
 * Parse a v3 record straight to a fresh, key-stable identity copy. There is one
 * schema in this repo, so this is THE reader; any other version throws
 * `nonV3RecordMessage`, which names the fresh-cut command.
 */
export function parseMetaIdentity(json: string): MetaIdentity {
	return normalizeMetaIdentity(parseMetaRecordV3(json));
}

// ---------------------------------------------------------------------------
// capability source — backend capability registry (0.11 Stage 0 step 3C)
//
// The identity-only cut (step 3A) dropped the backend honesty metadata (wakeMode
// / deliveryLevel / nativeIdLabel) out of the per-session record — it is NOT per
// session, it is per BACKEND — and v3 has never carried it either. Its home is
// a registry data file
// `pi/entwurf-capabilities.json` (frozen decision 1 — a registry FILE). "이
// 시민은 self-fetch 인가 / pi 는 어떻게 깨우나" is answered by capability, not
// by identity.
//
// This block is the SCHEMA + PARSER + path resolver. As of 3C it did NOT re-wire
// the live consumers (`META_BACKEND_DESCRIPTORS` was the authority mint/parse read).
// 3D-3 then cut mint/parse over to this registry via the `metaCapabilityFor` seam
// (defined below `metaCapabilitiesFilePath`): the registry is now the LIVE source of
// wakeMode/deliveryLevel, and `META_BACKEND_DESCRIPTORS` survives only as the
// drift-guard reference. 3D-4 then removed wakeMode from the record itself — the
// live v3 identity carries no delivery aspect at all, so capability is the ONLY
// source and there is no per-record copy left to drift against it.
// The 3C gate (check-entwurf-capabilities) still asserts the JSON AGREES with the
// const for the three existing backends (the drift guard) and COVERS exactly
// META_CITIZEN_BACKENDS (pi included).
//
// `wakeMode` describes the last centimetre, not citizen rank. The control-socket
// adapter injects the body into a pi turn, so backend `pi` is `direct-inject`;
// Claude's mailbox is `self-fetch`; native-push adapters are direct injection.
// Dormant spawn-bg resume is a separate transport/ownership decision and does not
// turn the pi record into a mailbox citizen.
// ---------------------------------------------------------------------------

/** Bump only on a breaking capability-registry shape change; the parser refuses other versions. */
export const CAPABILITY_SCHEMA_VERSION = 1 as const;

/** One backend's capability — the honesty metadata that stays OUT of the identity record. */
export interface MetaCapability {
	wakeMode: WakeMode;
	deliveryLevel: string;
	nativeIdLabel: string;
}

/** The whole registry: schema version + one capability per v2 backend. */
export interface MetaCapabilityRegistry {
	schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
	backends: Record<MetaCitizenBackend, MetaCapability>;
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
 * keys must be exactly META_CITIZEN_BACKENDS (no missing, no extra). A registry that
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
	const expected = [...META_CITIZEN_BACKENDS].sort();
	if (present.length !== expected.length || !expected.every((b, i) => b === present[i])) {
		throw new MetaRecordError(
			`capability registry must cover exactly ${expected.join(", ")} (got ${present.join(", ")}).`,
		);
	}
	const entries = backends as Record<string, unknown>;
	const out = {} as Record<MetaCitizenBackend, MetaCapability>;
	for (const backend of META_CITIZEN_BACKENDS) {
		out[backend] = parseCapabilityEntry(entries[backend], backend);
	}
	return { schemaVersion: CAPABILITY_SCHEMA_VERSION, backends: out };
}

/**
 * The packaged capability registry path. This function's ENTIRE behaviour is
 * arithmetic on its own file location, so it is only ever as correct as the layout
 * it is executed from — which is why it is gated by check-capability-bundle-reach
 * (which re-asks every shipped copy from where it lives) and NOT by the source-path
 * gates (calling it from its own source dir can never fail).
 *
 * Two layouts resolve:
 *  - repo / npm package: `pi-extensions/lib/` → `<root>/pi/entwurf-capabilities.json`.
 *  - a BUNDLE that carries the module at its own root: `../../pi` would escape the
 *    bundle, so the registry travels AT the bundle root and resolves via `../` from
 *    `lib/`. Two bundles ship this way, and each needs its own copy step:
 *      · meta-bridge plugin — installed under a version dir in the Claude plugin
 *        cache; meta-bridge-install.sh copies it, doctor-meta-bridge asserts it.
 *      · entwurf-bridge MCP dist — `mcp/entwurf-bridge/dist/pi-extensions/lib/`,
 *        three levels deeper than the source; build-bridge.sh copies it. This is
 *        the copy that answers entwurf_v2, and it shipped with NO registry through
 *        0.12.8-repair.0: sends died ENOENT while the registry-free verbs
 *        (entwurf_self/entwurf_peers) stayed green and hid it.
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
// the cut-over is behaviour-preserving: at 3D-3 only the SOURCE moved and the
// record.delivery.wakeMode SLOT still existed. 3D-4 then deleted that slot with
// the rest of `delivery{}`, so today the registry is the sole home.
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
 * the registry" from "hardcoded off the const". Param is `MetaCitizenBackend` (all 4):
 * `backends` is `Record<MetaCitizenBackend, …>`, so the lookup is total — mint/parse
 * still pass the 3 `MetaBackend` values (a subset), and the v2 decider's mailbox
 * deliverability passes the unsupported backends (which are MetaCitizenBackend to the
 * type system even though pi never reaches that call at runtime).
 */
export function metaCapabilityFor(
	backend: MetaCitizenBackend,
	registry: MetaCapabilityRegistry = loadMetaCapabilityRegistry(),
): MetaCapability {
	return registry.backends[backend];
}

/** Denote-sortable on-disk filename. Body is SSOT; do NOT parse this for authority. */
export function metaRecordFilename(record: MetaIdentity): string {
	return `${record.gardenId}.meta.json`;
}

/** One reason the active store is not certifiable, naming its own entry + cause. */
export interface ActiveStoreDefect {
	filename: string;
	message: string;
}

/**
 * A `.meta.json` entry as the certification sees it. `regularFile` is false for a
 * symlink, directory, fifo or device wearing a record's name: the bytes
 * production would read then live somewhere this store does not own, so the
 * certification refuses instead of following the link.
 */
export interface ActiveStoreEntry {
	filename: string;
	regularFile: boolean;
}

export interface ActiveStoreCertification {
	/** `.meta.json` entries examined (regular or not). */
	scanned: number;
	/** The parsed records — trustworthy ONLY when `defects` is empty. */
	records: { filename: string; identity: MetaIdentity }[];
	/** Every reason this store is not certifiable. Empty = certified. */
	defects: ActiveStoreDefect[];
}

/**
 * THE active-store certification — ONE contract, shared by the install doctor and
 * every identity writer. A store is certified when every `.meta.json` entry is:
 *
 *   1. a REGULAR file — a symlink/dir/fifo named `<gid>.meta.json` is refused,
 *      never followed (the bytes it points at are outside this store's ownership,
 *      so no scan of this directory can certify them);
 *   2. readable by the LIVE schema (v3 — a previous generation cannot be read
 *      and is never coerced);
 *   3. named by its own body (`<gardenId>.meta.json`) — the body stays the
 *      authority, but a wrong path breaks garden-id lookup, so drift is
 *      corruption of the ACTIVE store even though the bytes parse;
 *   4. the unique holder of its `nativeSessionId` across the WHOLE store — the
 *      native→garden mapping is one-to-one or a writer attaches to the wrong
 *      citizen (and a reader routes a message to it).
 *
 * Every defect collapses to ONE prescription: archive the generation with
 * fresh-cut. That is what a clean live store IS — this generation's records and
 * nothing else. The certification never repairs, never prunes and never picks a
 * winner among duplicates.
 *
 * Pure over injected (entries, readRecord); {@link certifyActiveStoreDir} binds
 * the real fs. A writer must consult `records` only after finding `defects` empty.
 *
 * This is deliberately the only store-wide scan a writer runs. Before it, the
 * upsert asked one narrow question — "is there a record for MY nativeSessionId?"
 * — and therefore wrote straight past a drifted, duplicated or symlinked
 * neighbour that the doctor would have refused: two contracts for one store, and
 * the runtime held the weaker one.
 */
export function certifyActiveStore(
	entries: readonly ActiveStoreEntry[],
	readRecord: (filename: string) => string,
): ActiveStoreCertification {
	const records: { filename: string; identity: MetaIdentity }[] = [];
	const defects: ActiveStoreDefect[] = [];
	const byNative = new Map<string, string[]>();
	let scanned = 0;
	for (const entry of entries) {
		if (!entry.filename.endsWith(".meta.json")) continue;
		scanned += 1;
		if (!entry.regularFile) {
			defects.push({
				filename: entry.filename,
				message:
					"not a regular file (symlink/directory/special) — a record's bytes must live in the store " +
					"itself; this entry is never followed. Inspect and remove it by hand.",
			});
			continue;
		}
		let identity: MetaIdentity;
		try {
			identity = parseMetaIdentity(readRecord(entry.filename));
		} catch (err) {
			defects.push({ filename: entry.filename, message: err instanceof Error ? err.message : String(err) });
			continue;
		}
		const expected = metaRecordFilename(identity);
		if (entry.filename !== expected) {
			defects.push({
				filename: entry.filename,
				message:
					`body/filename drift — body gardenId=${identity.gardenId}, expected filename ${expected}. ` +
					"The body is the authority, so this file is corrupt: a garden-id lookup would never find it.",
			});
			continue;
		}
		const seen = byNative.get(identity.nativeSessionId) ?? [];
		seen.push(entry.filename);
		byNative.set(identity.nativeSessionId, seen);
		records.push({ filename: entry.filename, identity });
	}
	for (const [nativeSessionId, files] of byNative.entries()) {
		if (files.length > 1) {
			defects.push({
				filename: files[0] as string,
				message:
					`duplicate nativeSessionId ${JSON.stringify(nativeSessionId)} in ${files.join(", ")} — ` +
					"the native→garden mapping must be unique; this store cannot say which record owns that session.",
			});
		}
	}
	return { scanned, records, defects };
}

/**
 * The fs-bound certification: read a store directory and certify it. `withFileTypes`
 * classifies without following links (a symlinked record is `isFile() === false`),
 * which is what makes rule 1 above enforceable.
 *
 * A store that is NOT THERE is a certified empty one — a host that has never had a
 * generation is not a broken host. That is ENOENT and only ENOENT. Any other errno —
 * EACCES on the store or on an ancestor, ENOTDIR when the path is not a directory at all
 * — is a failure to READ the store, and answering "certified, 0 records" there would let
 * the doctor and the install preflight call an unreadable host clean (2026-07-25
 * fresh-eyes review; `existsSync` returns false for a directory it merely cannot search,
 * which is the same laundering {@link inspectRecordEntry} refuses on the targeted path).
 *
 * Split out of {@link certifyActiveStoreDir} so that EVERY store-wide scan in this repo
 * — the certification, the `entwurf_peers` listing, the rival scan — gets its entries
 * from one function that carries the ENTRY KIND. A binding that does its own
 * `readdir()` gets names only, so the next thing it does is `readFileSync`, and rule 1
 * ("a symlink is refused, never followed — its bytes live where this store has no
 * ownership") quietly stops holding on that surface. That is not hypothetical: both
 * `entwurf_peers` bindings hand-rolled exactly that readdir, and the #52 duplicate pass
 * then let a symlink pointing at foreign bytes quarantine a healthy regular record.
 * The rule has to be structural, not remembered at each call site — the same lesson
 * `pi_settings_io` learned about the settings writers.
 */
export function readActiveStoreEntries(dir: string): ActiveStoreEntry[] {
	const resolved = path.resolve(expandTilde(dir));
	let dirents: fs.Dirent[];
	try {
		dirents = fs.readdirSync(resolved, { withFileTypes: true });
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") return [];
		throw new MetaRecordError(
			`cannot read the meta-record store ${resolved}: ${err instanceof Error ? err.message : String(err)}. ` +
				"That is a failure to inspect the store, not an empty store — refusing to certify a store this " +
				"process cannot read.",
		);
	}
	return dirents
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => ({ filename: entry.name, regularFile: entry.isFile() }));
}

/** The errno {@link readStoreRecordFile} raises for an entry whose OPEN succeeded but
 * whose file description is not a regular file — a directory, a fifo, a device. There is
 * no operating-system errno for "you opened the wrong KIND of thing", so this is a
 * synthesized one; every real errno is passed through untouched. */
export const NOT_REGULAR_ENTRY_CODE = "ENTWURF_ENOTREG";

const O_NOFOLLOW_FLAG = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
const O_NONBLOCK_FLAG = typeof fs.constants.O_NONBLOCK === "number" ? fs.constants.O_NONBLOCK : 0;

/**
 * Read a record's bytes with the entry KIND decided on the very file description the
 * read will use.
 *
 * `lstat`-then-`readFileSync(path)` classifies one entry and reads another. Between
 * those two syscalls the final path component can be replaced by a symlink, and the read
 * then follows it into bytes the store does not own — rule 1 laundered by a race rather
 * than by a missing check (2026-07-26 cross-review). A path looked up twice cannot hold
 * the rule; one open file description can:
 *
 *   `O_NOFOLLOW` — a symlink at the FINAL component fails the OPEN with `ELOOP`, so
 *                  foreign bytes are refused before one of them is read. Intermediate
 *                  components resolve as they always have: the shape of the store
 *                  DIRECTORY is a separate question, and this seam does not widen into
 *                  it.
 *   `O_NONBLOCK` — opening a fifo `O_RDONLY` BLOCKS until some writer appears, so a
 *                  named pipe dropped in the store would hang every scan on a host where
 *                  nobody is writing. Classify-then-open never had that window; this flag
 *                  is what buys it back. It is a no-op for regular files, and it does not
 *                  decide anything — the fstat below is what refuses the fifo.
 *   `fstat(fd)`  — the kind of THIS description, not of a name. A directory opens fine on
 *                  Linux, so without it the refusal would arrive later as a stranger
 *                  errno from the read.
 *
 * Errno is deliberately NOT flattened here. The callers separate raced-away (`ENOENT`)
 * from unreadable (`EACCES`) from refused (`ELOOP`), and a wrapper that turned all three
 * into one `MetaRecordError` would silently kill the rival scan's raced-away skip — the
 * loudest possible regression, since every concurrent birth would then refuse dispatch.
 * Shaping a message is the job of the caller that knows what the answer is FOR.
 */
export function readStoreRecordFile(file: string): string {
	if (O_NOFOLLOW_FLAG === 0) {
		throw new MetaRecordError(
			`cannot read meta-record ${path.basename(file)} safely: this platform exposes no O_NOFOLLOW, so a record ` +
				"read cannot refuse a symlink swapped in at the final component. entwurf certifies Linux only.",
		);
	}
	const fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW_FLAG | O_NONBLOCK_FLAG);
	try {
		if (!fs.fstatSync(fd).isFile()) {
			const err = new Error(
				`meta-record ${path.basename(file)} is not a regular file (directory/fifo/device) — a record's bytes ` +
					"must live in the store itself, so this entry is never read.",
			) as Error & { code: string };
			err.code = NOT_REGULAR_ENTRY_CODE;
			throw err;
		}
		return fs.readFileSync(fd, "utf8");
	} finally {
		fs.closeSync(fd);
	}
}

/** The reader every store-WIDE scan pairs with {@link readActiveStoreEntries}. The
 * caller's entry kind decides the POLICY — whether a non-regular entry is a defect
 * (certification), a diagnostic (listing) or a non-candidate (the rival scan) — because
 * only the caller knows that. What the caller cannot know is whether the entry is still
 * that kind at the instant of the read, so {@link readStoreRecordFile} re-decides it on
 * the fd and refuses there. Snapshot kind for the verdict, fd kind for the bytes. */
export function makeStoreRecordReader(dir: string): (filename: string) => string {
	const resolved = path.resolve(expandTilde(dir));
	return (filename: string) => readStoreRecordFile(path.join(resolved, filename));
}

export function certifyActiveStoreDir(dir: string): ActiveStoreCertification & { dir: string } {
	const resolved = path.resolve(expandTilde(dir));
	return {
		dir: resolved,
		...certifyActiveStore(readActiveStoreEntries(resolved), makeStoreRecordReader(resolved)),
	};
}

/**
 * The refusal an uncertifiable ACTIVE store earns, in the words both the runtime
 * writers and the install doctor use. One prescription, both invocation forms —
 * every defect kind (previous generation, corruption, drift, duplicate, symlink)
 * is answered by archiving the generation, so there is nothing to branch on.
 */
export function activeStoreRefusal(cert: ActiveStoreCertification & { dir: string }, shown = 3): string {
	const headline =
		`meta-record store ${cert.dir} holds ${cert.defects.length} entry/entries this generation cannot certify — ` +
		`refusing to write (the active store is v3-only and carries no cross-generation continuity). ` +
		`Archive the generation and open a fresh one with ${FRESH_CUT_PRESCRIPTION}.`;
	// `shown = 0` is for a caller that ALREADY printed every cause per entry (the
	// store-doctor): repeating them here doubles the wall on a large previous
	// generation, which is exactly the aggregation lesson F8 taught. The count and
	// the prescription are said once either way.
	if (shown <= 0) return headline;
	const head = cert.defects
		.slice(0, shown)
		.map((d) => `${d.filename}: ${d.message}`)
		.join("\n  ");
	return (
		`${headline}\n  ${head}` + (cert.defects.length > shown ? `\n  … and ${cert.defects.length - shown} more` : "")
	);
}

/** One unreadable meta-record, surfaced as an explicit fact — file + message
 * ONLY, never a half-parsed identity field. A salvaged gid-looking string
 * presented as a fact is a synthetic backdoor; verbatim-or-nothing. */
export interface MetaRecordReadError {
	filename: string;
	message: string;
}

export interface ListIdentitiesResult {
	identities: MetaIdentity[];
	errors: MetaRecordReadError[];
}

/**
 * Group already-parsed identities by the id that must be unique across a store.
 * Insertion-ordered (Map), so every consumer reports rivals in the order it read them.
 *
 * Keeps the listing's duplicate pass deterministic and separate from its quarantine
 * loop. Certification and the addressable read apply the same `nativeSessionId` equality
 * rule at different granularities, but do not call this listing-specific grouping helper.
 */
function groupByNativeSessionId(identities: readonly MetaIdentity[]): Map<string, MetaIdentity[]> {
	const byNative = new Map<string, MetaIdentity[]>();
	for (const identity of identities) {
		const seen = byNative.get(identity.nativeSessionId);
		if (seen) seen.push(identity);
		else byNative.set(identity.nativeSessionId, [identity]);
	}
	return byNative;
}

/**
 * Scan every meta-record in a store into identities + explicit read errors.
 * Pure over injected (entries, readRecord) so gates drive it without IO; the
 * fact-provider (slice 4b) supplies the real readdir/readFile.
 *
 * A record that fails to parse — or whose body gardenId drifts from its filename
 * (the same authority check as `readMetaIdentityByGardenId`) — is NEITHER
 * silently skipped (that hides a broken citizen = lie by omission) NOR allowed to
 * throw the whole listing (one corrupt file must not blind `entwurf_peers` — the
 * 0.10 "corrupt blocks registration forever" lesson). It becomes an explicit
 * error entry carrying ONLY filename + message. Duplicate gardenId across files
 * is impossible: the filename IS `<gardenId>.meta.json`, so the filesystem
 * already enforces uniqueness — only body/filename drift can split authority.
 *
 * It takes {@link ActiveStoreEntry} — filename PLUS kind — for the same reason the
 * certification does: rule 1 says a symlinked record is refused and NEVER FOLLOWED, and
 * a scan handed bare names cannot obey that, because the only thing it can do next is
 * read the path. Both `entwurf_peers` bindings used to hand-roll a name-only readdir,
 * so this surface read foreign bytes through a symlink while the doctor refused the
 * same entry — one store, two contracts again. A non-regular entry is now a diagnostic
 * whose bytes are never touched.
 *
 * Store-wide UNIQUENESS of `nativeSessionId` is enforced here as well (#52) — free,
 * because this function already reads the whole store. See the loop below for why both
 * rivals become errors rather than one becoming a winner.
 *
 * mode "collect" (default) returns partial results; "strict" throws if ANY
 * record was unreadable (doctor / gate callers wanting all-or-nothing).
 */
export function listAllMetaIdentities(
	entries: readonly ActiveStoreEntry[],
	readRecord: (filename: string) => string,
	opts: { mode?: "collect" | "strict" } = {},
): ListIdentitiesResult {
	const identities: MetaIdentity[] = [];
	const errors: MetaRecordReadError[] = [];
	for (const entry of entries) {
		const filename = entry.filename;
		if (!filename.endsWith(".meta.json")) continue;
		if (!entry.regularFile) {
			errors.push({
				filename,
				message:
					"not a regular file (symlink/directory/special) — a record's bytes must live in the store " +
					"itself, so this entry is never followed and cannot name a citizen. Inspect and remove it by " +
					`hand, or archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
			});
			continue;
		}
		let identity: MetaIdentity;
		try {
			identity = parseMetaIdentity(readRecord(filename));
		} catch (err) {
			errors.push({ filename, message: err instanceof Error ? err.message : String(err) });
			continue;
		}
		const expected = filename.slice(0, -".meta.json".length);
		if (identity.gardenId !== expected) {
			errors.push({
				filename,
				message:
					`body/filename drift: body gardenId "${identity.gardenId}" ≠ filename. The body is the authority; ` +
					`this file is corrupt and a garden-id lookup can never reach it. ` +
					`Archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
			});
			continue;
		}
		identities.push(identity);
	}
	// Rule 4 of {@link certifyActiveStore}, enforced HERE too (#52). This scan already
	// holds every record in its hand, so uniqueness costs NOTHING to check — and a
	// facts surface that reports two records claiming one `nativeSessionId` as two
	// healthy citizens is describing a store the doctor calls uncertifiable as clean.
	// That is the sharpest form of the gap: not a missing guard, a WRONG FACT.
	//
	// Both rivals leave `identities` and become errors, never one winner: the store
	// genuinely cannot say which record owns that session, so picking either would
	// mint the authority the certification refuses to mint. Everyone else keeps
	// listing — the same rule an unreadable record follows, because one broken pair
	// must not blind `entwurf_peers` (the 0.10 lesson).
	for (const [nativeSessionId, holders] of groupByNativeSessionId(identities)) {
		if (holders.length < 2) continue;
		const files = holders.map((h) => metaRecordFilename(h));
		for (const holder of holders) {
			const index = identities.indexOf(holder);
			if (index >= 0) identities.splice(index, 1);
			errors.push({
				filename: metaRecordFilename(holder),
				message:
					`duplicate nativeSessionId ${JSON.stringify(nativeSessionId)} — also claimed by ` +
					`${files.filter((f) => f !== metaRecordFilename(holder)).join(", ")}. The native→garden mapping ` +
					`must be unique; this store cannot say which record owns that session, so NEITHER is listed as ` +
					`a citizen. Archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
			});
		}
	}
	if (opts.mode === "strict" && errors.length > 0) {
		throw new MetaRecordError(
			`listAllMetaIdentities(strict): ${errors.length} unreadable meta-record(s): ${errors
				.map((e) => `${e.filename} (${e.message})`)
				.join("; ")}`,
		);
	}
	identities.sort((a, b) => (a.gardenId < b.gardenId ? -1 : a.gardenId > b.gardenId ? 1 : 0));
	errors.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
	return { identities, errors };
}

export type UpsertAction = "create" | "attach";

export interface UpsertDecision {
	action: UpsertAction;
	record: MetaIdentity;
}

/**
 * The pure core of the `upsert` CLI (3D-4; v3 identity since the #50 cut). Keyed
 * on RECORD EXISTENCE, never on a backend `source` field:
 *   - existing present → ATTACH: keep identity (gardenId, createdAt,
 *     nativeSessionId), bump recordUpdatedAt, and apply the 3-value merge to the
 *     nullable axes + always-refresh cwd. Identity drift (a different backend for
 *     the same nativeSessionId) is corruption → throw.
 *   - absent → CREATE: mint a fresh v3 identity.
 *
 * 3-value attach merge (G5): for model/transcriptPath — the two nullable axes v3
 * still has — an input of `undefined` KEEPS the existing value (a pi-birth caller
 * that does not know the transcript must not wipe a previously-recorded one),
 * `null` explicitly clears it, a string sets it. cwd is required and always
 * refreshed. `parentGardenId` was a third merge axis until #50 deleted it.
 *
 * Idempotent by construction: calling it twice with the same input yields one
 * attach after the first create, never a second id. `existing` is the normalized
 * identity the caller found among the CERTIFIED records (V3-only).
 */
export function decideUpsert(
	existing: MetaIdentity | null,
	input: MetaIdentityMintInput,
	now: Date = new Date(),
): UpsertDecision {
	const backend = requireCitizenBackend(input.backend);
	const nativeSessionId = requireNonEmptyString(input.nativeSessionId, "nativeSessionId");
	const cwd = requireNonEmptyString(input.cwd, "cwd");

	if (existing === null) {
		return { action: "create", record: mintMetaIdentity(input, now) };
	}
	if (existing.nativeSessionId !== nativeSessionId) {
		throw new MetaRecordError(
			`decideUpsert called with existing record for a different nativeSessionId ` +
				`(existing="${existing.nativeSessionId}", input="${nativeSessionId}"). ` +
				`The caller must pass the certified record whose nativeSessionId equals input.nativeSessionId.`,
		);
	}
	if (existing.backend !== backend) {
		throw new MetaRecordError(
			`meta-record identity drift: nativeSessionId "${nativeSessionId}" is bound to backend ` +
				`"${existing.backend}" but upsert input says "${backend}". A native session cannot change backend.`,
		);
	}
	// 3-value merge (G5): undefined keeps existing, null clears, string sets. The
	// nullable axes are validated the same way mint validates them. v3 dropped
	// parentGardenId + isEntwurf, so only model/transcriptPath merge now.
	const model = input.model === undefined ? existing.model : requireNullableString(input.model, "model");
	const transcriptPath =
		input.transcriptPath === undefined
			? existing.transcriptPath
			: requireNullableString(input.transcriptPath, "transcriptPath");
	return {
		action: "attach",
		record: { ...existing, cwd, model, transcriptPath, recordUpdatedAt: isoNow(now) },
	};
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
 * `ENTWURF_META_SESSIONS_DIR` override wins (used by tests / unusual deployments).
 */
export function defaultMetaSessionsDir(): string {
	if (process.env.ENTWURF_META_SESSIONS_DIR) return path.resolve(expandTilde(process.env.ENTWURF_META_SESSIONS_DIR));
	return path.join(piAgentDir(), "meta-sessions");
}

/**
 * Where per-garden-id idle-wake mailboxes live: `<pi-agent-dir>/meta-mailbox`.
 * Deliberately a SIBLING of meta-sessions, not nested inside it — the record
 * store is the authority (scanned for identity) while the mailbox is volatile
 * signal/body traffic; keeping them apart means a mailbox poke never risks a
 * record-dir readdir picking up a non-record file. The watched signal for a
 * session is `<this>/<gardenId>/inbox.signal`. Same runtime resolution as
 * meta-sessions (no config baking); `ENTWURF_META_MAILBOX_DIR` overrides for tests.
 */
export function defaultMetaMailboxDir(): string {
	if (process.env.ENTWURF_META_MAILBOX_DIR) return path.resolve(expandTilde(process.env.ENTWURF_META_MAILBOX_DIR));
	return path.join(piAgentDir(), "meta-mailbox");
}

/**
 * Where native-backend SENDER markers live: `<pi-agent-dir>/meta-senders`.
 *
 * The problem this closes: a native Claude Code session that SENDS via the
 * user-scope entwurf-bridge MCP has no `PI_SESSION_ID` — at tool-call time the
 * MCP process does not know which garden-id session it belongs to, so the sender
 * envelope degrades to anonymous `external-mcp` and the receiver has no reply
 * address. The hook DOES know the garden-id (it just minted the record), and the
 * hook + the MCP child run under the SAME Claude Code owner process. Under the
 * exec-form launch contract the hook's parent IS Claude — Claude execs
 * `hook-launch.sh`, which `exec`s the hook and hands it that same pid — so the hook
 * writes the marker under `process.ppid` and the MCP reads the marker for its OWN
 * `process.ppid`. Both sides name the one owner on every host, with no shell on the
 * path to be mistaken for it and nothing to carry in an env var.
 * This uses process ancestry, NOT cwd inference (same repo / multiple sessions would
 * make cwd ambiguous). `ENTWURF_META_SENDERS_DIR` overrides for tests.
 */
export function defaultMetaSendersDir(): string {
	if (process.env.ENTWURF_META_SENDERS_DIR) return path.resolve(expandTilde(process.env.ENTWURF_META_SENDERS_DIR));
	return path.join(piAgentDir(), "meta-senders");
}

/**
 * Where native-backend RECEIVER presence markers live: `<pi-agent-dir>/meta-receivers`.
 *
 * The problem this closes (SE-2): a meta-record proves a session once EXISTED, not
 * that it is still a live receiver that a reply could reach. A self-fetch backend
 * (Claude Code) has no control socket to probe, so "is this receiver active right
 * now?" needs its own signal. The SessionStart/CwdChanged/FileChanged hook — the
 * event that actually arms the watchPaths idle-wake — writes a presence marker keyed
 * by GARDEN id (the universal address a sender targets), carrying the watch owner pid
 * + its start-key. A reader trusts it only while that pid is still the same live
 * process (start-key match); a terminated session leaves a marker whose owner is gone,
 * so it reads as inactive instead of a ghost active-receiver. UNLIKE the sender marker
 * (keyed by owner pid, a pid→garden hint), this is keyed by garden id because the
 * deliverability question starts from a target garden id. `ENTWURF_META_RECEIVERS_DIR`
 * overrides for tests.
 */
export function defaultMetaReceiversDir(): string {
	if (process.env.ENTWURF_META_RECEIVERS_DIR) return path.resolve(expandTilde(process.env.ENTWURF_META_RECEIVERS_DIR));
	return path.join(piAgentDir(), "meta-receivers");
}

/**
 * A boot-unique identity for a live process: pid is reused, but pid + start-time
 * is unique within a boot. Linux reads `/proc/<pid>/stat` field 22 (starttime in
 * clock ticks); macOS/BSD falls back to `ps -o lstart=`. Returns "" when the pid
 * is gone **or merely unreadable** (hidepid `/proc`, no `ps`) — a "" key never
 * matches, so a dead/reused owner fails the marker check. This is what stops a
 * stale marker (process exited, pid reused by a new Claude session) from granting
 * the wrong garden-id sender identity.
 *
 * READ THE RETURN VALUE FOR WHAT IT IS: "" is UNKNOWN, never "gone". For granting
 * identity that distinction is free — unknown and gone both refuse, so "" is
 * fail-CLOSED. For a destructive decision it inverts: treating "" as "the owner
 * left" is fail-OPEN, and that is how a generation cut could archive a live
 * citizen's address (caught in review 2026-07-25). Anything deciding whether an
 * owner is GONE must go through {@link classifyMarkerOwner}, never compare keys
 * itself.
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

/**
 * Does this pid exist RIGHT NOW? `true` / `false` are proofs; `null` means the
 * question could not be answered and the caller must not guess.
 *
 * `process.kill(pid, 0)` sends no signal, it only asks the kernel: success = the
 * process exists and we may signal it, `ESRCH` = definitively no such process,
 * `EPERM` = it EXISTS but belongs to someone else. `EPERM` is therefore evidence
 * of existence, never of absence — but it is not proof that it is the SAME
 * process the marker named, so it maps to `null` (unprovable), the conservative
 * side for every destructive caller.
 *
 * A non-positive pid returns `false` rather than reaching the syscall: `kill(0)`
 * and `kill(-n)` address process GROUPS, and a marker's malformed pid must never
 * become a broadcast.
 */
export function probePidExistence(pid: number): boolean | null {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as { code?: unknown }).code;
		if (code === "ESRCH") return false;
		// EPERM = alive but foreign; anything else = we simply do not know.
		return null;
	}
}

/** The observations a marker-owner verdict needs, injected so the rule stays pure. */
export interface MarkerOwnerFacts {
	/** `processStartKey(ownerPid)` — "" is UNKNOWN, never "gone". */
	currentStartKey: string;
	/** `probePidExistence(ownerPid)` — `null` = unprovable. */
	pidExists: boolean | null;
}

/**
 * `live` = proven still the same process. `dead` = proven no longer it.
 * `uncertain` = neither could be proven, so no destructive action may proceed.
 */
export type MarkerOwnerVerdict = "live" | "dead" | "uncertain";

/**
 * The two coordinate systems {@link processStartKey} can mint. They are NOT
 * comparable to each other: `linux:<starttime ticks since boot>` and `ps:<lstart
 * wall-clock text>` describe the same process with different numbers, so a
 * mismatch ACROSS schemes says nothing about whether the process changed.
 */
export type StartKeyScheme = "linux" | "ps";

/** The scheme of a start key, or `null` when it is not a key this repo mints. */
export function startKeyScheme(key: string): StartKeyScheme | null {
	if (/^linux:\d+$/.test(key)) return "linux";
	if (/^ps:.+$/.test(key)) return "ps";
	return null;
}

/**
 * CAN this pid own a native session at all? — the question one layer ABOVE
 * {@link classifyMarkerOwner}, and the one no marker consumer used to ask.
 *
 * `classifyMarkerOwner` answers "is the process this marker NAMES still the one
 * running", and for pid 1 the honest answer is YES: init is up for as long as the
 * host is, and its start-key does not change while it runs. So an `ownerPid: 1`
 * marker classifies `live` for the whole boot, and — this is the operational
 * point — THE ACTION THE REFUSAL PRESCRIBES CANNOT CHANGE THAT. Quiescing every
 * session leaves init running under the same start-key, so the operator does the
 * one thing they were told to do and the cut refuses again. (Deleting the marker
 * removes the CLAIM; it never refutes the verdict — which is exactly why the
 * affected host's only way out was a hand `rm`.) A reboot is not a dependable
 * remedy either: pid 1's key is `linux:<starttime in ticks since boot>` and init
 * starts within a few ticks, so the recorded value can simply come up again —
 * there is no contract in either direction, and this is not evidence that it must.
 * What was MEASURED (#53 A, second Linux host, 2026-07-25) is that the cut stayed
 * blocked until the file was deleted by hand, while `0.12.8` names that same cut
 * as the one repair for a pre-v3 store: the documented upgrade path had no in-band
 * exit. The pure rule is not wrong there; the marker's CLAIM is.
 *
 * WHERE SUCH A MARKER COMES FROM — stated at the size of the evidence. After this
 * fix no writer in THIS tree can mint one, so on a current install it is legacy or
 * corrupt residue. Legacy has more than one source: the retired shell-form Claude
 * hook (wrapper shell exits first → hook REPARENTED to init → reads `ppid = 1`),
 * and the agy imprint, which asked only `> 0` until #53 A and could mint the same
 * shape through the same reparenting. Corrupt is a real class too — this predicate
 * also refutes non-integer and unsafe-integer pids, which no writer here has ever
 * produced, so a foreign or damaged marker is the only way they appear. The ONE
 * file actually observed was a shell-form Claude hook reparented to init. None of
 * these is a zombie: a zombie is reaped, its pid is freed, the start-key stops
 * matching, and the marker resolves itself.
 *
 * A pid ≤ 1 is refuted BY CONSTRUCTION, which is why this predicate is shared by
 * both writers and every reader instead of living at one call site: 0 and
 * negatives address process GROUPS rather than a process (the rule
 * {@link probePidExistence} already holds), and on the axis this repo certifies no
 * native session is owned by init.
 *
 * THAT LAST CLAUSE IS A POLICY, NOT A LAW OF PROCESSES. The certified axis is a
 * Linux desktop/workstation host, where init is the service manager and every
 * native harness is a descendant of a login session. A container that runs the
 * harness AS pid 1 is a real shape in the world, and there `ownerPid: 1` would name
 * a genuine owner — so such a host is simply UNSUPPORTED here and fails CLOSED: the
 * writers refuse to mint the marker, so the session keeps its meta-record but never
 * claims reply-addressability, which costs a capability instead of granting a false
 * identity. Do not read this predicate as "pid 1 can never own anything"; read it as
 * "this repo does not certify a host where it does". Widening the axis means new
 * evidence and a new contract, not a quiet loosening of the bound.
 *
 * Writers refuse to mint it, readers refuse to honor it, and the cut treats it as
 * clearable residue rather than an owner claim — a proof of INVALIDITY, which is
 * stronger than the proof of death the cut already acts on.
 */
export function isPlausibleOwnerPid(pid: unknown): pid is number {
	return Number.isSafeInteger(pid) && (pid as number) > 1;
}

/**
 * The write-side half of {@link isPlausibleOwnerPid}. A marker naming an
 * impossible owner is not a degraded marker, it is a lie that outlives every
 * process that could refute it — so minting one THROWS rather than warns, and no
 * future writer can reintroduce #53 A by forgetting the predicate at its own call
 * site (both current writers still ask it first, and fail closed in their own
 * words).
 */
function requireOwnerPid(ownerPid: number, kind: string): number {
	if (!isPlausibleOwnerPid(ownerPid)) {
		throw new Error(
			`refusing to write a ${kind} marker for owner pid ${ownerPid}: a pid <= 1 cannot own a native session ` +
				"(pid 1 is init — a reparented orphan is not an owner). Quiescing the sessions, which is what " +
				"meta-bridge-fresh-cut asks for when it refuses, would not refute such a marker, so it would keep " +
				"blocking the cut on this host (#53 A).",
		);
	}
	return ownerPid;
}

/**
 * THE rule for "is the process this marker names still the one running?" — the one
 * place a `dead` verdict may be produced, so no caller re-derives it from
 * `processStartKey`'s ambiguous "" (see that function's contract).
 *
 *   recorded key unrecognized              → uncertain (no owner is named at all)
 *   current key "", pid proven absent      → dead      (nothing holds that pid)
 *   current key "", pid present/unprovable → uncertain
 *   current key unrecognized               → uncertain (we cannot read the owner)
 *   keys exactly equal                     → live
 *   same scheme, different value           → dead      (pid now holds another process)
 *   different schemes                      → uncertain (incomparable coordinates)
 *
 * Two rows carry the whole point. First, a MISSING current key is not absence of
 * an owner — only a definite "no such process" is (EPERM, hidepid `/proc` and a
 * missing `ps` all stay uncertain). Second, a DIFFERENT key only proves change
 * when both keys measure the same thing: a marker written while `/proc` was
 * unreadable carries `ps:…`, and the same live process reads back as `linux:…`
 * once `/proc` is available — treating that as proof of death would archive a
 * running citizen. An unrecognized key (garbage, a truncated write, a foreign
 * writer) is likewise never evidence; it is a malformed marker.
 */
export function classifyMarkerOwner(recordedStartKey: string, facts: MarkerOwnerFacts): MarkerOwnerVerdict {
	const recorded = startKeyScheme(recordedStartKey);
	if (recorded === null) return "uncertain";
	if (facts.currentStartKey === "") return facts.pidExists === false ? "dead" : "uncertain";
	const current = startKeyScheme(facts.currentStartKey);
	if (current === null) return "uncertain";
	if (facts.currentStartKey === recordedStartKey) return "live";
	return current === recorded ? "dead" : "uncertain";
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
	// Refused BEFORE the path is built: an impossible owner must not even leave a
	// backend directory behind, let alone a marker keyed to its pid.
	const ownerPid = requireOwnerPid(opts.ownerPid, "sender");
	const file = metaSenderMarkerPath(backend, ownerPid, opts.sendersDir ?? defaultMetaSendersDir());
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const marker: MetaSenderMarker = {
		backend,
		gardenId,
		nativeSessionId: requireNonEmptyString(opts.nativeSessionId, "nativeSessionId"),
		cwd: requireNonEmptyString(opts.cwd, "cwd"),
		ownerPid,
		ownerStartKey: processStartKey(ownerPid),
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
 * the bridge refuses by default (#50 C4; external-non-replyable only under the
 * explicit anonymous hatch). Never throws: an unreadable marker must not break a send.
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
		// Plausibility comes FIRST and is never opt-out: it is a property of the CLAIM,
		// not of the owner's current state, so `verifyOwner: false` (inspection) does not
		// reach past it either. An `ownerPid: 1` marker is a reparented orphan's residue
		// and would otherwise keep granting a dead citizen's sender identity for as long
		// as the host is up — the pid-reuse guard cannot catch it, because init IS still
		// the same process (#53 A). This also subsumes the old `Number.isInteger` check.
		if (!isPlausibleOwnerPid(marker.ownerPid)) return null;
		// pid-reuse guard (unless explicitly disabled): the owner pid must STILL be
		// the same process that wrote the marker. A bare pid is reused; pid+startKey
		// is boot-unique, so a stale marker from a dead session fails here instead of
		// granting a wrong-identity send.
		if (opts.verifyOwner !== false) {
			const liveKey = processStartKey(marker.ownerPid);
			if (!liveKey || liveKey !== marker.ownerStartKey) return null;
		}
		return marker;
	} catch {
		return null;
	}
}

// ── meta-receiver presence marker (SE-2 active-receiver signal) ──────────────

/**
 * The arm-capable hook events. Only these can emit watchPaths (and therefore arm
 * the idle-wake), so only these write a receiver presence marker. UserPromptSubmit
 * is deliberately absent: it can backfill the record but cannot re-arm the watch, so
 * it must NOT mint or refresh an "active receiver" claim it cannot back.
 */
export const META_RECEIVER_ARM_PROVENANCES = ["session-start", "cwd-changed", "file-changed"] as const;
export type MetaReceiverArmProvenance = (typeof META_RECEIVER_ARM_PROVENANCES)[number];

function requireArmProvenance(value: unknown): MetaReceiverArmProvenance {
	if (typeof value === "string" && (META_RECEIVER_ARM_PROVENANCES as readonly string[]).includes(value)) {
		return value as MetaReceiverArmProvenance;
	}
	throw new Error(
		`invalid armProvenance: ${JSON.stringify(value)} (expected one of ${META_RECEIVER_ARM_PROVENANCES.join(", ")})`,
	);
}

export interface MetaReceiverMarker {
	gardenId: string;
	backend: MetaBackend;
	nativeSessionId: string;
	/** The pid holding watchPaths (validated explicit hook-owner carrier = native CLI pid). */
	ownerPid: number;
	/** processStartKey(ownerPid) at write time — the dead-owner / pid-reuse guard. */
	ownerStartKey: string;
	/** The kind of process that owns the watch. Currently always the native CLI, not the plugin host. */
	ownerKind: string;
	/** Which arm-capable event wrote this presence (never user-prompt-submit). */
	armProvenance: MetaReceiverArmProvenance;
	updatedAt: string;
}

/** `<receiversDir>/<gardenId>.json` — keyed by garden id (the universal address). */
export function metaReceiverMarkerPath(gardenId: string, receiversDir: string = defaultMetaReceiversDir()): string {
	return path.join(receiversDir, `${requireGardenId(gardenId)}.json`);
}

export interface WriteMetaReceiverMarkerOptions {
	gardenId: string;
	backend: MetaBackend;
	nativeSessionId: string;
	ownerPid: number;
	armProvenance: MetaReceiverArmProvenance;
	/** Defaults to "claude-code-cli" — the watchPaths subscriber. */
	ownerKind?: string;
	receiversDir?: string;
	now?: Date;
}

/** Write (atomically) the receiver presence marker for a garden id. */
export function writeMetaReceiverMarker(opts: WriteMetaReceiverMarkerOptions): string {
	const gardenId = requireGardenId(opts.gardenId);
	const backend = requireBackend(opts.backend);
	const ownerPid = requireOwnerPid(opts.ownerPid, "receiver");
	const file = metaReceiverMarkerPath(gardenId, opts.receiversDir ?? defaultMetaReceiversDir());
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const marker: MetaReceiverMarker = {
		gardenId,
		backend,
		nativeSessionId: requireNonEmptyString(opts.nativeSessionId, "nativeSessionId"),
		ownerPid,
		ownerStartKey: processStartKey(ownerPid),
		ownerKind: requireNonEmptyString(opts.ownerKind ?? "claude-code-cli", "ownerKind"),
		armProvenance: requireArmProvenance(opts.armProvenance),
		updatedAt: isoNow(opts.now ?? new Date()),
	};
	const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	return file;
}

export interface ReadMetaReceiverMarkerOptions {
	/** Explicit marker file (test / explicit wiring). Wins over gardenId. */
	markerPath?: string;
	gardenId?: string;
	receiversDir?: string;
	/** Run the dead-owner / pid-reuse guard (verify the owner pid is still the same live process).
	 * Default true — set false only for unit assertions that inspect a marker without a live owner. */
	verifyOwner?: boolean;
}

/**
 * Read the receiver presence marker for a garden id. Returns null when absent,
 * corrupt, or (under verifyOwner) the owner pid is no longer the same live process —
 * each means "no active receiver", which the deliverability predicate turns into
 * not-deliverable. Never throws: an unreadable marker must not break a send path.
 * Record-backing is NOT checked here (the caller / predicate supplies recordBacked
 * as an explicit fact, so an absent record and a dead owner stay distinguishable).
 */
export function readMetaReceiverMarker(opts: ReadMetaReceiverMarkerOptions): MetaReceiverMarker | null {
	let file = opts.markerPath;
	if (!file && opts.gardenId) {
		file = metaReceiverMarkerPath(opts.gardenId, opts.receiversDir ?? defaultMetaReceiversDir());
	}
	if (!file || !fs.existsSync(file)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		const marker: MetaReceiverMarker = {
			gardenId: requireGardenId(raw.gardenId),
			backend: requireBackend(raw.backend),
			nativeSessionId: requireNonEmptyString(raw.nativeSessionId, "nativeSessionId"),
			ownerPid: typeof raw.ownerPid === "number" ? raw.ownerPid : Number.NaN,
			ownerStartKey: requireNonEmptyString(raw.ownerStartKey, "ownerStartKey"),
			ownerKind: requireNonEmptyString(raw.ownerKind, "ownerKind"),
			armProvenance: requireArmProvenance(raw.armProvenance),
			updatedAt: requireNonEmptyString(raw.updatedAt, "updatedAt"),
		};
		// Same rule as the sender marker, and for the same reason one layer over: an
		// impossible owner is not a live one, so a refuted marker must never read back
		// as an ACTIVE RECEIVER and pull the mailbox rail into delivering to a void.
		if (!isPlausibleOwnerPid(marker.ownerPid)) return null;
		if (opts.verifyOwner !== false) {
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
	now?: Date;
}

export interface UpsertMetaSessionResult {
	action: UpsertAction;
	record: MetaIdentity;
	dir: string;
	/** Absolute path of the written record. */
	path: string;
}

/**
 * Idempotent fs upsert (writes v3 identity). CERTIFY the whole active store, then
 * decide create-vs-attach on record EXISTENCE and write atomically as v3. On
 * attach the file is the existing garden id's record (same path, rewritten in
 * place); on create it is a fresh `<gardenId>.meta.json`.
 *
 * STRICT STORE (the guard boundary): every writer — pi birth, the Claude hook,
 * agy imprint, `entwurf_register_native` — funnels through here, so this is where
 * the generation policy has teeth, and it holds the SAME contract the install
 * doctor holds ({@link certifyActiveStore}): regular files, live schema, no
 * body/filename drift, globally unique `nativeSessionId`. Any defect fails the
 * WHOLE upsert BEFORE any write, naming the fresh-cut verb. Ordinary runtime
 * never writes around an uncertifiable store — the operator cuts a fresh
 * generation, once, and it is clean again.
 *
 * A narrower scan is not a smaller version of this: asking only about MY
 * `nativeSessionId` writes happily beside a drifted or duplicated record that the
 * doctor refuses, which is how a host ends up certified by one surface and not
 * the other. The write is tmp-file + rename so a crash never leaves a
 * half-written record (#30 crash-safety).
 */
export function upsertMetaSession(opts: UpsertMetaSessionOptions): UpsertMetaSessionResult {
	const dir = path.resolve(expandTilde(opts.dir ?? defaultMetaSessionsDir()));
	fs.mkdirSync(dir, { recursive: true });
	const cert = certifyActiveStoreDir(dir);
	if (cert.defects.length > 0) throw new MetaRecordError(activeStoreRefusal(cert));
	const target = requireNonEmptyString(opts.input.nativeSessionId, "nativeSessionId");
	const existing = cert.records.find((record) => record.identity.nativeSessionId === target)?.identity ?? null;
	const decision = decideUpsert(existing, opts.input, opts.now);
	const file = path.join(dir, metaRecordFilename(decision.record));
	atomicWriteIdentity(file, decision.record);
	return { action: decision.action, record: decision.record, dir, path: file };
}

/** tmp-file + rename so a crash never leaves a half-written record (v3 identity write). */
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
//                      (receipt stamped in mailbox state). The poke is what the plugin's FileChanged
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

/** What an lstat says about a record path — the ENTRY ITSELF, never its link target. */
type RecordEntryKind = "absent" | "regular-file" | "irregular";

/**
 * The one place a targeted record path is inspected, separating the three answers a
 * routing decision actually needs.
 *
 * `absent` is reserved for **ENOENT alone**. Every other errno — EACCES, ELOOP,
 * ENOTDIR (a store whose shape is broken), ENAMETOOLONG — means the entry could not be
 * inspected, and reporting "no such citizen" there would launder an inspection FAILURE
 * into a clean negative: `entwurf_v2` would call an unreadable store a soft
 * `bad-target` instead of failing loud. Unknown fails loud here, the same rule the
 * marker verdicts and the socket probe hold.
 *
 * lstat, never stat, so a symlink is classified as what it is rather than silently
 * resolved into bytes this store does not own.
 */
function inspectRecordEntry(file: string): RecordEntryKind {
	try {
		return fs.lstatSync(file).isFile() ? "regular-file" : "irregular";
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") return "absent";
		throw recordInspectionFailure(file, err);
	}
}

/**
 * How a FAILED record read is classified when the entry was already snapshotted as a
 * regular file — that is, a race: the entry changed between the classification and the
 * open. Pure, errno-only, so the branch a synthetic errno takes is exactly the branch a
 * real one takes (the 2026-07-26 cross-review found the previous shape unprovable: with
 * the classification in front of it, no settled store could reach these branches at all,
 * and a cell that claimed to pin them passed with the mapping deleted).
 *
 * Every verdict here collapses onto the answer the SETTLED store already gives, because a
 * race must not teach the operator a second vocabulary for one state of the world:
 *
 *   - `ENOENT`  — the record went away mid-read. Absence, and absence alone.
 *   - `ELOOP`   — `O_NOFOLLOW` refused a symlink at the final component.
 *   - `ENXIO`   — a socket (or a device with no driver behind it) is what the name now
 *                 points at. `lstat` calls that irregular, so an open that trips over it
 *                 must say the same thing rather than "this host is unreadable".
 *   - {@link NOT_REGULAR_ENTRY_CODE} — the fd opened, and `fstat` says it is a directory
 *                 or a fifo.
 *   - anything else (EACCES, ENOTDIR, EIO…) — an inspection FAILURE, which stays loud and
 *                 must never be laundered into a clean "no such citizen".
 */
export type RecordReadFailure = "absent" | "irregular" | "unreadable";

export function classifyRecordReadFailure(code: unknown): RecordReadFailure {
	if (code === "ENOENT") return "absent";
	if (code === "ELOOP" || code === "ENXIO" || code === NOT_REGULAR_ENTRY_CODE) return "irregular";
	return "unreadable";
}

/** The three refusals a targeted read can reach from EITHER layer — the settled
 * classification or a raced read. One text each, so a race and a quiet store say the same
 * sentence to the operator. */
function recordInspectionFailure(file: string, err: unknown): MetaRecordError {
	return new MetaRecordError(
		`cannot inspect meta-record ${path.basename(file)} under ${path.dirname(file)}: ` +
			`${err instanceof Error ? err.message : String(err)}. That is an inspection failure, not an absent ` +
			`citizen — refusing to report "no record" from a store this process cannot read.`,
	);
}
function absentRecordRefusal(id: string, file: string): MetaRecordError {
	return new MetaRecordError(
		`no meta-record for garden id "${id}" under ${path.dirname(file)} — not a garden citizen, cannot deliver.`,
	);
}
function irregularRecordRefusal(id: string): MetaRecordError {
	return new MetaRecordError(
		`meta-record ${id}.meta.json is not a regular file (symlink/directory/special) — a record's bytes must ` +
			`live in the store itself, so this entry is never followed and cannot address a citizen. ` +
			`Inspect and remove it by hand, or archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
	);
}

/**
 * The identity read-by-gardenId. Read the file, body is SSOT, fail-fast on
 * body/filename gardenId drift; V3-only via parseMetaIdentity (an unreadable
 * record throws, naming fresh-cut). This is what the live path uses (enqueue/read,
 * the MCP sender-marker check).
 */
export function readMetaIdentityByGardenId(
	gardenId: string,
	sessionsDir: string = defaultMetaSessionsDir(),
): MetaIdentity {
	const id = requireGardenId(gardenId);
	const file = recordFileFor(sessionsDir, id);
	// TWO LAYERS, AND THEY ARE NOT THE SAME RULE TWICE.
	//
	// Layer 1 — POLICY, on a settled store. Rule 1 of {@link certifyActiveStore}, enforced
	// HERE too, because this is the one place a live dispatch reads a record. Certifying
	// the store on WRITE while this read followed the link made the contract true only
	// where nobody was being addressed: the doctor refused a symlinked entry that v2
	// dispatch, `entwurf_self` and the sender-marker trust all resolved happily, from bytes
	// the store does not own (2026-07-25 fresh-eyes review). It classifies WITHOUT OPENING,
	// which is the point — a socket, a device, a mode-000 directory each earn the
	// certification's own sentence instead of whatever errno an `open` would have tripped
	// over (ENXIO, EACCES), and nothing special is opened to find out what it is. Deleting
	// this layer in favour of the fd alone looked like removing a duplicate enforcement
	// point and was actually a regression on all three shapes (2026-07-26 cross-review,
	// round 3 — found by GPT, reproduced here).
	//
	// Layer 2 — the RACE, on the bytes actually returned. A verdict about a name stops
	// being true the moment something replaces what the name points at, so the read
	// re-decides on its own fd. Its errno verdicts collapse onto layer 1's sentences via
	// {@link classifyRecordReadFailure}, which is pure so that the branches stay provable:
	// with layer 1 in front of it, no settled store can reach them.
	const kind = inspectRecordEntry(file);
	if (kind === "absent") throw absentRecordRefusal(id, file);
	if (kind === "irregular") throw irregularRecordRefusal(id);
	let raw: string;
	try {
		raw = readStoreRecordFile(file);
	} catch (err) {
		if (err instanceof MetaRecordError) throw err;
		switch (classifyRecordReadFailure((err as { code?: unknown }).code)) {
			case "absent":
				throw absentRecordRefusal(id, file);
			case "irregular":
				throw irregularRecordRefusal(id);
			default:
				throw recordInspectionFailure(file, err);
		}
	}
	const identity = parseMetaIdentity(raw);
	if (identity.gardenId !== id) {
		throw new MetaRecordError(
			`meta-record body/filename drift: ${id}.meta.json contains gardenId "${identity.gardenId}". ` +
				`The body is the authority; this file is corrupt and a garden-id lookup can never reach it. ` +
				`Archive the generation with ${FRESH_CUT_PRESCRIPTION}.`,
		);
	}
	return identity;
}

/**
 * Probe-free existence check for a garden citizen's meta-record. Used by the 5d
 * entwurf_v2 production `resolveTarget`: a MISSING record is a soft `bad-target`
 * (identity:null), but a PRESENT-but-corrupt record must fail loud — so the producer
 * checks here FIRST and only calls `readMetaIdentityByGardenId` when this returns true,
 * leaving drift/corruption as the lone throw (never matched by message string).
 * Validates the gid (F2-P1) like its read sibling.
 *
 * It shares {@link inspectRecordEntry} with that sibling for one reason: `existsSync`
 * answers `false` for an entry it merely could not stat (EACCES on the store, ELOOP),
 * which turned an unreadable store into a soft `bad-target` — a clean-looking "no such
 * citizen" for a host that is actually broken. An entry that EXISTS but is not a
 * regular file also answers `true` here, so the refusal comes from the read (loud, with
 * a cause) rather than from a silent negative.
 */
export function metaRecordExistsByGardenId(gardenId: string, sessionsDir: string = defaultMetaSessionsDir()): boolean {
	const id = requireGardenId(gardenId);
	return inspectRecordEntry(recordFileFor(sessionsDir, id)) !== "absent";
}

/**
 * Pure: which OTHER records in this store claim `identity`'s `nativeSessionId`.
 * Returns their filenames, sorted; empty means `identity` holds it alone.
 *
 * A RIVAL IS A RECORD THAT COULD BE ADDRESSED INSTEAD. That is the whole test, and it
 * is narrower than "a file whose bytes mention the same id" — three neighbour shapes
 * are therefore NOT candidates, and skipping them is a claim about reachability, not
 * leniency:
 *
 *   - NON-REGULAR (symlink/dir/special): rule 1 of {@link certifyActiveStore} says such
 *     an entry is refused and never followed, because its bytes live where this store
 *     has no ownership. So it is skipped WITHOUT BEING READ — following it to see
 *     whether it "counts" would break the rule in the act of enforcing it, and let a
 *     planted symlink to foreign bytes quarantine a healthy citizen.
 *   - BODY/FILENAME DRIFT: a record whose body names a different garden id is
 *     unreachable by garden-id lookup from either name, so it can never be dispatched
 *     to and cannot compete for an address.
 *   - UNPARSEABLE by the live schema: same reason — no read path can reach it.
 *
 * All three are real certification defects, and the certification and the listing both
 * say so. What they must not do is blind a healthy citizen, which is the 0.10 "corrupt
 * blocks registration forever" mistake wearing a new hat.
 *
 * A CANDIDATE WE COULD NOT READ IS A DIFFERENT ANSWER AND THROWS. A regular
 * `.meta.json` this process cannot read might be a genuine duplicate; skipping it would
 * report "holds it alone" from a scan that never asked, which is exactly the vacuous
 * pass the store-level readdir guard refuses one level up. ENOENT is the one exception
 * and the one this repo already recognises everywhere (`inspectRecordEntry`, the cut's
 * socket walk, `clearFiles`): a file that vanished between the readdir and the read is
 * not in the store, so it holds nothing.
 *
 * The identity's OWN file is excluded by filename, not by identity equality: the caller
 * has already proven body and filename agree, and a rival is by definition a different
 * file.
 */
export function nativeSessionIdRivals(
	identity: MetaIdentity,
	entries: readonly ActiveStoreEntry[],
	readRecord: (filename: string) => string,
): string[] {
	const own = metaRecordFilename(identity);
	const rivals: string[] = [];
	for (const entry of entries) {
		const filename = entry.filename;
		if (!filename.endsWith(".meta.json") || filename === own) continue;
		if (!entry.regularFile) continue; // never followed — see rule 1 above
		let raw: string;
		try {
			raw = readRecord(filename);
		} catch (err) {
			if ((err as { code?: unknown }).code === "ENOENT") continue; // raced away — holds nothing
			throw new MetaRecordError(
				`cannot read meta-record ${filename} while proving that ${own} holds nativeSessionId ` +
					`${JSON.stringify(identity.nativeSessionId)} alone: ` +
					`${err instanceof Error ? err.message : String(err)}. That record may be a duplicate, so this ` +
					`is an unanswered question, not a clean scan — refusing to dispatch at an address this process ` +
					`cannot certify.`,
			);
		}
		let other: MetaIdentity;
		try {
			other = parseMetaIdentity(raw);
		} catch {
			continue; // unreachable by the live schema — not an addressable rival
		}
		if (metaRecordFilename(other) !== filename) continue; // drifted — unreachable by garden id
		if (other.nativeSessionId === identity.nativeSessionId) rivals.push(filename);
	}
	return rivals.sort();
}

/**
 * The read a DISPATCH does (#52) — the targeted read PLUS the store-wide half of the
 * contract that a targeted read cannot see on its own.
 *
 * WHY THIS IS A SECOND FUNCTION AND NOT A CHANGE TO {@link readMetaIdentityByGardenId}:
 * the cost is real and the README says so out loud — a call-relay does not re-scan the
 * whole store per message, and the mailbox poke, the sender-marker trust and
 * `entwurf_self` keep the per-entry half exactly as before. What separates the callers
 * is not how careful they are, it is what they DO with the answer: these two turn
 * `nativeSessionId` into an ADDRESS — a native-push injection into a live conversation,
 * a pi resume against a transcript — and each does it ONCE per dispatch, next to a
 * socket connect and a process spawn. One readdir there is nothing; the same readdir
 * per relayed message is the design the store deliberately does not have.
 *
 * The failure it prevents is not hypothetical corruption. `upsertMetaSession` certifies
 * and then writes, which is not a transaction: two concurrent births — two SessionStart
 * hooks, an `entwurf_register_native` racing an agy imprint — can both read one clean
 * snapshot and mint DIFFERENT garden ids for one native session. Nothing was ever
 * corrupted on such a host, and yet both ids would direct-inject the same conversation,
 * or resume one transcript twice under two per-garden-id locks.
 *
 * Fails LOUD, never soft: a duplicate is corruption of the address space, and QB1
 * reserves the soft `bad-target` answer for a record that is simply ABSENT.
 */
export function readAddressableMetaIdentity(
	gardenId: string,
	sessionsDir: string = defaultMetaSessionsDir(),
): MetaIdentity {
	const identity = readMetaIdentityByGardenId(gardenId, sessionsDir);
	const dir = path.resolve(expandTilde(sessionsDir));
	// Entries carry their KIND (readActiveStoreEntries), so the rival scan can refuse a
	// symlinked neighbour without reading it. A bare-name readdir here would have made
	// rule 1 unenforceable at exactly the surface that turns a record into an address.
	// A store that cannot be listed throws from there — answering "unique" from a scan
	// that never happened is the vacuous pass this whole check exists to refuse.
	const rivals = nativeSessionIdRivals(identity, readActiveStoreEntries(dir), makeStoreRecordReader(dir));
	if (rivals.length > 0) {
		throw new MetaRecordError(
			`meta-record ${metaRecordFilename(identity)} shares nativeSessionId ` +
				`${JSON.stringify(identity.nativeSessionId)} with ${rivals.join(", ")} — the native→garden mapping ` +
				`must be unique, so this store cannot say which record owns that session and dispatching at either ` +
				`garden id would reach the same native session twice. Archive the generation with ` +
				`${FRESH_CUT_PRESCRIPTION}.`,
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
	// 3D-4: read IDENTITY (V3-only) — confirms the citizen exists and
	// normalizes the gardenId. The record is no longer mutated; the identity record
	// carries no delivery, so the enqueue receipt lives SOLELY in the mailbox state store.
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
	// (there is no `record.delivery` on the identity record). No record write. Stamped before the
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
	// 3D-4: read IDENTITY (V3-only) — citizen-existence + normalized gardenId. The
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
// mailbox receipt state — the receipt authority (0.11 Stage 0 3B)
//
// The read-receipt lives at `<meta-mailbox>/<gardenId>/state.json` — a SIBLING of
// the inbox.signal/.msg traffic it accounts for, so the receipt sits with the
// mailbox (volatile delivery bookkeeping), not with identity. It used to live at
// `record.delivery.lastReadAt`; 3A/3B built this home FIRST because the record
// could not drop `delivery{}` before its replacement existed (NEXT.md 고정순서
// 4: "delivery 제거 전 mailbox receipt state schema 먼저 못박음 ... 대체 state
// 없이 제거 금지"). 3D-4 then made that removal, and #50 carried it into v3:
// there is no receipt slot on the record at all any more.
//
// This block is the SCHEMA + STORE. The live enqueue/read path re-wire landed in
// 3D-4 (the dual-write era is over — the state store is the sole receipt
// authority; see `enqueueMetaMessage`/`readMetaInbox` below).
// wakeMode/deliveryLevel are NOT here — those are capability, not receipt (3C).
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
