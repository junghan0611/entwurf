/**
 * #171 step 8 — the holder lease of a vendor session, against a real directory.
 *
 * Oracle: the lease file itself. A verdict that lets a second process in must leave a file naming
 * that process; every refusal must leave the file byte for byte as it was found. Liveness is
 * injected, so no row depends on what runs on this host.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";
import {
	acquireHolderLease,
	holderLeasePath,
	type LeaseProbe,
	type LeaseScope,
	parseHolderLease,
	publishLeaseChild,
	readLeaseScope,
	releaseHolderLease,
	wellFormedScope,
} from "./holder-lease.ts";

const ROOT = mkdtempSync(join(tmpdir(), "acp-holder-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const MACHINE = "0123456789abcdef0123456789abcdef";
const BOOT_A = "11111111-2222-3333-4444-555555555555";
const BOOT_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const NS_A = "pid:[4026531836]";
const NS_B = "pid:[4026532999]";
/** `pidNs: null`: a scope that names no PID namespace. */
const scopeOf = (bootId: string, machine = MACHINE, pidNs: string | null = NS_A): LeaseScope =>
	pidNs === null ? { machine, bootId } : { machine, bootId, pidNs };

type Verdict = "live" | "dead" | "uncertain";
function probe(
	pid: number,
	over: Partial<LeaseProbe> & { others?: Record<number, Verdict>; emptyGroups?: number[] } = {},
): LeaseProbe {
	return {
		self: { pid, startKey: `start-${pid}` },
		nonce: "module-1",
		scope: scopeOf(BOOT_A),
		classify: (identity) => over.others?.[identity.pid] ?? "uncertain",
		groupGone: (pgid) => over.emptyGroups?.includes(pgid) ?? false,
		...over,
	};
}

let seq = 0;
function fresh() {
	const dir = join(ROOT, `d${seq++}`);
	const input = { backend: "claude", acpSessionId: "ACP-1", at: "2026-11-22T00:00:00Z" };
	const path = holderLeasePath(input.backend, input.acpSessionId, dir);
	return { dir, input, path, read: () => readFileSync(path, "utf8") };
}

it("[QK:ACP-LEASE-ONE-HOLDER] one process holds a session: the same module holds on, a reloaded module and another live process stop", () => {
	const { dir, input, path, read } = fresh();
	const first = acquireHolderLease(input, probe(100), dir);
	expect(first).toMatchObject({ ok: true, how: "created", path, lease: { gen: 1, holder: { pid: 100 }, child: null } });
	const before = read();
	// The path does not carry the session id.
	expect(path).not.toContain("ACP-1");
	expect(acquireHolderLease(input, probe(100), dir)).toMatchObject({ ok: true, how: "held" });
	expect(acquireHolderLease(input, probe(100, { nonce: "module-2" }), dir)).toMatchObject({
		ok: false,
		stop: "reload",
	});
	expect(acquireHolderLease(input, probe(200, { others: { 100: "live" } }), dir)).toMatchObject({
		ok: false,
		stop: "holder",
		why: "process 100 holds this session",
	});
	// The same pid with another start is another process.
	const reused = probe(100, { others: { 100: "live" } });
	reused.self.startKey = "start-later";
	expect(acquireHolderLease(input, reused, dir)).toMatchObject({ ok: false, stop: "holder" });
	expect(read()).toBe(before);
	// A process that cannot name its own start holds nothing.
	const nameless = probe(300);
	nameless.self.startKey = "";
	const other = fresh();
	expect(acquireHolderLease(other.input, nameless, other.dir)).toMatchObject({ ok: false, stop: "holderStale" });
	expect(existsSync(other.path)).toBe(false);
	// Another session, and the same id under another backend, are other leases.
	expect(acquireHolderLease({ ...input, acpSessionId: "ACP-2" }, probe(200), dir)).toMatchObject({ how: "created" });
	expect(acquireHolderLease({ ...input, backend: "agy" }, probe(200), dir)).toMatchObject({ how: "created" });
});

