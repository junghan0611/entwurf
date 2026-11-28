/**
 * tmux-placement — where the lister's OWN tmux server shows a citizen, as one read (#178).
 *
 * A PLACEMENT VIEW ONLY: never an address, a liveness answer or an authority, and imported by the
 * peers observation and by nothing on a send or launch path.
 *
 * ONE SERVER, THE ONE `TMUX` NAMES. The pane listing runs with the lister's environment inherited —
 * no `-S`, no `-L`, no socket guess, no other server. With `TMUX` absent or empty nothing is run and
 * every citizen stays `unobserved` for this owner; so does a tmux that did not answer, exited
 * non-zero, or printed a line this cannot read. One listing, one read, no retry, nothing stored.
 *
 * THE JOIN IS A PROCESS ID, FOR CLAUDE CODE AND PI-DURABLE ONLY (decision G-P2, widened to
 * pi-durable after measurement): `pane_pid`, the process tmux
 * started in the pane — the same pid the tmux Claude Code resume already joins on — against the
 * citizen's ACTIVE receiver owner. Pi is never claimed.
 *
 * A CITIZEN STARTED BY HAND BEHIND A SHELL misses that join: the pane's process is the shell. The
 * listing therefore also carries what `owner-foreground.ts` needs to find such a citizen as the
 * pane's foreground job: the server's own pid and each pane's tty, read here as a DEVICE (one
 * `stat` per pane, in this one read) — never a `/dev/pts/<n>` path built from a number. Those two
 * fields serve that second join only: a server that does not print them, or a tty that cannot be
 * read, costs the second join and never a pane's own pid.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

/** One listing may wait this long for tmux; the column is a convenience. */
export const TMUX_PLACEMENT_READ_TIMEOUT_MS = 2000;

/** Tab-separated; the session name is LAST and takes the rest of the line, whatever it contains. */
export const TMUX_PLACEMENT_FORMAT = "#{pane_pid}\t#{pane_id}\t#{window_index}\t#{pid}\t#{pane_tty}\t#{session_name}";

export function buildTmuxPaneListArgs(): string[] {
	return ["list-panes", "-a", "-F", TMUX_PLACEMENT_FORMAT];
}

export interface TmuxPaneRow {
	readonly pid: number;
	readonly paneId: string;
	readonly window: string;
	readonly session: string;
	/** The tmux server's own pid (`#{pid}`), or null when the line did not carry one. */
	readonly serverPid: number | null;
	/** The pane's tty path as tmux names it (`#{pane_tty}`), or null when the line did not carry one. */
	readonly tty: string | null;
}

/**
 * Parse the listing. `null` — nobody looked — if ANY non-empty line is not the six fields this
 * asked for, or its pane pid, pane id, window or session cannot be read: a tmux that answered in
 * another shape has told us nothing, and a partial index would let `none` be said over panes that
 * were not read. The server pid and the tty are read where they are there and left null where not.
 */
export function parseTmuxPaneList(stdout: string): TmuxPaneRow[] | null {
	const rows: TmuxPaneRow[] = [];
	for (const line of stdout.split("\n")) {
		if (line === "") continue;
		const a = line.indexOf("\t");
		const b = a < 0 ? -1 : line.indexOf("\t", a + 1);
		const c = b < 0 ? -1 : line.indexOf("\t", b + 1);
		const d = c < 0 ? -1 : line.indexOf("\t", c + 1);
		const e = d < 0 ? -1 : line.indexOf("\t", d + 1);
		if (e < 0) return null;
		const pidText = line.slice(0, a);
		const paneId = line.slice(a + 1, b);
		const window = line.slice(b + 1, c);
		const serverText = line.slice(c + 1, d);
		const ttyText = line.slice(d + 1, e);
		const session = line.slice(e + 1);
		if (!/^[1-9][0-9]*$/.test(pidText) || !/^%[0-9]+$/.test(paneId) || !/^[0-9]+$/.test(window) || session === "") {
			return null;
		}
		const pid = Number(pidText);
		if (!Number.isSafeInteger(pid) || pid <= 1) return null;
		const serverPid =
			/^[1-9][0-9]*$/.test(serverText) && Number.isSafeInteger(Number(serverText)) ? Number(serverText) : null;
		const tty = ttyText.startsWith("/") ? ttyText : null;
		rows.push({ pid, paneId, window, session, serverPid, tty });
	}
	return rows;
}

