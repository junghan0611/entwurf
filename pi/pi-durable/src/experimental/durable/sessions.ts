import { createHash, randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../../config.ts";
import { isSessionName } from "./session-name.ts";

/**
 * An owner's end as the opener observed it (#157 B3): the storage outcome of the first actual close, and the
 * lease outcome of its release.
 */
export interface FenceEnd {
	readonly storage: "closed" | "never-opened" | "failed" | "unknown";
	readonly lease: "never-held" | "released" | "failed" | "unknown";
	readonly envCleanup?: "failed";
	readonly cause?: string;
}

/** One admitted owner of a session directory, from before its native lease through its end. */
export interface FenceTicket {
	/** Set immediately before the storage open is called; an end that says `never-opened` needs it unset. */
	storageOpenAttempted: boolean;
	/** The native lease was acquired. */
	leased(): Promise<void>;
	/** The storage open and the Harness open both resolved. */
	storageOpened(): Promise<void>;
	closed(end: FenceEnd): Promise<void>;
	closeFailed(end: FenceEnd): Promise<void>;
	/** The native lease was not acquired: nothing was opened and no lease was observed. */
	endUnleased(): Promise<void>;
}

/** What an owned open hands the fence once its directory is chosen, before its native lease. */
export interface FenceAdmission {
	/** The directory exactly as selected; its lease is `${directory}.lock`. */
	readonly directory: string;
	/** The session id the directory was selected by. */
	readonly selectedN: string;
	/** This call's own `mkdir` created the directory. */
	readonly created: boolean;
}

/**
 * The owner fence every owned open takes before its native lease (#157 B3). Supplied by the host, never imported
 * here; it admits this opener or refuses, and a refusal opens nothing.
 */
export interface SessionFence {
	admit(request: FenceAdmission): Promise<FenceTicket>;
}

/** One session directory holding `session.sqlite`, locked by this process. */
export interface SessionLocation {
	id: string;
	directory: string;
	database: string;
	cwd: string;
	created: boolean;
	release(): Promise<void>;
	/** The fence's admission of this owner, admitted before the lease. */
	ticket: FenceTicket;
}

/** One session of a directory as its files show it (#143): nothing in it is opened. */
export interface SessionEntry {
	id: string;
	directory: string;
	/** From the id's millisecond prefix. */
	createdAt: number;
	/** The newest modification of `session.sqlite` or its WAL; absent when neither exists. */
	lastWriteAt?: number;
	/** Another process holds the session's lock. */
	openElsewhere: boolean;
}

/** A path's stat, or undefined when nothing is there; any other failure is thrown, never read as absence. */
async function statIfPresent(path: string): Promise<Stats | undefined> {
	try {
		return await stat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function sessionRoot(cwdInput: string): Promise<{ cwd: string; root: string }> {
	const cwd = await realpath(resolve(cwdInput));
	const root = join(
		getAgentDir(),
		"experimental",
		"durable-sessions",
		createHash("sha256").update(cwd).digest("hex").slice(0, 24),
	);
	return { cwd, root };
}

/** The sessions of `cwd`, most recently written first. Reads names, file times and locks; creates nothing. */
export async function listSessions(cwdInput: string): Promise<SessionEntry[]> {
	const { root } = await sessionRoot(cwdInput);
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const sessions: SessionEntry[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !isSessionName(entry.name)) continue;
		const directory = join(root, entry.name);
		let lastWriteAt: number | undefined;
		for (const file of ["session.sqlite", "session.sqlite-wal"]) {
			const mtime = (await statIfPresent(join(directory, file)))?.mtimeMs;
			if (mtime !== undefined && (lastWriteAt === undefined || mtime > lastWriteAt)) lastWriteAt = mtime;
		}
		sessions.push({
			id: entry.name,
			directory,
			createdAt: Number(entry.name.slice(0, 13)),
			...(lastWriteAt === undefined ? {} : { lastWriteAt }),
			openElsewhere: await lockfile.check(directory, { realpath: false }),
		});
	}
	return sessions.sort((a, b) => (b.lastWriteAt ?? b.createdAt) - (a.lastWriteAt ?? a.createdAt));
}

/**
 * A new session for `cwd`, its newest one with `continueSession`, or the existing one named by `sessionId`, admitted
 * by `fence` before its native lease is taken.
 */
export async function selectSession(
	fence: SessionFence,
	cwdInput: string,
	continueSession: boolean,
	sessionId?: string,
): Promise<SessionLocation> {
	const { cwd, root } = await sessionRoot(cwdInput);
	await mkdir(root, { recursive: true });

	let directory: string;
	let created = false;
	if (sessionId !== undefined) {
		const chosen = isSessionName(sessionId) ? join(root, sessionId) : undefined;
		if (chosen === undefined || !(await statIfPresent(chosen))?.isDirectory()) {
			throw new Error(`No durable session ${sessionId} exists for ${cwd}`);
		}
		directory = chosen;
	} else if (continueSession) {
		const entries = await readdir(root, { withFileTypes: true });
		const newest = entries
			.filter((entry) => entry.isDirectory() && isSessionName(entry.name))
			.map((entry) => entry.name)
			.sort()
			.at(-1);
		if (!newest) throw new Error(`No durable session exists for ${cwd}`);
		directory = join(root, newest);
	} else {
		directory = join(root, `${String(Date.now()).padStart(13, "0")}-${randomUUID()}`);
		await mkdir(directory);
		created = true;
	}

	// The owner fence admits this opener BEFORE the native lease, or refuses with nothing taken (#157 B3).
	const ticket = await fence.admit({ directory, selectedN: basename(directory), created });
	// A lock left by a crashed process goes stale after 10 s; wait that long before giving up.
	const lease = lockfile.lock(directory, {
		realpath: false,
		retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
	});
	const release = await lease.catch(async (error) => {
		const refused = new Error(`Session is already open in another process: ${directory}`, { cause: error });
		// No acquisition was observed: this owner ends with nothing opened and no lease held.
		await ticket.endUnleased().catch((fenceError) => {
			throw new AggregateError([refused, fenceError], `${refused.message}; its owner end was not recorded`);
		});
		throw refused;
	});
	// Apart from the lease's own failure: the lease IS held here, so a failed checkpoint is never recorded as an
	// acquire failure. The open fails and releases the lease; the claim stays fenced under this live owner.
	await ticket.leased().catch(async (error) => {
		await release().catch((releaseError) => {
			throw new AggregateError([error, releaseError], `lease checkpoint and release both failed: ${directory}`);
		});
		throw error;
	});
	return {
		id: basename(directory),
		directory,
		database: join(directory, "session.sqlite"),
		cwd,
		created,
		release,
		ticket,
	};
}
