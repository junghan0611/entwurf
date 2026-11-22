// #171 step 8 — who holds a vendor session.
//
// A vendor session can be driven by one agent process at a time. A second Pi that resumed the same
// id while the first one's agent was still alive would have two writers on one conversation. So the
// process that holds a session publishes a lease for it, and an attach stops while another holder's
// lease stands.
//
// The lease is released by its owner alone, and only once that owner has proof that the agent it
// started is gone (backend.ts: the child's exit was observed and its process group is empty). A
// signal that was sent is not that proof, so the process exit hook releases nothing. A holder that
// died without releasing leaves its lease standing, and the next owner stops on it.
//
// One takeover exists: after a host reboot no process of the previous boot can be alive. It is taken
// only when both the lease and this process name a well-formed scope (the machine id and the boot
// id), the machine is the same and the boot differs; under an exclusive takeover marker; and only
// if the lease is still the generation that was read. Anything missing, malformed or foreign stops.
//
// Scope, stated: exclusivity holds for one local store with working `O_EXCL`, `rename` and `fsync`.
// A HOME shared by two hosts is covered only as far as the machine id tells them apart: a lease of
// another machine is never taken over.

import { createHash } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ProcessIdentity {
	pid: number;
	/** `processStartKey(pid)` at the time of writing: `linux:<ticks>` or `ps:<lstart>`. */
	startKey: string;
}

/** The kernel a process identity belongs to: an identity is comparable only inside one scope. */
export interface LeaseScope {
	machine: string;
	bootId: string;
}

export interface HolderLease {
	v: 1;
	/** Bumped by every rewrite, so a takeover can tell that the lease it read is still the one on disk. */
	gen: number;
	holder: ProcessIdentity;
	/** The holder's module instance: a `/reload` keeps the pid and makes a new one. */
	nonce: string;
	scope: LeaseScope | null;
	/** The agent process the holder started for this session, once it exists. */
	child: ProcessIdentity | null;
	at: string;
}

/** What this process knows about itself and can find out about another, injected for tests. */
export interface LeaseProbe {
	self: ProcessIdentity;
	nonce: string;
	scope: LeaseScope | null;
	/** `live`: that very process runs. `dead`: proven gone. `uncertain`: anything else. */
	classify(identity: ProcessIdentity): "live" | "dead" | "uncertain";
}

