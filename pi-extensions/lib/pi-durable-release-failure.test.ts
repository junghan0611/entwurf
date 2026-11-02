/**
 * #157 S3 joint review D1/D3/D4 — what a reserve or a withdrawal reports when a lock release fails AFTER its own
 * decision write, and what a refused holder's state is. The fence's guard decisions, lock order and claim schema are
 * not under test here (pi-durable-reservation.test.ts owns them); only the structured facts a refusal carries.
 *
 * Hermetic: every root is a fresh temp directory and every path is passed explicitly. A real record and C4 location
 * are committed through the existing birth, owned by a child process that is then killed and reaped, so the donor is a
 * proven-dead incarnation. Nothing opens a database, takes a native lease or reads an agent directory.
 *
 * A release fails by ONE injected fault: `node:fs` is wrapped for this file only, and `unlinkSync` of exactly the named
 * path throws EACCES while a cell arms it. The file the release could not remove is therefore really left behind — an
 * actual residue, not a simulated report. Oracles are independent of the subject: claims are read back as raw JSON,
 * paths are joined here.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMetaRecordArmLocksDir } from "./meta-session.ts";
import { commitPiDurableBirth } from "./pi-durable-location.ts";
import {
	PiDurableOwnerFenceError,
	type PiDurableReservation,
	reservePiDurableSession,
	withdrawPiDurableReservation,
} from "./pi-durable-owner-fence.ts";

const faults = vi.hoisted(() => ({ unlink: new Set<string>(), unlinkThenThrow: new Set<string>() }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const unlinkSync = (target: import("node:fs").PathLike): void => {
		if (faults.unlink.has(String(target))) {
			throw Object.assign(new Error(`EACCES: permission denied, unlink '${String(target)}'`), { code: "EACCES" });
		}
		actual.unlinkSync(target);
		// The file is really gone, and the call still reports a failure: a failed release is not a remaining file.
		if (faults.unlinkThenThrow.has(String(target))) {
			throw Object.assign(new Error(`EIO: i/o error, unlink '${String(target)}'`), { code: "EIO" });
		}
	};
	const wrapped = { ...actual, unlinkSync };
	return { ...wrapped, default: wrapped };
});

const CLAIM = "entwurf-owner.json";
const TX = "entwurf-owner.tx";
const N = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const HEX32 = /^[0-9a-f]{32}$/;
const GEN_A = "a".repeat(32);
const GEN_R = "c".repeat(32);
const AT = "2026-11-02T00:00:00.000Z";
const CLEAN_END = { at: AT, storage: "closed", lease: "released" };
const FIRST = { at: AT, generation: GEN_A, from: "fresh" };

interface Owner {
	pid: number;
	startKey: string;
	hostname: string;
}

/** A start key read from /proc here, the way the kernel reports field 22; never through the subject. */
function startKeyOf(pid: number): string {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = stat
		.slice(stat.lastIndexOf(")") + 1)
		.trim()
		.split(/\s+/);
	return `linux:${fields[19]}`;
}

const self = (): Owner => ({ pid: process.pid, startKey: startKeyOf(process.pid), hostname: os.hostname() });

/** A real child, alive until `end` kills and reaps it. */
async function liveChild(): Promise<{ owner: Owner; end: () => Promise<void> }> {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	const pid = child.pid;
	if (pid === undefined) throw new Error("the child did not start");
	const exited = new Promise((resolve) => child.once("exit", resolve));
	await new Promise((resolve) => setTimeout(resolve, 50));
	const owner = { pid, startKey: startKeyOf(pid), hostname: os.hostname() };
	return {
		owner,
		end: async () => {
			child.kill("SIGKILL");
			await exited;
		},
	};
}

let tmp: string;
let roots: { sessionsDir: string; mailboxDir: string; sendersDir: string; receiversDir: string };
let cwd: string;
let profile: string;
let S: string;
let R: string;
let gid: string;
let inc: string;
let donor: Owner;
const children: { end: () => Promise<void> }[] = [];

