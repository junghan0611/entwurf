/**
 * pi-durable LOCATION EVIDENCE (#157 B3, C4 locator leaf) — where a pi-durable citizen's native
 * session directory physically is, written by the durable host's own birth and bound to its
 * record by the record's `attachIncarnation`.
 *
 * WHAT THIS IS. One garden-keyed file per pi-durable citizen, `<locations>/<gardenId>.location.json`,
 * holding the minimum location + binding evidence its attach already knows: the native session id,
 * the realpath cwd, `realpath(session.directory)`, the owner pid and its start key, and the
 * `attachIncarnation` minted in the same record-arm-locked commit as the record's own. The record
 * stays the SOLE address (AGENTS.md Hard Rule 2): this file is evidence the record points at, keyed
 * by the record's garden id, and it counts only while the record carries the very binding it copied.
 *
 * WHAT THIS IS NOT. Not an address, a registry, a presence marker, a liveness or ownership verdict,
 * a dormancy proof or a guarded enrollment. A matching pair says ONE thing: the record's last
 * committed binding named this physical directory and this owner incarnation. A process holding the
 * session before its own commit (the unbound window from the native lease to this birth) is
 * invisible here; only an owner claim taken before the lease could see it, and none exists in this
 * leaf. Public resume of a pi-durable citizen stays refused.
 *
 * WHERE. `<dirname(receiversDir)>/meta-pi-durable-locations`: a sibling of the receivers root the
 * birth actually uses, the same derivation as the record-arm lock dir, so a sandboxed receivers root
 * sandboxes it too and no new environment carrier exists. It is deliberately NOT inside the record
 * store (every entry there is certified), the receivers or senders roots (fresh-cut walks every entry
 * there as a marker) or the mailbox (fresh-cut archives it).
 *
 * LIFECYCLE (Rule 8). Written by a pi-durable birth only; never removed by retire, close, the
 * doorbell or any reader. No reader in this tree enumerates the directory: fresh-cut archives the
 * store and the mailbox and walks the marker roots, the doctor certifies the store. A carrier whose
 * record is absent (a cut generation) or whose binding no longer matches is INERT — every read
 * below refuses it by name. There is no automatic deletion, migration, GC, doctor framework or
 * recovery verb for it.
 *
 * FAILURE STATES OF A BIRTH (all non-green; none is "binding not committed" by fiat):
 *   (a) arm lock busy, or any failure before the minted upsert: the store keeps whatever pair it
 *       had — possibly an OLDER matching pair;
 *   (b) the minted upsert landed but the carrier write failed: record ≠ carrier, a pair mismatch
 *       every read refuses;
 *   (c) the pair committed but a later step of the birth failed: a matching pair, and still a failed
 *       birth. The two files are never one atomic commit.
 * Calling a cleanup is not a cleanup's success: an arm-lock release that does not answer
 * `released` is reported, never assumed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { acquireLock, releaseLock } from "./entwurf-v2-lock.ts";
import {
	defaultMetaRecordArmLocksDir,
	findCertifiedIdentityByNativeSessionId,
	isPlausibleOwnerPid,
	type MetaIdentity,
	mintAttachIncarnation,
	NOT_REGULAR_ENTRY_CODE,
	processStartKey,
	readAddressableMetaIdentity,
	readStoreRecordFile,
	requireAttachIncarnation,
	requireGardenId,
	requireNonEmptyString,
	type UpsertAction,
	UpsertActionMismatchError,
	upsertMetaSession,
} from "./meta-session.ts";

export const PI_DURABLE_LOCATION_DIRNAME = "meta-pi-durable-locations";
export const PI_DURABLE_LOCATION_SUFFIX = ".location.json";
export const PI_DURABLE_LOCATION_SCHEMA_VERSION = 1;
const PI_DURABLE_BACKEND = "pi-durable";

const LOCATION_KEYS: readonly string[] = [
	"schemaVersion",
	"gardenId",
	"backend",
	"nativeSessionId",
	"cwd",
	"nativeDirectory",
	"ownerPid",
	"ownerStartKey",
	"attachIncarnation",
	"writtenAt",
];

/** The location evidence one pi-durable birth commits. Evidence only — see the file header. */
export interface PiDurableLocation {
	schemaVersion: typeof PI_DURABLE_LOCATION_SCHEMA_VERSION;
	gardenId: string;
	backend: typeof PI_DURABLE_BACKEND;
	nativeSessionId: string;
	/** The realpath cwd the record carries (`sessions.ts:42` realpaths it before the attach sees it). */
	cwd: string;
	/** `realpath(session.directory)` at the birth: the physical native session directory. */
	nativeDirectory: string;
	ownerPid: number;
	ownerStartKey: string;
	/** The record's `attachIncarnation` minted in the same arm-locked commit. Never null here. */
	attachIncarnation: string;
	writtenAt: string;
}

