/**
 * retirement-event — the #106 B machine-readable retirement record's APPEND leaf (#147).
 *
 * One target-gid-keyed append-only sidecar per citizen: `<retirementsDir>/<targetGardenId>.jsonl`,
 * one closed v1 JSON line per event. The event body names both ends explicitly
 * (`actorGardenId` / `targetGardenId`) — the filename is never the only carrier.
 *
 * What this leaf is NOT:
 *   - not an identity field, liveness fact, dormancy proof, permission or grant. Nothing that
 *     decides dispatch, facts, peers or resume reads it; there is no production reader at all.
 *   - not a receipt framework. It appends exactly the event it is handed; minting `eventId`/`at`,
 *     mapping a dispatch outcome to a summary and the requested/outcome ordering belong to the
 *     caller's join.
 *   - not a retention, GC or scanning surface. Absence of a line is `unknown`, never "no retire".
 *
 * Path: the directory is an explicit argument. The composition computes it ONCE from its own
 * fixed sessions directory with `retirementsDirBesideSessions`; this module reads no environment
 * and resolves no home directory.
 *
 * IO boundary (Linux-certified, same stance as `readStoreRecordFile` in meta-session.ts):
 *   - the directory is created 0700 if absent (parent must exist); an existing entry must be a
 *     real directory, never a symlink.
 *   - the file is opened O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW|O_NONBLOCK, 0600 on create. A final
 *     symlink fails (ELOOP), a directory fails (EISDIR), a FIFO never blocks (ENXIO without a
 *     reader; with one, the fstat check below refuses it).
 *   - the OPENED fd must be a regular file with exactly one link (a hardlink is not appended to).
 *   - the whole line is ONE writeSync; a short write is an error. A short write can leave a
 *     partial tail line in the file — that is reported, never hidden or repaired here.
 *   - fsyncSync, then close. fsync is a flush request to this file, not a power-loss or
 *     multi-file transaction guarantee.
 * Residual, outside this leaf: ancestors of the directory are not checked; an existing file's
 * mode is not changed; a same-user process that can rename entries in the directory can swap the
 * name after open (the write still lands on the inode that was checked). The threat model is the
 * same-user store every other meta sidecar shares.
 *
 * Errors: an invalid event or a refused entry throws `RetirementEventError`; a native fs error
 * (ELOOP, EISDIR, ENXIO, EIO, …) is thrown as it is. Either way the append fails ONCE — no retry.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isValidSessionId } from "./session-id.js";

export const RETIREMENT_EVENT_VERSION = 1 as const;
export const RETIREMENTS_DIR_NAME = "meta-retirements";
export const RETIREMENT_EVENT_SUFFIX = ".jsonl";

export type RetirementTargetBackend = "pi" | "claude-code";

/**
 * Which outcome statuses each backend can truthfully report: Pi's request boundaries
 * (`shutdown-requested` is a request ACK, never an exit) and the Claude Code adapter's outcomes
 * (`exited` is that fd-pinned process only). A cross-domain pair — Pi `exited`, Claude Code
 * `shutdown-requested` — is refused, so it can never become a durable line. A dispatch-level
 * unknown is `unknown` on either side.
 */
export const RETIREMENT_OUTCOME_STATUSES_BY_BACKEND = {
	pi: ["shutdown-requested", "refused", "unknown"],
	"claude-code": ["exited", "refused", "not-signalled", "unknown"],
} as const satisfies Record<RetirementTargetBackend, readonly string[]>;
export type RetirementOutcomeStatus = (typeof RETIREMENT_OUTCOME_STATUSES_BY_BACKEND)[RetirementTargetBackend][number];

/**
 * A closed semantic summary. `reason` is null or a short lowercase token; it is never detail,
 * cause, stderr or other free text. The token check is a FORMAT check, not a secret sanitizer.
 * The adapters' reason values are typed `string` (not an enum): which of them may be recorded,
 * or mapped to null, is the composition's join to decide, not this leaf's.
 */
export interface RetirementOutcomeSummary {
	status: RetirementOutcomeStatus;
	reason: string | null;
}

