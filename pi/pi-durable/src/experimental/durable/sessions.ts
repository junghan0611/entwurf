import { createHash, randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../../config.ts";

/** One session directory holding `session.sqlite`, locked by this process. */
export interface SessionLocation {
	id: string;
	directory: string;
	database: string;
	cwd: string;
	created: boolean;
	release(): Promise<void>;
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

const SESSION_NAME = /^\d{13}-[0-9a-f-]{36}$/u;

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
		if (!entry.isDirectory() || !SESSION_NAME.test(entry.name)) continue;
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

/** A new session for `cwd`, its newest one with `continueSession`, or the existing one named by `sessionId`. */
export async function selectSession(
	cwdInput: string,
	continueSession: boolean,
	sessionId?: string,
): Promise<SessionLocation> {
	const { cwd, root } = await sessionRoot(cwdInput);
	await mkdir(root, { recursive: true });

	let directory: string;
	let created = false;
	if (sessionId !== undefined) {
		const chosen = SESSION_NAME.test(sessionId) ? join(root, sessionId) : undefined;
		if (chosen === undefined || !(await statIfPresent(chosen))?.isDirectory()) {
			throw new Error(`No durable session ${sessionId} exists for ${cwd}`);
		}
		directory = chosen;
	} else if (continueSession) {
		const entries = await readdir(root, { withFileTypes: true });
		const newest = entries
			.filter((entry) => entry.isDirectory() && SESSION_NAME.test(entry.name))
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

	let release: () => Promise<void>;
	try {
		// A lock left by a crashed process goes stale after 10 s; wait that long before giving up.
		release = await lockfile.lock(directory, {
			realpath: false,
			retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
		});
	} catch (error) {
		throw new Error(`Session is already open in another process: ${directory}`, { cause: error });
	}
	return { id: basename(directory), directory, database: join(directory, "session.sqlite"), cwd, created, release };
}
