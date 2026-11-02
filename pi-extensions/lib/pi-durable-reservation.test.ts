/**
 * #157 B3 I-2 — the pi-durable reservation: a parent's reserve of one citizen's D for one child, the child's adoption,
 * the parent's withdrawal and observation, and the reader's schema 2 `reserved` row.
 *
 * Hermetic: every root is a fresh temp directory and every path is passed explicitly. A real record and C4 location are
 * committed here through the existing birth, owned by a real child process that is then killed and reaped, so the donor
 * is a proven-dead incarnation. Nothing opens a database, takes a native lease or reads an agent directory; a
 * `${D}.lock` is a plain directory made here where a cell needs one present.
 *
 * Oracles are independent of the subject: names, keysets, generations and every claim a cell starts from are literals
 * written here as raw JSON; claims are read back as raw JSON; the cwd hash is computed here; start keys are read from
 * `/proc` here.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "./entwurf-v2-lock.ts";
import { commitPiDurableBirth } from "./pi-durable-location.ts";
import {
	createPiDurableOwnerFence,
	observePiDurableReservation,
	type PiDurableReservation,
	reservePiDurableSession,
	withdrawPiDurableReservation,
} from "./pi-durable-owner-fence.ts";

const CLAIM = "entwurf-owner.json";
const TX = "entwurf-owner.tx";
const N = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const HEX32 = /^[0-9a-f]{32}$/;
const GEN_A = "a".repeat(32);
const GEN_B = "b".repeat(32);
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

/** A real child already killed and reaped: a proven-dead incarnation. */
async function deadOwner(): Promise<Owner> {
	const child = await liveChild();
	await child.end();
	return child.owner;
}

let tmp: string;
let metaRoot: string;
let roots: { sessionsDir: string; mailboxDir: string; sendersDir: string; receiversDir: string };
let cwd: string;
let profile: string;
/** S: the selection, joined from the raw profile the way the owned open joins it. */
let S: string;
/** R: realpath(S), the physical D where the claim lives. */
let R: string;
let gid: string;
let inc: string;
/** The incarnation the record's binding names, dead once bound. */
let donor: Owner;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdr-"));
	metaRoot = path.join(tmp, "meta");
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
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

/** Commits a real record and C4 location for S, owned by a child that is then killed: the donor is proven dead. */
async function bind(): Promise<void> {
	if (!fs.existsSync(S)) fs.mkdirSync(S, { recursive: true });
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
}

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

/** The flat donor row a reservation copies from a native claim. */
function donorRow(claim: Record<string, any>): Record<string, any> {
	const { generation, state, owner, lease, end } = claim;
	return { generation, state, owner, lease, ...(end === undefined ? {} : { end }), selected: claim.selected };
}

/** A schema 2 reserved claim at R, held by `parent` at GEN_R and reserved from `from`. */
function reservedClaim(parent: Owner, from: Record<string, any>, nativeLease = "absent"): Record<string, any> {
	return {
		schemaVersion: 2,
		resource: R,
		selected: selected(),
		state: "reserved",
		owner: parent,
		generation: GEN_R,
		firstParticipation: FIRST,
		reservation: { gardenId: gid, n: N, cwd, resource: R, profile, attachIncarnation: inc, nativeLease, from },
		lease: "never-held",
		writtenAt: AT,
	};
}

const claimFile = () => path.join(R, CLAIM);
const writeRaw = (body: unknown) => fs.writeFileSync(claimFile(), `${JSON.stringify(body)}\n`);
const readRaw = (): Record<string, any> => JSON.parse(fs.readFileSync(claimFile(), "utf8"));
const bytes = () => fs.readFileSync(claimFile());
const listing = () => fs.readdirSync(R).sort();
const reserve = () => reservePiDurableSession({ gardenId: gid, roots });
const ordinary = () => createPiDurableOwnerFence().admit({ directory: S, selectedN: N, created: false, profile });
const adopt = (sourceGeneration: string, admission: Partial<{ directory: string; profile: string }> = {}) =>
	createPiDurableOwnerFence({ adoption: { gardenId: gid, metaRoot, sourceGeneration } }).admit({
		directory: S,
		selectedN: N,
		created: false,
		profile,
		...admission,
	});
