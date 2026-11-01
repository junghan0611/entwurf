/**
 * #157 B3 C4 — pi-durable location evidence: the carrier one birth writes beside the receivers root,
 * bound to its record by the record's `attachIncarnation`, and the verification leaf that reads it from
 * the garden id alone.
 *
 * Hermetic: every root is a fresh temp directory and every path is passed explicitly — no HOME, agent
 * directory or environment default is read. The native session directory is a plain directory made here;
 * the one file put inside it is an inert sentinel, never a database, and nothing opens it.
 *
 * Oracles are independent of the subject: the carrier's directory, file name and keyset are literals
 * typed here; records and carriers are read as raw JSON; the owner start key is read from `/proc` here;
 * every mutated carrier is written here as raw text.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, releaseLock } from "./entwurf-v2-lock.ts";
import { upsertMetaSession } from "./meta-session.ts";
import { commitPiDurableBirth, PiDurableLocationError, verifyPiDurableLocation } from "./pi-durable-location.ts";

const N = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const OTHER_N = "1759622499999-6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const CWD_HASH = "0123456789abcdef01234567";
const HEX32 = /^[0-9a-f]{32}$/;
const KEYS = [
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

let root: string;
let realRoot: string;
let sessionsDir: string;
let receiversDir: string;
let cwd: string;
let nativeDir: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-location-"));
	realRoot = fs.realpathSync(root);
	sessionsDir = path.join(root, "meta-sessions");
	receiversDir = path.join(root, "meta-receivers");
	cwd = path.join(realRoot, "project");
	fs.mkdirSync(cwd);
	nativeDir = path.join(root, "agent", "experimental", "durable-sessions", CWD_HASH, N);
	fs.mkdirSync(nativeDir, { recursive: true });
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const locationsDir = (base = root) => path.join(base, "meta-pi-durable-locations");
const carrierFile = (gid: string, base = root) => path.join(locationsDir(base), `${gid}.location.json`);
const armLocks = () => path.join(root, "meta-record-arm-locks");
const realNativeDir = () => path.join(realRoot, "agent", "experimental", "durable-sessions", CWD_HASH, N);

function readJson(file: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function recordOf(gid: string): Record<string, unknown> {
	return readJson(path.join(sessionsDir, `${gid}.meta.json`));
}

/** /proc/<pid>/stat field 22, read here and not through the subject's helper. */
function procStartTime(pid: number): string {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] as string;
}

function commit(over: Partial<Parameters<typeof commitPiDurableBirth>[0]> = {}) {
	return commitPiDurableBirth({
		nativeSessionId: N,
		cwd,
		sessionDirectory: nativeDir,
		ownerPid: process.pid,
		sessionsDir,
		receiversDir,
		...over,
	});
}

function verify(gid: string, receivers = receiversDir) {
	return verifyPiDurableLocation({ gardenId: gid, sessionsDir, receiversDir: receivers });
}

function caught(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("expected a throw");
}

