/**
 * codex-socket-listener — does the operator-named Codex app-server's OWN process subtree hold the
 * LISTEN socket at the control endpoint Entwurf actually connects to? (#128 CP-A1)
 *
 * WHY THIS EXISTS, measured. `smoke-codex-fresh-live` asserted "the explicit app-server PID owns
 * the same default UDS" by comparing argv against `--listen unix://<resolved default path>`. That
 * is a statement of intent, and the two hosts that ran it measured the difference:
 *
 *   - oracle, the 0.36.0 cut (`[측정 2026-10-14]`, cleanup receipts codex-procs-before.txt and
 *     codex-socket-before.txt): the named pid 851181 was the pnpm node WRAPPER, and its argv
 *     matched. The LISTEN socket was held by its child 851228, the native binary, at the 0.162.1
 *     physical path under `/tmp/codex-daemon-<euid>/`. The check passed on a process that held
 *     no socket.
 *   - thinkpad (#128 comment 6157960561): the named pid WAS the listener, but it was started with
 *     `--listen unix://` (the vendor default, no path), so the check refused it.
 *
 * So ownership is read from the kernel, never from argv. The endpoint is not resolved here: the
 * caller passes the `connectPath` of the production classifier `checkCodexSocketFile`, the same
 * socket delivery connects to. This leaf adds no alias rule and has no path seam that could stand
 * in for that check.
 *
 * Two halves, kept apart on purpose:
 *
 *   OBSERVE (read-only IO, real `/proc` only). It reads the named process's own network
 *   namespace table (`/proc/<pid>/net/unix`) and keeps only the LISTEN stream rows bound at
 *   exactly the endpoint. With exactly one such row, it walks DOWN from the named pid alone: the
 *   kernel's children lists, each child's parent re-read from its own `stat`, and `fd` links
 *   compared against that one inode. Then a bounded SECOND read: every walked node's `stat`
 *   again (parent and start time), and the `fd` links again of each node that held the inode.
 *   The table is read last. There is no host-wide pid search, no environment read and no reach
 *   above or beside the named pid.
 *
 *   JUDGE (pure). Positive ONLY when exactly one process inside that subtree held exactly that
 *   inode, still holds it on the second read, its parent chain reaches the named pid through
 *   observed nodes, and the named pid is still the process whose identity the caller checked
 *   (its start time, captured by the caller BEFORE those checks). Descent alone is not
 *   evidence — the held inode is. Everything else fails closed, and the reason says which kind
 *   of failure it is:
 *     not-owned      a LISTEN row exists and NO process in the named subtree holds it. This does
 *                    not name a foreign owner; nothing outside the subtree was read.
 *     indeterminate  zero or several rows, several holders, an unreadable or unrecognised entry,
 *                    or a pid, parent, fd or row that moved between the reads. None of these say
 *                    who owns the socket, so none of them may read as an answer either way.
 *
 * What a positive does NOT mean: a self-listener (thinkpad shape) being owned says nothing
 * about whether a vendor-managed daemon is an admitted operator shape, nor about the tmux seat
 * the same smoke checks separately. Those stay their own contracts.
 */
import * as fs from "node:fs";

/** One LISTEN-state stream socket bound at exactly the endpoint, as a kernel table row. */
export interface UnixListenRow {
	readonly inode: string;
}

export class UnixTableError extends Error {}

const TABLE_HEADER = /^Num\s+RefCount\s+Protocol\s+Flags\s+Type\s+St\s+Inode(?:\s+Path)?\s*$/;
// `%pK: %08X %08X %08X %04X %02X %5lu` and then ` <path>` when the socket is bound.
const TABLE_ROW =
	/^[0-9A-Fa-f]+:\s+[0-9A-Fa-f]{8}\s+[0-9A-Fa-f]{8}\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{2}\s+(\d+)(?: (.*))?$/;
const SO_ACCEPTCON = 0x10000;
const SOCK_STREAM = 0x0001;

/**
 * The LISTEN stream rows of a `/proc/<pid>/net/unix` table whose path is byte-equal to
 * `endpoint`. A connected row at the same path, a datagram socket, a path that only shares a
 * prefix and an abstract socket are not rows of this endpoint. A table this parser does not
 * recognise throws rather than being read around.
 */