export interface RetirementRequestedEvent {
	v: typeof RETIREMENT_EVENT_VERSION;
	kind: "retirement-requested";
	eventId: string;
	at: string;
	actorGardenId: string;
	targetGardenId: string;
	targetBackend: RetirementTargetBackend;
}

export interface RetirementOutcomeEvent {
	v: typeof RETIREMENT_EVENT_VERSION;
	kind: "retirement-outcome";
	eventId: string;
	at: string;
	actorGardenId: string;
	targetGardenId: string;
	targetBackend: RetirementTargetBackend;
	outcome: RetirementOutcomeSummary;
}

export type RetirementEvent = RetirementRequestedEvent | RetirementOutcomeEvent;

export class RetirementEventError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RetirementEventError";
	}
}

const EVENT_ID_RE = /^[0-9a-f]{32}$/;
/** The shape of `Date#toISOString()` output; calendar validity is the round-trip below. */
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REASON_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const BASE_KEYS = ["v", "kind", "eventId", "at", "actorGardenId", "targetGardenId", "targetBackend"] as const;
const OUTCOME_KEYS = ["status", "reason"] as const;

/**
 * Read a plain object's own DATA properties exactly once. A foreign prototype (and with it an
 * inherited `toJSON`), an accessor or a symbol key refuses, so what is validated is what is
 * written: serialization only ever sees the fresh object built from these values.
 */
function snapshotPlain(value: unknown, what: string): Map<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RetirementEventError(`${what} must be an object`);
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) throw new RetirementEventError(`${what} must be a plain object`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const fields = new Map<string, unknown>();
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== "string") throw new RetirementEventError(`${what} must not carry symbol keys`);
		const descriptor = descriptors[key];
		if (!("value" in descriptor)) throw new RetirementEventError(`${what}.${key} must be a data property`);
		fields.set(key, descriptor.value);
	}
	return fields;
}

function requireExactKeys(fields: Map<string, unknown>, keys: readonly string[], what: string): void {
	const extra = [...fields.keys()].filter((key) => !keys.includes(key));
	const missing = keys.filter((key) => !fields.has(key));
	if (extra.length > 0 || missing.length > 0) {
		throw new RetirementEventError(
			`${what} keyset is closed: missing [${missing.join(", ")}], not allowed [${extra.join(", ")}]`,
		);
	}
}

/** Exactly `Date#toISOString()` of a real instant: 2026-02-30 or 24:00 does not round-trip. */
function isIsoInstant(value: unknown): value is string {
	if (typeof value !== "string" || !AT_RE.test(value)) return false;
	const ms = Date.parse(value);
	return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

/**
 * Validate ONE snapshot of the event and return its exact on-disk bytes (canonical key order, one
 * UTF-8 line) together with the target id taken from that same snapshot. The append routes the
 * file by this id, never by re-reading the caller's object.
 */
function validateRetirementEvent(event: RetirementEvent): { bytes: Buffer; targetGardenId: string } {
	const f = snapshotPlain(event, "retirement event");
	const kind = f.get("kind");
	if (kind !== "retirement-requested" && kind !== "retirement-outcome") {
		throw new RetirementEventError(`unknown retirement event kind: ${String(kind)}`);
	}
	requireExactKeys(f, kind === "retirement-outcome" ? [...BASE_KEYS, "outcome"] : BASE_KEYS, `${kind} event`);
	const v = f.get("v");
	const eventId = f.get("eventId");
	const at = f.get("at");
	const actorGardenId = f.get("actorGardenId");
	const targetGardenId = f.get("targetGardenId");
	const targetBackend = f.get("targetBackend");
	if (v !== RETIREMENT_EVENT_VERSION) throw new RetirementEventError(`unsupported event version: ${String(v)}`);
	if (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId)) {
		throw new RetirementEventError("eventId must be 32 lowercase hex characters");
	}
	if (!isIsoInstant(at)) throw new RetirementEventError("at must be a valid Date#toISOString() instant");
	if (!isValidSessionId(actorGardenId)) throw new RetirementEventError("actorGardenId is not a garden id");
	if (!isValidSessionId(targetGardenId)) throw new RetirementEventError("targetGardenId is not a garden id");
	if (targetBackend !== "pi" && targetBackend !== "claude-code") {
		throw new RetirementEventError(`unsupported targetBackend: ${String(targetBackend)}`);
	}
	const base = { v, kind, eventId, at, actorGardenId, targetGardenId, targetBackend };
	const line = (body: object) => ({ bytes: Buffer.from(`${JSON.stringify(body)}\n`, "utf8"), targetGardenId });
	if (kind === "retirement-requested") return line(base);

	const o = snapshotPlain(f.get("outcome"), "outcome summary");
	requireExactKeys(o, OUTCOME_KEYS, "outcome summary");
	const status = o.get("status");
	const reason = o.get("reason");
	const allowed: readonly unknown[] = RETIREMENT_OUTCOME_STATUSES_BY_BACKEND[targetBackend];
	if (!allowed.includes(status)) {
		throw new RetirementEventError(`outcome status ${String(status)} is not a ${targetBackend} outcome`);
	}
	if (reason !== null && (typeof reason !== "string" || !REASON_RE.test(reason))) {
		throw new RetirementEventError("outcome reason must be null or a short lowercase token");
	}
	return line({ ...base, outcome: { status, reason } });
}

