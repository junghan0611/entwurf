/**
 * pi-durable OWNER FENCE (#157 B3, pre-release fence) — the claim an owned pi-durable open takes inside its
 * native session directory D BEFORE the native lease (proper-lockfile's `${D}.lock`), and carries through
 * storage open and close.
 *
 * WHAT THIS IS. Three fixed names inside D, never derived from the session id and never under the SDK's
 * `session.sqlite` prefix:
 *   - `entwurf-owner.json` — the claim: one regular file, replaced by tmp+rename, read no-follow;
 *   - `entwurf-owner.tx` — the transaction mutex S_D, created `wx`; its body is evidence only;
 *   - `entwurf-owner.json.tmp-<pid>-<hex>` — the atomic temp a write renames into place.
 * Every claim write — the first creation of an absent claim included — happens inside ONE S_D hold, on a
 * decision read inside that hold; an owner's own transition also requires the generation it last wrote.
 * The holder unlinks only the tx it created, in `finally`. A tx it did not create (another holder, or crash
 * residue) is never removed, taken over or aged out: there is no TTL, no mtime rule and no cleanup verb.
 *
 * WHAT IT GUARANTEES. Mutual exclusion among PARTICIPATING owned openers only. It does not prove that no
 * foreign lease exists, and it does not make a legacy or non-participating opener safe (an opener with
 * neither a fence nor a lease is invisible to it). A `closed` claim is a participating owner's end receipt in
 * one of two rows; it is not "untouched since", not dormancy and not public-resume evidence, and neither is
 * `firstParticipation`, which records the first participation attempt for D, not a completed enrollment.
 *
 * SCHEMA. A new admission writes schema 2, whose `selected` also carries `profile`: the agent directory exactly as
 * the owned open's `getAgentDir()` returned it, the value its `directory` was joined from. A schema 1 claim (the
 * pre-profile build: `selected` is `{n, directory}`) is still read, and every admission row judges it as before; its
 * profile is never inferred, and it is replaced only by the next admission's own claim, never rewritten to migrate.
 * Schema 2 alone knows `reserved` with its `reservation`, and `adoptedFrom`; an older reader refuses schema 2, so the
 * rollout is complete only once every participating reader is this one.
 *
 * RESERVATION (#157 B3 I-2). A parent reserves one citizen's D for one child (`reservePiDurableSession`), the child
 * adopts exactly that reservation (`createPiDurableOwnerFence({adoption})`), and only the parent withdraws its own
 * (`withdrawPiDurableReservation`). The reserve and the adoption take record-arm(gid), then S_D(R), on the record and
 * C4 pair read inside the arm hold; the withdrawal takes S_D only. A parent's per-target lock is its caller's outer
 * scope and is never taken here. The claim and S_D live in R, the physical D; the SDK's lease is `${S}.lock`, S being
 * the donor's own selection, and every lease snapshot is taken there. `observePiDurableReservation` is a read, never a
 * watch.
 *
 * DEATH POLICY stays in meta-session.ts (Hard Rule 14): `classifyMarkerOwner` over `processStartKey` and
 * `probePidExistence`, plus `isPlausibleOwnerPid`. A live or uncertain owner — this very process included — is
 * refused; only a proven-dead owner on this host is reclaimed, and an unattributed lease that is present is
 * never presumed to be the dead owner's.
 *
 * The owned app (pi/pi-durable/src/experimental/durable/sessions.ts) declares the `SessionFence` and
 * `FenceTicket` shapes this module implements, type-only and without importing Entwurf; the packaged
 * bootstrap builds one fence from the compiled twin of this file and hands it to every owned open.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireLock, type LockClaim, releaseLock } from "./entwurf-v2-lock.ts";
import {
	classifyMarkerOwner,
	defaultMetaRecordArmLocksDir,
	isPlausibleOwnerPid,
	type MetaIdentity,
	probePidExistence,
	processStartKey,
	readStoreRecordFile,
	requireAttachIncarnation,
	requireGardenId,
} from "./meta-session.ts";
import { type PiDurableLocation, verifyPiDurableLocation } from "./pi-durable-location.ts";

export const PI_DURABLE_OWNER_CLAIM = "entwurf-owner.json";
export const PI_DURABLE_OWNER_TX = "entwurf-owner.tx";
export const PI_DURABLE_OWNER_TMP_PREFIX = `${PI_DURABLE_OWNER_CLAIM}.tmp-`;
/** The schema a new admission writes: `selected` is `{n, directory, profile}`. */
export const PI_DURABLE_OWNER_SCHEMA_VERSION = 2;
/** The pre-profile schema, still read and never written: `selected` is `{n, directory}`. */
const LEGACY_SCHEMA_VERSION = 1;

/** The bounded wait for S_D: 20 attempts 100 ms apart, then `tx-held`. */
const TX_ATTEMPTS = 20;
const TX_DELAY_MS = 100;
const CAUSE_MAX = 512;
const HEX32 = /^[0-9a-f]{32}$/;

/** The states an owned open's own lifetime writes. */
export type PiDurableNativeState = "fenced" | "leased" | "storage-open" | "closed" | "close-failed";
/** Schema 2 adds `reserved`: a parent's hold of D for one child, never an owned open's own state. */
export type PiDurableOwnerState = PiDurableNativeState | "reserved";
/** `${S}.lock` as a reserve saw it, S being the donor's own selection. */
export type PiDurableNativeLease = "absent" | "present-attributed";
export type PiDurableLeaseOutcome = "never-held" | "held" | "released" | "failed" | "unknown";
export type PiDurableStorageEnd = "closed" | "never-opened" | "failed" | "unknown";
export type PiDurableParticipation = "fresh" | "unarmed-existing";

export interface PiDurableOwner {
	readonly pid: number;
	readonly startKey: string;
	readonly hostname: string;
}

/** An owner's end as the opener observed it; `at` is added when it is written. */
export interface PiDurableOwnerEnd {
	readonly storage: PiDurableStorageEnd;
	readonly lease: PiDurableLeaseOutcome;
	readonly envCleanup?: "failed";
	readonly cause?: string;
}

export interface PiDurableOwnerClaim {
	readonly schemaVersion: typeof PI_DURABLE_OWNER_SCHEMA_VERSION | 1;
	readonly resource: string;
	/** Schema 2 also carries `profile`, the agent directory `directory` was joined from, exactly as it was read. */
	readonly selected: { readonly n: string; readonly directory: string; readonly profile?: string };
	readonly state: PiDurableOwnerState;
	readonly owner: PiDurableOwner;
	readonly generation: string;
	readonly firstParticipation: {
		readonly at: string;
		readonly generation: string;
		readonly from: PiDurableParticipation;
	};
	readonly reclaimedFrom?: {
		readonly generation: string;
		readonly state: PiDurableOwnerState;
		readonly owner: PiDurableOwner;
		readonly leaseOutcome: PiDurableLeaseOutcome;
	};
	readonly lease: PiDurableLeaseOutcome;
	readonly end?: PiDurableOwnerEnd & { readonly at: string };
	/** Schema 2, `reserved` only: the reservation this parent holds D under. */
	readonly reservation?: PiDurableReservationBody;
	/** Schema 2: the reservation this owner adopted D from; kept through its own transitions only. */
	readonly adoptedFrom?: { readonly generation: string; readonly owner: PiDurableOwner };
	readonly writtenAt: string;
}

/** The last native owner a reservation was taken from: one flat row, never a reservation, adoption or reclaim. */
export interface PiDurableDonor {
	readonly generation: string;
	readonly state: PiDurableNativeState;
	readonly owner: PiDurableOwner;
	readonly lease: PiDurableLeaseOutcome;
	readonly end?: PiDurableOwnerEnd & { readonly at: string };
	readonly selected: PiDurableOwnerClaim["selected"];
}

