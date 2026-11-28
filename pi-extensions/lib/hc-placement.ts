/**
 * hc-placement — where a Herdr Core shows a citizen, as ONE read for one listing (#178).
 *
 * A PLACEMENT VIEW ONLY. Nothing here is an address, a liveness answer or an authority: delivery
 * follows the record and its live rail, and this module is imported by the peers observation and by
 * nothing on a send or launch path. It names no target and returns no verb.
 *
 * THE OPERATOR NAMES THE ENDPOINT, AND ONLY THE OPERATOR. `ENTWURF_HC_PLACEMENT_SOCKET=<absolute
 * path>` is an opt-in for a same-host placement read. It is not discovered, not derived from
 * `HC_TERMINAL_SOCKET` (a launch input, which this view deliberately does not borrow), and nothing
 * else is tried when it is absent or does not answer:
 *   absent / empty                    not read — every citizen stays as the other owner left it
 *   path does not exist               not read (`unobserved`)
 *   connect / reply / hello failure   not read (`unobserved`), once, no retry
 *   not absolute, or carries NUL      named config error (thrown)
 *   exists but is not a unix socket   named config error (thrown)
 * A config error stops the LISTING that asked for the view. It reaches no delivery, because no
 * delivery path reads this variable.
 *
 * ONE READ, NO WATCHER, NOTHING KEPT. `hello {generation: 1}` then `terminal.list`, one connection
 * each, bounded, never retried. The result lives for one listing; no location is written anywhere,
 * so an old location cannot be shown as current.
 *
 * THE JOIN IS A PROCESS ID, AND ONLY FOR CLAUDE CODE (decision G-P2). The core reports the pid of
 * the program each terminal runs (`[HC api.rs:253-268]`, `Public` terminal at v0.1.20). A Claude
 * Code citizen's validated receiver-marker owner is that same process when the terminal runs
 * `claude` directly — measured on oracle 2026-11-28, n=2 (marker ownerPid === terminal pid). Pi and
 * pi-durable have no verified owner-pid source here, so their rows are never claimed: `unobserved`,
 * not `none`. A citizen started by hand from a shell inside a terminal does not join (the terminal's
 * process is the shell) and reads `none`: the core was read and no terminal's own process is it.
 *
 * ONLY THIS CORE'S OWN TERMINALS. `terminal.list` also relays terminals of machines the core knows;
 * a pid from another machine is not a pid here. Only rows with a local address (`t<n>`) are indexed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	buildHcHelloPacket,
	createHcSocketCall,
	HC_GENERATION,
	type HcSocketCall,
	readHcEnvelope,
} from "./hc-launch.ts";
import {
	AMBIGUOUS_PLACEMENT,
	NO_PLACEMENT,
	type PlacementObservation,
	UNOBSERVED_PLACEMENT,
} from "./herdr-placement.ts";

/** The operator's opt-in. Read by this module only. */
export const HC_PLACEMENT_SOCKET_ENV = "ENTWURF_HC_PLACEMENT_SOCKET";

/** One listing may wait this long for each of the two reads; the column is a convenience. */
export const HC_PLACEMENT_READ_TIMEOUT_MS = 2000;

export type HcPlacementConfigReason = "hc-placement-socket-malformed" | "hc-placement-socket-not-a-socket";

/** An operator-named path that cannot be a local unix socket. Thrown, never downgraded to `unobserved`. */
export class HcPlacementConfigError extends Error {
	readonly reason: HcPlacementConfigReason;
	constructor(reason: HcPlacementConfigReason, detail: string) {
		super(
			`${reason}: ${HC_PLACEMENT_SOCKET_ENV} ${detail}. This variable is only a same-host placement view; unset it or name the core's absolute socket path.`,
		);
		this.name = "HcPlacementConfigError";
		this.reason = reason;
	}
}

/** `null` = absent in this process's stat view; otherwise whether the path is a unix socket. No follow. */
export type HcSocketPathProbe = (socketPath: string) => "absent" | "socket" | "other";

export const probeHcSocketPath: HcSocketPathProbe = (socketPath) => {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(socketPath);
	} catch (error) {
		// Bounded environment probe: only "not there" is absence; any other failure is not a socket we may use.
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "other";
	}
	return stat.isSocket() ? "socket" : "other";
};

/**
 * The socket this listing may read, or null when there is nothing to read. Throws
 * `HcPlacementConfigError` for a path that is named but cannot be one.
 */
export function resolveHcPlacementSocket(
	env: NodeJS.ProcessEnv,
	probe: HcSocketPathProbe = probeHcSocketPath,
): string | null {
	const named = env[HC_PLACEMENT_SOCKET_ENV] ?? "";
	if (named === "") return null;
	if (!path.isAbsolute(named) || named.includes("\0")) {
		throw new HcPlacementConfigError("hc-placement-socket-malformed", "is not an absolute path");
	}
	const kind = probe(named);
	if (kind === "absent") return null;
	if (kind !== "socket") {
		throw new HcPlacementConfigError("hc-placement-socket-not-a-socket", "names something that is not a unix socket");
	}
	return named;
}