const ticketAt = (generation: string, owner: Owner = self()): PiDurableReservation => ({
	gardenId: gid,
	metaRoot,
	resource: R,
	generation,
	profile,
	cwd,
	owner,
});

async function reasonOf(run: () => Promise<unknown>): Promise<string | undefined> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return (error as { reason?: string }).reason ?? String(error);
	}
}

describe("the reserved row (schema 2)", () => {
	it("[QK:PDR-RESERVED-ROW] a reserved claim carries exactly one reservation whose donor is one flat native row with the claim's selection; reserved without a reservation, a reservation on another state, a nested or reserved donor, another selection, reserved with a held lease and a schema 1 reserved are unreadable, and nothing is written", async () => {
		await bind();
		const from = donorRow(nativeClaim("closed", "released", donor, CLEAN_END));
		const valid = reservedClaim(self(), from);
		const { reservation, ...bare } = valid;
		const cells: { name: string; reason: string; body: unknown }[] = [
			{ name: "valid", reason: "owner-live", body: valid },
			{ name: "no-reservation", reason: "claim-unreadable", body: bare },
			{
				name: "fenced-with-reservation",
				reason: "claim-unreadable",
				body: { ...nativeClaim("fenced", "never-held", self()), reservation },
			},
			{ name: "nested-donor", reason: "claim-unreadable", body: reservedClaim(self(), { ...from, reservation }) },
			{
				name: "reserved-donor",
				reason: "claim-unreadable",
				body: reservedClaim(self(), { ...from, state: "reserved", lease: "never-held", end: undefined }),
			},
			{
				name: "other-selection",
				reason: "claim-unreadable",
				body: reservedClaim(self(), { ...from, selected: { ...selected(), directory: `${S}-other` } }),
			},
			{ name: "reserved-held", reason: "claim-unreadable", body: { ...valid, lease: "held" } },
			{
				name: "schema-1-reserved",
				reason: "claim-unreadable",
				body: { ...valid, schemaVersion: 1, selected: { n: N, directory: S } },
			},
		];
		for (const cell of cells) {
			writeRaw(cell.body);
			const before = bytes();
			expect(await reasonOf(reserve), cell.name).toBe(cell.reason);
			expect(bytes(), cell.name).toEqual(before);
			expect(listing(), cell.name).toEqual([CLAIM]);
		}
	});

	it("[QK:PDR-SNAPSHOT-ATTRIBUTION-READER] a present-attributed snapshot is readable only for a donor whose own row held the lease; for a donor that released it or never held one the claim is unreadable", async () => {
		await bind();
		const cells = [
			{ name: "leased-held", reason: "owner-live", from: donorRow(nativeClaim("leased", "held", donor)) },
			{
				name: "close-failed-unknown",
				reason: "owner-live",
				from: donorRow(nativeClaim("close-failed", "unknown", donor, { at: AT, storage: "unknown", lease: "unknown" })),
			},
			{
				name: "closed-released",
				reason: "claim-unreadable",
				from: donorRow(nativeClaim("closed", "released", donor, CLEAN_END)),
			},
			{
				name: "fenced-never-held",
				reason: "claim-unreadable",
				from: donorRow(nativeClaim("fenced", "never-held", donor)),
			},
		];
		for (const cell of cells) {
			writeRaw(reservedClaim(self(), cell.from, "present-attributed"));
			const before = bytes();
			expect(await reasonOf(reserve), cell.name).toBe(cell.reason);
			expect(bytes(), cell.name).toEqual(before);
		}
	});
});