export function listenRowsAt(table: string, endpoint: string): UnixListenRow[] {
	const lines = table.split("\n");
	if (!TABLE_HEADER.test(lines[0] ?? "")) {
		throw new UnixTableError(`unrecognised unix socket table header: ${JSON.stringify(lines[0] ?? "")}`);
	}
	const rows: UnixListenRow[] = [];
	for (const line of lines.slice(1)) {
		if (line === "") continue;
		const match = TABLE_ROW.exec(line.trimStart());
		if (match === null) throw new UnixTableError(`unrecognised unix socket table row: ${JSON.stringify(line)}`);
		const [, flags, type, inode, boundPath] = match;
		if (boundPath !== endpoint) continue;
		if ((Number.parseInt(flags ?? "", 16) & SO_ACCEPTCON) === 0) continue;
		if (Number.parseInt(type ?? "", 16) !== SOCK_STREAM) continue;
		rows.push({ inode: inode as string });
	}
	return rows;
}

export interface ProcStat {
	readonly comm: string;
	readonly ppid: number;
	readonly startTime: string;
}

/**
 * `/proc/<pid>/stat`. `comm` may itself contain spaces and parentheses, so the fixed fields are
 * counted from the LAST `)`: field 4 is the parent pid and field 22 the start time in clock
 * ticks since boot — the pair that tells a pid apart from a later process that reused it.
 */
export function parseProcStat(text: string): ProcStat {
	const open = text.indexOf("(");
	const close = text.lastIndexOf(")");
	if (open < 0 || close < open) throw new Error(`unrecognised stat line: ${JSON.stringify(text)}`);
	const fields = text
		.slice(close + 1)
		.trim()
		.split(/\s+/);
	const ppid = Number(fields[1]);
	const startTime = fields[19] ?? "";
	if (!Number.isInteger(ppid) || ppid < 0 || !/^\d+$/.test(startTime)) {
		throw new Error(`unrecognised stat fields: ${JSON.stringify(text)}`);
	}
	return { comm: text.slice(open + 1, close), ppid, startTime };
}

export interface SubtreeNode {
	readonly pid: number;
	readonly ppid: number;
	readonly comm: string;
	readonly startTime: string;
	/** fd numbers whose link is exactly `socket:[<the endpoint's LISTEN inode>]`. */
	readonly holdingFds: readonly number[];
	/**
	 * The second read, after the whole walk. `null` = the pid could not be read again. `holdingFds`
	 * is re-read only for a node that held the inode on the first read, and is `null` otherwise.
	 */
	readonly after: {
		readonly ppid: number;
		readonly startTime: string;
		readonly holdingFds: readonly number[] | null;
	} | null;
}

export type ObservationFailureReason =
	| "subtree-unreadable"
	| "subtree-changed"
	| "subtree-too-large"
	| "table-malformed";

export interface CodexSocketObservation {
	readonly namedPid: number;
	/** The named pid's start time as the CALLER read it before its own identity checks. */
	readonly namedStartTime: string;
	readonly endpoint: string;
	readonly rows: readonly UnixListenRow[];
	readonly rowsAfter: readonly UnixListenRow[];
	/** Breadth-first from the named pid; empty unless exactly one row was found. */
	readonly nodes: readonly SubtreeNode[];
	readonly failure: { readonly reason: ObservationFailureReason; readonly detail: string } | null;
}

export type CodexSocketOwnership =
	| {
			readonly verdict: "owned";
			readonly inode: string;
			/** Named pid first, the listener last. */
			readonly chain: readonly SubtreeNode[];
			readonly fds: readonly number[];
	  }
	| { readonly verdict: "not-owned"; readonly reason: "not-held-in-named-subtree"; readonly detail: string }
	| {
			readonly verdict: "indeterminate";
			readonly reason:
				| ObservationFailureReason
				| "no-listen-row"
				| "several-listen-rows"
				| "listen-row-changed"
				| "named-identity-moved"
				| "several-holders"
				| "listener-fd-released"
				| "chain-broken";
			readonly detail: string;
	  };

