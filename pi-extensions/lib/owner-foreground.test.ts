/**
 * owner-foreground — the tmux owner's second join, for a citizen started by hand behind a pane's shell (#178 G4),
 * proven beside the module. Deterministic: no tmux, no procfs, no tty is read; every read is a fixture.
 *
 *   TMP-FG-HAND-START               a pid miss consults the foreground join, and the leader of the pane's job is placed
 *   TMP-FG-BACKGROUND               a citizen whose group is not the tty's foreground group is not claimed
 *   TMP-FG-SHARED-GROUP-BACKGROUND  a member of the foreground group that does not lead it is not claimed
 *   TMP-FG-WRONG-SESSION            the tty alone, or the session alone, is incomplete evidence: unobserved, never none
 *   TMP-FG-STOPPED                  foreground is the tty's own answer, never the process's run state
 *   TMP-FG-TWO-ON-ONE-TTY           one pane has one leader; a tty-joined sighting names the pane, so two claims collide
 *   TMP-FG-RACED-START              the process is read twice and must not have changed between
 *   TMP-FG-START-KEY                the process must be the one the receiver marker names
 *   TMP-FG-DEVICE-IDENTITY          a tty is compared as a whole device number
 *   TMP-FG-SIGNED-TTY               a tty number is read as the kernel prints it, signed; one that is no device is no answer
 *   TMP-FG-NO-TTY                   an owner with no controlling tty is on no pane's tty: none, unless its session is a pane's
 *   TMP-FG-NAMESPACE                the lister, the owner and the server must share their mount and pid namespaces
 *   TMP-FG-UNREAD-NOT-NONE          none needs every pane's tty read
 *   TMP-FG-CONFLICT                 a tty in one pane and a session in another is ambiguous, never a pick
 *   TMP-FG-DUPLICATE-TTY            a device two panes name is nobody's
 *   TMP-FG-DIRECT-HIT-KEPT          a listing without the second join's fields still places a pane's own process
 */

import { describe, expect, test } from "vitest";
import type { PlacementObservation } from "./herdr-placement.ts";
import { type OwnerProcReads, parseOwnerStat, resolveTmuxOwnerPlacement } from "./owner-foreground.ts";
import { ambiguateSharedOwnerPlacements } from "./placement-compose.ts";
import {
	buildTmuxPlacementIndex,
	deviceKey,
	readTmuxPlacementIndex,
	type TmuxPaneRow,
	type TmuxPlacementIndex,
} from "./tmux-placement.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

/** A device number as Linux packs it into `tty_nr`. */
const dev = (major: number, minor: number): number => (minor & 0xff) | (major << 8) | ((minor & ~0xff) << 12);
const SERVER = 50;
const pane = (pid: number, paneId: string, minor: number, window = "1"): TmuxPaneRow => ({
	pid,
	paneId,
	window,
	session: "entwurf",
	serverPid: SERVER,
	tty: `/dev/pts/${minor}`,
});
/** Every pane's tty reads as pts major 136 and the minor its path names. */
const ptsDevice = (ttyPath: string): string | null => `136:${ttyPath.slice("/dev/pts/".length)}`;
const indexOf = (rows: TmuxPaneRow[], ttyDevice = ptsDevice): TmuxPlacementIndex =>
	buildTmuxPlacementIndex(rows, ttyDevice);

interface Proc {
	state?: string;
	pgrp: number;
	session: number;
	tty: number;
	tpgid: number;
	start?: number;
}
/** A `/proc/<pid>/stat` text whose command name holds a space and a parenthesis. */
const statText = (pid: number, p: Proc): string =>
	`${pid} (node (x) y) ${p.state ?? "S"} 1 ${p.pgrp} ${p.session} ${p.tty} ${p.tpgid} ${"0 ".repeat(13)}${p.start ?? 5000} 0 0\n`;

/** Fixture reads: each pid's stat (one text, or one per read in turn), and every namespace the same unless named. */
function reads(procs: Record<number, Proc | (Proc | null)[]>, namespaces: Record<string, string | null> = {}) {
	const calls: number[] = [];
	const seen = new Map<number, number>();
	const r: OwnerProcReads = {
		readStat(pid) {
			calls.push(pid);
			const entry = procs[pid];
			if (entry === undefined) return null;
			if (!Array.isArray(entry)) return statText(pid, entry);
			const n = seen.get(pid) ?? 0;
			seen.set(pid, n + 1);
			const at = entry[Math.min(n, entry.length - 1)];
			return at === null || at === undefined ? null : statText(pid, at);
		},
		readNamespace(pid, name) {
			const named = namespaces[`${pid}/${name}`];
			return named === undefined ? `${name}:[4026531832]` : named;
		},
	};
	return { reads: r, calls };
}
const NEVER: OwnerProcReads = {
	readStat() {
		throw new Error("no process read was expected");
	},
	readNamespace() {
		throw new Error("no namespace read was expected");
	},
};