describe("reserve", () => {
	it("[QK:PDR-V1-UNATTRIBUTED] a schema 1 clean close, otherwise attributed, refuses a reserve as profile-unattributed with its bytes unchanged: no profile is inferred from its directory; the same row in schema 2 is reserved", async () => {
		await bind();
		writeRaw({
			...nativeClaim("closed", "released", donor, CLEAN_END),
			schemaVersion: 1,
			selected: { n: N, directory: S },
		});
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("profile-unattributed");
		expect(bytes()).toEqual(before);
		expect(listing()).toEqual([CLAIM]);
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		await reserve();
		expect(readRaw().state).toBe("reserved");
		expect(readRaw().reservation.profile).toBe(profile);
	});

	it("[QK:PDR-RESERVE-CLEAN-ONLY] a closed donor is reserved only from its clean row with no lease present: a closed row that never opened storage, in either lease, refuses reserve-not-clean and a present lease refuses legacy-lease-present, each with its bytes unchanged", async () => {
		await bind();
		const refused = [
			nativeClaim("closed", "released", donor, { at: AT, storage: "never-opened", lease: "released" }),
			nativeClaim("closed", "never-held", donor, { at: AT, storage: "never-opened", lease: "never-held" }),
		];
		for (const [index, claim] of refused.entries()) {
			writeRaw(claim);
			const before = bytes();
			expect(await reasonOf(reserve), String(index)).toBe("reserve-not-clean");
			expect(bytes(), String(index)).toEqual(before);
		}
		const clean = nativeClaim("closed", "released", donor, CLEAN_END);
		writeRaw(clean);
		fs.mkdirSync(`${S}.lock`);
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("legacy-lease-present");
		expect(bytes()).toEqual(before);
		fs.rmdirSync(`${S}.lock`);
		const reservation = await reserve();
		const claim = readRaw();
		expect([claim.state, claim.lease]).toEqual(["reserved", "never-held"]);
		expect(claim.owner).toEqual(self());
		expect(claim.generation).toBe(reservation.generation);
		expect(claim.reclaimedFrom).toBeUndefined();
		expect(claim.selected).toEqual(selected());
		expect(claim.firstParticipation).toEqual(FIRST);
		expect(claim.reservation).toEqual({
			gardenId: gid,
			n: N,
			cwd,
			resource: R,
			profile,
			attachIncarnation: inc,
			nativeLease: "absent",
			from: donorRow(clean),
		});
		expect(reservation).toEqual({
			gardenId: gid,
			metaRoot,
			resource: R,
			generation: claim.generation,
			profile,
			cwd,
			owner: self(),
		});
	});

	it("[QK:PDR-ARM-BEFORE-SD] a busy record-arm lock refuses the reserve before S_D: the claim keeps its bytes and D holds no transaction; once the arm is free the same claim is reserved", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const before = bytes();
		const held = acquireLock(gid, { dir: path.join(metaRoot, "meta-record-arm-locks") });
		if (!held.ok) throw new Error("the record-arm lock was not free");
		try {
			expect(await reasonOf(reserve)).toBe("record-arm-busy");
			expect(bytes()).toEqual(before);
			expect(listing()).toEqual([CLAIM]);
		} finally {
			expect(releaseLock(held.claim)).toBe("released");
		}
		await reserve();
		expect(readRaw().state).toBe("reserved");
	});

	it("[QK:PDR-ROW-ORDER] the rows decide before the P-rules: no claim refuses reserve-unarmed, and a live holder refuses owner-live although the P-rules would refuse it too", async () => {
		await bind();
		expect(listing()).toEqual([]);
		expect(await reasonOf(reserve)).toBe("reserve-unarmed");
		expect(listing()).toEqual([]);
		// This holder is not the incarnation C4's binding names: P3 alone would refuse it as profile-unattributed.
		writeRaw(nativeClaim("leased", "held", self()));
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("owner-live");
		expect(bytes()).toEqual(before);
	});

	it("[QK:PDR-HOST-BEFORE-LIVENESS] a holder on another host is refused as owner-other-host even when its pid is live here: its pid is never judged on this host", async () => {
		await bind();
		writeRaw(nativeClaim("leased", "held", { ...self(), hostname: "pdr-another-host.invalid" }));
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("owner-other-host");
		expect(bytes()).toEqual(before);
	});

	it("[QK:PDR-DONOR-ATTRIBUTION] a dead reservation is reserved again by its flat donor's attribution, never its parent's: the new reservation keeps the same donor, and its reclaim names the dead parent", async () => {
		await bind();
		const parent = await deadOwner();
		const from = donorRow(nativeClaim("closed", "released", donor, CLEAN_END));
		writeRaw(reservedClaim(parent, from));
		await reserve();
		const claim = readRaw();
		expect(claim.state).toBe("reserved");
		expect(claim.generation).not.toBe(GEN_R);
		expect(claim.owner).toEqual(self());
		expect(claim.reservation.from).toEqual(from);
		expect(claim.reservation.nativeLease).toBe("absent");
		expect(claim.reclaimedFrom).toEqual({
			generation: GEN_R,
			state: "reserved",
			owner: parent,
			leaseOutcome: "never-held",
		});
	});

	it("[QK:PDR-LEASE-NO-LAUNDER] a dead reservation whose snapshot saw no lease refuses lease-appeared once one is present, even for a donor that held one: a snapshot is never retaken from now; one that saw an attributed lease keeps it", async () => {
		await bind();
		const parent = await deadOwner();
		const from = donorRow(nativeClaim("leased", "held", donor));
		writeRaw(reservedClaim(parent, from));
		fs.mkdirSync(`${S}.lock`);
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("lease-appeared");
		expect(bytes()).toEqual(before);
		writeRaw(reservedClaim(parent, from, "present-attributed"));
		await reserve();
		expect(readRaw().reservation.nativeLease).toBe("present-attributed");
	});

	it("[QK:PDR-LEASE-SIDECAR-SELECTION] under an N-level alias the snapshot reads the donor's own selection: a lock beside the physical directory alone reads as absent, and a lock beside the selection refuses", async () => {
		const elsewhere = path.join(tmp, "elsewhere", N);
		fs.mkdirSync(elsewhere, { recursive: true });
		fs.mkdirSync(path.dirname(S), { recursive: true });
		fs.symlinkSync(elsewhere, S);
		await bind();
		expect(R).toBe(fs.realpathSync(elsewhere));
		expect(R).not.toBe(S);
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		fs.mkdirSync(`${R}.lock`);
		await reserve();
		expect(readRaw().reservation.nativeLease).toBe("absent");
		fs.rmdirSync(`${R}.lock`);
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		fs.mkdirSync(`${S}.lock`);
		const before = bytes();
		expect(await reasonOf(reserve)).toBe("legacy-lease-present");
		expect(bytes()).toEqual(before);
	});
});