export type LeaseVerdict =
	| { ok: true; lease: HolderLease; path: string; how: "created" | "held" | "taken-over" }
	| { ok: false; stop: "holder" | "holderStale" | "reload"; why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MACHINE_ID = /^[0-9a-f]{32}$/;

export function holderLeaseDir(): string {
	return join(homedir(), ".pi", "agent", "entwurf-acp-holders");
}

export function holderLeasePath(backend: string, acpSessionId: string, dir: string = holderLeaseDir()): string {
	const name = createHash("sha256").update(acpSessionId).digest("hex");
	return join(dir, backend.replace(/[^a-z0-9_-]/gi, "_"), `${name}.json`);
}

/** A scope is usable only when both of its ids have their kernel-issued shape. */
export function wellFormedScope(scope: unknown): scope is LeaseScope {
	const s = scope as Partial<LeaseScope> | null;
	return (
		typeof s === "object" &&
		s !== null &&
		typeof s.machine === "string" &&
		MACHINE_ID.test(s.machine) &&
		typeof s.bootId === "string" &&
		UUID.test(s.bootId)
	);
}

/** This kernel's scope, or `null` where it cannot be read whole (no takeover is possible there). */
export function readLeaseScope(
	read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): LeaseScope | null {
	try {
		const scope = {
			machine: read("/etc/machine-id").trim(),
			bootId: read("/proc/sys/kernel/random/boot_id").trim(),
		};
		return wellFormedScope(scope) ? scope : null;
	} catch {
		return null;
	}
}

function isIdentity(value: unknown): value is ProcessIdentity {
	const v = value as Partial<ProcessIdentity> | null;
	return (
		typeof v === "object" &&
		v !== null &&
		Number.isSafeInteger(v.pid) &&
		(v.pid as number) > 0 &&
		typeof v.startKey === "string" &&
		v.startKey !== ""
	);
}

/** A lease as written here, or `undefined` for anything else. */
export function parseHolderLease(raw: unknown): HolderLease | undefined {
	const r = raw as Record<string, unknown> | null;
	if (typeof r !== "object" || r === null || r.v !== 1) return undefined;
	if (!Number.isSafeInteger(r.gen) || (r.gen as number) < 1) return undefined;
	if (!isIdentity(r.holder) || typeof r.nonce !== "string" || r.nonce === "") return undefined;
	if (r.scope !== null && !wellFormedScope(r.scope)) return undefined;
	if (r.child !== null && !isIdentity(r.child)) return undefined;
	if (typeof r.at !== "string" || r.at === "") return undefined;
	return {
		v: 1,
		gen: r.gen as number,
		holder: { pid: r.holder.pid, startKey: r.holder.startKey },
		nonce: r.nonce,
		scope: r.scope === null ? null : { machine: r.scope.machine, bootId: r.scope.bootId },
		child: r.child === null ? null : { pid: r.child.pid, startKey: r.child.startKey },
		at: r.at,
	};
}

function readLease(path: string): HolderLease | undefined {
	return parseHolderLease(JSON.parse(readFileSync(path, "utf8")));
}

function syncDirectory(path: string): void {
	const fd = openSync(path, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

/** Publish `lease` at `path`: exclusively when `exclusive`, else by rename over what is there. Durable either way. */
function publish(path: string, lease: HolderLease, exclusive: boolean): void {
	const body = `${JSON.stringify(lease)}\n`;
	if (exclusive) {
		const fd = openSync(path, "wx", 0o600);
		try {
			writeSync(fd, body);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	} else {
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, body, { mode: 0o600 });
		const fd = openSync(tmp, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(tmp, path);
	}
	syncDirectory(dirname(path));
}

function mine(lease: HolderLease, probe: LeaseProbe): boolean {
	return lease.holder.pid === probe.self.pid && lease.holder.startKey === probe.self.startKey;
}

/**
 * Hold the lease of one vendor session for this process, or say why not. Never waits and never
 * retries. Throws only on a store failure of its own write; the caller turns that into a stop.
 */
export function acquireHolderLease(
	input: { backend: string; acpSessionId: string; at: string },
	probe: LeaseProbe,
	dir: string = holderLeaseDir(),
): LeaseVerdict {
	if (probe.self.startKey === "") {
		return { ok: false, stop: "holderStale", why: "this process cannot name its own start" };
	}
	const path = holderLeasePath(input.backend, input.acpSessionId, dir);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const fresh: HolderLease = {
		v: 1,
		gen: 1,
		holder: { ...probe.self },
		nonce: probe.nonce,
		scope: probe.scope ? { ...probe.scope } : null,
		child: null,
		at: input.at,
	};
	try {
		publish(path, fresh, true);
		return { ok: true, lease: fresh, path, how: "created" };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	let found: HolderLease | undefined;
	try {
		found = readLease(path);
	} catch {
		found = undefined;
	}
	if (!found) return { ok: false, stop: "holderStale", why: "the holder lease cannot be read" };
	if (mine(found, probe)) {
		if (found.nonce === probe.nonce) return { ok: true, lease: found, path, how: "held" };
		return { ok: false, stop: "reload", why: "the lease belongs to this process before a reload" };
	}
	const holder = probe.classify(found.holder);
	if (holder === "live") return { ok: false, stop: "holder", why: `process ${found.holder.pid} holds this session` };
	// A previous boot's holder cannot be alive, whatever a pid of this boot looks like.
	const rebooted =
		wellFormedScope(found.scope) &&
		wellFormedScope(probe.scope) &&
		found.scope.machine === probe.scope.machine &&
		found.scope.bootId !== probe.scope.bootId;
	if (!rebooted) {
		return {
			ok: false,
			stop: "holderStale",
			why:
				holder === "dead"
					? `process ${found.holder.pid} held this session and did not release it`
					: `whether process ${found.holder.pid} still holds this session cannot be told`,
		};
	}
	const marker = `${path}.takeover`;
	try {
		closeSync(openSync(marker, "wx", 0o600));
	} catch {
		return { ok: false, stop: "holderStale", why: "another takeover of this lease is under way" };
	}
	try {
		let again: HolderLease | undefined;
		try {
			again = readLease(path);
		} catch {
			again = undefined;
		}
		// The lease that was judged must still be the one on disk: another owner may have replaced it.
		if (
			!again ||
			again.gen !== found.gen ||
			again.holder.pid !== found.holder.pid ||
			again.holder.startKey !== found.holder.startKey ||
			again.nonce !== found.nonce
		) {
			return { ok: false, stop: "holderStale", why: "the lease changed while it was being taken over" };
		}
		const taken: HolderLease = { ...fresh, gen: found.gen + 1 };
		publish(path, taken, false);
		return { ok: true, lease: taken, path, how: "taken-over" };
	} finally {
		rmSync(marker, { force: true });
	}
}

/** Publish the agent process this holder started. Only the owner's own lease is rewritten. */
export function publishLeaseChild(
	held: { lease: HolderLease; path: string },
	child: ProcessIdentity | null,
	probe: LeaseProbe,
	at: string,
): HolderLease {
	const current = readLease(held.path);
	if (!current || !mine(current, probe) || current.nonce !== probe.nonce || current.gen !== held.lease.gen) {
		throw new Error("entwurf: the holder lease is no longer this process's");
	}
	const next: HolderLease = { ...current, gen: current.gen + 1, child: child ? { ...child } : null, at };
	publish(held.path, next, false);
	return next;
}

/**
 * Release this process's lease. The caller has proven that the agent it started is gone. A lease
 * that is not this process's, or cannot be read, is left exactly as it is. Returns whether it was released.
 */
export function releaseHolderLease(path: string, probe: LeaseProbe, gen?: number): boolean {
	let current: HolderLease | undefined;
	try {
		current = readLease(path);
	} catch {
		return false;
	}
	if (!current || !mine(current, probe) || current.nonce !== probe.nonce) return false;
	// `gen`: the generation the caller last wrote. Another write since then is not the caller's to remove.
	if (gen !== undefined && current.gen !== gen) return false;
	rmSync(path, { force: true });
	syncDirectory(dirname(path));
	return true;
}