/** A birth that could not commit its location binding. Always non-green; see FAILURE STATES. */
export class PiDurableLocationError extends Error {
	readonly reason:
		| "owner-pid-implausible"
		| "cwd-not-absolute"
		| "native-directory-invalid"
		| "owner-start-key-unreadable"
		| "record-arm-lock-busy"
		| "record-arm-lock-release-failed"
		| "carrier-write-failed";
	constructor(reason: PiDurableLocationError["reason"], detail: string, options?: { cause?: unknown }) {
		super(`pi-durable location (${reason}): ${detail}`, options);
		this.name = "PiDurableLocationError";
		this.reason = reason;
	}
}

/** `<dirname(receiversDir)>/meta-pi-durable-locations`, from the receivers root the caller actually uses. */
export function piDurableLocationDir(receiversDir: string): string {
	if (!path.isAbsolute(receiversDir)) {
		throw new Error(`pi-durable location: the receivers root must be absolute (got ${JSON.stringify(receiversDir)})`);
	}
	return path.join(path.dirname(receiversDir), PI_DURABLE_LOCATION_DIRNAME);
}

export function piDurableLocationPath(gardenId: string, receiversDir: string): string {
	return path.join(piDurableLocationDir(receiversDir), `${requireGardenId(gardenId)}${PI_DURABLE_LOCATION_SUFFIX}`);
}

function requireAbsolute(value: unknown, field: string): string {
	const text = requireNonEmptyString(value, field);
	if (!path.isAbsolute(text)) throw new Error(`location field "${field}" must be an absolute path`);
	return text;
}

/** Strict parse: exact keyset, live schema version, body garden id equal to the file's. Throws on any drift. */
export function parsePiDurableLocation(json: string, expectedGardenId: string): PiDurableLocation {
	const raw: unknown = JSON.parse(json);
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("location is not a JSON object");
	const obj = raw as Record<string, unknown>;
	const stray = Object.keys(obj).filter((key) => !LOCATION_KEYS.includes(key));
	if (stray.length > 0) throw new Error(`location carries unexpected key(s) ${stray.join(", ")}`);
	const missing = LOCATION_KEYS.filter((key) => !(key in obj));
	if (missing.length > 0) throw new Error(`location lacks key(s) ${missing.join(", ")}`);
	if (obj.schemaVersion !== PI_DURABLE_LOCATION_SCHEMA_VERSION) {
		throw new Error(
			`location schemaVersion is ${JSON.stringify(obj.schemaVersion)}, not ${PI_DURABLE_LOCATION_SCHEMA_VERSION}`,
		);
	}
	if (obj.backend !== PI_DURABLE_BACKEND) throw new Error(`location backend is ${JSON.stringify(obj.backend)}`);
	if (!isPlausibleOwnerPid(obj.ownerPid))
		throw new Error(`location ownerPid ${JSON.stringify(obj.ownerPid)} is not a plausible owner`);
	const attachIncarnation = requireAttachIncarnation(obj.attachIncarnation);
	if (attachIncarnation === null)
		throw new Error("location attachIncarnation is null: a location without a binding is not evidence");
	const location: PiDurableLocation = {
		schemaVersion: PI_DURABLE_LOCATION_SCHEMA_VERSION,
		gardenId: requireGardenId(obj.gardenId),
		backend: PI_DURABLE_BACKEND,
		nativeSessionId: requireNonEmptyString(obj.nativeSessionId, "nativeSessionId"),
		cwd: requireAbsolute(obj.cwd, "cwd"),
		nativeDirectory: requireAbsolute(obj.nativeDirectory, "nativeDirectory"),
		ownerPid: obj.ownerPid,
		ownerStartKey: requireNonEmptyString(obj.ownerStartKey, "ownerStartKey"),
		attachIncarnation,
		writtenAt: requireNonEmptyString(obj.writtenAt, "writtenAt"),
	};
	if (location.gardenId !== expectedGardenId) {
		throw new AddressMismatch(`location body names ${location.gardenId}, its file names ${expectedGardenId}`);
	}
	return location;
}

class AddressMismatch extends Error {}

/**
 * Atomic private write: an exclusive tmp beside the final name, then rename. A failed write leaves no tmp of its
 * own; an entry that already held the tmp name (the exclusive create failed) is not this call's and is left as is.
 */
