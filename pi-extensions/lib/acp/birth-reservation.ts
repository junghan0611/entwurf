// #171 step 8 — the birth reservation: one file per Pi session, written before `session/new`.
//
// Decision 17: an ACP row is born once. `session/new` creates a vendor session whose id exists
// only in its answer; if that answer, or the write that keeps it, is lost, a second `session/new`
// for the same Pi session would open a second conversation inside the first. So immediately before
// `session/new` this file is created exclusively (`wx`) and made durable. It is never rewritten and
// never deleted. Its existence, whatever its bytes, means a birth was attempted for this Pi session:
// with a record the session continues from the record; without one the turn stops.
//
// The directory is HOME-based, beside the vendor overlays (overlay.ts), not under the Pi profile:
// the vendor session stores are per HOME, so a profile change must not hide a reservation.
//
// Scope, stated: the exclusion holds on one local store whose `O_EXCL` and `fsync` work. A HOME
// shared by two hosts over a network filesystem is not verified.

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function birthReservationDir(): string {
	return join(homedir(), ".pi", "agent", "entwurf-acp-births");
}

export function birthReservationPath(sessionKey: string, dir: string = birthReservationDir()): string {
	return join(dir, createHash("sha256").update(sessionKey).digest("hex"));
}

/** Whether anything sits at this session's reservation path. An error other than "absent" throws. */
export function birthReserved(sessionKey: string, dir: string = birthReservationDir()): boolean {
	try {
		lstatSync(birthReservationPath(sessionKey, dir));
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** The two durability calls, injectable so a test can see each one and make one fail. */
export interface BirthSync {
	file(fd: number): void;
	directory(path: string): void;
}

const REAL_SYNC: BirthSync = {
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

/** Directories whose whole chain of entries this process has synced, up to the filesystem root. */
const CERTIFIED = new Set<string>();

/**
 * Create this session's reservation and make it durable: the file, its entry in the directory, and
 * — once per process and directory — the entry of every directory above it up to the filesystem
 * root. Who created a directory is not asked: another process may have made it and stopped before
 * syncing it, and a reservation under an entry that is not durable is not durable either. Throws
 * `EEXIST` when one is already there and any other store error as it is; the caller sends nothing
 * in either case.
 */
export function publishBirthReservation(
	input: { sessionKey: string; backend: string; at: string },
	dir: string = birthReservationDir(),
	sync: BirthSync = REAL_SYNC,
	certified: Set<string> = CERTIFIED,
): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const fd = openSync(birthReservationPath(input.sessionKey, dir), "wx", 0o600);
	try {
		writeSync(fd, `${JSON.stringify({ sessionKey: input.sessionKey, backend: input.backend, at: input.at })}\n`);
		sync.file(fd);
	} finally {
		closeSync(fd);
	}
	sync.directory(dir);
	if (!certified.has(dir)) {
		// Each directory's own entry lives in its parent.
		for (let at = dirname(dir); ; at = dirname(at)) {
			sync.directory(at);
			if (at === dirname(at)) break;
		}
		certified.add(dir);
	}
}