beforeEach(async () => {
	faults.unlink.clear();
	faults.unlinkThenThrow.clear();
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdrf-"));
	const metaRoot = path.join(tmp, "meta");
	roots = {
		sessionsDir: path.join(metaRoot, "meta-sessions"),
		mailboxDir: path.join(metaRoot, "meta-mailbox"),
		sendersDir: path.join(metaRoot, "meta-senders"),
		receiversDir: path.join(metaRoot, "meta-receivers"),
	};
	cwd = path.join(fs.realpathSync(tmp), "project");
	fs.mkdirSync(cwd);
	profile = path.join(tmp, "agent");
	const cwdHash = createHash("sha256").update(cwd).digest("hex").slice(0, 24);
	S = path.join(profile, "experimental", "durable-sessions", cwdHash, N);
	fs.mkdirSync(S, { recursive: true });
	const child = await liveChild();
	try {
		const birth = commitPiDurableBirth({
			nativeSessionId: N,
			cwd,
			sessionDirectory: S,
			ownerPid: child.owner.pid,
			sessionsDir: roots.sessionsDir,
			receiversDir: roots.receiversDir,
		});
		gid = birth.record.gardenId;
		inc = String(birth.record.attachIncarnation);
	} finally {
		await child.end();
	}
	donor = child.owner;
	R = fs.realpathSync(S);
	writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
});

afterEach(async () => {
	faults.unlink.clear();
	faults.unlinkThenThrow.clear();
	for (const child of children.splice(0)) await child.end();
	fs.rmSync(tmp, { recursive: true, force: true });
});

const selected = () => ({ n: N, directory: S, profile });

/** A schema 2 native claim at R, every field a literal or a parameter of the cell. */
function nativeClaim(state: string, lease: string, owner: Owner, end?: Record<string, unknown>): Record<string, any> {
	return {
		schemaVersion: 2,
		resource: R,
		selected: selected(),
		state,
		owner,
		generation: GEN_A,
		firstParticipation: FIRST,
		lease,
		...(end === undefined ? {} : { end }),
		writtenAt: AT,
	};
}

/** A schema 2 reserved claim at R, held by `parent` at GEN_R, reserved from the clean-closed donor row. */
function reservedClaim(parent: Owner): Record<string, any> {
	const { generation, state, owner, lease, end } = nativeClaim("closed", "released", donor, CLEAN_END);
	return {
		schemaVersion: 2,
		resource: R,
		selected: selected(),
		state: "reserved",
		owner: parent,
		generation: GEN_R,
		firstParticipation: FIRST,
		reservation: {
			gardenId: gid,
			n: N,
			cwd,
			resource: R,
			profile,
			attachIncarnation: inc,
			nativeLease: "absent",
			from: { generation, state, owner, lease, end, selected: selected() },
		},
		lease: "never-held",
		writtenAt: AT,
	};
}

const claimFile = () => path.join(R, CLAIM);
const txFile = () => path.join(R, TX);
const armFile = () => path.join(defaultMetaRecordArmLocksDir(roots.receiversDir), `${gid}.lock`);
const writeRaw = (body: unknown) => fs.writeFileSync(claimFile(), `${JSON.stringify(body)}\n`);
const readRaw = (): Record<string, any> => JSON.parse(fs.readFileSync(claimFile(), "utf8"));
const bytes = () => fs.readFileSync(claimFile());
const reserve = () => reservePiDurableSession({ gardenId: gid, roots });

async function refusalOf(run: () => Promise<unknown>): Promise<PiDurableOwnerFenceError> {
	try {
		await run();
	} catch (error) {
		if (error instanceof PiDurableOwnerFenceError) return error;
		throw error;
	}
	throw new Error("the call did not refuse");
}

describe("a refused holder's state (D4)", () => {
	it("[QK:PDR-HOLDER-STATE-NAMED] a reserve refused by a live holder names that claim's state beside owner-live: a reservation's parent is `reserved`, a running native owner is its own state", async () => {
		writeRaw(reservedClaim(self()));
		const parent = await refusalOf(reserve);
		const child = await liveChild();
		children.push(child);
		writeRaw(nativeClaim("storage-open", "held", child.owner));
		const native = await refusalOf(reserve);
		expect([parent.reason, parent.holderState]).toEqual(["owner-live", "reserved"]);
		expect([native.reason, native.holderState]).toEqual(["owner-live", "storage-open"]);
		expect(parent.written).toBeUndefined();
		expect(native.written).toBeUndefined();
	});
});

