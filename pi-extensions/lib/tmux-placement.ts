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
 * citizen's ACTIVE receiver owner. A citizen started by hand from a shell in a pane does not join
 * (the pane's process is the shell) and this owner answers `none` for it. Pi is never claimed.
 */

import { spawnSync } from "node:child_process";

/** One listing may wait this long for tmux; the column is a convenience. */
export const TMUX_PLACEMENT_READ_TIMEOUT_MS = 2000;

/** Tab-separated; the session name is LAST and takes the rest of the line, whatever it contains. */
export const TMUX_PLACEMENT_FORMAT = "#{pane_pid}\t#{pane_id}\t#{window_index}\t#{session_name}";

export function buildTmuxPaneListArgs(): string[] {
	return ["list-panes", "-a", "-F", TMUX_PLACEMENT_FORMAT];
}

export interface TmuxPaneRow {
	readonly pid: number;
	readonly paneId: string;
	readonly window: string;
	readonly session: string;
}

/**
 * Parse the listing. `null` — nobody looked — if ANY non-empty line is not the four fields this
 * asked for: a tmux that answered in another shape has told us nothing, and a partial index would
 * let `none` be said over panes that were not read.
 */
export function parseTmuxPaneList(stdout: string): TmuxPaneRow[] | null {
	const rows: TmuxPaneRow[] = [];
	for (const line of stdout.split("\n")) {
		if (line === "") continue;
		const a = line.indexOf("\t");
		const b = a < 0 ? -1 : line.indexOf("\t", a + 1);
		const c = b < 0 ? -1 : line.indexOf("\t", b + 1);
		if (c < 0) return null;
		const pidText = line.slice(0, a);
		const paneId = line.slice(a + 1, b);
		const window = line.slice(b + 1, c);
		const session = line.slice(c + 1);
		if (!/^[1-9][0-9]*$/.test(pidText) || !/^%[0-9]+$/.test(paneId) || !/^[0-9]+$/.test(window) || session === "") {
			return null;
		}
		const pid = Number(pidText);
		if (!Number.isSafeInteger(pid) || pid <= 1) return null;
		rows.push({ pid, paneId, window, session });
	}
	return rows;
}

export interface TmuxPlacementIndex {
	readonly byPid: ReadonlyMap<number, TmuxPaneRow>;
	readonly ambiguous: ReadonlySet<number>;
}

export function buildTmuxPlacementIndex(rows: readonly TmuxPaneRow[]): TmuxPlacementIndex {
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
	return { byPid, ambiguous };
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
): TmuxPlacementIndex | null {
	if ((env.TMUX ?? "") === "") return null;
	const ran = run(buildTmuxPaneListArgs(), env);
	if (ran.status !== 0) return null;
	const rows = parseTmuxPaneList(ran.stdout);
	return rows === null ? null : buildTmuxPlacementIndex(rows);
}