export function judgeCodexSocketOwnership(o: CodexSocketObservation): CodexSocketOwnership {
	if (o.failure !== null) return { verdict: "indeterminate", reason: o.failure.reason, detail: o.failure.detail };
	if (o.rows.length === 0) {
		return {
			verdict: "indeterminate",
			reason: "no-listen-row",
			detail:
				`no LISTEN stream socket in pid ${o.namedPid}'s network namespace is bound at exactly ${o.endpoint}; ` +
				"ownership cannot be read, and the absence does not name another owner",
		};
	}
	if (o.rows.length > 1) {
		return {
			verdict: "indeterminate",
			reason: "several-listen-rows",
			detail: `${o.rows.length} LISTEN rows are bound at ${o.endpoint} (inodes ${o.rows.map((r) => r.inode).join(", ")})`,
		};
	}
	const inode = (o.rows[0] as UnixListenRow).inode;
	if (o.rowsAfter.length !== 1 || o.rowsAfter[0]?.inode !== inode) {
		return {
			verdict: "indeterminate",
			reason: "listen-row-changed",
			detail: `the LISTEN row at ${o.endpoint} was inode ${inode} before the fd join and ${JSON.stringify(o.rowsAfter.map((r) => r.inode))} after`,
		};
	}
	const named = o.nodes[0];
	if (named?.pid !== o.namedPid || named.startTime !== o.namedStartTime) {
		return {
			verdict: "indeterminate",
			reason: "named-identity-moved",
			detail:
				`pid ${o.namedPid} started at ${o.namedStartTime} when its identity was checked, but the walk began at ` +
				`${named === undefined ? "no node" : `pid ${named.pid} started at ${named.startTime}`}`,
		};
	}
	const moved = o.nodes.filter((node) => node.after?.startTime !== node.startTime || node.after?.ppid !== node.ppid);
	if (moved.length > 0) {
		return {
			verdict: "indeterminate",
			reason: "subtree-changed",
			detail: `pid(s) ${moved.map((node) => node.pid).join(", ")} exited, were reused or changed parent while the subtree was read`,
		};
	}
	const holders = o.nodes.filter((node) => node.holdingFds.length > 0);
	if (holders.length === 0) {
		return {
			verdict: "not-owned",
			reason: "not-held-in-named-subtree",
			detail:
				`no process in pid ${o.namedPid}'s subtree (${o.nodes.map((node) => node.pid).join(", ")}) holds the LISTEN socket ` +
				`inode ${inode} at ${o.endpoint}; nothing outside that subtree was read, so no owner is named`,
		};
	}
	if (holders.length > 1) {
		return {
			verdict: "indeterminate",
			reason: "several-holders",
			detail: `pids ${holders.map((node) => node.pid).join(", ")} all hold LISTEN inode ${inode}`,
		};
	}
	const listener = holders[0] as SubtreeNode;
	// Same pid, same start time and a stable row are not enough: the holder may have closed or
	// handed off its fd while a process this walk never re-read kept the inode open.
	const heldAfter = listener.after?.holdingFds ?? [];
	if (heldAfter.length === 0) {
		return {
			verdict: "indeterminate",
			reason: "listener-fd-released",
			detail: `pid ${listener.pid} held LISTEN inode ${inode} on fd ${listener.holdingFds.join(",")} but no longer did on the second read`,
		};
	}
	const byPid = new Map(o.nodes.map((node) => [node.pid, node] as const));
	const chain: SubtreeNode[] = [listener];
	for (let node = listener; node.pid !== o.namedPid; ) {
		const parent = byPid.get(node.ppid);
		if (parent === undefined || chain.includes(parent)) {
			return {
				verdict: "indeterminate",
				reason: "chain-broken",
				detail: `listener ${listener.pid}'s parent chain does not reach the named pid ${o.namedPid} through observed nodes`,
			};
		}
		chain.unshift(parent);
		node = parent;
	}
	return { verdict: "owned", inode, chain, fds: heldAfter };
}

/** One line for an assertion detail or a receipt. */
export function describeCodexSocketOwnership(ownership: CodexSocketOwnership): string {
	if (ownership.verdict !== "owned") return `${ownership.verdict} (${ownership.reason}): ${ownership.detail}`;
	const listener = ownership.chain[ownership.chain.length - 1] as SubtreeNode;
	return (
		`owned: LISTEN inode ${ownership.inode} held by pid ${listener.pid} (${listener.comm}) fd ${ownership.fds.join(",")}; ` +
		`chain ${ownership.chain.map((node) => `${node.pid}(${node.comm})`).join(" -> ")}`
	);
}

// ---------------------------------------------------------------------------
// OBSERVE — real /proc only
// ---------------------------------------------------------------------------

/** Bound on the walk. The Codex trees measured so far have one to three processes. */
const SUBTREE_LIMIT = 64;

class ObservationFailure extends Error {
	readonly reason: ObservationFailureReason;
	constructor(reason: ObservationFailureReason, detail: string) {
		super(detail);
		this.reason = reason;
	}
}

function failureFrom(error: unknown, what: string): ObservationFailure {
	const code = (error as NodeJS.ErrnoException).code;
	const message = error instanceof Error ? error.message : String(error);
	// A pid, task or fd that disappeared between two reads moved under us. A permission refusal
	// or anything else means the entry could not be read, which is not the same statement.
	if (code === "ENOENT" || code === "ESRCH") return new ObservationFailure("subtree-changed", `${what}: ${message}`);
	return new ObservationFailure("subtree-unreadable", `${what}: ${message}`);
}

