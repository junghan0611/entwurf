// The stored agy session U26 resumes (#171 step 7). NOT a gate. Pure file work, no spawning; kept out
// of continuity.mjs so it can be checked offline against a stored run.
//
// Identity, nonce and versions come from the stored run's own wire logs: the session id from the
// session/new answer, the planted word from the prompt that planted it (never from what the agent
// answered), the agent version from the initialize answer, and the cwd the session was created with.
// The session id read from the wire must be a UUID before it names a path; a wire log that is a symlink
// is refused before it is read. Only named session-store entries are copied. The validation is anchored
// at the RESOLVED stored-run directory: every path component from there down (home, .pi, agent, the
// overlay, each ancestor of an entry, the entry itself) is lstat()ed before anything below it is opened,
// so a symlink anywhere on the way is refused rather than followed. Only regular files and directories
// this user owns. Everything else in the stored overlay (its token link, config, caches, logs) is never
// opened.
import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

const PLANT = /Remember this word: '?([A-Z]+-[0-9A-Z]+)'?/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ndjson(path) {
	if (!lstatSync(path).isFile()) throw new Error(`U26 stored wire log is not a regular file: ${path}`);
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

/** Session id, planted word, agent version and creation cwd of the child that built the stored session. */
export function readStoredAgySession(runDir) {
	for (const name of readdirSync(runDir)
		.filter((f) => f.endsWith(".wire-out.ndjson"))
		.sort()) {
		const out = ndjson(join(runDir, name));
		const created = out.find((m) => m.method === "session/new");
		if (!created) continue;
		const input = ndjson(join(runDir, name.replace(".wire-out.", ".wire-in.")));
		const answer = (id) => input.find((m) => m.id === id && m.method === undefined);
		const wireId = answer(created.id)?.result?.sessionId;
		// Not a UUID: it names no path here, and the run is reported as naming no session.
		const sessionId = typeof wireId === "string" && UUID.test(wireId) ? wireId : undefined;
		const planted = out
			.filter((m) => m.method === "session/prompt" && m.params?.sessionId === sessionId)
			.map((m) => PLANT.exec((m.params.prompt ?? []).map((b) => b.text ?? "").join(""))?.[1])
			.find(Boolean);
		const init = out.find((m) => m.method === "initialize");
		return {
			child: name.replace(".wire-out.ndjson", ""),
			sessionId: sessionId ?? null,
			planted: planted ?? null,
			version: answer(init?.id)?.result?.agentInfo?.version ?? null,
			agentName: answer(init?.id)?.result?.agentInfo?.name ?? null,
			cwd: created.params?.cwd ?? null,
		};
	}
	return null;
}

/** The session-store entries of one agy conversation, relative to the overlay root. */
export const agySessionEntries = (sessionId) => {
	if (!UUID.test(String(sessionId))) throw new Error(`U26: not a session id: ${JSON.stringify(sessionId)}`);
	return [
		`antigravity-cli/conversations/${sessionId}.db`,
		`antigravity-cli/annotations/${sessionId}.pbtxt`,
		`antigravity-cli/brain/${sessionId}`,
		"antigravity-cli/conversation_summaries.db",
	];
};

/** A relative path that stays below its anchor, as its components. */
function components(rel) {
	if (isAbsolute(rel) || normalize(rel).split(sep).includes("..")) throw new Error(`U26 path leaves the store: ${rel}`);
	return normalize(rel).split(sep);
}

/**
 * Copy the named entries of the stored run's overlay `overlayRel` into `toOverlay`. The anchor is the
 * resolved `runDir` (realpath): from it, every component of `overlayRel` and of each entry's ancestors
 * must be a real directory this user owns, and each entry itself is walked with lstat (a symlink, a
 * non-regular file or a foreign owner throws). All of it is checked before the first byte is copied.
 * Destination files are created exclusively. Returns the copied files, relative to the overlay root.
 */
export function copySessionState(runDir, overlayRel, toOverlay, entries) {
	const uid = process.getuid();
	const anchor = realpathSync(runDir);
	const realDir = (rel) => {
		const s = lstatSync(join(anchor, rel));
		if (s.isSymbolicLink() || !s.isDirectory() || s.uid !== uid)
			throw new Error(`U26 source path is not a real directory you own: ${rel || "."}`);
	};
	realDir("");
	const base = components(overlayRel);
	for (let i = 1; i <= base.length; i++) realDir(base.slice(0, i).join(sep));
	const fromOverlay = join(anchor, ...base);
	const plan = [];
	const visit = (rel) => {
		const s = lstatSync(join(fromOverlay, rel));
		if (s.isSymbolicLink()) throw new Error(`U26 source has a symlink: ${rel}`);
		if (s.uid !== uid) throw new Error(`U26 source entry is not yours: ${rel}`);
		if (s.isDirectory()) for (const e of readdirSync(join(fromOverlay, rel)).sort()) visit(join(rel, e));
		else if (s.isFile()) plan.push(rel);
		else throw new Error(`U26 source entry is not a regular file: ${rel}`);
	};
	for (const rel of entries) {
		const parts = components(rel);
		for (let i = 1; i < parts.length; i++) realDir(join(...base, parts.slice(0, i).join(sep)));
		visit(rel);
	}
	for (const rel of plan) {
		mkdirSync(dirname(join(toOverlay, rel)), { recursive: true });
		copyFileSync(join(fromOverlay, rel), join(toOverlay, rel), constants.COPYFILE_EXCL);
	}
	return plan;
}