it("[QK:ACP-LEASE-DEAD-HOLDER-STOPS] a holder that is gone, or cannot be judged, on this boot leaves a lease that names no agent standing", () => {
	for (const verdict of ["dead", "uncertain"] as const) {
		const { dir, input, read } = fresh();
		acquireHolderLease(input, probe(100), dir);
		const before = read();
		expect(acquireHolderLease(input, probe(200, { others: { 100: verdict } }), dir), verdict).toMatchObject({
			ok: false,
			stop: "holderStale",
		});
		expect(read(), verdict).toBe(before);
	}
	// A lease that cannot be read is nobody's to replace.
	for (const body of ["{not json", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, gen: 1 }), ""]) {
		const { dir, input, path, read } = fresh();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body);
		expect(acquireHolderLease(input, probe(200), dir), body).toMatchObject({ ok: false, stop: "holderStale" });
		expect(read(), body).toBe(body);
	}
});

it("[QK:ACP-LEASE-REBOOT-TAKEOVER] a lease is taken over only across a boot of the same machine, with both scopes whole and the lease unchanged", () => {
	const held = (scope: LeaseScope | null) => {
		const world = fresh();
		acquireHolderLease(world.input, probe(100, { scope }), world.dir);
		return world;
	};
	// Control: the previous boot's holder cannot be alive, whatever a pid of this boot looks like.
	const taken = held(scopeOf(BOOT_A));
	const now = probe(200, { scope: scopeOf(BOOT_B), others: { 100: "dead" } });
	expect(acquireHolderLease(taken.input, now, taken.dir)).toMatchObject({
		ok: true,
		how: "taken-over",
		lease: { gen: 2, holder: { pid: 200 }, scope: { bootId: BOOT_B }, child: null },
	});
	expect(parseHolderLease(JSON.parse(taken.read()))).toMatchObject({ gen: 2, holder: { pid: 200 } });
	expect(existsSync(`${taken.path}.takeover`)).toBe(false);
	const uncertain = held(scopeOf(BOOT_A));
	expect(acquireHolderLease(uncertain.input, probe(200, { scope: scopeOf(BOOT_B) }), uncertain.dir)).toMatchObject({
		how: "taken-over",
	});
	// Every other shape stops and leaves the lease as found.
	const refusals: Array<[string, LeaseScope | null, LeaseProbe]> = [
		["same boot", scopeOf(BOOT_A), probe(200, { others: { 100: "dead" } })],
		["another machine", scopeOf(BOOT_A, "f".repeat(32)), probe(200, { scope: scopeOf(BOOT_B) })],
		["lease without a scope", null, probe(200, { scope: scopeOf(BOOT_B) })],
		["reader without a scope", scopeOf(BOOT_A), probe(200, { scope: null })],
		["reader with a malformed scope", scopeOf(BOOT_A), probe(200, { scope: { machine: "host", bootId: BOOT_B } })],
	];
	for (const [name, scope, reader] of refusals) {
		const world = held(scope);
		const before = world.read();
		expect(acquireHolderLease(world.input, reader, world.dir), name).toMatchObject({ ok: false, stop: "holderStale" });
		expect(world.read(), name).toBe(before);
	}
	// A holder that reads as alive is never taken over, boot id or not. Its pid is a number of another
	// boot, so nobody is named to the operator.
	const alive = held(scopeOf(BOOT_A));
	const aliveBefore = alive.read();
	expect(
		acquireHolderLease(alive.input, probe(200, { scope: scopeOf(BOOT_B), others: { 100: "live" } }), alive.dir),
	).toEqual({ ok: false, stop: "holderStale", why: "the lease's process ids cannot be compared from this process" });
	expect(alive.read()).toBe(aliveBefore);
	// Another takeover under way.
	const raced = held(scopeOf(BOOT_A));
	writeFileSync(`${raced.path}.takeover`, "");
	const before = raced.read();
	expect(acquireHolderLease(raced.input, probe(200, { scope: scopeOf(BOOT_B) }), raced.dir)).toMatchObject({
		ok: false,
		stop: "holderStale",
	});
	expect(raced.read()).toBe(before);
	// A scope is two kernel-issued ids, nothing looser; an unreadable source is no scope.
	expect(wellFormedScope(scopeOf(BOOT_A))).toBe(true);
	expect(wellFormedScope({ machine: "myhost", bootId: BOOT_A })).toBe(false);
	expect(wellFormedScope({ machine: MACHINE, bootId: "1" })).toBe(false);
	expect(wellFormedScope(null)).toBe(false);
	const ids = (path: string) => (path === "/etc/machine-id" ? `${MACHINE}\n` : `${BOOT_A}\n`);
	expect(readLeaseScope(ids, () => NS_A)).toEqual(scopeOf(BOOT_A));
	// Without a readable PID namespace the scope still tells a reboot.
	const bare = scopeOf(BOOT_A, MACHINE, null);
	expect(
		readLeaseScope(ids, () => {
			throw new Error("ENOENT");
		}),
	).toEqual(bare);
	expect(readLeaseScope(ids, () => "pid")).toEqual(bare);
	expect(wellFormedScope({ ...bare, pidNs: "4026531836" })).toBe(false);
	const older = held(bare);
	expect(acquireHolderLease(older.input, probe(200, { scope: scopeOf(BOOT_B) }), older.dir)).toMatchObject({
		how: "taken-over",
	});
	expect(readLeaseScope(() => "")).toBeNull();
	expect(
		readLeaseScope(() => {
			throw new Error("ENOENT");
		}),
	).toBeNull();
});

