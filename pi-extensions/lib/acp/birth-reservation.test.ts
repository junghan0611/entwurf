/**
 * #171 step 8 — the birth reservation on a real directory.
 *
 * Oracle: the file system itself for exclusion (a second create must fail whatever the first left),
 * and the injected sync calls for durability: which of them ran, in what order, and that a failure
 * of any one of them leaves the caller with an error before `session/new`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { type BirthSync, birthReservationPath, birthReserved, publishBirthReservation } from "./birth-reservation.ts";

const ROOT = mkdtempSync(join(tmpdir(), "acp-birth-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const input = (sessionKey: string) => ({ sessionKey, backend: "claude", at: "2026-11-21T00:00:00Z" });

it("[QK:ACP-BIRTH-RESERVATION-EXCLUSIVE] one birth per Pi session: a second reservation fails, and anything at the path counts", () => {
	const dir = join(ROOT, "exclusive");
	expect(birthReserved("pi:a", dir)).toBe(false);
	publishBirthReservation(input("pi:a"), dir);
	expect(birthReserved("pi:a", dir)).toBe(true);
	expect(birthReserved("pi:b", dir)).toBe(false);
	const first = readFileSync(birthReservationPath("pi:a", dir), "utf8");
	expect(() => publishBirthReservation(input("pi:a"), dir)).toThrow(expect.objectContaining({ code: "EEXIST" }));
	// Never rewritten.
	expect(readFileSync(birthReservationPath("pi:a", dir), "utf8")).toBe(first);
	// An empty file, a partial one, a dangling link: each is a birth that was attempted.
	writeFileSync(birthReservationPath("pi:empty", dir), "");
	writeFileSync(birthReservationPath("pi:partial", dir), '{"sessionK');
	symlinkSync(join(dir, "nowhere"), birthReservationPath("pi:link", dir));
	for (const key of ["pi:empty", "pi:partial", "pi:link"]) {
		expect(birthReserved(key, dir), key).toBe(true);
		expect(() => publishBirthReservation(input(key), dir), key).toThrow(expect.objectContaining({ code: "EEXIST" }));
	}
	// A path that cannot be looked at is an error, never "absent".
	const file = join(ROOT, "not-a-directory");
	writeFileSync(file, "x");
	expect(() => birthReserved("pi:a", file)).toThrow(expect.objectContaining({ code: "ENOTDIR" }));
});

/** `dir`, then every directory above it up to the filesystem root. */
function chain(dir: string): string[] {
	const out = [dir];
	for (let at = dirname(dir); ; at = dirname(at)) {
		out.push(at);
		if (at === dirname(at)) break;
	}
	return out;
}

it("[QK:ACP-BIRTH-RESERVATION-DURABLE] the file, its directory and every directory above it are synced whoever created them, and a failed sync is an error", () => {
	const calls: string[] = [];
	const sync: BirthSync = {
		file: () => void calls.push("file"),
		directory: (path) => void calls.push(path),
	};
	// Another process made the directories and stopped before syncing them: this call creates none of
	// them, and its reservation is durable only if it syncs the whole chain all the same.
	const dir = join(ROOT, "durable", "made-by-another", "births");
	mkdirSync(dir, { recursive: true });
	const thisProcess = new Set<string>();
	publishBirthReservation(input("pi:a"), dir, sync, thisProcess);
	expect(calls).toEqual(["file", ...chain(dir)]);
	expect(calls.at(-1)).toBe(chain(dir).at(-1));
	expect(dirname(calls.at(-1) as string)).toBe(calls.at(-1));
	// The chain was synced by this process: after that, the file and its own entry.
	calls.length = 0;
	publishBirthReservation(input("pi:b"), dir, sync, thisProcess);
	expect(calls).toEqual(["file", dir]);
	// A process that has not synced the chain itself does not take another's word for it.
	calls.length = 0;
	publishBirthReservation(input("pi:c"), dir, sync, new Set());
	expect(calls).toEqual(["file", ...chain(dir)]);

	for (const failing of ["file", "directory"] as const) {
		const broken: BirthSync = {
			file: () => {
				if (failing === "file") throw Object.assign(new Error("io"), { code: "EIO" });
			},
			directory: () => {
				if (failing === "directory") throw Object.assign(new Error("io"), { code: "EIO" });
			},
		};
		const certified = new Set<string>();
		expect(() => publishBirthReservation(input(`pi:${failing}`), dir, broken, certified), failing).toThrow(
			expect.objectContaining({ code: "EIO" }),
		);
		// A chain that was not synced is not remembered as synced.
		expect(certified.size, failing).toBe(0);
		// What was created stays: a birth that may not be durable is still never attempted twice.
		expect(existsSync(birthReservationPath(`pi:${failing}`, dir)), failing).toBe(true);
	}
});