describe("adopt", () => {
	it("[QK:PDR-ADOPT-BINDING-CHANGED] a binding committed after the reserve refuses the adoption as adopt-binding-changed, and nothing is written", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		const rebirth = await liveChild();
		try {
			commitPiDurableBirth({
				nativeSessionId: N,
				cwd,
				sessionDirectory: S,
				ownerPid: rebirth.owner.pid,
				sessionsDir: roots.sessionsDir,
				receiversDir: roots.receiversDir,
			});
		} finally {
			await rebirth.end();
		}
		const before = bytes();
		expect(await reasonOf(() => adopt(reservation.generation))).toBe("adopt-binding-changed");
		expect(bytes()).toEqual(before);
		expect(listing()).toEqual([CLAIM]);
	});

	it("[QK:PDR-LEASE-SNAPSHOT] a reservation whose snapshot saw no lease refuses its adoption as adopt-lease-appeared once one is present, even when its donor held one", async () => {
		await bind();
		writeRaw(nativeClaim("leased", "held", donor));
		const reservation = await reserve();
		expect(readRaw().reservation.nativeLease).toBe("absent");
		fs.mkdirSync(`${S}.lock`);
		const before = bytes();
		expect(await reasonOf(() => adopt(reservation.generation))).toBe("adopt-lease-appeared");
		expect(bytes()).toEqual(before);
	});

	it("[QK:PDR-ADOPT-EXACT] a matching adoption writes fenced under the child with adoptedFrom naming the reservation; another generation, profile spelling, selection spelling or reserved cwd refuses by name and writes nothing", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		const reserved = bytes();
		const cells: { name: string; reason: string; run: () => Promise<unknown> }[] = [
			{ name: "generation", reason: "adopt-generation-mismatch", run: () => adopt(GEN_B) },
			{
				name: "profile",
				reason: "adopt-profile-mismatch",
				run: () => adopt(reservation.generation, { profile: `${profile}/` }),
			},
			{
				name: "selection",
				reason: "adopt-profile-mismatch",
				run: () => adopt(reservation.generation, { directory: `${S}/` }),
			},
		];
		for (const cell of cells) {
			expect(await reasonOf(cell.run), cell.name).toBe(cell.reason);
			expect(bytes(), cell.name).toEqual(reserved);
		}
		// Another cwd in the reservation itself, written here as raw JSON.
		const moved = readRaw();
		writeRaw({ ...moved, reservation: { ...moved.reservation, cwd: path.join(cwd, "elsewhere") } });
		const before = bytes();
		expect(await reasonOf(() => adopt(reservation.generation))).toBe("adopt-reservation-mismatch");
		expect(bytes()).toEqual(before);
		fs.writeFileSync(claimFile(), reserved);
		await adopt(reservation.generation);
		const claim = readRaw();
		expect([claim.state, claim.lease]).toEqual(["fenced", "never-held"]);
		expect(claim.owner).toEqual(self());
		expect(claim.adoptedFrom).toEqual({ generation: reservation.generation, owner: self() });
		expect(claim.selected).toEqual(selected());
		expect(claim.firstParticipation).toEqual(FIRST);
		expect(claim.generation).toMatch(HEX32);
		expect(claim.generation).not.toBe(reservation.generation);
		expect("reservation" in claim).toBe(false);
		expect("reclaimedFrom" in claim).toBe(false);
	});

	it("[QK:PDR-ADOPT-NOT-RESERVED] an adoption finds no reservation once it was taken: a second child after the first adopted (CE-F), and a child after a reclaim of a dead parent's reservation (CE-A), both refuse adopt-not-reserved", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		await adopt(reservation.generation);
		const adopted = bytes();
		expect(await reasonOf(() => adopt(reservation.generation))).toBe("adopt-not-reserved");
		expect(bytes()).toEqual(adopted);

		const parent = await deadOwner();
		writeRaw(reservedClaim(parent, donorRow(nativeClaim("closed", "released", donor, CLEAN_END))));
		await ordinary();
		const reclaimed = readRaw();
		expect([reclaimed.state, reclaimed.reclaimedFrom?.state, reclaimed.reclaimedFrom?.owner]).toEqual([
			"fenced",
			"reserved",
			parent,
		]);
		const before = bytes();
		expect(await reasonOf(() => adopt(GEN_R))).toBe("adopt-not-reserved");
		expect(bytes()).toEqual(before);
	});

	it("[QK:PDR-ADOPT-PATH-FRESH] the adoption resolves its directory inside S_D: an N-level alias retargeted after the admission entered the hold, and before its decision ran, refuses adopt-reservation-mismatch, and nothing is written", async () => {
		const elsewhere = path.join(tmp, "elsewhere", N);
		const moved = path.join(tmp, "moved", N);
		fs.mkdirSync(elsewhere, { recursive: true });
		fs.mkdirSync(moved, { recursive: true });
		fs.mkdirSync(path.dirname(S), { recursive: true });
		fs.symlinkSync(elsewhere, S);
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		const before = bytes();
		const pending = adopt(reservation.generation);
		// The admission's synchronous part has run: its S_D exists in R, and its decision waits behind that await.
		expect(fs.existsSync(path.join(R, TX))).toBe(true);
		expect(bytes()).toEqual(before);
		fs.unlinkSync(S);
		fs.symlinkSync(moved, S);
		expect(await reasonOf(() => pending)).toBe("adopt-reservation-mismatch");
		expect(bytes()).toEqual(before);
		expect(listing()).toEqual([CLAIM]);
		expect(fs.readdirSync(moved)).toEqual([]);
	});
});

