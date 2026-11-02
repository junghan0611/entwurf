/**
 * #157 B3 — the pi-durable owner fence: the claim an owned open takes inside its native session directory D before
 * the native lease, its S_D transaction file, and the admission table over live, uncertain and proven-dead owners.
 *
 * Hermetic: every D is a plain directory under a fresh temp root; nothing here opens a database, takes a native
 * lease or reads an agent directory. A `${D}.lock` is made here as a plain directory where a cell needs one present.
 *
 * Oracles are independent of the subject: the three file names, the claim's keyset and every claim a cell starts
 * from are literals written here as raw JSON; claims are read back as raw JSON; an owner's start key is read from
 * `/proc` here, and a proven-dead owner is a real child process that has exited. The one local mock is node:crypto's
 * `randomBytes`, passed through except where a cell needs a temp name it can occupy first.
 *
 * Every D is joined from a plain agent directory the way the owned open joins it, and an admission's own claim (schema
 * 2) records the profile its caller handed in. Schema 1, the pre-profile build's claim, is covered only where a cell
 * seeds it as a raw literal: the uncertain, other-host, malformed, dead-reclaim, unattributed-lease, resource-mismatch
 * and closed-with-lease rows, the closed receipt an admission takes over, and the reader cells. The lifetime, re-entry,
 * generation and transaction cells run on schema 2 claims this fence wrote itself, and the temp-inert cell's schema 1
 * body is never read as a claim. This is not a schema × state matrix of schema 1.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPiDurableOwnerFence,
	PI_DURABLE_OWNER_CLAIM,
	PI_DURABLE_OWNER_TMP_PREFIX,
	PI_DURABLE_OWNER_TX,
	type PiDurableOwnerTicket,
} from "./pi-durable-owner-fence.ts";

const entropy = vi.hoisted(() => ({ randomBytes: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	const wrapped = { ...actual, ...entropy };
	return { ...wrapped, default: wrapped };
});
const realCrypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");

const CLAIM = "entwurf-owner.json";
const TX = "entwurf-owner.tx";
const N = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const OTHER_N = "1759622499999-6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const THIRD_N = "1759622455555-1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const HEX32 = /^[0-9a-f]{32}$/;
const KEYS = [
	"schemaVersion",
	"resource",
	"selected",
	"state",
	"owner",
	"generation",
	"firstParticipation",
	"lease",
	"writtenAt",
];
/** A cwd hash segment of the layout; the fence never recomputes it. */
const CWD_HASH = "0123456789abcdef01234567";
const GEN_A = "a".repeat(32);
const GEN_B = "b".repeat(32);
const AT = "2026-11-02T00:00:00.000Z";

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

/** A real child, its start key read while it lives, then killed and reaped: a proven-dead owner. */
async function deadOwner(): Promise<Owner> {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	const pid = child.pid;
	if (pid === undefined) throw new Error("the child did not start");
	await new Promise((resolve) => setTimeout(resolve, 50));
	const startKey = startKeyOf(pid);
	const exited = new Promise((resolve) => child.once("exit", resolve));
	child.kill("SIGKILL");
	await exited;
	return { pid, startKey, hostname: os.hostname() };
}

let tmp: string;
let profile: string;
let root: string;
let dead: Owner;

beforeAll(async () => {
	dead = await deadOwner();
});