export interface TmuxPlacementIndex {
	readonly byPid: ReadonlyMap<number, TmuxPaneRow>;
	readonly ambiguous: ReadonlySet<number>;
	/** How many panes the listing held. */
	readonly panes: number;
	/** The server's pid when every line carried the same one, else null. */
	readonly serverPid: number | null;
	/** Each pane by its tty's device, `<major>:<minor>`. */
	readonly byTtyDev: ReadonlyMap<string, TmuxPaneRow>;
	/** A device two different panes named: neither is indexed. */
	readonly ttyAmbiguous: ReadonlySet<string>;
	/** Some pane's tty was not read as a device: this index cannot say a tty is in no pane. */
	readonly ttyUnread: boolean;
}

/** `<major>:<minor>` of a device number as Linux packs it (`tty_nr` in `/proc/<pid>/stat`, and `st_rdev` below 2^32). */
export function deviceKey(dev: number): string | null {
	if (!Number.isSafeInteger(dev) || dev <= 0 || dev >= 2 ** 32) return null;
	const major = Math.floor(dev / 256) % 4096;
	const minor = (dev % 256) + Math.floor(dev / 1048576) * 256;
	return `${major}:${minor}`;
}

/** The device behind a tty path, or null when it is not a character device this could read. */
export type TmuxTtyDevice = (ttyPath: string) => string | null;

export const statTtyDevice: TmuxTtyDevice = (ttyPath) => {
	try {
		const stat = fs.statSync(ttyPath);
		return stat.isCharacterDevice() ? deviceKey(stat.rdev) : null;
	} catch {
		// Bounded environment probe: a pane that closed between the listing and this stat has an unread tty.
		return null;
	}
};

/** Build the index. With no tty reader every pane's tty is unread: the pid join is whole and the tty join declines. */
export function buildTmuxPlacementIndex(
	rows: readonly TmuxPaneRow[],
	ttyDevice: TmuxTtyDevice = () => null,
): TmuxPlacementIndex {
	const byPid = new Map<number, TmuxPaneRow>();
	const ambiguous = new Set<number>();
	for (const row of rows) {
		if (ambiguous.has(row.pid)) continue;
		const seen = byPid.get(row.pid);
		if (seen !== undefined && seen.paneId !== row.paneId) {
			byPid.delete(row.pid);
			ambiguous.add(row.pid);
			continue;
		}
		byPid.set(row.pid, row);
	}
	const byTtyDev = new Map<string, TmuxPaneRow>();
	const ttyAmbiguous = new Set<string>();
	let ttyUnread = false;
	for (const row of rows) {
		const dev = row.tty === null ? null : ttyDevice(row.tty);
		if (dev === null) {
			ttyUnread = true;
			continue;
		}
		if (ttyAmbiguous.has(dev)) continue;
		const held = byTtyDev.get(dev);
		if (held !== undefined && held.paneId !== row.paneId) {
			byTtyDev.delete(dev);
			ttyAmbiguous.add(dev);
			continue;
		}
		byTtyDev.set(dev, row);
	}
	const servers = new Set(rows.map((row) => row.serverPid));
	const serverPid = servers.size === 1 ? (rows[0]?.serverPid ?? null) : null;
	return { byPid, ambiguous, panes: rows.length, serverPid, byTtyDev, ttyAmbiguous, ttyUnread };
}

/** What one tmux run came back as; `null` status is a signal or a timeout. */
export type TmuxPlacementRun = (
	args: readonly string[],
	env: NodeJS.ProcessEnv,
) => { readonly status: number | null; readonly stdout: string };

export const runTmuxForPlacement: TmuxPlacementRun = (args, env) => {
	const res = spawnSync("tmux", args as string[], {
		env,
		encoding: "utf8",
		timeout: TMUX_PLACEMENT_READ_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "ignore"],
	});
	// Bounded environment probe: a tmux that could not be started is a placement owner nobody read.
	return res.error ? { status: null, stdout: "" } : { status: res.status, stdout: res.stdout ?? "" };
};

/** Read the lister's own tmux server ONCE, or decline to. `null` is "nobody looked". */
export function readTmuxPlacementIndex(
	env: NodeJS.ProcessEnv = process.env,
	run: TmuxPlacementRun = runTmuxForPlacement,
	ttyDevice: TmuxTtyDevice = statTtyDevice,
): TmuxPlacementIndex | null {
	if ((env.TMUX ?? "") === "") return null;
	const ran = run(buildTmuxPaneListArgs(), env);
	if (ran.status !== 0) return null;
	const rows = parseTmuxPaneList(ran.stdout);
	return rows === null ? null : buildTmuxPlacementIndex(rows, ttyDevice);
}