describe("an ordinary admission over a dead reservation", () => {
	it("[QK:PDR-ORDINARY-RESERVED-ATTRIBUTION] a dead parent's reservation attributes a present lease only by its donor's snapshot and only beside that snapshot's own selection: a present-attributed snapshot with the lease beside S is reclaimed, naming the parent's reserved row; the same snapshot with the lease beside another spelling of D, and an absent snapshot with the lease beside S, refuse lease-unattributed with nothing written", async () => {
		await bind();
		const profileB = path.join(tmp, "agent-b");
		const S2 = path.join(profileB, path.relative(profile, S));
		fs.mkdirSync(path.dirname(S2), { recursive: true });
		fs.symlinkSync(R, S2);
		const parent = await deadOwner();
		const from = donorRow(nativeClaim("leased", "held", donor));

		writeRaw(reservedClaim(parent, from, "present-attributed"));
		fs.mkdirSync(`${S}.lock`);
		await ordinary();
		const reclaimed = readRaw();
		expect([reclaimed.state, reclaimed.lease]).toEqual(["fenced", "never-held"]);
		expect(reclaimed.owner).toEqual(self());
		expect(reclaimed.reclaimedFrom).toEqual({
			generation: GEN_R,
			state: "reserved",
			owner: parent,
			leaseOutcome: "never-held",
		});
		expect(reclaimed.selected).toEqual(selected());
		expect(reclaimed.firstParticipation).toEqual(FIRST);
		expect("reservation" in reclaimed).toBe(false);
		expect("adoptedFrom" in reclaimed).toBe(false);
		fs.rmdirSync(`${S}.lock`);

		writeRaw(reservedClaim(parent, from, "present-attributed"));
		fs.mkdirSync(`${S2}.lock`);
		let before = bytes();
		const alias = () =>
			createPiDurableOwnerFence().admit({ directory: S2, selectedN: N, created: false, profile: profileB });
		expect(await reasonOf(alias)).toBe("lease-unattributed");
		expect(bytes()).toEqual(before);
		fs.rmdirSync(`${S2}.lock`);

		writeRaw(reservedClaim(parent, from));
		fs.mkdirSync(`${S}.lock`);
		before = bytes();
		expect(await reasonOf(ordinary)).toBe("lease-unattributed");
		expect(bytes()).toEqual(before);
	});
});