/** Validate one event and return its exact on-disk bytes: canonical key order, one UTF-8 line. */
export function serializeRetirementEvent(event: RetirementEvent): Buffer {
	return validateRetirementEvent(event).bytes;
}

/** Pure path: the sidecar directory beside a FIXED sessions directory. */
export function retirementsDirBesideSessions(sessionsDir: string): string {
	if (!path.isAbsolute(sessionsDir)) throw new RetirementEventError("sessionsDir must be an absolute path");
	return path.join(path.dirname(path.resolve(sessionsDir)), RETIREMENTS_DIR_NAME);
}

export function retirementEventFile(retirementsDir: string, targetGardenId: string): string {
	if (!path.isAbsolute(retirementsDir)) throw new RetirementEventError("retirementsDir must be an absolute path");
	if (!isValidSessionId(targetGardenId)) throw new RetirementEventError("targetGardenId is not a garden id");
	return path.join(retirementsDir, `${targetGardenId}${RETIREMENT_EVENT_SUFFIX}`);
}

function ensureRealDirectory(dir: string): void {
	try {
		fs.mkdirSync(dir, { mode: 0o700 });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
	}
	const st = fs.lstatSync(dir);
	if (st.isSymbolicLink() || !st.isDirectory()) {
		throw new RetirementEventError(`${path.basename(dir)} is not a real directory; refusing to append`);
	}
}

/** Append ONE validated event line to the target's sidecar. Throws once on any failure. */
export function appendRetirementEvent(retirementsDir: string, event: RetirementEvent): { bytes: number } {
	const { bytes, targetGardenId } = validateRetirementEvent(event);
	const file = retirementEventFile(retirementsDir, targetGardenId);
	const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
	if (!O_NOFOLLOW || !O_NONBLOCK) {
		throw new RetirementEventError(
			"this platform exposes no O_NOFOLLOW/O_NONBLOCK, so the append cannot refuse a symlink or FIFO",
		);
	}
	ensureRealDirectory(retirementsDir);
	const fd = fs.openSync(file, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600);
	try {
		const st = fs.fstatSync(fd);
		if (!st.isFile()) throw new RetirementEventError(`${path.basename(file)} is not a regular file`);
		if (st.nlink !== 1) throw new RetirementEventError(`${path.basename(file)} has ${st.nlink} links; refusing`);
		const written = fs.writeSync(fd, bytes, 0, bytes.length);
		if (written !== bytes.length) {
			throw new RetirementEventError(
				`short write: ${written} of ${bytes.length} bytes; the file may now end in a partial line`,
			);
		}
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	return { bytes: bytes.length };
}