function writePiDurableLocation(location: PiDurableLocation, receiversDir: string): string {
	const dir = piDurableLocationDir(receiversDir);
	const file = piDurableLocationPath(location.gardenId, receiversDir);
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	// Ownership of the tmp is its creation by THIS call: a `wx` that failed (EEXIST included) made nothing here.
	let created = false;
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		const fd = fs.openSync(tmp, "wx", 0o600);
		created = true;
		try {
			fs.writeFileSync(fd, `${JSON.stringify(location, null, "\t")}\n`);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmp, file);
	} catch (error) {
		let leftover = "";
		try {
			if (created) fs.rmSync(tmp, { force: true });
		} catch (cleanup) {
			leftover = `; its tmp ${tmp} could not be removed (${cleanup instanceof Error ? cleanup.message : String(cleanup)})`;
		}
		throw new PiDurableLocationError(
			"carrier-write-failed",
			`could not write ${file} (${error instanceof Error ? error.message : String(error)})${leftover}`,
			{ cause: error },
		);
	}
	return file;
}

export interface CommitPiDurableBirthOptions {
	nativeSessionId: string;
	/** The realpath cwd the durable session reports (absolute). */
	cwd: string;
	/** `session.directory` as the durable runtime reports it; realpath'd and verified here. */
	sessionDirectory: string;
	ownerPid: number;
	sessionsDir: string;
	/** The receivers root this birth uses (absolute); the arm-lock and location dirs derive from it. */
	receiversDir: string;
}

export interface CommitPiDurableBirthResult {
	/** `create` when THIS birth published the record, else `attach`. */
	action: UpsertAction;
	record: MetaIdentity;
	dir: string;
	/** Absolute path of the written record. */
	path: string;
	locationPath: string;
}

/**
 * The pi-durable birth's record write, in the order the Claude Code hook already uses for its own
 * binding (`meta-bridge-hook.ts` commitRecord): a read-only certified lookup; a create-only publish
 * when absent (a create replaces nothing, so it takes no lock); the record-arm lock for the garden id;
 * the attach upsert minting `attachIncarnation`; the location carrier copying that same value; the
 * release. Everything that can be refused before a write — the receivers root, the owner pid, the cwd,
 * the native directory, the owner start key — is checked first. See FAILURE STATES for what each failure leaves behind.
 */
export function commitPiDurableBirth(opts: CommitPiDurableBirthOptions): CommitPiDurableBirthResult {
	// A relative receivers root would put the arm lock and the carrier wherever the process happens to be.
	piDurableLocationDir(opts.receiversDir);
	// The writer refuses, before the first record write, what the carrier's parser would refuse: no
	// birth may commit a record whose location evidence could never be read back.
	if (!isPlausibleOwnerPid(opts.ownerPid)) {
		throw new PiDurableLocationError(
			"owner-pid-implausible",
			`owner pid ${JSON.stringify(opts.ownerPid)} is not a plausible owner; nothing was written`,
		);
	}
	if (typeof opts.cwd !== "string" || !path.isAbsolute(opts.cwd)) {
		throw new PiDurableLocationError(
			"cwd-not-absolute",
			`the durable session cwd ${JSON.stringify(opts.cwd)} is not absolute; nothing was written`,
		);
	}
	let nativeDirectory: string;
	try {
		if (!path.isAbsolute(opts.sessionDirectory)) throw new Error("not absolute");
		nativeDirectory = fs.realpathSync(opts.sessionDirectory);
		if (!fs.statSync(nativeDirectory).isDirectory()) throw new Error("not a directory");
	} catch (error) {
		throw new PiDurableLocationError(
			"native-directory-invalid",
			`the durable session directory ${JSON.stringify(opts.sessionDirectory)} is not an existing directory ` +
				`(${error instanceof Error ? error.message : String(error)}); nothing was written`,
		);
	}
	const ownerStartKey = processStartKey(opts.ownerPid);
	if (ownerStartKey === "") {
		throw new PiDurableLocationError(
			"owner-start-key-unreadable",
			`no start key could be read for owner pid ${opts.ownerPid}; nothing was written`,
		);
	}
	const input = {
		backend: PI_DURABLE_BACKEND,
		nativeSessionId: opts.nativeSessionId,
		cwd: opts.cwd,
		model: null,
		transcriptPath: null,
	} as const;

	let action: UpsertAction = "attach";
	let existing = findCertifiedIdentityByNativeSessionId(opts.nativeSessionId, opts.sessionsDir);
	if (existing === null) {
		try {
			existing = upsertMetaSession({ input, expectAction: "create", dir: opts.sessionsDir }).record;
			action = "create";
		} catch (error) {
			if (!(error instanceof UpsertActionMismatchError)) throw error;
			existing = findCertifiedIdentityByNativeSessionId(opts.nativeSessionId, opts.sessionsDir);
			if (existing === null) throw error;
		}
	}

	const lockDir = defaultMetaRecordArmLocksDir(opts.receiversDir);
	const acquired = acquireLock(existing.gardenId, { dir: lockDir });
	if (!acquired.ok) {
		throw new PiDurableLocationError(
			"record-arm-lock-busy",
			`${acquired.conflict.detail}; the minted binding was not written, so the store keeps whatever pair it had`,
		);
	}
	let result: CommitPiDurableBirthResult;
	try {
		const attachIncarnation = mintAttachIncarnation();
		const upsert = upsertMetaSession({
			input: { ...input, attachIncarnation },
			expectAction: "attach",
			dir: opts.sessionsDir,
		});
		const locationPath = writePiDurableLocation(
			{
				schemaVersion: PI_DURABLE_LOCATION_SCHEMA_VERSION,
				gardenId: upsert.record.gardenId,
				backend: PI_DURABLE_BACKEND,
				nativeSessionId: upsert.record.nativeSessionId,
				cwd: upsert.record.cwd,
				nativeDirectory,
				ownerPid: opts.ownerPid,
				ownerStartKey,
				attachIncarnation,
				writtenAt: new Date().toISOString(),
			},
			opts.receiversDir,
		);
		result = { action, record: upsert.record, dir: upsert.dir, path: upsert.path, locationPath };
	} catch (error) {
		let released: string;
		try {
			released = releaseLock(acquired.claim);
		} catch (cleanup) {
			released = `threw: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`;
		}
		if (released !== "released" && error instanceof Error) {
			error.message += ` (the record-arm lock release then answered ${released}, not released)`;
		}
		throw error;
	}
	const released = releaseLock(acquired.claim);
	if (released !== "released") {
		throw new PiDurableLocationError(
			"record-arm-lock-release-failed",
			`the pair for ${result.record.gardenId} was written, but releasing its record-arm lock answered ${released}`,
		);
	}
	return result;
}

