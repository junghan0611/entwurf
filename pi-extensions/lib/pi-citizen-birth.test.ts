/**
 * pi-citizen-birth — a pi record write serializes on the record-arm lock (#151 b1).
 *
 * The production subject is `birthPiCitizen` (and the `expectGardenId` refusal it relies on in
 * `upsertMetaSession`). The oracle is the store and lock directory on disk: record bytes before
 * and after, and whether `<gardenId>.lock` exists. The foreign holder is a real claim taken
 * through the same `acquireLock` primitive with its own nonce, held by this live process.
 *
 * Isolation: every write names a throwaway store, and PI_CODING_AGENT_DIR points at a DIFFERENT
 * throwaway root, so a default path a mutant falls back to lands in the sandbox — never the
 * operator's — and stays distinguishable from the store's own sibling lock dir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireLock, type LockClaim, releaseLock } from "./entwurf-v2-lock.ts";
import { defaultMetaRecordArmLocksDir, UpsertGardenMismatchError, upsertMetaSession } from "./meta-session.ts";
import {
	ARM_LOCK_WAIT_MS,
	birthPiCitizen,
	type PiCitizenBirthInput,
	RecordArmLockBusyError,
	RecordArmLockReleaseError,
} from "./pi-citizen-birth.ts";

const SAVED = {
	agent: process.env.PI_CODING_AGENT_DIR,
	sessions: process.env.ENTWURF_META_SESSIONS_DIR,
	receivers: process.env.ENTWURF_META_RECEIVERS_DIR,
};
let root = "";
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "env-agent");
	delete process.env.ENTWURF_META_SESSIONS_DIR;
	delete process.env.ENTWURF_META_RECEIVERS_DIR;
});
afterAll(() => {
	for (const [key, value] of [
		["PI_CODING_AGENT_DIR", SAVED.agent],
		["ENTWURF_META_SESSIONS_DIR", SAVED.sessions],
		["ENTWURF_META_RECEIVERS_DIR", SAVED.receivers],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(root, { recursive: true, force: true });
});

let seq = 0;
/** A fresh store under its own parent; its lock dir is that parent's `meta-record-arm-locks`. */
function store(): { sessionsDir: string; locksDir: string; socketDir: string } {
	const base = path.join(root, `s${++seq}`);
	return {
		sessionsDir: path.join(base, "meta-sessions"),
		locksDir: path.join(base, "meta-record-arm-locks"),
		socketDir: path.join(base, "sockets"),
	};
}
const NATIVE = "01900000-0000-7000-8000-0000000151b1";

function born(s: ReturnType<typeof store>): { gardenId: string; recordPath: string } {
	const first = birthPiCitizen({ ...at(s), nativeSessionId: NATIVE, cwd: "/tmp" });
	return { gardenId: first.gardenId, recordPath: first.recordPath };
}
/** The dirs of a store, every one named: a named store must name its lock dir (one rule). */
function at(
	s: ReturnType<typeof store>,
): Pick<PiCitizenBirthInput, "sessionsDir" | "recordArmLocksDir" | "controlSocketDir"> {
	return { sessionsDir: s.sessionsDir, recordArmLocksDir: s.locksDir, controlSocketDir: s.socketDir };
}
/** The lock file a seam sees, read independently of the birth. */
function lockOnDisk(lockPath: string): { gardenId: string; pid: number; nonce: string } | null {
	return fs.existsSync(lockPath)
		? (JSON.parse(fs.readFileSync(lockPath, "utf8")) as { gardenId: string; pid: number; nonce: string })
		: null;
}
function holdForeign(gardenId: string, dir: string): LockClaim {
	const held = acquireLock(gardenId, { dir, nonce: () => "f".repeat(32) });
	if (!held.ok) throw new Error(`test could not take the foreign lock: ${held.conflict.detail}`);
	return held.claim;
}

