/**
 * meta-migration — the FROZEN v1/v2 legacy readers, isolated OUT of the V3-only
 * production path (#50 schema hard cut).
 *
 * meta-session.ts is now V3-only: normal routing mints, serializes, reads and
 * validates schemaVersion-3 identities and nothing else. The v2 parser + keyset
 * that used to live there are FROZEN here — v2 is a closed schema (it will never
 * gain a field again), so this snapshot is the stable base the M1 operator
 * command (scripts/meta-bridge-migrate-v3.ts: backup → migrate → verify
 * non-V3=0 → restore) reads a pre-cut store through. C1 only ISOLATED these
 * readers; the M1 surface is the sole consumer that runs a migration, and it
 * never deletes the v2 parser.
 *
 * IMPORT ALLOWLIST (check-meta-migration-readers): the frozen readers
 * (`parseMetaRecordV1`, `parseMetaRecordV2`, `META_IDENTITY_V2_KEYS`, the frozen
 * shapes) may be imported ONLY by the M1 operator surface and its gate. A
 * normal-routing file importing this module is the exact regression the hard cut
 * forbids — the whole point of V3-only production is that the legacy reader has
 * one address, here, reachable only through M1.
 *
 * Validation primitives are imported from meta-session.ts (the `.ts`-extension
 * fence: this is a lib→lib VALUE importer, so it is excluded from the emit-capable
 * root tsconfig and typechecked by scripts/tsconfig.json via its gate) so the
 * legacy reader can never drift from the production validators.
 */

import {
	describe,
	META_SCHEMA_VERSION_V2,
	type MetaBackend,
	type MetaBackendV2,
	MetaRecordError,
	metaCapabilityFor,
	requireBackend,
	requireBackendV2,
	requireBoolean,
	requireGardenId,
	requireNonEmptyString,
	requireNullableGardenId,
	requireNullableString,
	type WakeMode,
} from "./meta-session.ts";

// ---------------------------------------------------------------------------
// v1 — the original pointer record (delivery aspect embedded), FROZEN
// ---------------------------------------------------------------------------

/** The v1 schema number. Frozen: only the migration surface may read v1. */
export const META_SCHEMA_VERSION = 1 as const;

/**
 * The v1 read-receipt aspect (delivery bookkeeping embedded in the record).
 * v2 moved receipts to the mailbox state store; this shape survives only so M1
 * can read a pre-v2 record.
 */
export interface MetaDelivery {
	wakeMode: WakeMode;
	deliveryLevel: string;
	lastEnqueuedAt: string | null;
	lastDeliveredAt: string | null;
	lastReadAt: string | null;
}

/** The v1 opaque pointer record — FROZEN. Body is SSOT; never parse the filename. */
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

/** Parse + fully validate untrusted JSON text into a v1 MetaRecord. Throws on any drift. */
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
	// wakeMode is backend-DETERMINED; a record whose stored wakeMode contradicts
	// its backend is corrupt. Canonical comes from the capability registry seam —
	// the SAME seam production used when this parser was live, so the frozen
	// reader cannot drift from the capability contract.
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

/** Explicit v1 name, symmetric with `parseMetaRecordV2` at M1 call sites. */
export const parseMetaRecordV1 = parseMetaRecord;

// ---------------------------------------------------------------------------
// v2 — the identity-only shape, FROZEN
// ---------------------------------------------------------------------------

/**
 * The v2 identity shape (11 fields) — FROZEN. v3 is exactly this minus
 * `parentGardenId` + `isEntwurf` (#50: Call ≠ parentage, no `isEntwurf` species
 * boolean). Kept verbatim so the migration reader round-trips a pre-cut record
 * byte-for-byte before the M1 lane maps it to v3.
 */
export interface MetaIdentityV2 {
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

/**
 * The EXACT key set a v2 identity record may carry (frozen against the ledger
 * jsonc). The v2 parser is strict: any key outside this set — including stale v1
 * fields (`delivery`/`lastSeen`) — is a half-migrated / corrupt record and must
 * fail-fast. This constant is HALF of the strayness invariant: the v3 parser in
 * meta-session.ts must REJECT `parentGardenId`/`isEntwurf` as stray, and this
 * keyset must keep ACCEPTING them, so a record is legible to exactly one schema.
 */
export const META_IDENTITY_V2_KEYS: readonly string[] = [
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

/** Parse + fully validate untrusted JSON into a v2 identity. Throws on any drift. */
export function parseMetaRecordV2(json: string): MetaIdentityV2 {
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
	// key. A v2 record carrying v1 leftovers is half-migrated/corrupt — surface it.
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