const KEY = "linux:5000";
const answer = (
	index: TmuxPlacementIndex | null,
	pid: number,
	r: OwnerProcReads,
	backend = "pi-durable",
	startKey: string | null = KEY,
): PlacementObservation => resolveTmuxOwnerPlacement(index, backend, { pid, startKey }, r);
const kind = (p: PlacementObservation): string => (p.kind === "tmux-pane" ? `tmux ${p.paneId}` : p.kind);

// One pane: its own process is the shell 100, on pts/9. The citizen 200 was typed at that shell.
const ONE = () => indexOf([pane(100, "%6", 9)]);
const LEADER: Proc = { pgrp: 200, session: 100, tty: dev(136, 9), tpgid: 200 };

describe("the tmux owner: a citizen started by hand behind a pane's shell", () => {
	test("[QK:TMP-FG-HAND-START] a pid miss consults the foreground join, and the leader of the pane's foreground job is placed in that pane", () => {
		for (const backend of ["pi-durable", "claude-code"]) {
			const placed = answer(ONE(), 200, reads({ 200: LEADER }).reads, backend);
			ok(
				`${backend}: placed in the pane, in the pid join's own shape`,
				JSON.stringify(placed) === JSON.stringify({ kind: "tmux-pane", session: "entwurf", window: "1", paneId: "%6" }),
			);
		}
		ok("Pi is never claimed, and nothing is read for it", answer(ONE(), 200, NEVER, "pi").kind === "unobserved");
		ok("an unread server: unobserved, nothing read", answer(null, 200, NEVER).kind === "unobserved");
		ok(
			"no active owner: unobserved",
			resolveTmuxOwnerPlacement(ONE(), "pi-durable", null, NEVER).kind === "unobserved",
		);
		ok(
			"the stat is read past a command name with spaces and parentheses",
			parseOwnerStat(statText(200, LEADER))?.session === 100,
		);
	});

	test("[QK:TMP-FG-BACKGROUND] a citizen in the background behind another foreground program is not claimed, and is not said to be nowhere", () => {
		const r = reads({ 200: { ...LEADER, tpgid: 300 } });
		ok(
			"its own group, another group in the foreground: unobserved",
			kind(answer(ONE(), 200, r.reads)) === "unobserved",
		);
		ok(
			"a tty with no foreground group: unobserved",
			kind(answer(ONE(), 200, reads({ 200: { ...LEADER, tpgid: -1 } }).reads)) === "unobserved",
		);
	});

	test("[QK:TMP-FG-SHARED-GROUP-BACKGROUND] a background child that shares the shell's foreground group, job control off, is not claimed", () => {
		// The shell 100 is its own session, group and the tty's foreground group; the citizen 200 is only a member.
		const r = reads({ 200: { pgrp: 100, session: 100, tty: dev(136, 9), tpgid: 100 } });
		ok(
			"a member of the foreground group that does not lead it: unobserved",
			kind(answer(ONE(), 200, r.reads)) === "unobserved",
		);
	});

	test("[QK:TMP-FG-WRONG-SESSION] the pane's tty without the pane's session, or the session without the tty, is incomplete evidence", () => {
		const ttyOnly = reads({ 200: { ...LEADER, session: 999 } });
		ok("tty matches, session is no pane's: unobserved", kind(answer(ONE(), 200, ttyOnly.reads)) === "unobserved");
		const sessionOnly = reads({ 200: { ...LEADER, tty: dev(136, 77) } });
		ok("session matches, tty is no pane's: unobserved", kind(answer(ONE(), 200, sessionOnly.reads)) === "unobserved");
		const noTty = reads({ 200: { ...LEADER, tty: 0 } });
		ok("session matches, no controlling tty: unobserved", kind(answer(ONE(), 200, noTty.reads)) === "unobserved");
	});

	test("[QK:TMP-FG-STOPPED] foreground is the tty's own answer: a suspended job is not claimed, a stopped leader still in the foreground is", () => {
		const suspended = reads({ 200: { ...LEADER, state: "T", tpgid: 100 } });
		ok(
			"Ctrl-Z, the shell took the foreground back: unobserved",
			kind(answer(ONE(), 200, suspended.reads)) === "unobserved",
		);
		for (const state of ["T", "t", "R", "D"]) {
			const stopped = reads({ 200: { ...LEADER, state } });
			ok(
				`state ${state}, still the foreground leader: placed (a place is not liveness)`,
				kind(answer(ONE(), 200, stopped.reads)) === "tmux %6",
			);
		}
	});

	test("[QK:TMP-FG-TWO-ON-ONE-TTY] one pane has one leader, and a tty-joined sighting names the pane, so it collides with the pane's own process", () => {
		const r = reads({ 200: LEADER, 201: { ...LEADER } });
		ok("the leader is placed", kind(answer(ONE(), 200, r.reads)) === "tmux %6");
		ok("a second citizen in the leader's group is not", kind(answer(ONE(), 201, r.reads)) === "unobserved");
		// The pane's own process is a citizen too (pid join), and another citizen leads its foreground job.
		const rows = ambiguateSharedOwnerPlacements([
			{ id: "direct", placement: answer(ONE(), 100, NEVER) },
			{ id: "hand", placement: answer(ONE(), 200, r.reads) },
			{ id: "elsewhere", placement: answer(indexOf([pane(100, "%6", 9), pane(110, "%7", 10)]), 110, NEVER) },
		]);
		ok(
			"two claims on one pane are both ambiguous; another pane is left alone",
			rows.map((row) => `${row.id}=${kind(row.placement)}`).join() ===
				"direct=ambiguous,hand=ambiguous,elsewhere=tmux %7",
		);
	});

	test("[QK:TMP-FG-RACED-START] the process is read twice, and a change between the reads is no claim", () => {
		const cases: [string, (Proc | null)[]][] = [
			["another start time in the second read", [LEADER, { ...LEADER, start: 5001 }]],
			["the foreground moved between the reads", [LEADER, { ...LEADER, tpgid: 100 }]],
			["the session changed between the reads", [LEADER, { ...LEADER, session: 101 }]],
			["gone at the second read", [LEADER, null]],
		];
		for (const [label, sequence] of cases) {
			const r = reads({ 200: sequence });
			ok(`${label}: unobserved, two reads`, kind(answer(ONE(), 200, r.reads)) === "unobserved" && r.calls.length === 2);
		}
		// A citizen that matches no pane is read twice as well: `none` is never said from one read.
		const elsewhere: Proc = { ...LEADER, session: 999, tty: dev(136, 50) };
		for (const [label, sequence] of [
			["gone at the second read", [elsewhere, null]],
			["on another tty at the second read", [elsewhere, { ...elsewhere, tty: dev(136, 9) }]],
			["in the pane's session at the second read", [elsewhere, { ...elsewhere, session: 100 }]],
		] as [string, (Proc | null)[]][]) {
			const r = reads({ 200: sequence });
			ok(
				`in no pane, ${label}: unobserved, two reads`,
				kind(answer(ONE(), 200, r.reads)) === "unobserved" && r.calls.length === 2,
			);
		}
		const steadyElsewhere = reads({ 200: [elsewhere, { ...elsewhere }] });
		ok(
			"in no pane in two equal reads: none, two reads",
			kind(answer(ONE(), 200, steadyElsewhere.reads)) === "none" && steadyElsewhere.calls.length === 2,
		);
		const steady = reads({ 200: [LEADER, { ...LEADER }] });
		ok("two equal reads: placed", kind(answer(ONE(), 200, steady.reads)) === "tmux %6" && steady.calls.length === 2);
	});

	test("[QK:TMP-FG-START-KEY] the process must be the one the receiver marker names: another start time, or no Linux key, is no claim", () => {
		const r = reads({ 200: LEADER });
		ok(
			"the marker's key is another process's: unobserved",
			kind(answer(ONE(), 200, r.reads, "pi-durable", "linux:4999")) === "unobserved",
		);
		ok("no key: unobserved, nothing read", kind(answer(ONE(), 200, NEVER, "pi-durable", null)) === "unobserved");
		ok(
			"a key of another platform: unobserved, nothing read",
			kind(answer(ONE(), 200, NEVER, "pi-durable", "ps:Sat Nov 28")) === "unobserved",
		);
		ok("an unreadable process: unobserved", kind(answer(ONE(), 200, reads({}).reads)) === "unobserved");
	});

	test("[QK:TMP-FG-DEVICE-IDENTITY] a tty is compared as a whole device: the low byte of a minor is not the pane", () => {
		ok(
			"136:9 and 136:265 are different devices",
			deviceKey(dev(136, 9)) === "136:9" && deviceKey(dev(136, 265)) === "136:265",
		);
		const two = () => indexOf([pane(100, "%6", 9), pane(300, "%8", 265)]);
		// A citizen on pts/265 in no pane's session: with only the low byte it would look like pane %6.
		const elsewhere = reads({ 200: { ...LEADER, session: 999, tty: dev(136, 265) } });
		ok("on a device no pane has: none", kind(answer(ONE(), 200, elsewhere.reads)) === "none");
		const there = reads({ 200: { ...LEADER, session: 300, tty: dev(136, 265) } });
		ok("on pane %8's device, in its session: placed there", kind(answer(two(), 200, there.reads)) === "tmux %8");
		ok("a device number this cannot unpack is no device", deviceKey(0) === null && deviceKey(2 ** 32) === null);
	});

	test("[QK:TMP-FG-SIGNED-TTY] a tty number is read as the kernel prints it, signed; a nonzero one that is no device is unobserved, never none", () => {
		// pts minor 524297 has bit 19 set, so its packed number has bit 31 set and /proc prints it negative.
		const high = dev(136, 524297);
		ok("the fixture's number is negative as printed", high < 0 && deviceKey(high + 2 ** 32) === "136:524297");
		const there = indexOf([pane(100, "%6", 524297)]);
		ok(
			"a negative tty number is the pane's device: placed",
			kind(answer(there, 200, reads({ 200: { ...LEADER, tty: high } }).reads)) === "tmux %6",
		);
		ok(
			"the same device, in no pane's session, every tty read: unobserved (tty alone)",
			kind(answer(there, 200, reads({ 200: { ...LEADER, session: 999, tty: high } }).reads)) === "unobserved",
		);
		for (const tty of [2 ** 33, -(2 ** 33)]) {
			const r = reads({ 200: { ...LEADER, session: 999, tty } });
			ok(
				`${tty} is no device: unobserved, with every pane read and an unrelated session`,
				kind(answer(ONE(), 200, r.reads)) === "unobserved",
			);
		}
	});

	test("[QK:TMP-FG-NO-TTY] an owner with no controlling tty is on no pane's tty: none when its session is no pane's either, unobserved when its session is a pane's", () => {
		const rows = () => indexOf([pane(100, "%6", 9), pane(110, "%7", 10)]);
		const detached = reads({ 200: { ...LEADER, session: 999, tty: 0, tpgid: -1 } });
		ok(
			"no tty, in no pane's session, every tty read: none, two reads",
			kind(answer(rows(), 200, detached.reads)) === "none" && detached.calls.length === 2,
		);
		const inSession = reads({ 200: { ...LEADER, tty: 0, tpgid: -1 } });
		ok("no tty, in a pane's session: unobserved", kind(answer(rows(), 200, inSession.reads)) === "unobserved");
	});

	test("[QK:TMP-FG-NAMESPACE] the lister, the owner and the tmux server must share one mount and one pid namespace", () => {
		for (const [label, namespaces] of [
			["the owner's mount namespace differs", { "200/mnt": "mnt:[7]" }],
			["the owner's pid namespace differs", { "200/pid": "pid:[7]" }],
			["the server's pid namespace differs", { [`${SERVER}/pid`]: "pid:[7]" }],
			["the lister's own namespace cannot be read", { "self/mnt": null }],
			["the server's namespace cannot be read", { [`${SERVER}/mnt`]: null }],
		] as [string, Record<string, string | null>][]) {
			ok(`${label}: unobserved`, kind(answer(ONE(), 200, reads({ 200: LEADER }, namespaces).reads)) === "unobserved");
		}
		const noServer = indexOf([{ ...pane(100, "%6", 9), serverPid: null }]);
		ok(
			"a listing that named no server pid: unobserved",
			kind(answer(noServer, 200, reads({ 200: LEADER }).reads)) === "unobserved",
		);
		const twoServers = indexOf([pane(100, "%6", 9), { ...pane(110, "%7", 10), serverPid: 51 }]);
		ok(
			"lines that disagree on the server pid: unobserved",
			kind(answer(twoServers, 200, reads({ 200: LEADER }).reads)) === "unobserved",
		);
	});

	test("[QK:TMP-FG-UNREAD-NOT-NONE] none needs every pane's tty read: one unread pane leaves a citizen that matched nothing unobserved", () => {
		const elsewhere = { 200: { ...LEADER, session: 999, tty: dev(136, 50) } };
		const rows = [pane(100, "%6", 9), pane(110, "%7", 10)];
		ok("every tty read, in no pane: none", kind(answer(indexOf(rows), 200, reads(elsewhere).reads)) === "none");
		const oneUnread = indexOf(rows, (ttyPath) => (ttyPath === "/dev/pts/10" ? null : ptsDevice(ttyPath)));
		ok(
			"one pane's tty was not read: unobserved",
			kind(answer(oneUnread, 200, reads(elsewhere).reads)) === "unobserved",
		);
		ok(
			"a pane with no tty named: unobserved",
			kind(
				answer(indexOf([pane(100, "%6", 9), { ...pane(110, "%7", 10), tty: null }]), 200, reads(elsewhere).reads),
			) === "unobserved",
		);
		ok("a server with no pane holds nobody: none, nothing read", kind(answer(indexOf([]), 200, NEVER)) === "none");
		// An unread pane forbids none, not a place: the citizen's own pane was read, and its tty and session both name it.
		ok(
			"placed in a read pane while an unrelated pane is unread",
			kind(answer(oneUnread, 200, reads({ 200: LEADER }).reads)) === "tmux %6",
		);
	});

	test("[QK:TMP-FG-CONFLICT] a tty in one pane and a session in another is ambiguous, never a pick", () => {
		const two = indexOf([pane(100, "%6", 9), pane(110, "%7", 10)]);
		const crossed = reads({ 200: { ...LEADER, session: 110 } });
		ok("tty of %6, session of %7: ambiguous", kind(answer(two, 200, crossed.reads)) === "ambiguous");
		const sharedPid = indexOf([pane(100, "%6", 9), pane(100, "%7", 10)]);
		ok(
			"the session is a pid two panes report: ambiguous",
			kind(answer(sharedPid, 200, reads({ 200: LEADER }).reads)) === "ambiguous",
		);
	});

	test("[QK:TMP-FG-DUPLICATE-TTY] a device two panes name belongs to neither: its leader is ambiguous, and a non-leader on it stays unobserved", () => {
		// Both panes stat to one device; the citizen's session is the LAST pane's own process.
		const shared = indexOf([pane(110, "%7", 9), pane(100, "%6", 9)]);
		ok("the device is held back from the index", shared.ttyAmbiguous.has("136:9") && shared.byTtyDev.size === 0);
		ok("the leader on it: ambiguous", kind(answer(shared, 200, reads({ 200: LEADER }).reads)) === "ambiguous");
		ok(
			"not the leader: unobserved",
			kind(answer(shared, 200, reads({ 200: { ...LEADER, tpgid: 300 } }).reads)) === "unobserved",
		);
		const linked = indexOf([pane(100, "%6", 9), { ...pane(100, "%6", 9), session: "other" }]);
		ok(
			"one pane listed under two sessions is one pane",
			linked.byTtyDev.get("136:9")?.paneId === "%6" && linked.ttyAmbiguous.size === 0,
		);
	});

	test("[QK:TMP-FG-DIRECT-HIT-KEPT] a listing without a server pid or a tty, or a tty that cannot be read, still places a pane's own process", () => {
		const env = { TMUX: "/tmp/tmux-1000/default,1,0" };
		const run = (stdout: string) => () => ({ status: 0, stdout });
		// An older tmux prints nothing for a format it does not know: the two fields are empty.
		const bare = readTmuxPlacementIndex(env, run("100\t%6\t1\t\t\tentwurf\n"), () => null);
		ok("the listing is still an index", bare !== null && bare.ttyUnread && bare.serverPid === null);
		ok("the pane's own process is placed, nothing read", kind(answer(bare, 100, NEVER)) === "tmux %6");
		ok(
			"a citizen behind the shell is unobserved there, not none",
			kind(answer(bare, 200, reads({ 200: LEADER }).reads)) === "unobserved",
		);
		// Every field printed, and every tty stat fails (the panes closed after the listing).
		const closed = readTmuxPlacementIndex(env, run(`100\t%6\t1\t${SERVER}\t/dev/pts/9\tentwurf\n`), () => null);
		ok(
			"a failed tty stat keeps the pid join",
			kind(answer(closed, 100, NEVER)) === "tmux %6" && closed?.ttyUnread === true,
		);
		ok("and declines the second join", kind(answer(closed, 200, reads({ 200: LEADER }).reads)) === "unobserved");
		const read = readTmuxPlacementIndex(env, run(`100\t%6\t1\t${SERVER}\t/dev/pts/9\tentwurf\n`), ptsDevice);
		ok(
			"with the tty read, the same citizen is placed",
			kind(answer(read, 200, reads({ 200: LEADER }).reads)) === "tmux %6",
		);
	});
});
