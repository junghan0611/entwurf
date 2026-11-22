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
// A lease left standing is taken over on proof, never on a guess. Both the lease and this process
// must name a well-formed scope (the machine id and the boot id) of the same machine. Then:
//  - another boot: no process of the previous boot can be alive;
//  - the same boot, and the same PID namespace named by both (a pid is a number of one namespace;
//    a lease that names none, as one written before this did, proves nothing here): the holder is
//    dead by its pid and start, the agent it published is dead by its pid and start, and that
//    agent's process group is empty. An agent that still runs is a holder, named by its pid. A
//    group that is not proven empty stops without naming anyone. A lease that names no agent proves
//    nothing about one, and stops (GLG 2026-11-22: a Pi that died must not cost its session until
//    the next reboot).
// A process the agent started that left its group (its own session) is not seen by this proof.
// Either way it is taken under an exclusive takeover marker, and only if the lease is still the
// generation that was read. Anything missing, malformed, foreign or unproven stops.
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
	readlinkSync,
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
	/**
	 * The PID namespace the writer's pids are numbers of (`readlink /proc/self/ns/pid`). Two
	 * processes of one machine and boot can still be in different namespaces, where the other's
	 * pid reads as "no such process". Absent where it cannot be read, and in a lease written before
	 * it existed.
	 */
	pidNs?: string;
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
	/**
	 * Is the process group `pgid` empty? `true` only on the kernel's own "no such process"; `false`
	 * is "not proven", not "a process of it runs".
	 */
	groupGone(pgid: number): boolean;
}

export type LeaseVerdict =
	| { ok: true; lease: HolderLease; path: string; how: "created" | "held" | "taken-over" }
	| { ok: false; stop: "holder" | "holderStale" | "reload" | "resume"; why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MACHINE_ID = /^[0-9a-f]{32}$/;
const PID_NS = /^pid:\[[0-9]+\]$/;

export function holderLeaseDir(): string {
	return join(homedir(), ".pi", "agent", "entwurf-acp-holders");
}

export function holderLeasePath(backend: string, acpSessionId: string, dir: string = holderLeaseDir()): string {
	const name = createHash("sha256").update(acpSessionId).digest("hex");
	return join(dir, backend.replace(/[^a-z0-9_-]/gi, "_"), `${name}.json`);
}

/** A scope is usable only when its ids have their kernel-issued shape; the PID namespace may be absent. */
export function wellFormedScope(scope: unknown): scope is LeaseScope {
	const s = scope as Partial<LeaseScope> | null;
	return (
		typeof s === "object" &&
		s !== null &&
		typeof s.machine === "string" &&
		MACHINE_ID.test(s.machine) &&
		typeof s.bootId === "string" &&
		UUID.test(s.bootId) &&
		(s.pidNs === undefined || (typeof s.pidNs === "string" && PID_NS.test(s.pidNs)))
	);
}

/** This kernel's scope, or `null` where it cannot be read whole (no takeover is possible there). */
export function readLeaseScope(
	read: (path: string) => string = (path) => readFileSync(path, "utf8"),
	link: (path: string) => string = (path) => readlinkSync(path),
): LeaseScope | null {
	try {
		const scope: LeaseScope = {
			machine: read("/etc/machine-id").trim(),
			bootId: read("/proc/sys/kernel/random/boot_id").trim(),
		};
		if (!wellFormedScope(scope)) return null;
		// Without a readable namespace the scope still tells a reboot; it proves nothing on the same boot.
		try {
			const pidNs = link("/proc/self/ns/pid");
			if (PID_NS.test(pidNs)) scope.pidNs = pidNs;
		} catch {
			// no procfs namespace link here
		}
		return scope;
	} catch {
		return null;
	}
}

/**
 * Two scopes of one machine: a `rebooted` one, or the `same` boot and PID namespace, where the
 * lease's pids are this process's pids. `null`: not comparable.
 */
function bootRelation(lease: unknown, reader: unknown): "same" | "rebooted" | null {
	if (!wellFormedScope(lease) || !wellFormedScope(reader) || lease.machine !== reader.machine) return null;
	if (lease.bootId !== reader.bootId) return "rebooted";
	return lease.pidNs !== undefined && lease.pidNs === reader.pidNs ? "same" : null;
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
		scope:
			r.scope === null
				? null
				: {
						machine: r.scope.machine,
						bootId: r.scope.bootId,
						...(r.scope.pidNs === undefined ? {} : { pidNs: r.scope.pidNs }),
					},
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

/** Do two scopes name different kernels or PID namespaces? Only what both state can differ. */
function foreignScope(lease: LeaseScope | null, reader: LeaseScope | null): boolean {
	if (!wellFormedScope(lease) || !wellFormedScope(reader)) return false;
	if (lease.machine !== reader.machine || lease.bootId !== reader.bootId) return true;
	return lease.pidNs !== undefined && reader.pidNs !== undefined && lease.pidNs !== reader.pidNs;
}

/** The lease names this very process: its pid and start, in a scope that is not another one. */
function mine(lease: HolderLease, probe: LeaseProbe): boolean {
	return (
		lease.holder.pid === probe.self.pid &&
		lease.holder.startKey === probe.self.startKey &&
		!foreignScope(lease.scope, probe.scope)
	);
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
	// A pid is a number of one boot and one PID namespace. Only where the lease's are this process's
	// (`same`) does a probe of one say anything about the lease's process, and only there is a
	// process named to the operator.
	const relation = bootRelation(found.scope, probe.scope);
	const holder = probe.classify(found.holder);
	if (holder === "live" && relation === "same") {
		return { ok: false, stop: "holder", why: `process ${found.holder.pid} holds this session` };
	}
	// A previous boot's holder cannot be alive. A holder that reads as alive is still never taken over.
	let proven = relation === "rebooted" && holder !== "live";
	// On this boot: the holder is dead by pid and start, the agent it published is dead by pid and
	// start, and nothing is left in that agent's process group (the agent is spawned as its leader,
	// and what it starts stays in the group).
	if (relation === "same" && holder === "dead" && found.child !== null) {
		const agent = probe.classify(found.child);
		if (agent === "live") {
			return {
				ok: false,
				stop: "holder",
				why: `agent process ${found.child.pid} of the previous holder still runs`,
			};
		}
		if (agent === "dead") {
			// Not proven empty: what the agent started may still be leaving, the group id may have been
			// reused, or it cannot be asked. None of these names a process to end, so this is no `holder`.
			if (!probe.groupGone(found.child.pid)) {
				return {
					ok: false,
					stop: "resume",
					why: `process group ${found.child.pid} of the previous agent is not proven empty`,
				};
			}
			proven = true;
		}
	}
	if (!proven) {
		return {
			ok: false,
			stop: "holderStale",
			why:
				relation !== "same"
					? "the lease's process ids cannot be compared from this process"
					: holder === "dead"
						? `process ${found.holder.pid} held this session, and the end of its agent cannot be proven`
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