describe("withdraw", () => {
	it("[QK:PDR-WITHDRAW-PROJECTION] a withdrawal restores exactly the donor's own row under a new generation: its owner, state, lease, end and selection, the first participation kept, and no reservation, reclaim, adoption or withdrawal mark; the next reserve passes again", async () => {
		await bind();
		const clean = nativeClaim("closed", "released", donor, CLEAN_END);
		writeRaw(clean);
		const reservation = await reserve();
		await withdrawPiDurableReservation(reservation);
		const claim = readRaw();
		expect(Object.keys(claim).sort()).toEqual(Object.keys(clean).sort());
		for (const key of [
			"schemaVersion",
			"resource",
			"selected",
			"state",
			"owner",
			"firstParticipation",
			"lease",
			"end",
		]) {
			expect(claim[key], key).toEqual(clean[key]);
		}
		expect(claim.generation).toMatch(HEX32);
		expect([GEN_A, reservation.generation]).not.toContain(claim.generation);
		await reserve();
		expect(readRaw().state).toBe("reserved");

		// A dead attributed donor withdraws back to its own held row, reclaimable again.
		const held = nativeClaim("leased", "held", donor);
		writeRaw(held);
		const reclaim = await reserve();
		expect(readRaw().reclaimedFrom?.owner).toEqual(donor);
		await withdrawPiDurableReservation(reclaim);
		const restored = readRaw();
		expect(Object.keys(restored).sort()).toEqual(Object.keys(held).sort());
		for (const key of ["state", "owner", "lease", "selected", "firstParticipation"]) {
			expect(restored[key], key).toEqual(held[key]);
		}
	});

	it("[QK:PDR-WITHDRAW-OWN-GEN] only this owner's own reservation at its exact generation is withdrawn: another owner's, another generation and a late ticket after a withdrawal refuse withdraw-not-own with nothing written", async () => {
		await bind();
		const other = await deadOwner();
		writeRaw(reservedClaim(other, donorRow(nativeClaim("closed", "released", donor, CLEAN_END))));
		let before = bytes();
		expect(await reasonOf(() => withdrawPiDurableReservation(ticketAt(GEN_R)))).toBe("withdraw-not-own");
		expect(bytes()).toEqual(before);

		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		before = bytes();
		expect(await reasonOf(() => withdrawPiDurableReservation({ ...reservation, generation: GEN_B }))).toBe(
			"withdraw-not-own",
		);
		expect(bytes()).toEqual(before);

		await withdrawPiDurableReservation(reservation);
		before = bytes();
		expect(await reasonOf(() => withdrawPiDurableReservation(reservation))).toBe("withdraw-not-own");
		expect(bytes()).toEqual(before);
	});
});