export type PiDurableLocationRefusal =
	| "record-unaddressable"
	| "record-not-pi-durable"
	| "record-unbound"
	| "carrier-absent"
	| "carrier-not-regular"
	| "carrier-unreadable"
	| "carrier-malformed"
	| "carrier-address-mismatch"
	| "binding-mismatch"
	| "native-directory-invalid";

export type PiDurableLocationVerdict =
	| { ok: true; record: MetaIdentity; location: PiDurableLocation }
	| { ok: false; reason: PiDurableLocationRefusal; detail: string };

/**
 * The verification leaf: from a garden id (the address) to location evidence, or a named refusal.
 * The record is read through the addressable reader; the carrier through the store's no-follow,
 * regular-file read; nothing in the native directory is opened. A pass means ONLY that the record's
 * current binding and this carrier agree and the named directory exists as itself — never liveness,
 * ownership, dormancy or an admission.
 */
export function verifyPiDurableLocation(opts: {
	gardenId: string;
	sessionsDir: string;
	receiversDir: string;
}): PiDurableLocationVerdict {
	let record: MetaIdentity;
	try {
		record = readAddressableMetaIdentity(opts.gardenId, opts.sessionsDir);
	} catch (error) {
		return {
			ok: false,
			reason: "record-unaddressable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
	if (record.backend !== PI_DURABLE_BACKEND) {
		return { ok: false, reason: "record-not-pi-durable", detail: `${record.gardenId} is a ${record.backend} record` };
	}
	if (record.attachIncarnation === null) {
		return {
			ok: false,
			reason: "record-unbound",
			detail: `${record.gardenId} carries no attachIncarnation: no committed location binding to check`,
		};
	}
	const file = piDurableLocationPath(record.gardenId, opts.receiversDir);
	let text: string;
	try {
		text = readStoreRecordFile(file);
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		if (code === "ENOENT") return { ok: false, reason: "carrier-absent", detail: `${file} does not exist` };
		if (code === "ELOOP" || code === NOT_REGULAR_ENTRY_CODE) {
			return {
				ok: false,
				reason: "carrier-not-regular",
				detail: `${file} is not a regular file and is never followed`,
			};
		}
		return { ok: false, reason: "carrier-unreadable", detail: error instanceof Error ? error.message : String(error) };
	}
	let location: PiDurableLocation;
	try {
		location = parsePiDurableLocation(text, record.gardenId);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (error instanceof AddressMismatch) return { ok: false, reason: "carrier-address-mismatch", detail };
		return { ok: false, reason: "carrier-malformed", detail };
	}
	const differs = (["nativeSessionId", "cwd", "attachIncarnation"] as const).filter(
		(field) => location[field] !== record[field],
	);
	if (differs.length > 0) {
		return {
			ok: false,
			reason: "binding-mismatch",
			detail: `the carrier and the record of ${record.gardenId} differ on ${differs.join(", ")}`,
		};
	}
	try {
		const real = fs.realpathSync(location.nativeDirectory);
		if (real !== location.nativeDirectory) throw new Error(`it now resolves to ${real}`);
		if (!fs.statSync(real).isDirectory()) throw new Error("it is not a directory");
	} catch (error) {
		return {
			ok: false,
			reason: "native-directory-invalid",
			detail: `${location.nativeDirectory}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return { ok: true, record, location };
}
