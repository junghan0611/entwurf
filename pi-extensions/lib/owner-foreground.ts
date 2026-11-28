/**
 * owner-foreground — a citizen started by hand behind a pane's shell, found as that pane's foreground job (#178 G4).
 *
 * A PLACEMENT VIEW ONLY, like the module it serves: never an address, a liveness answer or an authority, and
 * imported by the peers observation and by nothing on a send or launch path.
 *
 * tmux reports the process it started in a pane. A citizen typed at that pane's shell is another process, so the
 * owner-pid join misses it. This looks once more, in the lister's own tmux server only, and claims a pane for a
 * citizen when ALL of these hold for its ACTIVE receiver owner:
 *
 *   K  the process is still the one the receiver marker names: its start time equals the marker's key, in two reads
 *      of `/proc/<pid>/stat` that agree with each other
 *   N  this process, the owner and the tmux server share one mount and one pid namespace, so pids and device
 *      numbers mean the same thing to all three
 *   T  the owner's controlling tty is the pane's tty, compared as a device
 *   S  the owner's session is the pane's own process (tmux makes it the session leader of the pane's tty)
 *   F  the owner is the LEADER of the tty's foreground job: its pid is its process group, and that group is the
 *      tty's foreground group
 *
 * WHAT F SAYS, AND WHAT IT DOES NOT. It says this pane's foreground job is this citizen's process. It does not say
 * whose bytes are on the screen: a leader can hand the terminal to a child. A citizen that is a member of the
 * foreground group without leading it (a shell with job control off starts a background child that way) is not
 * claimed, and neither is one in the background or suspended behind the shell.
 *
 * THE ANSWER IS TOTAL, AND `none` IS EARNED.
 *   that pane     K, N, T, S and F all hold, and T and S name the same pane
 *   ambiguous     the owner leads the foreground job, and T and S name different panes, or two panes share the device
 *   none          both reads succeeded and agree, and neither the owner's tty nor its session is any pane's — and
 *                 every pane's tty was read
 *   unobserved    anything else: a read failed, the key or a namespace differs, the process changed between the two
 *                 reads, its tty number cannot be read as a device, only one of T and S names a pane, or the owner
 *                 does not lead the foreground job of a pane it is on
 * A server with no pane at all holds nobody, and that is `none` with nothing read. An owner with NO controlling tty
 * (`tty_nr` 0) is on no pane's tty: it is `none` when its session is no pane's either, and `unobserved` when its
 * session is a pane's own process, since the session alone is incomplete evidence.
 *
 * AN UNREAD PANE FORBIDS `none`, NOT A PLACE. A pane whose tty could not be read may be the one the owner is on, so
 * a citizen that matched nothing is `unobserved` there. A citizen whose tty and session both name one pane that WAS
 * read is placed in it whatever else went unread: a tty is one pane's, and the session names that pane by its pid.
 */

import * as fs from "node:fs";
import {
	AMBIGUOUS_PLACEMENT,
	NO_PLACEMENT,
	type PlacementObservation,
	UNOBSERVED_PLACEMENT,
} from "./herdr-placement.ts";
import { resolveOwnerPidPlacement } from "./placement-compose.ts";
import { deviceKey, type TmuxPaneRow, type TmuxPlacementIndex } from "./tmux-placement.ts";

/** The reads of the owner's process this join needs; each is null when it could not be made. */
export interface OwnerProcReads {
	/** The whole text of `/proc/<pid>/stat`. */
	readStat(pid: number): string | null;
	/** What `/proc/<pid>/ns/<name>` links to. */
	readNamespace(pid: number | "self", name: "mnt" | "pid"): string | null;
}

export const procOwnerReads: OwnerProcReads = {
	readStat(pid) {
		try {
			return fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		} catch {
			// Bounded environment probe: no procfs, or a process that is gone, is an owner nobody could look at.
			return null;
		}
	},
	readNamespace(pid, name) {
		try {
			return fs.readlinkSync(`/proc/${pid}/ns/${name}`);
		} catch {
			// Bounded environment probe: an unreadable namespace link is a comparison that was not made.
			return null;
		}
	},
};

/** The fields of `/proc/<pid>/stat` this join compares. */
export interface OwnerStat {
	readonly pgrp: number;
	readonly session: number;
	readonly ttyNr: number;
	readonly tpgid: number;
	readonly starttime: string;
}

/** Parse a `/proc/<pid>/stat` text; null when any field this needs is not there. */
export function parseOwnerStat(text: string | null): OwnerStat | null {
	if (text === null) return null;
	// comm (field 2) is parenthesized and may hold spaces and parentheses: split after the LAST ')'.
	const fields = text
		.slice(text.lastIndexOf(")") + 1)
		.trim()
		.split(/\s+/);
	// after comm: 0 = state (f3), 2 = pgrp (f5), 3 = session (f6), 4 = tty_nr (f7), 5 = tpgid (f8), 19 = starttime (f22).
	const [state, , pgrp, session, ttyNr, tpgid] = fields;
	const starttime = fields[19];
	if (state === undefined || !/^[A-Za-z]$/.test(state)) return null;
	if (starttime === undefined || !/^\d+$/.test(starttime)) return null;
	const numbers = [pgrp, session, ttyNr, tpgid].map((field) =>
		field !== undefined && /^-?\d+$/.test(field) ? Number(field) : Number.NaN,
	);
	if (numbers.some((value) => !Number.isSafeInteger(value))) return null;
	return {
		pgrp: numbers[0] as number,
		session: numbers[1] as number,
		ttyNr: numbers[2] as number,
		tpgid: numbers[3] as number,
		starttime,
	};
}