describe("adoption evidence and observation", () => {
	it("[QK:PDR-ADOPTED-EVIDENCE-KEPT] adoptedFrom stays through the adopting owner's own transitions to its end, and the next separate admission writes none", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		const ticket = await adopt(reservation.generation);
		const evidence = { generation: reservation.generation, owner: self() };
		await ticket.leased();
		expect(readRaw().adoptedFrom).toEqual(evidence);
		ticket.storageOpenAttempted = true;
		await ticket.storageOpened();
		expect(readRaw().adoptedFrom).toEqual(evidence);
		await ticket.closed({ storage: "closed", lease: "released" });
		expect([readRaw().state, readRaw().adoptedFrom]).toEqual(["closed", evidence]);
		await ordinary();
		expect(readRaw().state).toBe("fenced");
		expect("adoptedFrom" in readRaw()).toBe(false);
	});

	it("[QK:PDR-OBSERVATION-CLASSES] an observation classifies only a claim the strict reader accepted: reserved at g_r is not yet adopted, an adoption through its end is adopted, a withdrawal or a reclaim is lost, and an unreadable or missing claim is unobserved by name", async () => {
		await bind();
		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const reservation = await reserve();
		expect(observePiDurableReservation(reservation)).toEqual({ class: "not-yet-adopted" });
		const ticket = await adopt(reservation.generation);
		expect(observePiDurableReservation(reservation)).toEqual({ class: "adopted" });
		await ticket.leased();
		await ticket.closeFailed({ storage: "failed", lease: "released" });
		expect(readRaw().state).toBe("close-failed");
		expect(observePiDurableReservation(reservation)).toEqual({ class: "adopted" });

		writeRaw(nativeClaim("closed", "released", donor, CLEAN_END));
		const withdrawn = await reserve();
		await withdrawPiDurableReservation(withdrawn);
		expect(observePiDurableReservation(withdrawn)).toEqual({ class: "lost" });

		const parent = await deadOwner();
		writeRaw(reservedClaim(parent, donorRow(nativeClaim("closed", "released", donor, CLEAN_END))));
		await ordinary();
		expect(observePiDurableReservation(ticketAt(GEN_R, parent))).toEqual({ class: "lost" });

		fs.writeFileSync(claimFile(), "{ not json");
		expect(observePiDurableReservation(reservation)).toMatchObject({ class: "unobserved", reason: "claim-unreadable" });
		fs.rmSync(claimFile());
		expect(observePiDurableReservation(reservation)).toMatchObject({ class: "unobserved", reason: "claim-missing" });
	});
});