/** A parent's reservation of D for one child, written only on a `reserved` claim. */
export interface PiDurableReservationBody {
	readonly gardenId: string;
	readonly n: string;
	readonly cwd: string;
	readonly resource: string;
	/** The donor's raw profile: the child's SDK is started with exactly this value. */
	readonly profile: string;
	/** The record's binding when the reservation was taken. */
	readonly attachIncarnation: string;
	readonly nativeLease: PiDurableNativeLease;
	readonly from: PiDurableDonor;
}

/** What an owned open hands the fence after it chose D and before it takes the native lease. */
export interface PiDurableOwnerAdmission {
	/** D exactly as this opener selected it (pre-canonical; its lease is `${directory}.lock`). */
	readonly directory: string;
	/** The session id N this opener selected D by. */
	readonly selectedN: string;
	/** The opener's own `mkdir(D)` created D in this call. */
	readonly created: boolean;
	/** The agent directory exactly as the opener's `getAgentDir()` returned it, the value `directory` was joined from. */
	readonly profile: string;
}

/** One admitted owner, kept in memory between its checkpoints (the app's `FenceTicket`). */
export interface PiDurableOwnerTicket {
	/** Set by the opener immediately before it calls the storage open; never written to the claim. */
	storageOpenAttempted: boolean;
	/** fenced → leased: the native lease was acquired. */
	leased(): Promise<void>;
	/** leased → storage-open: the storage open and the Harness open both resolved. */
	storageOpened(): Promise<void>;
	/** → closed, in exactly one of the two allowed end rows. */
	closed(end: PiDurableOwnerEnd): Promise<void>;
	/** → close-failed: anything that is not a verified end. */
	closeFailed(end: PiDurableOwnerEnd): Promise<void>;
	/** fenced → closed {never-opened, never-held}: the lease was not acquired. */
	endUnleased(): Promise<void>;
}

/** The fence an owned open takes before its native lease (the app's `SessionFence`). */
export interface PiDurableOwnerFence {
	admit(request: PiDurableOwnerAdmission): Promise<PiDurableOwnerTicket>;
}

export type PiDurableOwnerFenceReason =
	| "admission-invalid"
	| "directory-invalid"
	| "owner-pid-implausible"
	| "owner-start-key-unreadable"
	| "tx-held"
	| "tx-release-failed"
	| "legacy-lease-present"
	| "owner-live"
	| "owner-uncertain"
	| "owner-other-host"
	| "lease-unattributed"
	| "claim-unreadable"
	| "claim-resource-mismatch"
	| "claim-missing"
	| "generation-mismatch"
	| "transition-invalid"
	| "reservation-invalid"
	| "reserve-meta-root-split"
	| "record-arm-busy"
	| "record-arm-release-failed"
	| "binding-mismatch"
	| "profile-record-unbound"
	| "profile-other-host"
	| "profile-unattributed"
	| "profile-n-mismatch"
	| "profile-layout-mismatch"
	| "profile-alias-moved"
	| "reserve-unarmed"
	| "reserve-not-clean"
	| "lease-appeared"
	| "adopt-not-reserved"
	| "adopt-generation-mismatch"
	| "adopt-binding-changed"
	| "adopt-reservation-mismatch"
	| "adopt-profile-mismatch"
	| "adopt-lease-appeared"
	| "withdraw-not-own";

export class PiDurableOwnerFenceError extends Error {
	readonly reason: PiDurableOwnerFenceReason;
	constructor(reason: PiDurableOwnerFenceReason, message: string) {
		super(`${reason}: ${message}`);
		this.name = "PiDurableOwnerFenceError";
		this.reason = reason;
	}
}