export function buildHcTerminalListPacket(id: string): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method: "terminal.list", params: {} })}\n`;
}

/** One live terminal of the core that was read, reduced to what the join reads. */
export interface HcTerminalRow {
	readonly terminal: string;
	readonly pid: number;
}

const HC_LOCAL_TERMINAL = /^t[0-9a-z]+$/;

/**
 * Parse a `terminal.list` result. `null` — nobody looked — for a payload this does not recognise;
 * a row with no address makes the whole payload unreadable rather than partly trusted. Rows that are
 * not live, not local, or carry no usable pid contribute nothing: there is no process to join.
 */
export function parseHcTerminalList(result: Record<string, unknown>): HcTerminalRow[] | null {
	const terminals = result.terminals;
	if (!Array.isArray(terminals)) return null;
	const rows: HcTerminalRow[] = [];
	for (const entry of terminals) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
		const { address, state, pid } = entry as { address?: unknown; state?: unknown; pid?: unknown };
		if (typeof address !== "string" || address === "") return null;
		if (!HC_LOCAL_TERMINAL.test(address) || state !== "live") continue;
		if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) continue;
		rows.push({ terminal: address, pid });
	}
	return rows;
}

/** The join index of ONE read of ONE core. A pid two terminals report is carried as ambiguous. */
export interface HcPlacementIndex {
	readonly coreId: string;
	readonly coreName: string;
	readonly byPid: ReadonlyMap<number, string>;
	readonly ambiguous: ReadonlySet<number>;
}

export function buildHcPlacementIndex(
	core: { readonly id: string; readonly name: string },
	rows: readonly HcTerminalRow[],
): HcPlacementIndex {
	const byPid = new Map<number, string>();
	const ambiguous = new Set<number>();
	for (const row of rows) {
		if (ambiguous.has(row.pid)) continue;
		const seen = byPid.get(row.pid);
		if (seen !== undefined && seen !== row.terminal) {
			byPid.delete(row.pid);
			ambiguous.add(row.pid);
			continue;
		}
		byPid.set(row.pid, row.terminal);
	}
	return { coreId: core.id, coreName: core.name, byPid, ambiguous };
}

export interface HcPlacementReadDeps {
	readonly probe: HcSocketPathProbe;
	readonly connect: (socketPath: string) => HcSocketCall;
}

export const HC_PLACEMENT_PRODUCTION_DEPS: HcPlacementReadDeps = Object.freeze({
	probe: probeHcSocketPath,
	connect: (socketPath: string) => createHcSocketCall(socketPath),
});

/**
 * Read the operator-named core ONCE, or decline to. `null` is "nobody looked". Never retries, never
 * tries another endpoint, never starts a core (the transport is a socket connect, not the hc CLI).
 */
export async function readHcPlacementIndex(
	env: NodeJS.ProcessEnv = process.env,
	deps: HcPlacementReadDeps = HC_PLACEMENT_PRODUCTION_DEPS,
): Promise<HcPlacementIndex | null> {
	const socketPath = resolveHcPlacementSocket(env, deps.probe);
	if (socketPath === null) return null;
	const call = deps.connect(socketPath);
	const helloId = "entwurf-placement-hello";
	const said = await call(buildHcHelloPacket(helloId), HC_PLACEMENT_READ_TIMEOUT_MS);
	if (said.kind !== "reply") return null;
	const hello = readHcEnvelope(said.line, helloId);
	if (hello === null || hello.arm !== "result" || hello.result.generation !== HC_GENERATION) return null;
	const core = hello.result.core;
	if (typeof core !== "object" || core === null) return null;
	const { id, name } = core as { id?: unknown; name?: unknown };
	if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") return null;
	const listId = "entwurf-placement-list";
	const listed = await call(buildHcTerminalListPacket(listId), HC_PLACEMENT_READ_TIMEOUT_MS);
	if (listed.kind !== "reply") return null;
	const list = readHcEnvelope(listed.line, listId);
	if (list === null || list.arm !== "result") return null;
	const rows = parseHcTerminalList(list.result);
	return rows === null ? null : buildHcPlacementIndex({ id, name }, rows);
}

/**
 * The hc decision for one citizen. `null` means this owner makes no claim (it was not read), so
 * whatever the other placement owner said stands. `ownerPid` is the citizen's VALIDATED live owner,
 * supplied by the caller for Claude Code only; null when there is none.
 */
export function resolveHcPlacement(
	index: HcPlacementIndex | null,
	backend: string,
	ownerPid: number | null,
): PlacementObservation | null {
	if (index === null) return null;
	// G-P2: no verified owner-pid source for any other backend. Not looked at, so not `none`.
	if (backend !== "claude-code") return UNOBSERVED_PLACEMENT;
	// No live validated owner: there is no key to look up, so nothing was measured about this citizen.
	if (ownerPid === null) return UNOBSERVED_PLACEMENT;
	if (index.ambiguous.has(ownerPid)) return AMBIGUOUS_PLACEMENT;
	const terminal = index.byPid.get(ownerPid);
	return terminal === undefined
		? NO_PLACEMENT
		: { kind: "hc-terminal", coreId: index.coreId, coreName: index.coreName, terminal };
}

/**
 * Two owners, one column. A sighting wins over a blank; two sightings, or any `ambiguous`, are
 * `ambiguous`; `none` needs one owner that looked and none that saw; otherwise nobody looked.
 */
export function combinePlacement(herdr: PlacementObservation, hc: PlacementObservation | null): PlacementObservation {
	if (hc === null) return herdr;
	const seen = (p: PlacementObservation) => p.kind === "herdr-pane" || p.kind === "hc-terminal";
	if (herdr.kind === "ambiguous" || hc.kind === "ambiguous") return AMBIGUOUS_PLACEMENT;
	if (seen(herdr) && seen(hc)) return AMBIGUOUS_PLACEMENT;
	if (seen(herdr)) return herdr;
	if (seen(hc)) return hc;
	return herdr.kind === "none" || hc.kind === "none" ? NO_PLACEMENT : UNOBSERVED_PLACEMENT;
}