beforeEach(() => {
	entropy.randomBytes.mockReset();
	entropy.randomBytes.mockImplementation(realCrypto.randomBytes as never);
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-"));
	profile = path.join(tmp, "agent");
	root = path.join(profile, "experimental", "durable-sessions", CWD_HASH);
	fs.mkdirSync(root, { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

function makeD(name = N): string {
	const d = path.join(root, name);
	fs.mkdirSync(d);
	return d;
}

const claimPath = (d: string) => path.join(d, CLAIM);
const readRaw = (d: string): Record<string, any> => JSON.parse(fs.readFileSync(claimPath(d), "utf8"));
const bytes = (file: string) => fs.readFileSync(file);
const listing = (d: string) => fs.readdirSync(d).sort();

/** A claim body written here as raw JSON, every field a literal or a parameter of the cell. */
function rawClaim(
	d: string,
	fields: { state: string; lease: string; owner: Owner; end?: Record<string, unknown>; resource?: string; n?: string },
): Record<string, unknown> {
	return {
		schemaVersion: 1,
		resource: fields.resource ?? fs.realpathSync(d),
		selected: { n: fields.n ?? N, directory: d },
		state: fields.state,
		owner: fields.owner,
		generation: GEN_A,
		firstParticipation: { at: AT, generation: GEN_A, from: "fresh" },
		lease: fields.lease,
		...(fields.end === undefined ? {} : { end: fields.end }),
		writtenAt: AT,
	};
}

function writeRaw(d: string, body: unknown): void {
	fs.writeFileSync(claimPath(d), `${JSON.stringify(body)}\n`);
}

const admit = (d: string, created: boolean, selectedN = N) =>
	createPiDurableOwnerFence().admit({ directory: d, selectedN, created, profile });

async function reasonOf(run: () => Promise<unknown>): Promise<string | undefined> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return (error as { reason?: string }).reason ?? String(error);
	}
}

describe("admission of an absent claim", () => {
	it("[QK:PDF-ADMIT-FRESH] a D this call created gets a fenced claim, firstParticipation from fresh at its own first generation, owned by this process", async () => {
		const d = makeD();
		await admit(d, true);
		const claim = readRaw(d);
		expect(Object.keys(claim).sort()).toEqual([...KEYS].sort());
		expect(claim.schemaVersion).toBe(2);
		expect(claim.resource).toBe(fs.realpathSync(d));
		expect(claim.selected).toEqual({ n: N, directory: d, profile });
		expect([claim.state, claim.lease]).toEqual(["fenced", "never-held"]);
		expect(claim.owner).toEqual(self());
		expect(claim.generation).toMatch(HEX32);
		expect(claim.firstParticipation).toEqual({ at: claim.writtenAt, generation: claim.generation, from: "fresh" });
		expect(listing(d)).toEqual([CLAIM]);
		expect(fs.statSync(claimPath(d)).mode & 0o777).toBe(0o600);
	});

	it("[QK:PDF-ADMIT-UNARMED] an existing D with no claim and no lease is admitted as unarmed-existing participation", async () => {
		const d = makeD();
		await admit(d, false);
		const claim = readRaw(d);
		expect([claim.state, claim.lease]).toEqual(["fenced", "never-held"]);
		expect(claim.firstParticipation.from).toBe("unarmed-existing");
		expect(claim.firstParticipation.generation).toBe(claim.generation);
		expect(listing(d)).toEqual([CLAIM]);
	});

	it("[QK:PDF-UNARMED-LEGACY-LEASE] an existing D whose lease is present — no claim, or a closed one — is refused and nothing in D changes", async () => {
		const unarmed = makeD();
		fs.mkdirSync(`${unarmed}.lock`);
		expect(await reasonOf(() => admit(unarmed, false))).toBe("legacy-lease-present");
		expect(listing(unarmed)).toEqual([]);
		expect(fs.existsSync(`${unarmed}.lock`)).toBe(true);

		const ended = makeD(OTHER_N);
		writeRaw(
			ended,
			rawClaim(ended, {
				state: "closed",
				lease: "released",
				owner: dead,
				n: OTHER_N,
				end: { at: AT, storage: "closed", lease: "released" },
			}),
		);
		const before = bytes(claimPath(ended));
		fs.mkdirSync(`${ended}.lock`);
		expect(await reasonOf(() => admit(ended, false, OTHER_N))).toBe("legacy-lease-present");
		expect(bytes(claimPath(ended))).toEqual(before);
		expect(listing(ended)).toEqual([CLAIM]);
	});
});

describe("owners that are not proven dead", () => {
	it("[QK:PDF-LIVE-NO-SELF-REENTRY] a claim this very process owns is refused as live at every state; nothing re-enters it", async () => {
		const d = makeD();
		const ticket = await admit(d, true);
		const refusedAt = async (): Promise<string | undefined> => {
			const before = bytes(claimPath(d));
			const reason = await reasonOf(() => admit(d, false));
			expect(bytes(claimPath(d))).toEqual(before);
			return reason;
		};
		expect(await refusedAt()).toBe("owner-live");
		await ticket.leased();
		expect(await refusedAt()).toBe("owner-live");
		ticket.storageOpenAttempted = true;
		await ticket.storageOpened();
		expect(await refusedAt()).toBe("owner-live");
		await ticket.closeFailed({ storage: "failed", lease: "released" });
		expect(readRaw(d).state).toBe("close-failed");
		expect(await refusedAt()).toBe("owner-live");
	});

	it("[QK:PDF-UNKNOWN-FAILS-CLOSED] an uncertain owner, another host, an unreadable, symlinked, non-regular or stray-keyed claim, and an invalid state × lease × end are refused, and nothing is written", async () => {
		const cells: { name: string; reason: string; setup: (d: string) => void }[] = [
			{
				name: "uncertain",
				reason: "owner-uncertain",
				setup: (d) =>
					writeRaw(
						d,
						rawClaim(d, {
							state: "leased",
							lease: "held",
							owner: { pid: process.ppid, startKey: "ps:Thu Jan  1 00:00:00 1970", hostname: os.hostname() },
						}),
					),
			},
			{
				name: "other-host",
				reason: "owner-other-host",
				setup: (d) =>
					writeRaw(
						d,
						rawClaim(d, { state: "leased", lease: "held", owner: { ...dead, hostname: "pdf-another-host.invalid" } }),
					),
			},
			{ name: "unreadable", reason: "claim-unreadable", setup: (d) => fs.writeFileSync(claimPath(d), "{ not json") },
			{
				name: "symlink",
				reason: "claim-unreadable",
				setup: (d) => {
					const elsewhere = path.join(tmp, `elsewhere-${path.basename(d)}.json`);
					fs.writeFileSync(elsewhere, JSON.stringify(rawClaim(d, { state: "leased", lease: "held", owner: dead })));
					fs.symlinkSync(elsewhere, claimPath(d));
				},
			},
			{ name: "directory", reason: "claim-unreadable", setup: (d) => fs.mkdirSync(claimPath(d)) },
			{
				name: "stray-key",
				reason: "claim-unreadable",
				setup: (d) => writeRaw(d, { ...rawClaim(d, { state: "leased", lease: "held", owner: dead }), stray: true }),
			},
			{
				name: "closed+failed",
				reason: "claim-unreadable",
				setup: (d) =>
					writeRaw(
						d,
						rawClaim(d, {
							state: "closed",
							lease: "failed",
							owner: dead,
							end: { at: AT, storage: "failed", lease: "failed" },
						}),
					),
			},
			{
				name: "leased+released",
				reason: "claim-unreadable",
				setup: (d) => writeRaw(d, rawClaim(d, { state: "leased", lease: "released", owner: dead })),
			},
		];
		for (const [index, cell] of cells.entries()) {
			const d = makeD(`${String(index).padStart(13, "0")}-00000000-0000-0000-0000-000000000000`);
			cell.setup(d);
			const before = listing(d);
			const claimBefore = fs.lstatSync(claimPath(d)).isFile() ? bytes(claimPath(d)) : undefined;
			expect(await reasonOf(() => admit(d, false, path.basename(d))), cell.name).toBe(cell.reason);
			expect(listing(d), cell.name).toEqual(before);
			if (claimBefore !== undefined) expect(bytes(claimPath(d)), cell.name).toEqual(claimBefore);
		}
	});
});

describe("the claim's two schemas (#157 B3 I-1)", () => {
	it("[QK:PDR-V2-READER-STRICT] a schema 2 claim whose directory is not joined from its profile, whose profile is missing or relative, or whose selected holds a stray key, a schema 1 claim carrying a profile, and an unknown schema are unreadable; a valid schema 2 and a valid schema 1 claim are read and judged; nothing is written", async () => {
		const body = (d: string, schemaVersion: number, selected: Record<string, unknown>) => ({
			...rawClaim(d, { state: "leased", lease: "held", owner: self(), n: path.basename(d) }),
			schemaVersion,
			selected,
		});
		const cells: { name: string; reason: string; claim: (d: string, n: string) => unknown }[] = [
			{ name: "v2", reason: "owner-live", claim: (d, n) => body(d, 2, { n, directory: d, profile }) },
			{ name: "v1", reason: "owner-live", claim: (d, n) => body(d, 1, { n, directory: d }) },
			{
				name: "v2-not-joined",
				reason: "claim-unreadable",
				claim: (d, n) => body(d, 2, { n, directory: d, profile: path.join(tmp, "another-agent") }),
			},
			{ name: "v2-no-profile", reason: "claim-unreadable", claim: (d, n) => body(d, 2, { n, directory: d }) },
			{
				name: "v2-relative-profile",
				reason: "claim-unreadable",
				claim: (d, n) => body(d, 2, { n, directory: d, profile: "agent" }),
			},
			{
				name: "v2-stray-selected-key",
				reason: "claim-unreadable",
				claim: (d, n) => body(d, 2, { n, directory: d, profile, stray: true }),
			},
			{
				name: "v1-with-profile",
				reason: "claim-unreadable",
				claim: (d, n) => body(d, 1, { n, directory: d, profile }),
			},
			{ name: "unknown-schema", reason: "claim-unreadable", claim: (d, n) => body(d, 3, { n, directory: d, profile }) },
		];
		for (const [index, cell] of cells.entries()) {
			const n = `${String(index).padStart(13, "0")}-00000000-0000-0000-0000-000000000003`;
			const d = makeD(n);
			writeRaw(d, cell.claim(d, n));
			const before = bytes(claimPath(d));
			expect(await reasonOf(() => admit(d, false, n)), cell.name).toBe(cell.reason);
			expect(bytes(claimPath(d)), cell.name).toEqual(before);
			expect(listing(d), cell.name).toEqual([CLAIM]);
		}
	});
});

describe("owners proven dead", () => {
	it("[QK:PDF-DEAD-RECLAIM] a dead owner whose lease is attributed (held, or held with its release unobserved) is reclaimed: fenced, a new generation, reclaimedFrom naming what it took over", async () => {
		const cells = [
			{ state: "leased", lease: "held" },
			{ state: "storage-open", lease: "held" },
			{ state: "close-failed", lease: "unknown", end: { at: AT, storage: "unknown", lease: "unknown" } },
		];
		for (const [index, cell] of cells.entries()) {
			const d = makeD(`${String(index).padStart(13, "0")}-00000000-0000-0000-0000-000000000001`);
			writeRaw(d, rawClaim(d, { ...cell, owner: dead, n: path.basename(d) }));
			// A present lease does not stop this row: the library's stale takeover is admissible only here.
			fs.mkdirSync(`${d}.lock`);
			await admit(d, false, path.basename(d));
			const claim = readRaw(d);
			expect([claim.state, claim.lease], cell.state).toEqual(["fenced", "never-held"]);
			expect(claim.owner, cell.state).toEqual(self());
			expect(claim.generation, cell.state).toMatch(HEX32);
			expect(claim.generation, cell.state).not.toBe(GEN_A);
			expect(claim.reclaimedFrom, cell.state).toEqual({
				generation: GEN_A,
				state: cell.state,
				owner: dead,
				leaseOutcome: cell.lease,
			});
			expect(claim.firstParticipation, cell.state).toEqual({ at: AT, generation: GEN_A, from: "fresh" });
		}
	});

	it("[QK:PDF-DEAD-LEASE-UNATTRIBUTED] a dead owner whose lease is unattributed is refused while that lease is present, and reclaimed once it is absent", async () => {
		const cells = [
			{ state: "fenced", lease: "never-held" },
			{ state: "close-failed", lease: "released", end: { at: AT, storage: "failed", lease: "released" } },
			{ state: "close-failed", lease: "failed", end: { at: AT, storage: "failed", lease: "failed" } },
		];
		for (const [index, cell] of cells.entries()) {
			const name = `${String(index).padStart(13, "0")}-00000000-0000-0000-0000-000000000002`;
			const d = makeD(name);
			writeRaw(d, rawClaim(d, { ...cell, owner: dead, n: name }));
			const before = bytes(claimPath(d));
			fs.mkdirSync(`${d}.lock`);
			expect(await reasonOf(() => admit(d, false, name)), cell.lease).toBe("lease-unattributed");
			expect(bytes(claimPath(d)), cell.lease).toEqual(before);
			expect(listing(d), cell.lease).toEqual([CLAIM]);
			fs.rmdirSync(`${d}.lock`);
			await admit(d, false, name);
			const claim = readRaw(d);
			expect(claim.state, cell.lease).toBe("fenced");
			expect(claim.reclaimedFrom?.leaseOutcome, cell.lease).toBe(cell.lease);
		}
	});
});

describe("what one D is", () => {
	it("[QK:PDF-ALIAS-NOT-ABSENT] another session id or another spelling of the same D reads the same claim: a live owner refuses it", async () => {
		const d = makeD();
		await admit(d, true);
		const before = bytes(claimPath(d));
		// Another name for D: a symlink in another root, so both N and the selected directory differ.
		const aliasRoot = path.join(tmp, "alias-root");
		fs.mkdirSync(aliasRoot);
		const alias = path.join(aliasRoot, OTHER_N);
		fs.symlinkSync(d, alias);
		expect(await reasonOf(() => admit(alias, false, OTHER_N))).toBe("owner-live");
		// The same N under another spelling of the root.
		const rootAlias = path.join(tmp, "root-alias");
		fs.symlinkSync(root, rootAlias);
		expect(await reasonOf(() => admit(path.join(rootAlias, N), false, N))).toBe("owner-live");
		expect(bytes(claimPath(d))).toEqual(before);
	});

	it("[QK:PDF-RESOURCE-MISMATCH-REFUSED] a claim naming another resource (a copied D) is refused by name, never read as absent, and stays as it was", async () => {
		const d = makeD();
		const elsewhere = path.join(tmp, "copied-from");
		fs.mkdirSync(elsewhere);
		writeRaw(
			d,
			rawClaim(d, { state: "fenced", lease: "never-held", owner: dead, resource: fs.realpathSync(elsewhere) }),
		);
		const before = bytes(claimPath(d));
		expect(await reasonOf(() => admit(d, false))).toBe("claim-resource-mismatch");
		expect(bytes(claimPath(d))).toEqual(before);
		expect(listing(d)).toEqual([CLAIM]);
	});
});

describe("the transaction and the generation", () => {
	it("[QK:PDF-GENERATION-EXACT] a ticket whose generation is no longer the claim's cannot transition, and the claim is left as it is", async () => {
		const d = makeD();
		const stale = await admit(d, true);
		const moved = { ...readRaw(d), generation: GEN_B };
		writeRaw(d, moved);
		const before = bytes(claimPath(d));
		expect(await reasonOf(() => stale.leased())).toBe("generation-mismatch");
		expect(bytes(claimPath(d))).toEqual(before);

		const current = makeD(OTHER_N);
		const fresh = await admit(current, true, OTHER_N);
		const generation = readRaw(current).generation;
		await fresh.leased();
		expect([readRaw(current).state, readRaw(current).lease]).toEqual(["leased", "held"]);
		expect(readRaw(current).generation).not.toBe(generation);
	});

	it("[QK:PDF-TX-OWN-RELEASED] the transaction file this actor created is gone after an admission, a refused admission, a transition and a refused transition", async () => {
		const d = makeD();
		const ticket = await admit(d, true);
		expect(fs.existsSync(path.join(d, TX))).toBe(false);
		expect(await reasonOf(() => admit(d, false))).toBe("owner-live");
		expect(fs.existsSync(path.join(d, TX))).toBe(false);
		await ticket.leased();
		expect(fs.existsSync(path.join(d, TX))).toBe(false);
		writeRaw(d, { ...readRaw(d), generation: GEN_B });
		expect(await reasonOf(() => ticket.storageOpened())).toBe("transition-invalid");
		ticket.storageOpenAttempted = true;
		expect(await reasonOf(() => ticket.storageOpened())).toBe("generation-mismatch");
		expect(listing(d)).toEqual([CLAIM]);
	});

	it("[QK:PDF-TX-RESIDUE-FAILS-CLOSED] a transaction file this actor did not create refuses as tx-held after the bounded wait and is left byte for byte", async () => {
		const d = makeD();
		const residue = path.join(d, TX);
		fs.writeFileSync(residue, "residue of another holder\n");
		expect(await reasonOf(() => admit(d, true))).toBe("tx-held");
		expect(bytes(residue).toString()).toBe("residue of another holder\n");
		expect(listing(d)).toEqual([TX]);

		const owned = makeD(OTHER_N);
		const ticket = await admit(owned, true, OTHER_N);
		const before = bytes(claimPath(owned));
		fs.writeFileSync(path.join(owned, TX), "a foreign holder\n");
		expect(await reasonOf(() => ticket.leased())).toBe("tx-held");
		expect(bytes(path.join(owned, TX)).toString()).toBe("a foreign holder\n");
		expect(bytes(claimPath(owned))).toEqual(before);
	}, 15_000);
});

describe("what the fence leaves in D", () => {
	it("[QK:PDF-CLOSED-RECEIPT-KEPT] a clean end is a closed claim that stays, with its end; the next admission reads it, and an unleased end is the never-opened, never-held row", async () => {
		const d = makeD();
		const ticket = await admit(d, true);
		const first = readRaw(d).firstParticipation;
		await ticket.leased();
		ticket.storageOpenAttempted = true;
		await ticket.storageOpened();
		await ticket.closed({ storage: "closed", lease: "released" });
		const claim = readRaw(d);
		expect([claim.state, claim.lease]).toEqual(["closed", "released"]);
		expect(Object.keys(claim.end).sort()).toEqual(["at", "lease", "storage"]);
		expect([claim.end.storage, claim.end.lease]).toEqual(["closed", "released"]);
		expect(listing(d)).toEqual([CLAIM]);
		// The next owner reads that receipt: it keeps the first participation instead of starting one.
		await admit(d, false);
		expect(readRaw(d).firstParticipation).toEqual(first);
		expect(readRaw(d).state).toBe("fenced");

		const unleased = makeD(OTHER_N);
		const never: PiDurableOwnerTicket = await admit(unleased, true, OTHER_N);
		await never.endUnleased();
		const ended = readRaw(unleased);
		expect([ended.state, ended.lease, ended.end.storage, ended.end.lease]).toEqual([
			"closed",
			"never-held",
			"never-opened",
			"never-held",
		]);

		// A schema 1 receipt, seeded as raw JSON: closed, released, its storage closed, no lease present. The next
		// admission reads it and writes its own schema 2 claim with the profile ITS caller read, here spelled with a
		// trailing separator: the same join, other bytes, and nothing the old claim could have supplied.
		const legacy = makeD(THIRD_N);
		writeRaw(
			legacy,
			rawClaim(legacy, {
				state: "closed",
				lease: "released",
				owner: dead,
				n: THIRD_N,
				end: { at: AT, storage: "closed", lease: "released" },
			}),
		);
		const callerProfile = `${profile}/`;
		await createPiDurableOwnerFence().admit({
			directory: legacy,
			selectedN: THIRD_N,
			created: false,
			profile: callerProfile,
		});
		const taken = readRaw(legacy);
		expect(Object.keys(taken).sort()).toEqual([...KEYS].sort());
		expect(taken.schemaVersion).toBe(2);
		expect(taken.selected).toEqual({ n: THIRD_N, directory: legacy, profile: callerProfile });
		expect([taken.state, taken.lease]).toEqual(["fenced", "never-held"]);
		expect(taken.owner).toEqual(self());
		expect(taken.generation).toMatch(HEX32);
		expect(taken.generation).not.toBe(GEN_A);
		expect(taken.firstParticipation).toEqual({ at: AT, generation: GEN_A, from: "fresh" });
		expect(listing(legacy)).toEqual([CLAIM]);
	});

	it("[QK:PDF-TMP-INERT] a leftover atomic temp holding a valid-looking claim is never read as the claim, and stays as it was", async () => {
		const d = makeD();
		const leftover = path.join(d, `${CLAIM}.tmp-999-abcdefabcdef`);
		fs.writeFileSync(leftover, JSON.stringify(rawClaim(d, { state: "leased", lease: "held", owner: self() })));
		const before = bytes(leftover);
		await admit(d, false);
		expect(readRaw(d).firstParticipation.from).toBe("unarmed-existing");
		expect(bytes(leftover)).toEqual(before);
		expect(listing(d)).toEqual([CLAIM, path.basename(leftover)].sort());
	});

	it("[QK:PDF-TMP-COLLISION-NOT-OURS] a temp name another file already holds is not this write's to remove: the write fails by its own EEXIST and that file keeps its bytes and inode", async () => {
		const d = makeD();
		const taken = Buffer.from("c0111de0aa01", "hex");
		const theirs = path.join(d, `${CLAIM}.tmp-${process.pid}-${taken.toString("hex")}`);
		fs.writeFileSync(theirs, "another writer's temp\n");
		const inode = fs.statSync(theirs).ino;
		entropy.randomBytes.mockImplementation(((size: number) =>
			size === 6 ? Buffer.from(taken) : realCrypto.randomBytes(size)) as never);
		const failure = await admit(d, true).then(
			() => undefined,
			(error: unknown) => error as NodeJS.ErrnoException,
		);
		expect(failure?.code).toBe("EEXIST");
		expect(fs.readFileSync(theirs, "utf8")).toBe("another writer's temp\n");
		expect(fs.statSync(theirs).ino).toBe(inode);
		expect(listing(d)).toEqual([path.basename(theirs)]);
	});

	it("[QK:PDF-SQLITE-NAMESPACE] no fence name starts with session.sqlite, and the SDK's session.sqlite files in D stay byte-identical through a whole owner lifetime", async () => {
		for (const name of [PI_DURABLE_OWNER_CLAIM, PI_DURABLE_OWNER_TX, PI_DURABLE_OWNER_TMP_PREFIX]) {
			expect(name.startsWith("session.sqlite"), name).toBe(false);
		}
		expect([PI_DURABLE_OWNER_CLAIM, PI_DURABLE_OWNER_TX]).toEqual([CLAIM, TX]);
		expect(PI_DURABLE_OWNER_TMP_PREFIX.startsWith(`${CLAIM}.tmp-`)).toBe(true);
		const d = makeD();
		const sqlite = ["session.sqlite", "session.sqlite-wal", "session.sqlite-shm"];
		for (const [i, name] of sqlite.entries()) fs.writeFileSync(path.join(d, name), Buffer.from([i, 0x53, 0x51, 0x4c]));
		const before = sqlite.map((name) => bytes(path.join(d, name)));
		const ticket = await admit(d, false);
		await ticket.leased();
		ticket.storageOpenAttempted = true;
		await ticket.storageOpened();
		await ticket.closed({ storage: "closed", lease: "released" });
		expect(sqlite.map((name) => bytes(path.join(d, name)))).toEqual(before);
		expect(listing(d)).toEqual([CLAIM, ...sqlite].sort());
	});
});