describe("pi birth under the record-arm lock (#151 b1)", () => {
	it("[QK:RENEW-B1-ATTACH-RELEASES-LOCK] an attach to an existing record writes under the lock and leaves no lock behind", () => {
		const s = store();
		const { gardenId } = born(s);
		const again = birthPiCitizen({
			nativeSessionId: NATIVE,
			cwd: "/tmp",
			transcriptPath: "/tmp/b1.jsonl",
			...at(s),
			armLockWait: "once",
		});
		expect(again.action).toBe("attach");
		expect(again.gardenId).toBe(gardenId);
		expect(again.record.transcriptPath).toBe("/tmp/b1.jsonl");
		expect(fs.existsSync(path.join(s.locksDir, `${gardenId}.lock`))).toBe(false);
	});

	it("[QK:RENEW-B1-BUSY-WRITES-NOTHING] a lock someone else holds is the named busy refusal and the record bytes do not move", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const before = fs.readFileSync(recordPath);
		const claim = holdForeign(gardenId, s.locksDir);
		try {
			let caught: unknown = null;
			try {
				birthPiCitizen({
					nativeSessionId: NATIVE,
					cwd: "/elsewhere",
					transcriptPath: "/tmp/b1-busy.jsonl",
					...at(s),
					armLockWait: "once",
				});
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(RecordArmLockBusyError);
			expect((caught as RecordArmLockBusyError).code).toBe("record-arm-lock-busy");
			expect((caught as RecordArmLockBusyError).gardenId).toBe(gardenId);
			expect(fs.readFileSync(recordPath).equals(before)).toBe(true);
		} finally {
			releaseLock(claim, { dir: s.locksDir });
		}
	});

	it("[QK:RENEW-B1-BOUNDED-WAITS] the bounded mode polls for its bound before refusing; the once mode does not", () => {
		const s = store();
		const { gardenId } = born(s);
		const claim = holdForeign(gardenId, s.locksDir);
		try {
			const timed = (wait: "bounded" | "once"): number => {
				const start = Date.now();
				expect(() =>
					birthPiCitizen({
						nativeSessionId: NATIVE,
						cwd: "/tmp",
						...at(s),
						armLockWait: wait,
					}),
				).toThrow(RecordArmLockBusyError);
				return Date.now() - start;
			};
			expect(timed("bounded")).toBeGreaterThanOrEqual(ARM_LOCK_WAIT_MS - 50);
			expect(timed("once")).toBeLessThan(ARM_LOCK_WAIT_MS / 2);
		} finally {
			releaseLock(claim, { dir: s.locksDir });
		}
	});

	it("[QK:RENEW-B1-PRIMITIVE-THROW-NOT-BUSY] a lock the primitive cannot write is thrown as itself, never as busy, and nothing is written", () => {
		const s = store();
		const { recordPath } = born(s);
		const before = fs.readFileSync(recordPath);
		// The lock dir path is a regular file: the claim cannot be written there at all.
		fs.writeFileSync(s.locksDir, "not a directory");
		let caught: unknown = null;
		try {
			birthPiCitizen({
				nativeSessionId: NATIVE,
				cwd: "/elsewhere",
				...at(s),
				armLockWait: "once",
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(Error);
		expect(caught).not.toBeInstanceOf(RecordArmLockBusyError);
		expect((caught as { code?: unknown }).code).not.toBe("record-arm-lock-busy");
		expect(fs.readFileSync(recordPath).equals(before)).toBe(true);
	});

	it("[QK:RENEW-B1-EXPECT-GARDEN] an upsert whose record is not the garden its caller locked refuses before writing", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const before = fs.readFileSync(recordPath);
		const other = gardenId.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
		expect(() =>
			upsertMetaSession({
				input: { backend: "pi", nativeSessionId: NATIVE, cwd: "/elsewhere" },
				expectAction: "attach",
				expectGardenId: other,
				dir: s.sessionsDir,
			}),
		).toThrow(UpsertGardenMismatchError);
		expect(fs.readFileSync(recordPath).equals(before)).toBe(true);
	});

	it("[QK:RENEW-B1-NAMED-STORE-NAMES-LOCK] a named store must name its lock dir: refused before anything is read or written", () => {
		// A named store without a named lock dir is refused before anything is read or written.
		const s = store();
		expect(() =>
			birthPiCitizen({
				nativeSessionId: NATIVE,
				cwd: "/tmp",
				sessionsDir: s.sessionsDir,
				controlSocketDir: s.socketDir,
			}),
		).toThrow(/must also name its record-arm lock dir/);
		expect(fs.existsSync(s.sessionsDir)).toBe(false);
	});

	it("[QK:RENEW-B1-DEFAULT-LOCK-IS-HOOKS] one store, one lock namespace: the default and an explicit naming of it meet the same mutex as the hook", () => {
		// Defaults: the store and the receivers dir under DIFFERENT parents. A default birth and an explicit
		// birth naming the default lock dir meet the same mutex — the receivers parent's, not the store's.
		const base = path.join(root, `d${++seq}`);
		const S = path.join(base, "store-parent", "meta-sessions");
		const R = path.join(base, "receivers-parent", "meta-receivers");
		const saved = [process.env.ENTWURF_META_SESSIONS_DIR, process.env.ENTWURF_META_RECEIVERS_DIR];
		process.env.ENTWURF_META_SESSIONS_DIR = S;
		process.env.ENTWURF_META_RECEIVERS_DIR = R;
		try {
			const socketDir = path.join(base, "sockets");
			const { gardenId } = birthPiCitizen({ nativeSessionId: NATIVE, cwd: "/tmp", controlSocketDir: socketDir });
			const hookDir = defaultMetaRecordArmLocksDir();
			expect(hookDir).toBe(path.join(base, "receivers-parent", "meta-record-arm-locks"));
			const claim = holdForeign(gardenId, hookDir);
			try {
				expect(() =>
					birthPiCitizen({ nativeSessionId: NATIVE, cwd: "/tmp", controlSocketDir: socketDir, armLockWait: "once" }),
				).toThrow(RecordArmLockBusyError);
				expect(() =>
					birthPiCitizen({
						nativeSessionId: NATIVE,
						cwd: "/tmp",
						sessionsDir: S,
						recordArmLocksDir: hookDir,
						controlSocketDir: socketDir,
						armLockWait: "once",
					}),
				).toThrow(RecordArmLockBusyError);
			} finally {
				releaseLock(claim, { dir: hookDir });
			}
		} finally {
			if (saved[0] === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
			else process.env.ENTWURF_META_SESSIONS_DIR = saved[0];
			if (saved[1] === undefined) delete process.env.ENTWURF_META_RECEIVERS_DIR;
			else process.env.ENTWURF_META_RECEIVERS_DIR = saved[1];
		}
	});

	it("[QK:RENEW-B1-HOLDS-LOCK-DURING-WRITE] this call's claim is on disk when the record write starts and still there when it has finished", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const seen: {
			before: ReturnType<typeof lockOnDisk>;
			after: ReturnType<typeof lockOnDisk>;
			written: string | null;
		} = {
			before: null,
			after: null,
			written: null,
		};
		const out = birthPiCitizen({
			...at(s),
			nativeSessionId: NATIVE,
			cwd: "/tmp",
			transcriptPath: "/tmp/b1-held.jsonl",
			armLockWait: "once",
			_test_lockedWrite: {
				before: (lockPath) => {
					seen.before = lockOnDisk(lockPath);
				},
				after: (lockPath) => {
					seen.after = lockOnDisk(lockPath);
					seen.written =
						(JSON.parse(fs.readFileSync(recordPath, "utf8")) as { transcriptPath?: string }).transcriptPath ?? null;
				},
			},
		});
		for (const held of [seen.before, seen.after]) {
			expect(held?.gardenId).toBe(gardenId);
			expect(held?.pid).toBe(process.pid);
		}
		expect(seen.after?.nonce).toBe(seen.before?.nonce);
		expect(seen.written).toBe("/tmp/b1-held.jsonl");
		expect(out.armLockRelease).toBe("released");
		expect(fs.existsSync(path.join(s.locksDir, `${gardenId}.lock`))).toBe(false);
	});

	it("[QK:RENEW-B1-RELEASE-FAULT-AFTER-WRITE] a release that throws after the write keeps the write and says so, with no retry or rollback advice", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		let caught: unknown = null;
		try {
			birthPiCitizen({
				...at(s),
				nativeSessionId: NATIVE,
				cwd: "/tmp",
				transcriptPath: "/tmp/b1-kept.jsonl",
				armLockWait: "once",
				_test_lockedWrite: { after: () => fs.chmodSync(s.locksDir, 0o555) },
			});
		} catch (err) {
			caught = err;
		} finally {
			fs.chmodSync(s.locksDir, 0o755);
			fs.rmSync(path.join(s.locksDir, `${gardenId}.lock`), { force: true });
		}
		expect(caught).toBeInstanceOf(RecordArmLockReleaseError);
		const fault = caught as RecordArmLockReleaseError;
		expect(fault.code).toBe("record-arm-lock-release-failed");
		expect(fault.written.record.transcriptPath).toBe("/tmp/b1-kept.jsonl");
		expect((JSON.parse(fs.readFileSync(recordPath, "utf8")) as { transcriptPath?: string }).transcriptPath).toBe(
			"/tmp/b1-kept.jsonl",
		);
		expect(fault.message).toContain(`garden ${gardenId} was written`);
		expect(fault.message).toContain(path.join(s.locksDir, `${gardenId}.lock`));
		expect(fault.message).not.toMatch(/retry|rollback|roll back/i);
	});

	it("[QK:RENEW-B1-RELEASE-FAULT-AFTER-FAILED-WRITE] a write that fails and a release that throws both reach the message, with the garden and the lock", () => {
		const s = store();
		const { gardenId, recordPath } = born(s);
		const before = fs.readFileSync(recordPath);
		let caught: unknown = null;
		try {
			birthPiCitizen({
				...at(s),
				nativeSessionId: NATIVE,
				cwd: "/elsewhere",
				armLockWait: "once",
				_test_lockedWrite: {
					before: () => {
						fs.chmodSync(s.sessionsDir, 0o555);
						fs.chmodSync(s.locksDir, 0o555);
					},
				},
			});
		} catch (err) {
			caught = err;
		} finally {
			fs.chmodSync(s.sessionsDir, 0o755);
			fs.chmodSync(s.locksDir, 0o755);
			fs.rmSync(path.join(s.locksDir, `${gardenId}.lock`), { force: true });
		}
		expect(caught).toBeInstanceOf(AggregateError);
		const both = caught as AggregateError;
		expect(both.errors).toHaveLength(2);
		for (const cause of both.errors) expect(both.message).toContain((cause as Error).message);
		expect(both.message).toContain(`garden ${gardenId}`);
		expect(both.message).toContain(path.join(s.locksDir, `${gardenId}.lock`));
		expect(fs.readFileSync(recordPath).equals(before)).toBe(true);
	});

	it("[QK:RENEW-B1-RELEASE-NOT-PROVEN] a lock gone or someone else's at release is reported as that, and another's claim is left in place", () => {
		for (const how of ["not-owned", "absent"] as const) {
			const s = store();
			const { gardenId } = born(s);
			const lockPath = path.join(s.locksDir, `${gardenId}.lock`);
			const out = birthPiCitizen({
				...at(s),
				nativeSessionId: NATIVE,
				cwd: "/tmp",
				armLockWait: "once",
				_test_lockedWrite: {
					after: () => {
						if (how === "absent") fs.rmSync(lockPath);
						else {
							const claim = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Record<string, unknown>;
							fs.writeFileSync(lockPath, JSON.stringify({ ...claim, nonce: "e".repeat(32) }));
						}
					},
				},
			});
			expect(out.armLockRelease).toBe(how);
			if (how === "not-owned") expect(lockOnDisk(lockPath)?.nonce).toBe("e".repeat(32));
			fs.rmSync(lockPath, { force: true });
		}
	});
});