describe("pi-durable location — the birth's binding", () => {
	it("[QK:PDL-COMMIT-BINDS-PAIR] a birth mints the record's attachIncarnation and writes the same value, with the realpath directory and owner, into one private carrier beside the receivers root; a later birth mints again", () => {
		const first = commit();
		expect(first.action).toBe("create");
		const gid = first.record.gardenId;
		const inc1 = recordOf(gid).attachIncarnation;
		expect(inc1).toMatch(HEX32);
		expect(first.locationPath).toBe(carrierFile(gid));
		const c1 = readJson(carrierFile(gid));
		expect(Object.keys(c1)).toEqual(KEYS);
		expect(c1).toEqual({
			schemaVersion: 1,
			gardenId: gid,
			backend: "pi-durable",
			nativeSessionId: N,
			cwd,
			nativeDirectory: realNativeDir(),
			ownerPid: process.pid,
			ownerStartKey: `linux:${procStartTime(process.pid)}`,
			attachIncarnation: inc1,
			writtenAt: expect.any(String),
		});
		expect(fs.statSync(carrierFile(gid)).mode & 0o777).toBe(0o600);
		expect(fs.statSync(locationsDir()).mode & 0o777).toBe(0o700);
		expect(fs.readdirSync(locationsDir())).toEqual([`${gid}.location.json`]);
		expect(verify(gid)).toMatchObject({ ok: true, location: c1 });

		const second = commit();
		expect(second.action).toBe("attach");
		expect(second.record.gardenId).toBe(gid);
		const inc2 = recordOf(gid).attachIncarnation;
		expect(inc2).toMatch(HEX32);
		expect(inc2).not.toBe(inc1);
		expect(readJson(carrierFile(gid)).attachIncarnation).toBe(inc2);
		expect(fs.readdirSync(sessionsDir)).toEqual([`${gid}.meta.json`]);
		expect(verify(gid)).toMatchObject({ ok: true });
		const probe = acquireLock(gid, { dir: armLocks() });
		expect(probe.ok).toBe(true);
		if (probe.ok) releaseLock(probe.claim, { dir: armLocks() });
	});

	it("[QK:PDL-NATIVE-DIRECTORY-REALPATH] a session directory reached through a symlink is recorded as the directory itself", () => {
		const alias = path.join(root, "alias-to-session");
		fs.symlinkSync(nativeDir, alias);
		const { record } = commit({ sessionDirectory: alias });
		expect(readJson(carrierFile(record.gardenId)).nativeDirectory).toBe(realNativeDir());
	});

	it("[QK:PDL-ROOT-ISOLATION] the carrier lives in its own sibling of the receivers root actually used — never in the store, the receivers, the senders or the mailbox", () => {
		const { record } = commit();
		const gid = record.gardenId;
		expect(fs.readdirSync(root).sort()).toEqual([
			"agent",
			"meta-pi-durable-locations",
			"meta-record-arm-locks",
			"meta-sessions",
			"project",
		]);
		expect(fs.readdirSync(sessionsDir)).toEqual([`${gid}.meta.json`]);

		const elsewhere = path.join(root, "elsewhere");
		const moved = commit({ receiversDir: path.join(elsewhere, "meta-receivers") });
		expect(moved.locationPath).toBe(carrierFile(gid, elsewhere));
		expect(verify(gid, path.join(elsewhere, "meta-receivers"))).toMatchObject({ ok: true });
		expect(verify(gid)).toMatchObject({ ok: false, reason: "binding-mismatch" });
	});

	it("[QK:PDL-REFUSES-BEFORE-WRITE] a missing, non-directory or relative session directory, an unreadable owner start key or a relative receivers root fails the birth by name with nothing written", () => {
		const file = path.join(root, "a-file");
		fs.writeFileSync(file, "");
		const pidMax = Number(fs.readFileSync("/proc/sys/kernel/pid_max", "utf8").trim());
		const cases: [string, Partial<Parameters<typeof commitPiDurableBirth>[0]>, string | RegExp][] = [
			["missing", { sessionDirectory: path.join(root, "absent") }, "native-directory-invalid"],
			["a file", { sessionDirectory: file }, "native-directory-invalid"],
			["relative", { sessionDirectory: "agent/session" }, "native-directory-invalid"],
			["owner unknown", { ownerPid: pidMax + 1 }, "owner-start-key-unreadable"],
			["relative receivers", { receiversDir: "relative/meta-receivers" }, /receivers root must be absolute/],
		];
		for (const [name, over, expected] of cases) {
			const error = caught(() => commit(over));
			if (typeof expected === "string") {
				expect(error, name).toBeInstanceOf(PiDurableLocationError);
				expect((error as PiDurableLocationError).reason, name).toBe(expected);
			} else {
				expect((error as Error).message, name).toMatch(expected);
			}
			expect(fs.existsSync(sessionsDir), name).toBe(false);
			expect(fs.existsSync(locationsDir()), name).toBe(false);
			expect(fs.existsSync(armLocks()), name).toBe(false);
		}
		expect(fs.existsSync(path.join(process.cwd(), "relative"))).toBe(false);
	});

	it("[QK:PDL-REFUSES-IMPLAUSIBLE-OWNER-PID] an owner pid the carrier's parser would refuse (pid 1) fails the birth by name with nothing written", () => {
		const error = caught(() => commit({ ownerPid: 1 }));
		expect(error).toBeInstanceOf(PiDurableLocationError);
		expect((error as PiDurableLocationError).reason).toBe("owner-pid-implausible");
		expect(fs.existsSync(sessionsDir)).toBe(false);
		expect(fs.existsSync(locationsDir())).toBe(false);
		expect(fs.existsSync(armLocks())).toBe(false);
	});

	it("[QK:PDL-REFUSES-RELATIVE-CWD] a cwd the carrier's parser would refuse (relative) fails the birth by name with nothing written", () => {
		const error = caught(() => commit({ cwd: "project" }));
		expect(error).toBeInstanceOf(PiDurableLocationError);
		expect((error as PiDurableLocationError).reason).toBe("cwd-not-absolute");
		expect(fs.existsSync(sessionsDir)).toBe(false);
		expect(fs.existsSync(locationsDir())).toBe(false);
		expect(fs.existsSync(armLocks())).toBe(false);
	});
});

