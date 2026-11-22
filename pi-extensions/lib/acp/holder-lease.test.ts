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
const scopeOf = (bootId: string, machine = MACHINE): LeaseScope => ({ machine, bootId });

type Verdict = "live" | "dead" | "uncertain";
function probe(pid: number, over: Partial<LeaseProbe> & { others?: Record<number, Verdict> } = {}): LeaseProbe {
	return {
		self: { pid, startKey: `start-${pid}` },
		nonce: "module-1",
		scope: scopeOf(BOOT_A),
		classify: (identity) => over.others?.[identity.pid] ?? "uncertain",
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

it("[QK:ACP-LEASE-DEAD-HOLDER-STOPS] a holder that is gone, or cannot be judged, on this boot leaves its lease standing", () => {
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
	// A holder that is seen alive is never taken over, boot id or not.
	const alive = held(scopeOf(BOOT_A));
	expect(
		acquireHolderLease(alive.input, probe(200, { scope: scopeOf(BOOT_B), others: { 100: "live" } }), alive.dir),
	).toMatchObject({ ok: false, stop: "holder" });
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
	expect(readLeaseScope((path) => (path === "/etc/machine-id" ? `${MACHINE}\n` : `${BOOT_A}\n`))).toEqual(
		scopeOf(BOOT_A),
	);
	expect(readLeaseScope(() => "")).toBeNull();
	expect(
		readLeaseScope(() => {
			throw new Error("ENOENT");
		}),
	).toBeNull();
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