function readStat(pid: number): ProcStat {
	try {
		return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch (error) {
		throw failureFrom(error, `stat of pid ${pid}`);
	}
}

function readListenRows(namedPid: number, endpoint: string): UnixListenRow[] {
	let table: string;
	try {
		table = fs.readFileSync(`/proc/${namedPid}/net/unix`, "utf8");
	} catch (error) {
		throw failureFrom(error, `unix socket table of pid ${namedPid}`);
	}
	try {
		return listenRowsAt(table, endpoint);
	} catch (error) {
		throw new ObservationFailure("table-malformed", error instanceof Error ? error.message : String(error));
	}
}

function holdingFds(pid: number, target: string): number[] {
	const dir = `/proc/${pid}/fd`;
	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch (error) {
		throw failureFrom(error, `fd list of pid ${pid}`);
	}
	const held: number[] = [];
	for (const entry of entries) {
		let link: string;
		try {
			link = fs.readlinkSync(`${dir}/${entry}`);
		} catch (error) {
			throw failureFrom(error, `fd ${entry} of pid ${pid}`);
		}
		if (link === target) held.push(Number(entry));
	}
	return held;
}

function childPids(pid: number): number[] {
	let tids: string[];
	try {
		tids = fs.readdirSync(`/proc/${pid}/task`);
	} catch (error) {
		throw failureFrom(error, `task list of pid ${pid}`);
	}
	const children: number[] = [];
	for (const tid of tids) {
		const file = `/proc/${pid}/task/${tid}/children`;
		let text: string;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch (error) {
			// The task still being there while its children list is not means this kernel does not
			// expose one, which is unreadable rather than a process that moved.
			if ((error as NodeJS.ErrnoException).code === "ENOENT" && fs.existsSync(`/proc/${pid}/task/${tid}`)) {
				throw new ObservationFailure("subtree-unreadable", `${file}: this kernel exposes no children list`);
			}
			throw failureFrom(error, file);
		}
		for (const token of text.trim().split(/\s+/)) if (token !== "") children.push(Number(token));
	}
	return children;
}

function statOrNull(pid: number): ProcStat | null {
	try {
		return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		// Bounded probe: a pid that is gone answers null, and the judge reads null as moved.
		return null;
	}
}

/**
 * @param namedStartTime the named pid's start time as the caller read it BEFORE its own identity
 *   checks (uid, argv, environment), so this observation is bound to the process those checks read.
 */
export function observeCodexSocketSubtree(
	namedPid: number,
	endpoint: string,
	namedStartTime: string,
): CodexSocketObservation {
	const base = { namedPid, namedStartTime, endpoint };
	let rows: UnixListenRow[] = [];
	try {
		rows = readListenRows(namedPid, endpoint);
		if (rows.length !== 1) return { ...base, rows, rowsAfter: rows, nodes: [], failure: null };
		const target = `socket:[${(rows[0] as UnixListenRow).inode}]`;
		const visited: Array<Omit<SubtreeNode, "after">> = [];
		const queue: Array<{ pid: number; parent: number | null }> = [{ pid: namedPid, parent: null }];
		while (queue.length > 0) {
			const next = queue.shift() as { pid: number; parent: number | null };
			if (visited.length >= SUBTREE_LIMIT) {
				throw new ObservationFailure(
					"subtree-too-large",
					`pid ${namedPid}'s subtree exceeds ${SUBTREE_LIMIT} processes`,
				);
			}
			const stat = readStat(next.pid);
			if (next.parent !== null && stat.ppid !== next.parent) {
				throw new ObservationFailure(
					"subtree-changed",
					`pid ${next.pid} was listed as a child of ${next.parent} but its stat names parent ${stat.ppid}`,
				);
			}
			const fds = holdingFds(next.pid, target);
			for (const child of childPids(next.pid)) queue.push({ pid: child, parent: next.pid });
			visited.push({ pid: next.pid, ppid: stat.ppid, comm: stat.comm, startTime: stat.startTime, holdingFds: fds });
		}
		// The second read is bounded to what the first one found: every walked node's stat, and the
		// fds of the nodes that held the inode. The table is read last, after both.
		const nodes: SubtreeNode[] = visited.map((node) => {
			const stat = statOrNull(node.pid);
			if (stat === null) return { ...node, after: null };
			const held = node.holdingFds.length > 0 ? holdingFds(node.pid, target) : null;
			return { ...node, after: { ppid: stat.ppid, startTime: stat.startTime, holdingFds: held } };
		});
		const rowsAfter = readListenRows(namedPid, endpoint);
		return { ...base, rows, rowsAfter, nodes, failure: null };
	} catch (error) {
		// Every read above converts its own failure. Anything else is a defect here, not a
		// fact about the subtree, and crashes instead of becoming a verdict.
		if (!(error instanceof ObservationFailure)) throw error;
		return { ...base, rows, rowsAfter: [], nodes: [], failure: { reason: error.reason, detail: error.message } };
	}
}