function refuse(reason: PiDurableOwnerFenceReason, message: string): PiDurableOwnerFenceError {
	return new PiDurableOwnerFenceError(reason, message);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** What a launched child carries to adopt ONE reservation (#157 B3), decoded by its caller: its closed set only. */
export interface PiDurableAdoption {
	readonly gardenId: string;
	/** ONE absolute meta root; the four roots are its standard children. */
	readonly metaRoot: string;
	/** The reservation's generation g_r: matching data, never removal authority. */
	readonly sourceGeneration: string;
}

export interface PiDurableOwnerFenceOptions {
	readonly adoption?: PiDurableAdoption;
}

/**
 * The fence an owned open takes. Building it reads and writes nothing; every check happens at `admit`. With an
 * adoption, `admit` adopts exactly that reservation or refuses; it never falls back to an ordinary admission.
 */
export function createPiDurableOwnerFence(options: PiDurableOwnerFenceOptions = {}): PiDurableOwnerFence {
	if (options.adoption === undefined) return { admit: (request) => admitOwner(request) };
	const adoption = requireAdoption(options.adoption);
	return { admit: (request) => adoptOwner(request, adoption) };
}

// ── The claim's schema and its state × lease × end table ─────────────────────────────────────────

const NATIVE_STATES: readonly PiDurableNativeState[] = ["fenced", "leased", "storage-open", "closed", "close-failed"];
/** Schema 2's states; schema 1 knows only the native ones. */
const STATES: readonly PiDurableOwnerState[] = [...NATIVE_STATES, "reserved"];
const NATIVE_LEASES: readonly PiDurableNativeLease[] = ["absent", "present-attributed"];
const LEASES: readonly PiDurableLeaseOutcome[] = ["never-held", "held", "released", "failed", "unknown"];
const STORAGE_ENDS: readonly PiDurableStorageEnd[] = ["closed", "never-opened", "failed", "unknown"];
const PARTICIPATIONS: readonly PiDurableParticipation[] = ["fresh", "unarmed-existing"];
const CLAIM_KEYS = [
	"schemaVersion",
	"resource",
	"selected",
	"state",
	"owner",
	"generation",
	"firstParticipation",
	"lease",
	"writtenAt",
] as const;
const CLAIM_OPTIONAL_KEYS = ["reclaimedFrom", "end"] as const;
/** Only schema 2 carries a reservation or an adoption. */
const CLAIM_OPTIONAL_KEYS_V2 = [...CLAIM_OPTIONAL_KEYS, "reservation", "adoptedFrom"] as const;
const RESERVATION_KEYS = ["gardenId", "n", "cwd", "resource", "profile", "attachIncarnation", "nativeLease", "from"];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Json, required: readonly string[], optional: readonly string[] = []): boolean {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
	);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isTime(value: unknown): value is string {
	return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function isOwner(value: unknown): value is PiDurableOwner {
	return (
		isObject(value) &&
		hasExactKeys(value, ["pid", "startKey", "hostname"]) &&
		isPlausibleOwnerPid(value.pid) &&
		nonEmpty(value.startKey) &&
		nonEmpty(value.hostname)
	);
}

function isEnd(value: unknown): value is PiDurableOwnerEnd & { at: string } {
	return (
		isObject(value) &&
		hasExactKeys(value, ["at", "storage", "lease"], ["envCleanup", "cause"]) &&
		isTime(value.at) &&
		STORAGE_ENDS.includes(value.storage as PiDurableStorageEnd) &&
		LEASES.includes(value.lease as PiDurableLeaseOutcome) &&
		(value.envCleanup === undefined || value.envCleanup === "failed") &&
		(value.cause === undefined || (typeof value.cause === "string" && value.cause.length <= CAUSE_MAX))
	);
}

/**
 * The complete table (anything else is a malformed claim):
 *   reserved      never-held                     —   (schema 2 only)
 *   fenced        never-held                     —
 *   leased        held                           —
 *   storage-open  held                           —
 *   closed        released                       closed | never-opened
 *   closed        never-held                     never-opened
 *   close-failed  released | failed | unknown    failed | unknown; closed or never-opened only when the release
 *                                                failed or is unknown
 * `end.lease` repeats the claim's `lease`; an env-cleanup failure never rides a storage that was never opened.
 */
function combinationValid(
	state: PiDurableOwnerState,
	lease: PiDurableLeaseOutcome,
	end: (PiDurableOwnerEnd & { at: string }) | undefined,
): boolean {
	if (state === "reserved") return lease === "never-held" && end === undefined;
	if (state === "fenced") return lease === "never-held" && end === undefined;
	if (state === "leased" || state === "storage-open") return lease === "held" && end === undefined;
	if (end === undefined || end.lease !== lease) return false;
	if (end.envCleanup !== undefined && end.storage === "never-opened") return false;
	if (state === "closed") {
		if (lease === "released") return end.storage === "closed" || end.storage === "never-opened";
		return lease === "never-held" && end.storage === "never-opened";
	}
	if (lease !== "released" && lease !== "failed" && lease !== "unknown") return false;
	if (end.storage === "failed" || end.storage === "unknown") return true;
	return lease !== "released";
}

/**
 * A claim body exactly as the schema and the table allow, or a named refusal; never a default. A body read from D
 * is `claim-unreadable`; a body about to be written is `transition-invalid`.
 */
function requireClaim(
	value: unknown,
	where: string,
	reason: "claim-unreadable" | "transition-invalid" = "claim-unreadable",
): PiDurableOwnerClaim {
	const bad = (what: string): PiDurableOwnerFenceError => refuse(reason, `${where}: ${what}`);
	if (!isObject(value)) throw bad("not a JSON object");
	const v2 = value.schemaVersion === PI_DURABLE_OWNER_SCHEMA_VERSION;
	if (!v2 && value.schemaVersion !== LEGACY_SCHEMA_VERSION) throw bad("unknown schemaVersion");
	const optional = v2 ? CLAIM_OPTIONAL_KEYS_V2 : CLAIM_OPTIONAL_KEYS;
	if (!hasExactKeys(value, CLAIM_KEYS, optional)) throw bad("its keys are not exactly the claim's keys");
	if (!nonEmpty(value.resource) || !path.isAbsolute(value.resource)) throw bad("resource is not an absolute path");
	const selected = value.selected;
	if (
		!isObject(selected) ||
		!hasExactKeys(selected, v2 ? ["n", "directory", "profile"] : ["n", "directory"]) ||
		!nonEmpty(selected.n) ||
		!nonEmpty(selected.directory) ||
		!path.isAbsolute(selected.directory)
	) {
		throw bad(v2 ? "selected is not {n, directory, profile}" : "selected is not {n, directory}");
	}
	// Schema 2's profile is the value its directory was joined from, as it was read; schema 1 has none to infer.
	if (v2) {
		const profile = selected.profile;
		if (!nonEmpty(profile) || !path.isAbsolute(profile)) throw bad("selected.profile is not an absolute path");
		const n = selected.n as string;
		const directory = selected.directory as string;
		const joined = path.join(profile, "experimental", "durable-sessions", path.basename(path.dirname(directory)), n);
		if (joined !== directory) throw bad("selected.directory is not joined from selected.profile and selected.n");
	}
	const states: readonly PiDurableOwnerState[] = v2 ? STATES : NATIVE_STATES;
	if (!states.includes(value.state as PiDurableOwnerState)) throw bad("unknown state");
	if (!isOwner(value.owner)) throw bad("owner is not {pid, startKey, hostname} of a plausible pid");
	if (typeof value.generation !== "string" || !HEX32.test(value.generation)) throw bad("generation is not 32 hex");
	const first = value.firstParticipation;
	if (
		!isObject(first) ||
		!hasExactKeys(first, ["at", "generation", "from"]) ||
		!isTime(first.at) ||
		typeof first.generation !== "string" ||
		!HEX32.test(first.generation) ||
		!PARTICIPATIONS.includes(first.from as PiDurableParticipation)
	) {
		throw bad("firstParticipation is not {at, generation, from}");
	}
	const reclaimed = value.reclaimedFrom;
	if (
		reclaimed !== undefined &&
		!(
			isObject(reclaimed) &&
			hasExactKeys(reclaimed, ["generation", "state", "owner", "leaseOutcome"]) &&
			typeof reclaimed.generation === "string" &&
			HEX32.test(reclaimed.generation) &&
			states.includes(reclaimed.state as PiDurableOwnerState) &&
			isOwner(reclaimed.owner) &&
			LEASES.includes(reclaimed.leaseOutcome as PiDurableLeaseOutcome)
		)
	) {
		throw bad("reclaimedFrom is not {generation, state, owner, leaseOutcome}");
	}
	if (!LEASES.includes(value.lease as PiDurableLeaseOutcome)) throw bad("unknown lease outcome");
	if (value.end !== undefined && !isEnd(value.end)) throw bad("end is not {at, storage, lease, envCleanup?, cause?}");
	if (!isTime(value.writtenAt)) throw bad("writtenAt is not a time");
	const claim = value as unknown as PiDurableOwnerClaim;
	if (!combinationValid(claim.state, claim.lease, claim.end)) {
		throw bad(`state ${claim.state} with lease ${claim.lease} and end ${JSON.stringify(claim.end ?? null)} is invalid`);
	}
	// Exactly a `reserved` claim carries a reservation (#157 B3); an adoption rides only an owned state.
	if ((claim.state === "reserved") !== (value.reservation !== undefined)) {
		throw bad(`a ${claim.state} claim ${claim.state === "reserved" ? "lacks" : "carries"} a reservation`);
	}
	if (value.reservation !== undefined) requireReservation(value.reservation, claim, bad);
	if (value.adoptedFrom !== undefined && (claim.state === "reserved" || !isAdoptedFrom(value.adoptedFrom))) {
		throw bad("adoptedFrom is not {generation, owner} on an owned state");
	}
	return claim;
}

function isAdoptedFrom(value: unknown): boolean {
	return (
		isObject(value) &&
		hasExactKeys(value, ["generation", "owner"]) &&
		typeof value.generation === "string" &&
		HEX32.test(value.generation) &&
		isOwner(value.owner)
	);
}

/** Whether a native row's own lease outcome makes a present lease that owner's: held, or held and never seen released. */
function leaseAttributed(lease: PiDurableLeaseOutcome): boolean {
	return lease === "held" || lease === "unknown";
}

/**
 * A reservation exactly as the reserve writes it: it names the claim's resource, session and profile; its donor is ONE
 * flat native row whose selection is the claim's; a present lease is attributed only to a donor that held one.
 */
function requireReservation(
	value: unknown,
	claim: PiDurableOwnerClaim,
	bad: (what: string) => PiDurableOwnerFenceError,
): void {
	if (!isObject(value) || !hasExactKeys(value, RESERVATION_KEYS))
		throw bad("reservation is not the reservation's keys");
	try {
		requireGardenId(value.gardenId);
		if (requireAttachIncarnation(value.attachIncarnation) === null) throw new Error("attachIncarnation is null");
	} catch (error) {
		throw bad(`reservation: ${messageOf(error)}`);
	}
	if (!nonEmpty(value.cwd) || !path.isAbsolute(value.cwd)) throw bad("reservation.cwd is not an absolute path");
	if (value.resource !== claim.resource || value.n !== claim.selected.n || value.profile !== claim.selected.profile) {
		throw bad("reservation does not name the claim's resource, session and profile");
	}
	if (!NATIVE_LEASES.includes(value.nativeLease as PiDurableNativeLease))
		throw bad("reservation.nativeLease is unknown");
	const from = value.from;
	if (
		!isObject(from) ||
		!hasExactKeys(from, ["generation", "state", "owner", "lease", "selected"], ["end"]) ||
		typeof from.generation !== "string" ||
		!HEX32.test(from.generation) ||
		!NATIVE_STATES.includes(from.state as PiDurableNativeState) ||
		!isOwner(from.owner) ||
		!LEASES.includes(from.lease as PiDurableLeaseOutcome) ||
		(from.end !== undefined && !isEnd(from.end))
	) {
		throw bad("reservation.from is not one flat native owner row");
	}
	// The reserve selects nothing itself: the donor's selection IS the claim's.
	const selected = from.selected;
	if (
		!isObject(selected) ||
		!hasExactKeys(selected, ["n", "directory", "profile"]) ||
		selected.n !== claim.selected.n ||
		selected.directory !== claim.selected.directory ||
		selected.profile !== claim.selected.profile
	) {
		throw bad("reservation.from.selected is not the claim's selected");
	}
	const donor = from as unknown as PiDurableDonor;
	if (!combinationValid(donor.state, donor.lease, donor.end))
		throw bad("reservation.from is not a row the table allows");
	const attributable = leaseAttributed(donor.lease);
	if (value.nativeLease === "present-attributed" && !attributable) {
		throw bad("reservation.nativeLease is present-attributed for a donor that held no lease");
	}
}

// ── Reads, writes and the S_D hold ───────────────────────────────────────────────────────────────

/** The claim of D, or undefined when there is none; a symlink, a non-regular entry or a bad body is refused. */
function readClaim(resource: string): PiDurableOwnerClaim | undefined {
	const file = path.join(resource, PI_DURABLE_OWNER_CLAIM);
	let text: string;
	try {
		text = readStoreRecordFile(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw refuse("claim-unreadable", `${file}: ${messageOf(error)}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw refuse("claim-unreadable", `${file}: ${messageOf(error)}`);
	}
	return requireClaim(parsed, file);
}

/** tmp+rename, mode 0600, fsync'd before the rename. Only a body the schema and the table accept is written. */
function writeClaim(resource: string, body: PiDurableOwnerClaim): void {
	requireClaim(JSON.parse(JSON.stringify(body)), "the claim about to be written", "transition-invalid");
	const tmp = path.join(resource, `${PI_DURABLE_OWNER_TMP_PREFIX}${process.pid}-${randomBytes(6).toString("hex")}`);
	// Ownership of the temp is its creation by THIS call: a `wx` that failed (EEXIST included) made nothing here.
	let created = false;
	try {
		const fd = fs.openSync(tmp, "wx", 0o600);
		created = true;
		try {
			fs.writeSync(fd, `${JSON.stringify(body, null, "\t")}\n`);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmp, path.join(resource, PI_DURABLE_OWNER_CLAIM));
	} catch (error) {
		// Only the temp this call created is its to remove; a file that was already there is left as it is.
		if (created) fs.rmSync(tmp, { force: true });
		throw error;
	}
}

/** Whether `${D}.lock` (the lease this opener would take) exists in any form; an unreadable answer throws. */
function leasePresent(directory: string): boolean {
	try {
		fs.lstatSync(`${directory}.lock`);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

interface TxHold {
	readonly dev: number;
	readonly ino: number;
}

/** What a busy tx says about its holder, as evidence only; nothing is decided from it. */
function txEvidence(tx: string): string {
	try {
		return readStoreRecordFile(tx).trim().slice(0, CAUSE_MAX) || "(empty)";
	} catch (error) {
		return `(unreadable: ${(error as NodeJS.ErrnoException).code ?? messageOf(error)})`;
	}
}

async function enterTx(tx: string): Promise<TxHold> {
	for (let attempt = 1; ; attempt++) {
		let fd: number | undefined;
		try {
			fd = fs.openSync(tx, "wx", 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		if (fd !== undefined) {
			try {
				const evidence = {
					pid: process.pid,
					startKey: processStartKey(process.pid),
					hostname: os.hostname(),
					enteredAt: new Date().toISOString(),
				};
				fs.writeSync(fd, `${JSON.stringify(evidence)}\n`);
				const { dev, ino } = fs.fstatSync(fd);
				return { dev, ino };
			} catch (error) {
				// This tx was created by this call a moment ago, so it is this actor's own to remove.
				fs.rmSync(tx, { force: true });
				throw error;
			} finally {
				fs.closeSync(fd);
			}
		}
		if (attempt >= TX_ATTEMPTS) {
			throw refuse(
				"tx-held",
				`${tx} is held (${txEvidence(tx)}); a tx this fence did not create is never removed, taken over or aged out`,
			);
		}
		await sleep(TX_DELAY_MS);
	}
}

/** Unlink the tx this actor created, and only that one; a failure is reported and leaves residue that fails closed. */
function leaveTx(tx: string, held: TxHold, during: unknown): void {
	try {
		const now = fs.lstatSync(tx);
		if (now.dev !== held.dev || now.ino !== held.ino) {
			throw new Error("the transaction file is no longer the one this owner created");
		}
		fs.unlinkSync(tx);
	} catch (error) {
		throw refuse(
			"tx-release-failed",
			`${tx}: ${messageOf(error)}${during === undefined ? "" : `; the step had already failed: ${messageOf(during)}`}; the residue fails closed until an operator removes it`,
		);
	}
}

/** One S_D hold around a synchronous decision read and write. */
async function withTx<T>(resource: string, step: () => T): Promise<T> {
	const tx = path.join(resource, PI_DURABLE_OWNER_TX);
	const held = await enterTx(tx);
	let stepError: unknown;
	try {
		return step();
	} catch (error) {
		stepError = error;
		throw error;
	} finally {
		leaveTx(tx, held, stepError);
	}
}

function newGeneration(): string {
	return randomBytes(16).toString("hex");
}

function boundedCause(cause: string | undefined): { cause?: string } {
	return cause === undefined ? {} : { cause: cause.slice(0, CAUSE_MAX) };
}

// ── Admission ────────────────────────────────────────────────────────────────────────────────────

function requireAdmission(request: unknown): PiDurableOwnerAdmission {
	if (
		!isObject(request) ||
		!nonEmpty(request.directory) ||
		!path.isAbsolute(request.directory) ||
		!nonEmpty(request.selectedN) ||
		typeof request.created !== "boolean" ||
		!nonEmpty(request.profile) ||
		!path.isAbsolute(request.profile)
	) {
		throw refuse(
			"admission-invalid",
			"an admission names an absolute directory, its session id, whether it was created and the absolute profile it was joined from",
		);
	}
	return request as unknown as PiDurableOwnerAdmission;
}

function thisOwner(): PiDurableOwner {
	const pid = process.pid;
	if (!isPlausibleOwnerPid(pid)) throw refuse("owner-pid-implausible", `pid ${pid} cannot own a session`);
	const startKey = processStartKey(pid);
	if (startKey === "") throw refuse("owner-start-key-unreadable", `the start key of pid ${pid} cannot be read`);
	return { pid, startKey, hostname: os.hostname() };
}

/**
 * The admission table, inside the S_D hold, after D is chosen and before `lockfile.lock`:
 *   absent + created by this call            → fenced, from "fresh"
 *   absent + D existed, or `closed`          → `${D}.lock` present (any age): legacy-lease-present, nothing
 *                                              written; absent: fenced (a `closed` claim's firstParticipation kept)
 *   resource ≠ realpath(D)                   → claim-resource-mismatch, never read as absent
 *   an owner on another host                 → owner-other-host
 *   an owner live or uncertain (this pid too)→ owner-live / owner-uncertain
 *   a dead owner, unattributed lease         → `${D}.lock` present: lease-unattributed; absent: reclaim
 *   a dead owner, attributed lease           → reclaim (the library's stale takeover is admissible only here)
 *   a dead reservation's parent              → as a dead owner, its lease attributed only by its donor's snapshot
 *                                              and only for that snapshot's own selection
 * A differing `selected` (another N or another spelling of D) with an equal resource is an alias, judged by the
 * rows above.
 */
async function admitOwner(request: PiDurableOwnerAdmission): Promise<PiDurableOwnerTicket> {
	const { directory, selectedN, created, profile } = requireAdmission(request);
	let resource: string;
	try {
		resource = fs.realpathSync(directory);
		if (!fs.statSync(resource).isDirectory()) throw new Error("not a directory");
	} catch (error) {
		throw refuse("directory-invalid", `${directory}: ${messageOf(error)}`);
	}
	const owner = thisOwner();
	const written = await withTx(resource, () => {
		const read = readClaim(resource);
		if (read !== undefined && read.resource !== resource) {
			throw refuse("claim-resource-mismatch", `the claim in ${directory} names ${read.resource}, not ${resource}`);
		}
		// Only a claim for THIS resource is judged below; a mismatched one was refused above, never read as absent.
		const claim = read;
		const at = new Date().toISOString();
		const generation = newGeneration();
		const fenced = (
			firstParticipation: PiDurableOwnerClaim["firstParticipation"],
			reclaimedFrom?: PiDurableOwnerClaim["reclaimedFrom"],
		): PiDurableOwnerClaim => ({
			schemaVersion: PI_DURABLE_OWNER_SCHEMA_VERSION,
			resource,
			selected: { n: selectedN, directory, profile },
			state: "fenced",
			owner,
			generation,
			firstParticipation,
			...(reclaimedFrom === undefined ? {} : { reclaimedFrom }),
			lease: "never-held",
			writtenAt: at,
		});
		// `selected` is never compared: an alias of D (another N, another spelling) is judged by the same rows.
		if (claim === undefined || claim.state === "closed") {
			// An unarmed or ended D: a lease seen here is nobody this fence can name, so its stale takeover is never invoked.
			if ((claim !== undefined || !created) && leasePresent(directory)) {
				throw refuse("legacy-lease-present", `${directory}.lock exists while no participating owner holds it`);
			}
			const from = created ? "fresh" : "unarmed-existing";
			const body = fenced(claim?.firstParticipation ?? { at, generation, from });
			writeClaim(resource, body);
			return body;
		}
		if (claim.owner.hostname !== owner.hostname) {
			throw refuse("owner-other-host", `${directory} is claimed by pid ${claim.owner.pid} on ${claim.owner.hostname}`);
		}
		const verdict = classifyMarkerOwner(claim.owner.startKey, {
			currentStartKey: processStartKey(claim.owner.pid),
			pidExists: probePidExistence(claim.owner.pid),
		});
		const proven = verdict === "dead";
		if (!proven) {
			throw refuse(
				verdict === "live" ? "owner-live" : "owner-uncertain",
				`${directory} is ${claim.state} under pid ${claim.owner.pid}, which is ${verdict}`,
			);
		}
		// A dead owner whose recorded lease is attributable to it: held, or held and its release never observed.
		const attributed = claim.lease === "held" || claim.lease === "unknown";
		// A dead reservation's parent never held a lease: only its donor's snapshot attributes one, and only to the very
		// selection that snapshot was taken on; another spelling's sidecar is not that evidence (#157 B3).
		const snapshot = claim.reservation;
		const reservedAttributed =
			snapshot?.nativeLease === "present-attributed" && snapshot.from.selected.directory === directory;
		if (!(attributed || reservedAttributed) && leasePresent(directory)) {
			throw refuse(
				"lease-unattributed",
				`${directory}.lock exists, and the dead owner's claim (${claim.state}, lease ${claim.lease}) does not make it that owner's`,
			);
		}
		const body = fenced(claim.firstParticipation, {
			generation: claim.generation,
			state: claim.state,
			owner: claim.owner,
			leaseOutcome: claim.lease,
		});
		writeClaim(resource, body);
		return body;
	});
	return new OwnerTicket(resource, written);
}

// ── An admitted owner's transitions ──────────────────────────────────────────────────────────────

const UNLEASED_END: PiDurableOwnerEnd = { storage: "never-opened", lease: "never-held" };

function requireEnd(end: unknown): PiDurableOwnerEnd {
	if (
		!isObject(end) ||
		!hasExactKeys(end, ["storage", "lease"], ["envCleanup", "cause"]) ||
		!STORAGE_ENDS.includes(end.storage as PiDurableStorageEnd) ||
		!LEASES.includes(end.lease as PiDurableLeaseOutcome) ||
		(end.envCleanup !== undefined && end.envCleanup !== "failed") ||
		(end.cause !== undefined && typeof end.cause !== "string")
	) {
		throw refuse("transition-invalid", "an end is {storage, lease, envCleanup?, cause?}");
	}
	return end as unknown as PiDurableOwnerEnd;
}

class OwnerTicket implements PiDurableOwnerTicket {
	storageOpenAttempted = false;
	readonly #resource: string;
	/** The body this owner last wrote; its generation is what the next transition requires. */
	#claim: PiDurableOwnerClaim;
	#ended = false;

	constructor(resource: string, claim: PiDurableOwnerClaim) {
		this.#resource = resource;
		this.#claim = claim;
	}

	async leased(): Promise<void> {
		await this.#write(["fenced"], "leased", "held", undefined);
	}

	async storageOpened(): Promise<void> {
		if (!this.storageOpenAttempted) {
			throw refuse("transition-invalid", "storage-open without an attempted storage open");
		}
		await this.#write(["leased"], "storage-open", "held", undefined);
	}

	async endUnleased(): Promise<void> {
		await this.#end(["fenced"], "closed", UNLEASED_END);
	}

	async closed(end: PiDurableOwnerEnd): Promise<void> {
		const checked = this.#checkEnd(end);
		if (checked.storage === "closed" && this.#claim.state !== "storage-open") {
			throw refuse("transition-invalid", "a storage close is recorded only for an opened storage");
		}
		await this.#end(["leased", "storage-open"], "closed", checked);
	}

	async closeFailed(end: PiDurableOwnerEnd): Promise<void> {
		await this.#end(["leased", "storage-open"], "close-failed", this.#checkEnd(end));
	}

	#checkEnd(end: PiDurableOwnerEnd): PiDurableOwnerEnd {
		const checked = requireEnd(end);
		if (checked.storage === "never-opened" && this.storageOpenAttempted) {
			throw refuse("transition-invalid", "the storage open was attempted, so this end is not never-opened");
		}
		return checked;
	}

	async #end(
		from: readonly PiDurableOwnerState[],
		to: "closed" | "close-failed",
		end: PiDurableOwnerEnd,
	): Promise<void> {
		await this.#write(from, to, end.lease, end);
		this.#ended = true;
	}

	async #write(
		from: readonly PiDurableOwnerState[],
		to: PiDurableOwnerState,
		lease: PiDurableLeaseOutcome,
		end: PiDurableOwnerEnd | undefined,
	): Promise<void> {
		if (this.#ended) throw refuse("transition-invalid", "this owner's claim has already ended");
		if (!from.includes(this.#claim.state)) {
			throw refuse("transition-invalid", `${this.#claim.state} → ${to} is not a transition`);
		}
		const last = this.#claim;
		this.#claim = await withTx(this.#resource, () => {
			const current = readClaim(this.#resource);
			if (current === undefined) {
				throw refuse("claim-missing", `the claim this owner wrote in ${this.#resource} is gone`);
			}
			if (current.generation !== last.generation) {
				throw refuse(
					"generation-mismatch",
					`the claim in ${this.#resource} is generation ${current.generation}, not ${last.generation} this owner wrote`,
				);
			}
			const at = new Date().toISOString();
			const body: PiDurableOwnerClaim = {
				schemaVersion: PI_DURABLE_OWNER_SCHEMA_VERSION,
				resource: last.resource,
				selected: last.selected,
				state: to,
				owner: last.owner,
				generation: newGeneration(),
				firstParticipation: last.firstParticipation,
				...(last.adoptedFrom === undefined ? {} : { adoptedFrom: last.adoptedFrom }),
				lease,
				...(end === undefined
					? {}
					: {
							end: {
								at,
								storage: end.storage,
								lease: end.lease,
								...(end.envCleanup === undefined ? {} : { envCleanup: end.envCleanup }),
								...boundedCause(end.cause),
							},
						}),
				writtenAt: at,
			};
			writeClaim(this.#resource, body);
			return body;
		});
	}
}

// ── Reservation, adoption and withdrawal (#157 B3 I-2) ─────────────────────────────────────────────

/** The four meta roots one reservation addresses: the standard children of ONE meta root, never a split shape. */
export interface PiDurableMetaRoots {
	readonly sessionsDir: string;
	readonly mailboxDir: string;
	readonly sendersDir: string;
	readonly receiversDir: string;
}

const META_ROOT_CHILDREN: Readonly<Record<keyof PiDurableMetaRoots, string>> = {
	sessionsDir: "meta-sessions",
	mailboxDir: "meta-mailbox",
	sendersDir: "meta-senders",
	receiversDir: "meta-receivers",
};

function standardRoots(metaRoot: string): PiDurableMetaRoots {
	return {
		sessionsDir: path.join(metaRoot, META_ROOT_CHILDREN.sessionsDir),
		mailboxDir: path.join(metaRoot, META_ROOT_CHILDREN.mailboxDir),
		sendersDir: path.join(metaRoot, META_ROOT_CHILDREN.sendersDir),
		receiversDir: path.join(metaRoot, META_ROOT_CHILDREN.receiversDir),
	};
}

/** ONE meta root whose standard children are exactly the four roots given; any other shape is refused, never merged. */
function requireMetaRoot(roots: unknown): string {
	const fields = Object.keys(META_ROOT_CHILDREN) as (keyof PiDurableMetaRoots)[];
	const absolute = (field: keyof PiDurableMetaRoots): boolean => {
		const root = isObject(roots) ? roots[field] : undefined;
		return nonEmpty(root) && path.isAbsolute(root);
	};
	if (!fields.every(absolute)) throw refuse("reservation-invalid", "a reservation names four absolute meta roots");
	const given = roots as PiDurableMetaRoots;
	const metaRoot = path.dirname(given.sessionsDir);
	const standard = standardRoots(metaRoot);
	const split = fields.filter((field) => given[field] !== standard[field]);
	if (split.length > 0) {
		throw refuse("reserve-meta-root-split", `${split.join(", ")}: not the standard children of ${metaRoot}`);
	}
	return metaRoot;
}

function requireReservationGardenId(value: unknown): string {
	try {
		return requireGardenId(value);
	} catch (error) {
		throw refuse("reservation-invalid", messageOf(error));
	}
}

interface CheckedAdoption extends PiDurableAdoption {
	readonly roots: PiDurableMetaRoots;
}

function requireAdoption(value: unknown): CheckedAdoption {
	if (
		!isObject(value) ||
		!hasExactKeys(value, ["gardenId", "metaRoot", "sourceGeneration"]) ||
		!nonEmpty(value.metaRoot) ||
		!path.isAbsolute(value.metaRoot) ||
		typeof value.sourceGeneration !== "string" ||
		!HEX32.test(value.sourceGeneration)
	) {
		throw refuse("reservation-invalid", "an adoption is exactly {gardenId, metaRoot, sourceGeneration}");
	}
	const metaRoot = value.metaRoot as string;
	return {
		gardenId: requireReservationGardenId(value.gardenId),
		metaRoot,
		sourceGeneration: value.sourceGeneration as string,
		roots: standardRoots(metaRoot),
	};
}

/** Takes the record-arm lock of `gardenId` at once; a busy lock refuses with nothing read or written. */
function takeRecordArm(gardenId: string, roots: PiDurableMetaRoots): LockClaim {
	const acquired = acquireLock(gardenId, { dir: defaultMetaRecordArmLocksDir(roots.receiversDir) });
	if (!acquired.ok) throw refuse("record-arm-busy", `${acquired.conflict.detail}; nothing was read or written`);
	return acquired.claim;
}

/**
 * Releases the record-arm lock, after S_D. Returns what the caller throws: the step's own error when the release
 * answered `released`, else a named release failure carrying it. A clean step whose release answered returns undefined.
 */
function leaveRecordArm(arm: LockClaim, during: unknown): unknown {
	let released: string;
	try {
		released = releaseLock(arm);
	} catch (error) {
		released = `threw: ${messageOf(error)}`;
	}
	if (released === "released") return during;
	const failed = during === undefined ? "" : `; the step had already failed: ${messageOf(during)}`;
	return refuse("record-arm-release-failed", `the record-arm lock of ${arm.gardenId} answered ${released}${failed}`);
}

type Pair = { readonly record: MetaIdentity; readonly location: PiDurableLocation };

/** The record and C4 pair read NOW, inside the caller's arm hold (P1), or a named refusal. */
function freshPair(gardenId: string, roots: PiDurableMetaRoots): Pair {
	const { sessionsDir, receiversDir } = roots;
	const verdict = verifyPiDurableLocation({ gardenId, sessionsDir, receiversDir });
	if (!verdict.ok) {
		const reason = verdict.reason === "binding-mismatch" ? "binding-mismatch" : "profile-record-unbound";
		throw refuse(reason, `${gardenId}: ${verdict.reason}: ${verdict.detail}`);
	}
	return { record: verdict.record, location: verdict.location };
}

/** The current holder's liveness by the shared death policy; only `dead` lets a reserve take D over. */
function holderVerdict(holder: PiDurableOwner): ReturnType<typeof classifyMarkerOwner> {
	return classifyMarkerOwner(holder.startKey, {
		currentStartKey: processStartKey(holder.pid),
		pidExists: probePidExistence(holder.pid),
	});
}

/** Reserve rows 3–4: the current holder of a non-closed claim, a reservation's parent included; its host first. */
function requireHolderGone(claim: PiDurableOwnerClaim, resource: string, hostname: string): void {
	const where = `${resource} is ${claim.state} under pid ${claim.owner.pid} on ${claim.owner.hostname}`;
	const otherHost = claim.owner.hostname !== hostname;
	const verdict = otherHost ? "other-host" : holderVerdict(claim.owner);
	if (verdict === "other-host") throw refuse("owner-other-host", where);
	if (verdict !== "dead") throw refuse(verdict === "live" ? "owner-live" : "owner-uncertain", `${where}: ${verdict}`);
}

/** The reservation a `reserved` claim carries; the reader guarantees one. */
function reservationOf(claim: PiDurableOwnerClaim): PiDurableReservationBody {
	if (claim.reservation === undefined) {
		throw refuse("claim-unreadable", `the ${claim.state} claim in ${claim.resource} carries no reservation`);
	}
	return claim.reservation;
}

/** The native donor: a `reserved` claim's flat `from`, or a native claim's own row. Never a reservation's parent. */
function donorOf(claim: PiDurableOwnerClaim): PiDurableDonor {
	if (claim.state === "reserved") return reservationOf(claim).from;
	return {
		generation: claim.generation,
		state: claim.state,
		owner: claim.owner,
		lease: claim.lease,
		...(claim.end === undefined ? {} : { end: claim.end }),
		selected: claim.selected,
	};
}

function reclaimOf(claim: PiDurableOwnerClaim): NonNullable<PiDurableOwnerClaim["reclaimedFrom"]> {
	return { generation: claim.generation, state: claim.state, owner: claim.owner, leaseOutcome: claim.lease };
}

/**
 * P2–P6 on the native donor, on the pair read in this hold (P1); P2 is the claim's resource row before this. The donor
 * is the incarnation C4's binding names, on this host; its selection is the record's session, joined from its own raw
 * profile, and still reaches R. Returns that profile. A schema 1 donor recorded none, and none is ever inferred.
 */
function requireProfile(donor: PiDurableDonor, pair: Pair, resource: string): string {
	const { record, location } = pair;
	const { owner, selected } = donor;
	if (owner.hostname !== os.hostname()) throw refuse("profile-other-host", `the donor was owned on ${owner.hostname}`);
	if (owner.pid !== location.ownerPid || owner.startKey !== location.ownerStartKey) {
		throw refuse("profile-unattributed", `pid ${owner.pid} is not the incarnation ${record.gardenId}'s binding names`);
	}
	if (selected.n !== record.nativeSessionId) {
		throw refuse("profile-n-mismatch", `the donor selected ${selected.n}, the record names ${record.nativeSessionId}`);
	}
	const recorded = selected.profile;
	if (!nonEmpty(recorded)) throw refuse("profile-unattributed", "the donor's schema 1 claim records no profile");
	const cwdHash = createHash("sha256").update(record.cwd).digest("hex").slice(0, 24);
	if (path.join(recorded, "experimental", "durable-sessions", cwdHash, selected.n) !== selected.directory) {
		throw refuse("profile-layout-mismatch", `${selected.directory} is not joined from ${recorded} and ${record.cwd}`);
	}
	let real: string;
	try {
		real = fs.realpathSync(selected.directory);
	} catch (error) {
		throw refuse("profile-alias-moved", `${selected.directory}: ${messageOf(error)}`);
	}
	if (real !== resource)
		throw refuse("profile-alias-moved", `${selected.directory} now reaches ${real}, not ${resource}`);
	return recorded;
}

/** What a parent asks to reserve: the garden id it resolved (the record is the address) and its own four roots. */
export interface PiDurableReserveRequest {
	readonly gardenId: string;
	readonly roots: PiDurableMetaRoots;
}

/** A taken reservation's coordinates, for its caller's launch, observation and withdrawal. */
export interface PiDurableReservation {
	readonly gardenId: string;
	readonly metaRoot: string;
	/** R, the physical D (C4's `nativeDirectory`): the claim and S_D live here. */
	readonly resource: string;
	/** g_r: matching data for the child, and the withdrawal's own-generation test. */
	readonly generation: string;
	/** The donor's raw profile: the child's SDK is started with exactly this value. */
	readonly profile: string;
	/** The record's cwd: the launch's cwd. */
	readonly cwd: string;
	readonly owner: PiDurableOwner;
}

/**
 * A parent's reservation of one pi-durable citizen's D for one child (#157 B3): record-arm(gid), then S_D(R), on the
 * record and C4 pair read inside the arm hold. Both are released before this returns, so before any launch; the
 * caller's own per-target lock, if it holds one, stays its outer scope and is never taken here. A refusal writes
 * nothing. A write followed by a failed release is reported, and its caller must not launch.
 */
export async function reservePiDurableSession(request: PiDurableReserveRequest): Promise<PiDurableReservation> {
	if (!isObject(request)) throw refuse("reservation-invalid", "a reserve names a garden id and four meta roots");
	const gardenId = requireReservationGardenId(request.gardenId);
	const metaRoot = requireMetaRoot(request.roots);
	const roots = standardRoots(metaRoot);
	const owner = thisOwner();
	const arm = takeRecordArm(gardenId, roots);
	let reserved: PiDurableReservation;
	try {
		reserved = await reserveInPair(gardenId, roots, metaRoot, owner);
	} catch (error) {
		throw leaveRecordArm(arm, error);
	}
	const failure = leaveRecordArm(arm, undefined);
	if (failure !== undefined) throw failure;
	return reserved;
}

/** The reserve's rows and write, inside S_D(R), on the pair read in this arm hold. Rows decide before P-rules. */
async function reserveInPair(
	gardenId: string,
	roots: PiDurableMetaRoots,
	metaRoot: string,
	owner: PiDurableOwner,
): Promise<PiDurableReservation> {
	const pair = freshPair(gardenId, roots);
	const { record, location } = pair;
	const resource = location.nativeDirectory;
	const written = await withTx(resource, () => {
		const claim = readClaim(resource);
		if (claim === undefined) throw refuse("reserve-unarmed", `${resource} holds no claim; a reserve never enrolls`);
		if (claim.resource !== resource) {
			throw refuse("claim-resource-mismatch", `the claim in ${resource} names ${claim.resource}`);
		}
		if (claim.state !== "closed") requireHolderGone(claim, resource, owner.hostname);
		if (claim.state === "closed" && claim.end?.storage !== "closed") {
			throw refuse("reserve-not-clean", `${resource} closed without its storage ever opening`);
		}
		// P1–P6 judge the native donor: a dead reservation's flat `from`, never its parent.
		const donor = donorOf(claim);
		const profile = requireProfile(donor, pair, resource);
		// The snapshot is taken on S, the donor's own selection: the SDK's lease is `${S}.lock`, never `${R}.lock`.
		const sidecar = leasePresent(donor.selected.directory);
		let nativeLease: PiDurableNativeLease = "absent";
		if (claim.state === "closed") {
			if (sidecar) throw refuse("legacy-lease-present", `${donor.selected.directory}.lock exists after a clean close`);
		} else if (claim.state === "reserved") {
			const before = reservationOf(claim).nativeLease;
			if (before === "absent" && sidecar) {
				throw refuse("lease-appeared", `${donor.selected.directory}.lock appeared after its reservation saw none`);
			}
			if (before === "present-attributed" && sidecar) nativeLease = "present-attributed";
		} else if (leaseAttributed(claim.lease)) {
			if (sidecar) nativeLease = "present-attributed";
		} else if (sidecar) {
			throw refuse("lease-unattributed", `${donor.selected.directory}.lock exists, and the dead owner never held it`);
		}
		const body: PiDurableOwnerClaim = {
			schemaVersion: PI_DURABLE_OWNER_SCHEMA_VERSION,
			resource,
			selected: donor.selected,
			state: "reserved",
			owner,
			generation: newGeneration(),
			firstParticipation: claim.firstParticipation,
			...(claim.state === "closed" ? {} : { reclaimedFrom: reclaimOf(claim) }),
			reservation: {
				gardenId: record.gardenId,
				n: record.nativeSessionId,
				cwd: record.cwd,
				resource,
				profile,
				attachIncarnation: location.attachIncarnation,
				nativeLease,
				from: donor,
			},
			lease: "never-held",
			writtenAt: new Date().toISOString(),
		};
		writeClaim(resource, body);
		return body;
	});
	return {
		gardenId: record.gardenId,
		metaRoot,
		resource,
		generation: written.generation,
		profile: reservationOf(written).profile,
		cwd: record.cwd,
		owner,
	};
}

/**
 * A launched child's adoption of exactly one reservation (#157 B3), inside record-arm(gid) then S_D(R), never the
 * parent's per-target lock, on the pair read in this hold. Every row must hold; a refusal writes nothing and takes no
 * lease. The admission's directory is resolved inside S_D, never before it. The ticket returns only after both locks
 * are released, so the native lease and storage come after them.
 */
async function adoptOwner(request: PiDurableOwnerAdmission, adoption: CheckedAdoption): Promise<PiDurableOwnerTicket> {
	const admission = requireAdmission(request);
	const owner = thisOwner();
	const arm = takeRecordArm(adoption.gardenId, adoption.roots);
	let adopted: PiDurableOwnerClaim;
	try {
		adopted = await adoptInPair(admission, adoption, owner);
	} catch (error) {
		throw leaveRecordArm(arm, error);
	}
	const failure = leaveRecordArm(arm, undefined);
	if (failure !== undefined) throw failure;
	return new OwnerTicket(adopted.resource, adopted);
}

/** The adoption's rows and write, inside S_D(R), on the pair read in this arm hold. */
async function adoptInPair(
	admission: PiDurableOwnerAdmission,
	adoption: CheckedAdoption,
	owner: PiDurableOwner,
): Promise<PiDurableOwnerClaim> {
	const { record, location } = freshPair(adoption.gardenId, adoption.roots);
	const resource = location.nativeDirectory;
	const { directory, selectedN, profile } = admission;
	return withTx(resource, () => {
		const claim = readClaim(resource);
		if (claim !== undefined && claim.resource !== resource) {
			throw refuse("claim-resource-mismatch", `the claim in ${resource} names ${claim.resource}`);
		}
		if (claim === undefined || claim.state !== "reserved") {
			throw refuse("adopt-not-reserved", `${resource} holds no reservation to adopt`);
		}
		const reservation = reservationOf(claim);
		if (claim.generation !== adoption.sourceGeneration) {
			throw refuse(
				"adopt-generation-mismatch",
				`${resource} is at ${claim.generation}, not ${adoption.sourceGeneration}`,
			);
		}
		if (record.attachIncarnation !== reservation.attachIncarnation) {
			throw refuse("adopt-binding-changed", `${record.gardenId} was bound again after its reservation`);
		}
		// D as the admission names it NOW, in this hold: a path resolved before S_D is not this decision's evidence.
		let real: string;
		try {
			real = fs.realpathSync(directory);
		} catch (error) {
			throw refuse("directory-invalid", `${directory}: ${messageOf(error)}`);
		}
		const expected = [adoption.gardenId, record.nativeSessionId, record.cwd, real];
		const named = [reservation.gardenId, reservation.n, reservation.cwd, reservation.resource];
		if (expected.some((value, index) => value !== named[index])) {
			throw refuse(
				"adopt-reservation-mismatch",
				`the reservation names ${named.join(", ")}, not ${expected.join(", ")}`,
			);
		}
		const cwdHash = createHash("sha256").update(record.cwd).digest("hex").slice(0, 24);
		const joined = path.join(profile, "experimental", "durable-sessions", cwdHash, record.nativeSessionId);
		if (profile !== reservation.profile || directory !== claim.selected.directory || joined !== directory) {
			throw refuse("adopt-profile-mismatch", `${directory} with profile ${profile} is not the reserved selection`);
		}
		if (claim.owner.hostname !== owner.hostname) {
			throw refuse("owner-other-host", `the reservation in ${resource} was taken on ${claim.owner.hostname}`);
		}
		if (reservation.nativeLease === "absent" && leasePresent(directory)) {
			throw refuse("adopt-lease-appeared", `${directory}.lock appeared after the reservation saw none`);
		}
		const body: PiDurableOwnerClaim = {
			schemaVersion: PI_DURABLE_OWNER_SCHEMA_VERSION,
			resource,
			selected: { n: selectedN, directory, profile },
			state: "fenced",
			owner,
			generation: newGeneration(),
			firstParticipation: claim.firstParticipation,
			adoptedFrom: { generation: claim.generation, owner: claim.owner },
			lease: "never-held",
			writtenAt: new Date().toISOString(),
		};
		writeClaim(resource, body);
		return body;
	});
}

function sameOwner(a: PiDurableOwner, b: PiDurableOwner): boolean {
	return a.pid === b.pid && a.startKey === b.startKey && a.hostname === b.hostname;
}

/**
 * The parent's withdrawal of its OWN reservation, once its launch is definitely none-created (its caller's judgement
 * from the rail's own outcome). One S_D hold and no record or C4 read: only `reserved` + this owner + exactly g_r is
 * withdrawn, back to the donor's own row under a new generation. Nothing of the reservation, the reserve's reclaim or
 * any earlier history is carried; anything else writes nothing and refuses `withdraw-not-own`.
 */
export async function withdrawPiDurableReservation(reservation: PiDurableReservation): Promise<void> {
	const owner = thisOwner();
	const resource = reservation.resource;
	await withTx(resource, () => {
		const claim = readClaim(resource);
		if (claim?.state !== "reserved") throw refuse("withdraw-not-own", `${resource} is not reserved`);
		if (claim.generation !== reservation.generation) {
			throw refuse("withdraw-not-own", `${resource} is at ${claim.generation}, not ${reservation.generation}`);
		}
		if (!sameOwner(claim.owner, owner)) {
			throw refuse("withdraw-not-own", `${resource} is reserved by pid ${claim.owner.pid}, not this process`);
		}
		const donor = reservationOf(claim).from;
		const body: PiDurableOwnerClaim = {
			schemaVersion: PI_DURABLE_OWNER_SCHEMA_VERSION,
			resource: claim.resource,
			selected: donor.selected,
			state: donor.state,
			owner: donor.owner,
			generation: newGeneration(),
			firstParticipation: claim.firstParticipation,
			lease: donor.lease,
			...(donor.end === undefined ? {} : { end: donor.end }),
			writtenAt: new Date().toISOString(),
		};
		writeClaim(resource, body);
	});
}

/** What one reservation's D says now: a read, never a watch. */
export type PiDurableReservationObservation =
	| { readonly class: "adopted" | "not-yet-adopted" | "lost" }
	| { readonly class: "unobserved"; readonly reason: PiDurableOwnerFenceReason; readonly detail: string };

/**
 * `adopted`: any state carrying `adoptedFrom.generation === g_r` (an adoption write, not readiness or success);
 * `not-yet-adopted`: still `reserved` at g_r; `lost`: any other claim the strict reader accepted. A claim that could
 * not be read, is gone, or names another resource is `unobserved` by name, never `lost`.
 */
export function observePiDurableReservation(reservation: PiDurableReservation): PiDurableReservationObservation {
	let claim: PiDurableOwnerClaim | undefined;
	try {
		claim = readClaim(reservation.resource);
	} catch (error) {
		if (error instanceof PiDurableOwnerFenceError) {
			return { class: "unobserved", reason: error.reason, detail: error.message };
		}
		throw error;
	}
	if (claim === undefined) {
		return { class: "unobserved", reason: "claim-missing", detail: `${reservation.resource} holds no claim` };
	}
	if (claim.resource !== reservation.resource) {
		return { class: "unobserved", reason: "claim-resource-mismatch", detail: `the claim names ${claim.resource}` };
	}
	if (claim.adoptedFrom?.generation === reservation.generation) return { class: "adopted" };
	if (claim.state === "reserved" && claim.generation === reservation.generation) return { class: "not-yet-adopted" };
	return { class: "lost" };
}