/** The owner a pid-joined placement owner looks for: the receiver marker's pid and its start key. */
export interface ActiveOwner {
	readonly pid: number;
	readonly startKey: string | null;
}

function sameNamespaces(reads: OwnerProcReads, ownerPid: number, serverPid: number): boolean {
	for (const name of ["mnt", "pid"] as const) {
		const mine = reads.readNamespace("self", name);
		if (mine === null) return false;
		if (reads.readNamespace(ownerPid, name) !== mine || reads.readNamespace(serverPid, name) !== mine) return false;
	}
	return true;
}

/** The pane whose foreground job the owner leads, or the blank word that says why there is none. */
export function foregroundPane(
	index: TmuxPlacementIndex,
	owner: ActiveOwner,
	reads: OwnerProcReads,
): TmuxPaneRow | PlacementObservation {
	if (index.panes === 0) return NO_PLACEMENT;
	const key = owner.startKey?.startsWith("linux:") ? owner.startKey.slice("linux:".length) : null;
	if (key === null) return UNOBSERVED_PLACEMENT;
	const read1 = parseOwnerStat(reads.readStat(owner.pid));
	if (read1 === null) return UNOBSERVED_PLACEMENT;
	if (read1.starttime !== key) return UNOBSERVED_PLACEMENT;
	if (index.serverPid === null) return UNOBSERVED_PLACEMENT;
	if (!sameNamespaces(reads, owner.pid, index.serverPid)) return UNOBSERVED_PLACEMENT;
	// Nothing below is said, a place or `none`, about a process that changed while it was being read.
	const read2 = parseOwnerStat(reads.readStat(owner.pid));
	if (read2 === null || JSON.stringify(read2) !== JSON.stringify(read1)) return UNOBSERVED_PLACEMENT;

	// `tty_nr` is printed as a signed 32-bit number: a device whose packed number has its top bit set reads negative.
	const ttyNr = read1.ttyNr < 0 ? read1.ttyNr + 2 ** 32 : read1.ttyNr;
	const device = ttyNr === 0 ? null : deviceKey(ttyNr);
	if (ttyNr !== 0 && device === null) return UNOBSERVED_PLACEMENT;
	const ttyShared = device !== null && index.ttyAmbiguous.has(device);
	const ttyPane = device === null ? undefined : index.byTtyDev.get(device);
	const sessionShared = index.ambiguous.has(read1.session);
	const sessionPane = index.byPid.get(read1.session);
	if (!ttyShared && ttyPane === undefined && !sessionShared && sessionPane === undefined) {
		return index.ttyUnread ? UNOBSERVED_PLACEMENT : NO_PLACEMENT;
	}

	// The owner is on a pane's tty or in a pane's session. Only the leader of the foreground job is claimed.
	if (read1.tpgid <= 0) return UNOBSERVED_PLACEMENT;
	if (read1.pgrp !== read1.tpgid) return UNOBSERVED_PLACEMENT;
	if (read1.pgrp !== owner.pid) return UNOBSERVED_PLACEMENT;

	if (ttyShared || sessionShared) return AMBIGUOUS_PLACEMENT;
	if (ttyPane === undefined) return UNOBSERVED_PLACEMENT;
	const session = sessionPane === undefined ? "missing" : sessionPane.paneId === ttyPane.paneId ? "same" : "other";
	if (session === "other") return AMBIGUOUS_PLACEMENT;
	if (session === "missing") return UNOBSERVED_PLACEMENT;
	return ttyPane;
}

const isPane = (answer: TmuxPaneRow | PlacementObservation): answer is TmuxPaneRow => !("kind" in answer);

/** The tmux owner's answer for one citizen: the pane whose own process is its owner, else the foreground join. */
export function resolveTmuxOwnerPlacement(
	index: TmuxPlacementIndex | null,
	backend: string,
	owner: ActiveOwner | null,
	reads: OwnerProcReads = procOwnerReads,
): PlacementObservation {
	const place = (pane: TmuxPaneRow): PlacementObservation => ({
		kind: "tmux-pane",
		session: pane.session,
		window: pane.window,
		paneId: pane.paneId,
	});
	return resolveOwnerPidPlacement(index, backend, owner === null ? null : owner.pid, place, () => {
		// Reached only with an index, a claimed backend and an owner: the three guards above this callback.
		const answer = foregroundPane(index as TmuxPlacementIndex, owner as ActiveOwner, reads);
		return isPane(answer) ? place(answer) : answer;
	});
}