/** A lease of holder 100 on BOOT_A whose agent 4242 is published: what a Pi that died leaves behind. */
function leftBehind(scope: LeaseScope | null = scopeOf(BOOT_A)) {
	const world = fresh();
	const owner = probe(100, { scope });
	const got = acquireHolderLease(world.input, owner, world.dir);
	if (!got.ok) throw new Error(got.why);
	publishLeaseChild({ lease: got.lease, path: world.path }, { pid: 4242, startKey: "child-start" }, owner, "t");
	return world;
}

it("[QK:ACP-LEASE-GONE-TAKEOVER] a lease is taken over on the same boot only when its holder and its agent are dead and the agent's group is empty", () => {
	const gone = { others: { 100: "dead", 4242: "dead" } as Record<number, Verdict>, emptyGroups: [4242] };
	// Control: all three proven.
	const taken = leftBehind();
	expect(acquireHolderLease(taken.input, probe(200, gone), taken.dir)).toMatchObject({
		ok: true,
		how: "taken-over",
		lease: { gen: 3, holder: { pid: 200 }, nonce: "module-1", scope: { bootId: BOOT_A }, child: null },
	});
	expect(parseHolderLease(JSON.parse(taken.read()))).toMatchObject({ gen: 3, holder: { pid: 200 }, child: null });
	expect(existsSync(`${taken.path}.takeover`)).toBe(false);
	// Every proof that is missing stops, and leaves the lease as found.
	const refusals: Array<[string, LeaseScope | null, LeaseProbe]> = [
		["holder cannot be judged", scopeOf(BOOT_A), probe(200, { ...gone, others: { 4242: "dead" } })],
		["agent cannot be judged", scopeOf(BOOT_A), probe(200, { ...gone, others: { 100: "dead" } })],
		["lease without a scope", null, probe(200, gone)],
		["reader without a scope", scopeOf(BOOT_A), probe(200, { ...gone, scope: null })],
		["another machine", scopeOf(BOOT_A, "f".repeat(32)), probe(200, gone)],
	];
	for (const [name, scope, reader] of refusals) {
		const world = leftBehind(scope);
		const before = world.read();
		expect(acquireHolderLease(world.input, reader, world.dir), name).toMatchObject({ ok: false, stop: "holderStale" });
		expect(world.read(), name).toBe(before);
	}
	// Another takeover under way.
	const raced = leftBehind();
	writeFileSync(`${raced.path}.takeover`, "");
	const before = raced.read();
	expect(acquireHolderLease(raced.input, probe(200, gone), raced.dir)).toMatchObject({
		ok: false,
		stop: "holderStale",
	});
	expect(raced.read()).toBe(before);
});