describe("pi-durable location — the three failure states are distinct", () => {
	it("[QK:PDL-ARM-LOCK-BUSY-KEEPS-OLD-PAIR] (a) a busy record-arm lock fails the birth before the minted write: an older matching pair stays matching, and a first birth's create-only record stays unbound", () => {
		const first = commit();
		const gid = first.record.gardenId;
		const before = recordOf(gid).attachIncarnation;
		const bytes = fs.readFileSync(carrierFile(gid), "utf8");
		const held = acquireLock(gid, { dir: armLocks() });
		expect(held.ok).toBe(true);
		const error = caught(() => commit());
		expect((error as PiDurableLocationError).reason).toBe("record-arm-lock-busy");
		expect(recordOf(gid).attachIncarnation).toBe(before);
		expect(fs.readFileSync(carrierFile(gid), "utf8")).toBe(bytes);
		expect(verify(gid)).toMatchObject({ ok: true });
		if (held.ok) releaseLock(held.claim, { dir: armLocks() });

		const created = upsertMetaSession({
			input: { backend: "pi-durable", nativeSessionId: OTHER_N, cwd, model: null, transcriptPath: null },
			expectAction: "create",
			dir: sessionsDir,
		}).record.gardenId;
		const heldNew = acquireLock(created, { dir: armLocks() });
		expect(heldNew.ok).toBe(true);
		const errorNew = caught(() => commit({ nativeSessionId: OTHER_N }));
		expect((errorNew as PiDurableLocationError).reason).toBe("record-arm-lock-busy");
		expect(recordOf(created).attachIncarnation).toBeNull();
		expect(fs.existsSync(carrierFile(created))).toBe(false);
		expect(verify(created)).toMatchObject({ ok: false, reason: "record-unbound" });
		if (heldNew.ok) releaseLock(heldNew.claim, { dir: armLocks() });
	});

	it.skipIf(process.getuid?.() === 0)(
		"[QK:PDL-CARRIER-WRITE-FAILS-MISMATCH] (b) a carrier that cannot be written after the minted record fails the birth by name, releases the lock and leaves record ≠ carrier, which every read refuses; a failed rename leaves no tmp",
		() => {
			const first = commit();
			const gid = first.record.gardenId;
			const inc1 = recordOf(gid).attachIncarnation;
			fs.chmodSync(locationsDir(), 0o500);
			let error: unknown;
			try {
				error = caught(() => commit());
			} finally {
				fs.chmodSync(locationsDir(), 0o700);
			}
			expect((error as PiDurableLocationError).reason).toBe("carrier-write-failed");
			const inc2 = recordOf(gid).attachIncarnation;
			expect(inc2).toMatch(HEX32);
			expect(inc2).not.toBe(inc1);
			expect(readJson(carrierFile(gid)).attachIncarnation).toBe(inc1);
			const verdict = verify(gid);
			expect(verdict).toMatchObject({ ok: false, reason: "binding-mismatch" });
			expect(verdict.ok ? "" : verdict.detail).toMatch(/differ on attachIncarnation$/);
			const probe = acquireLock(gid, { dir: armLocks() });
			expect(probe.ok).toBe(true);
			if (probe.ok) releaseLock(probe.claim, { dir: armLocks() });

			fs.rmSync(carrierFile(gid));
			fs.mkdirSync(carrierFile(gid));
			expect((caught(() => commit()) as PiDurableLocationError).reason).toBe("carrier-write-failed");
			expect(fs.readdirSync(locationsDir())).toEqual([`${gid}.location.json`]);
			expect(verify(gid)).toMatchObject({ ok: false, reason: "carrier-not-regular" });
		},
	);

	it("[QK:PDL-TMP-COLLISION-NOT-OURS] a birth whose exclusive tmp name is already taken fails by name and leaves that entry as it was — bytes and inode — while a write that fails after creating its own tmp still removes it", () => {
		const first = commit();
		const gid = first.record.gardenId;
		const carrierBefore = fs.readFileSync(carrierFile(gid), "utf8");
		const FIXED_MS = 1790000000000;
		// The tmp grammar, spelled here: `<carrier>.tmp-<pid>-<ms>`.
		const taken = `${carrierFile(gid)}.tmp-${process.pid}-${FIXED_MS}`;
		fs.writeFileSync(taken, "not this birth's\n", { mode: 0o600 });
		const before = fs.statSync(taken);
		const now = vi.spyOn(Date, "now").mockReturnValue(FIXED_MS);
		let error: unknown;
		try {
			error = caught(() => commit());
		} finally {
			now.mockRestore();
		}
		expect((error as PiDurableLocationError).reason).toBe("carrier-write-failed");
		expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe("EEXIST");
		const after = fs.statSync(taken);
		expect(fs.readFileSync(taken, "utf8")).toBe("not this birth's\n");
		expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
		expect(fs.readFileSync(carrierFile(gid), "utf8")).toBe(carrierBefore);
		expect(fs.readdirSync(locationsDir()).sort()).toEqual([`${gid}.location.json`, path.basename(taken)].sort());

		// Its own tmp: created, then the rename fails (a directory holds the carrier's name) — removed, and the
		// unrelated entry is still there, unchanged.
		fs.rmSync(carrierFile(gid));
		fs.mkdirSync(carrierFile(gid));
		expect((caught(() => commit()) as PiDurableLocationError).reason).toBe("carrier-write-failed");
		expect(fs.readdirSync(locationsDir()).sort()).toEqual([`${gid}.location.json`, path.basename(taken)].sort());
		expect(fs.readFileSync(taken, "utf8")).toBe("not this birth's\n");
		expect(fs.statSync(taken).ino).toBe(before.ino);
	});
});