describe("a release that fails after the reserve's write (D3)", () => {
	it("[QK:PDR-RESERVE-TX-RELEASE-NAMES-WRITE] when S_D cannot be released after the reservation was written, the refusal stays tx-release-failed with its own words and names the reservation it wrote — the one now on disk — and the transaction file is really left; a refused reserve whose release fails names no write and changed nothing; a release reported failed after its file was removed leaves no file, and its words say only what a remaining one would do", async () => {
		faults.unlink.add(txFile());
		const after = await refusalOf(reserve);
		const onDisk = readRaw();
		expect(after.reason).toBe("tx-release-failed");
		expect(after.message).toContain("if that transaction file remains, it fails closed until an operator removes it");
		expect(onDisk.state).toBe("reserved");
		expect(onDisk.generation).toMatch(HEX32);
		expect(after.written).toEqual({
			resource: R,
			state: "reserved",
			generation: onDisk.generation,
			ownerPid: process.pid,
		});
		expect(fs.existsSync(txFile())).toBe(true);
		expect(fs.existsSync(armFile())).toBe(false);

		fs.rmSync(txFile());
		writeRaw(reservedClaim(self()));
		const before = bytes();
		const refused = await refusalOf(reserve);
		expect(refused.reason).toBe("tx-release-failed");
		expect(refused.message).toContain("the step had already failed: owner-live");
		expect(refused.written).toBeUndefined();
		expect(bytes().equals(before)).toBe(true);
		expect(fs.existsSync(txFile())).toBe(true);

		// A release reported failed AFTER the file was removed: the report is conditional, and no file remains.
		fs.rmSync(txFile());
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		faults.unlink.clear();
		faults.unlinkThenThrow.add(txFile());
		const gone = await refusalOf(reserve);
		const reservedNow = readRaw();
		expect(gone.reason).toBe("tx-release-failed");
		expect(gone.message).toContain("if that transaction file remains, it fails closed until an operator removes it");
		expect(gone.written).toEqual({
			resource: R,
			state: "reserved",
			generation: reservedNow.generation,
			ownerPid: process.pid,
		});
		expect(fs.existsSync(txFile())).toBe(false);
	});

	it("[QK:PDR-RESERVE-ARM-RELEASE-NAMES-WRITE] when the record-arm lock cannot be released after a clean reserve, the refusal is record-arm-release-failed with its own words and names the reservation it wrote; S_D was released", async () => {
		faults.unlink.add(armFile());
		const after = await refusalOf(reserve);
		const onDisk = readRaw();
		expect(after.reason).toBe("record-arm-release-failed");
		expect(after.message).toContain(`the record-arm lock of ${gid} answered threw: EACCES`);
		expect(onDisk.state).toBe("reserved");
		expect(after.written).toEqual({
			resource: R,
			state: "reserved",
			generation: onDisk.generation,
			ownerPid: process.pid,
		});
		expect(fs.existsSync(txFile())).toBe(false);
	});

	it("[QK:PDR-ARM-RELEASE-KEEPS-STEP-WRITE] when both releases fail after the write, the record-arm failure keeps the S_D failure's words as its cause and the write it named", async () => {
		faults.unlink.add(txFile());
		faults.unlink.add(armFile());
		const after = await refusalOf(reserve);
		const onDisk = readRaw();
		expect(after.reason).toBe("record-arm-release-failed");
		expect(after.message).toContain("the step had already failed: tx-release-failed:");
		expect(after.message).toContain("if that transaction file remains, it fails closed until an operator removes it");
		expect(after.written).toEqual({
			resource: R,
			state: "reserved",
			generation: onDisk.generation,
			ownerPid: process.pid,
		});
		expect(fs.existsSync(txFile())).toBe(true);
	});
});

describe("a release that fails after the withdrawal's write (D1)", () => {
	it("[QK:PDR-WITHDRAW-TX-RELEASE-NAMES-WRITE] when S_D cannot be released after the withdrawal restored the donor's row, the refusal stays tx-release-failed and names that row as written — the reservation is gone, only the transaction file is left; a refused withdrawal whose release fails names no write and changed nothing", async () => {
		const reservation: PiDurableReservation = await reserve();
		faults.unlink.add(txFile());
		const after = await refusalOf(() => withdrawPiDurableReservation(reservation));
		const onDisk = readRaw();
		expect(after.reason).toBe("tx-release-failed");
		expect(onDisk.state).toBe("closed");
		expect(onDisk.owner).toEqual(donor);
		expect(after.written).toEqual({ resource: R, state: "closed", generation: onDisk.generation, ownerPid: donor.pid });
		expect(fs.existsSync(txFile())).toBe(true);

		fs.rmSync(txFile());
		writeRaw(reservedClaim(self()));
		const before = bytes();
		const refused = await refusalOf(() => withdrawPiDurableReservation({ ...reservation, generation: GEN_A }));
		expect(refused.reason).toBe("tx-release-failed");
		expect(refused.message).toContain("the step had already failed: withdraw-not-own");
		expect(refused.written).toBeUndefined();
		expect(bytes().equals(before)).toBe(true);
	});
});