it("[QK:ACP-LEASE-PID-NAMESPACE] a pid proves nothing across PID namespaces: a same-boot lease is taken over only where both name the same one", () => {
	// In another namespace the holder's pids read as gone while they run: every probe below says so.
	const gone = { others: { 100: "dead", 4242: "dead" } as Record<number, Verdict>, emptyGroups: [4242] };
	const bare = scopeOf(BOOT_A, MACHINE, null);
	const rows: Array<[string, LeaseScope, LeaseScope]> = [
		["another namespace", scopeOf(BOOT_A), scopeOf(BOOT_A, MACHINE, NS_B)],
		["a lease that names none", bare, scopeOf(BOOT_A)],
		["a reader that names none", scopeOf(BOOT_A), bare],
		["neither names one", bare, bare],
	];
	for (const [name, lease, reader] of rows) {
		const world = leftBehind(lease);
		const before = world.read();
		expect(acquireHolderLease(world.input, probe(200, { ...gone, scope: reader }), world.dir), name).toMatchObject({
			ok: false,
			stop: "holderStale",
		});
		expect(world.read(), name).toBe(before);
	}
	// A pid of another namespace that reads as alive here names nobody: no process is given to the
	// operator to close, for the holder, for the agent, or as this process before a reload.
	const live = { others: { 100: "live", 4242: "live" } as Record<number, Verdict>, emptyGroups: [] };
	const unnamed = {
		ok: false,
		stop: "holderStale",
		why: "the lease's process ids cannot be compared from this process",
	};
	for (const [name, lease, reader] of rows) {
		const world = leftBehind(lease);
		const before = world.read();
		expect(acquireHolderLease(world.input, probe(200, { ...live, scope: reader }), world.dir), name).toEqual(unnamed);
		expect(world.read(), name).toBe(before);
	}
	const twin = leftBehind();
	expect(
		acquireHolderLease(
			twin.input,
			probe(100, { ...live, nonce: "module-2", scope: scopeOf(BOOT_A, MACHINE, NS_B) }),
			twin.dir,
		),
	).toEqual(unnamed);
	// The namespace is kept through a rewrite of the lease.
	const kept = leftBehind();
	expect(parseHolderLease(JSON.parse(kept.read()))?.scope).toEqual(scopeOf(BOOT_A));
});

it("[QK:ACP-LEASE-LIVE-ORPHAN-STOPS] an agent that outlived its holder holds the session and is named by its pid; a group not proven empty stops and names nobody to end", () => {
	type Facts = Partial<LeaseProbe> & { others: Record<number, Verdict>; emptyGroups?: number[] };
	const rows: Array<[string, Facts, "holder" | "resume", string]> = [
		[
			"the agent runs",
			{ others: { 100: "dead", 4242: "live" }, emptyGroups: [4242] },
			"holder",
			"agent process 4242 of the previous holder still runs",
		],
		[
			"the agent is dead and its group is not proven empty",
			{ others: { 100: "dead", 4242: "dead" } },
			"resume",
			"process group 4242 of the previous agent is not proven empty",
		],
	];
	for (const [name, facts, stop, why] of rows) {
		const world = leftBehind();
		const before = world.read();
		expect(acquireHolderLease(world.input, probe(200, facts), world.dir), name).toEqual({ ok: false, stop, why });
		expect(world.read(), name).toBe(before);
		expect(existsSync(`${world.path}.takeover`), name).toBe(false);
	}
});

it("[QK:ACP-LEASE-RELEASE-OWNER-ONLY] only the owning module publishes its agent or releases the lease", () => {
	const { dir, input, path, read } = fresh();
	const owner = probe(100);
	const got = acquireHolderLease(input, owner, dir);
	if (!got.ok) throw new Error(got.why);
	const held = { lease: got.lease, path };
	const withChild = publishLeaseChild(held, { pid: 4242, startKey: "child-start" }, owner, "2026-11-22T00:00:01Z");
	expect(withChild).toMatchObject({ gen: 2, child: { pid: 4242, startKey: "child-start" } });
	expect(parseHolderLease(JSON.parse(read()))).toEqual(withChild);
	// The lease this module read is no longer the one on disk: it publishes nothing over it.
	expect(() => publishLeaseChild(held, null, owner, "t")).toThrow(/no longer this process's/);
	const before = read();
	for (const stranger of [probe(200), probe(100, { nonce: "module-2" })]) {
		expect(releaseHolderLease(path, stranger)).toBe(false);
		expect(() => publishLeaseChild({ lease: withChild, path }, null, stranger, "t")).toThrow();
		expect(read()).toBe(before);
	}
	expect(releaseHolderLease(path, owner)).toBe(true);
	expect(existsSync(path)).toBe(false);
	// Nothing to release, or nothing readable: left alone.
	expect(releaseHolderLease(path, owner)).toBe(false);
	writeFileSync(path, "{not json");
	expect(releaseHolderLease(path, owner)).toBe(false);
	expect(read()).toBe("{not json");
});