describe("pi-durable location — the verification leaf refuses by name", () => {
	function bound() {
		const { record } = commit();
		return { gid: record.gardenId, carrier: readJson(carrierFile(record.gardenId)) };
	}

	it("[QK:PDL-VERIFY-CARRIER-REFUSALS] a carrier whose body names another garden, drifts from the record's binding, or breaks the schema is refused by name", () => {
		const cases: [string, (c: Record<string, unknown>) => string, string, RegExp?][] = [
			[
				"another garden",
				(c) => JSON.stringify({ ...c, gardenId: "20260101T000000-aaaaaa" }),
				"carrier-address-mismatch",
			],
			["another backend", (c) => JSON.stringify({ ...c, backend: "pi" }), "carrier-malformed"],
			["another N", (c) => JSON.stringify({ ...c, nativeSessionId: OTHER_N }), "binding-mismatch", /nativeSessionId/],
			["another cwd", (c) => JSON.stringify({ ...c, cwd: "/elsewhere" }), "binding-mismatch", /cwd/],
			[
				"another incarnation",
				(c) => JSON.stringify({ ...c, attachIncarnation: "f".repeat(32) }),
				"binding-mismatch",
				/attachIncarnation/,
			],
			["null incarnation", (c) => JSON.stringify({ ...c, attachIncarnation: null }), "carrier-malformed", /null/],
			["stray key", (c) => JSON.stringify({ ...c, presence: "alive" }), "carrier-malformed", /unexpected key/],
			[
				"missing key",
				(c) => {
					const { writtenAt: _dropped, ...rest } = c;
					return JSON.stringify(rest);
				},
				"carrier-malformed",
				/lacks/,
			],
			["another schema", (c) => JSON.stringify({ ...c, schemaVersion: 2 }), "carrier-malformed"],
			["bad JSON", () => "{", "carrier-malformed"],
			["relative directory", (c) => JSON.stringify({ ...c, nativeDirectory: "durable/N" }), "carrier-malformed"],
			["implausible owner", (c) => JSON.stringify({ ...c, ownerPid: 1 }), "carrier-malformed"],
		];
		for (const [name, mutate, reason, detail] of cases) {
			fs.rmSync(root, { recursive: true, force: true });
			fs.mkdirSync(cwd, { recursive: true });
			fs.mkdirSync(nativeDir, { recursive: true });
			const { gid, carrier } = bound();
			fs.writeFileSync(carrierFile(gid), mutate(carrier));
			const verdict = verify(gid);
			expect(verdict, name).toMatchObject({ ok: false, reason });
			if (detail !== undefined) expect(verdict.ok ? "" : verdict.detail, name).toMatch(detail);
		}
	});

	it("[QK:PDL-VERIFY-ENTRY-REFUSALS] an absent carrier, a symlink or a directory at its name, an unaddressable, foreign-backend or unbound record, and a session directory that is gone, moved or not a directory are refused by name", () => {
		const { gid, carrier } = bound();
		const file = carrierFile(gid);
		const bytes = fs.readFileSync(file, "utf8");

		fs.rmSync(file);
		expect(verify(gid)).toMatchObject({ ok: false, reason: "carrier-absent" });
		const copy = path.join(root, "copy.location.json");
		fs.writeFileSync(copy, bytes);
		fs.symlinkSync(copy, file);
		expect(verify(gid)).toMatchObject({ ok: false, reason: "carrier-not-regular" });
		fs.rmSync(file);
		fs.mkdirSync(file);
		expect(verify(gid)).toMatchObject({ ok: false, reason: "carrier-not-regular" });
		fs.rmdirSync(file);
		fs.writeFileSync(file, bytes);
		expect(verify(gid)).toMatchObject({ ok: true });

		expect(verify("20260101T000000-aaaaaa")).toMatchObject({ ok: false, reason: "record-unaddressable" });
		const pi = upsertMetaSession({
			input: { backend: "pi", nativeSessionId: OTHER_N, cwd, model: null, transcriptPath: null },
			dir: sessionsDir,
		}).record.gardenId;
		fs.writeFileSync(carrierFile(pi), JSON.stringify({ ...carrier, gardenId: pi }));
		expect(verify(pi)).toMatchObject({ ok: false, reason: "record-not-pi-durable" });
		const unbound = upsertMetaSession({
			input: {
				backend: "pi-durable",
				nativeSessionId: "1759622488888-1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
				cwd,
				model: null,
				transcriptPath: null,
			},
			dir: sessionsDir,
		}).record.gardenId;
		expect(verify(unbound)).toMatchObject({ ok: false, reason: "record-unbound" });

		const parked = `${nativeDir}.parked`;
		fs.renameSync(nativeDir, parked);
		expect(verify(gid)).toMatchObject({ ok: false, reason: "native-directory-invalid" });
		fs.symlinkSync(parked, nativeDir);
		expect(verify(gid)).toMatchObject({ ok: false, reason: "native-directory-invalid" });
		fs.rmSync(nativeDir);
		fs.writeFileSync(nativeDir, "");
		expect(verify(gid)).toMatchObject({ ok: false, reason: "native-directory-invalid" });
	});

	it("[QK:PDL-READ-RETAINS] reading changes nothing: a pass or a refusal leaves the carrier and the session directory as they were, and a carrier whose record is gone stays, inert", () => {
		const { gid } = bound();
		const sentinel = path.join(nativeDir, "session.sqlite");
		fs.writeFileSync(sentinel, "not a database");
		const file = carrierFile(gid);
		const before = { bytes: fs.readFileSync(file, "utf8"), mtime: fs.statSync(file).mtimeMs };
		const listing = fs.readdirSync(nativeDir);

		expect(verify(gid)).toMatchObject({ ok: true });
		expect(verify(gid, path.join(root, "elsewhere", "meta-receivers"))).toMatchObject({
			ok: false,
			reason: "carrier-absent",
		});
		fs.rmSync(path.join(sessionsDir, `${gid}.meta.json`));
		expect(verify(gid)).toMatchObject({ ok: false, reason: "record-unaddressable" });

		expect({ bytes: fs.readFileSync(file, "utf8"), mtime: fs.statSync(file).mtimeMs }).toEqual(before);
		expect(fs.readdirSync(nativeDir)).toEqual(listing);
		expect(fs.readFileSync(sentinel, "utf8")).toBe("not a database");
	});
});
