// Shared configuration for the raw ACP session probes beside this file (#171). NOT a gate; in no
// check tier. Imported FIRST by every probe, so its refusals run before any child is spawned.
//
// Nothing here names a user or a host path. The launcher (run.sh) resolves the operator's real
// directories BEFORE it clears the environment and passes them in:
//   ENTWURF_RAW_CLAUDE_DIR  real Claude config dir  (default "$HOME/.claude", as production)
//   ENTWURF_RAW_GEMINI_DIR  real Gemini dir for agy (default "$HOME/.gemini", as production)
//   ENTWURF_AGY_BIN         agy executable          (default: `agy` on PATH)
// Those directories are only the symlink SOURCES the production overlay functions link to. No file
// inside them is opened here: the two credential paths below are stat()ed for their mtime only, so a
// run can show whether a vendor refreshed a token through the overlay link.
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	ftruncateSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// The compiled bridge dist (gitignored; build it from the HEAD you measure).
export const D = join(REPO, "mcp/entwurf-bridge/dist/pi-extensions/lib/acp");

const inside = (child, parent) => {
	const r = relative(resolve(parent), resolve(child));
	return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
function refuse(message) {
	console.error(`[raw-acp-session] ${message}`);
	process.exit(2);
}

if (process.env.LIVE !== "1") refuse("set LIVE=1 to drive real vendor ACP agents (spends subscription turns).");

export const RUN = process.argv[2];
if (!RUN || !isAbsolute(RUN)) refuse("argv[2] must be the absolute run directory (use run.sh).");
if (inside(RUN, REPO)) refuse(`the run directory must be outside the repository: ${RUN}`);
// Hard Rule 12: the operator's HOME and XDG roots must already be replaced by the sandbox.
for (const name of [
	"HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
	"PI_CODING_AGENT_DIR",
]) {
	const value = process.env[name];
	if (!value || !inside(value, RUN)) refuse(`${name} must point inside the run directory: ${value ?? "<unset>"}`);
}

function realDir(name) {
	const value = process.env[name];
	if (!value || !isAbsolute(value)) refuse(`${name} must be an absolute path (run.sh sets it).`);
	if (inside(value, RUN)) refuse(`${name} must name the operator's directory, not one inside the run: ${value}`);
	return value;
}
export const REAL_CLAUDE = realDir("ENTWURF_RAW_CLAUDE_DIR");
export const REAL_GEMINI = realDir("ENTWURF_RAW_GEMINI_DIR");

// stat (mtime) only — never opened, read or copied.
export const TOKEN = join(REAL_GEMINI, "antigravity-cli/antigravity-oauth-token");
export const CLAUDE_CRED = join(REAL_CLAUDE, ".credentials.json");
export const mt = (p) => {
	try {
		return statSync(p).mtime.toISOString();
	} catch (e) {
		return `stat-failed:${e.code}`;
	}
};

// Step 7: claude-agent-acp from a prefix OUTSIDE the repository, so a version can be measured before
// the pin moves. run.sh passes ENTWURF_RAW_CLAUDE_ACP_PREFIX; unset keeps the repository's pinned package.
// The launcher resolves the vendor package relative to its own file, so a copy of it is placed at the
// prefix root (a symlink would resolve back into the repository).
const CLAUDE_ACP_PREFIX = (() => {
	const value = process.env.ENTWURF_RAW_CLAUDE_ACP_PREFIX;
	if (!value) return undefined;
	if (!isAbsolute(value)) refuse(`ENTWURF_RAW_CLAUDE_ACP_PREFIX must be absolute: ${value}`);
	if (inside(value, REPO)) refuse(`ENTWURF_RAW_CLAUDE_ACP_PREFIX must lie outside the repository: ${value}`);
	if (!existsSync(join(value, "node_modules/@agentclientprotocol/claude-agent-acp/package.json")))
		refuse(`no @agentclientprotocol/claude-agent-acp under ${value}/node_modules`);
	return value;
})();

/**
 * The write boundary. Probe writes stay in the run directory, plus the launcher copy in the prefix root
 * (writePrefixLauncher). The vendor's own writes through the overlay links reach the operator's real
 * directories, and are recorded by mtime; nothing here contains them. The production overlays link
 * Claude's .credentials.json, cache, debug, session-env, shell-snapshots, skills, stats-cache.json,
 * statsig and telemetry (overlay.ts OVERLAY_PASSTHROUGH) and agy's OAuth token.
 *
 * This stat()s the TARGET of every such link (never opens it) and keys it by overlay and link name, so a
 * run can say which link targets changed. A directory's mtime moves only when an entry directly inside
 * it is added, removed or renamed: a lower bound on the vendor's writes, not a record of all of them.
 */
export function linkTargetMtimes(overlays) {
	const out = {};
	for (const [label, dir] of Object.entries(overlays)) {
		const walk = (d) => {
			if (!existsSync(d)) return;
			for (const e of readdirSync(d)) {
				const p = join(d, e);
				const s = lstatSync(p);
				if (s.isDirectory()) walk(p);
				else if (s.isSymbolicLink()) {
					const target = resolve(dirname(p), readlinkSync(p));
					if (inside(target, RUN)) continue;
					out[`${label}:${p.slice(dir.length + 1)}`] = mt(target);
				}
			}
		};
		walk(dir);
	}
	return out;
}

/** The Claude launch argument a probe should use: the prefix copy when a prefix is set, else as before. */
export function claudeLauncherArg(arg, src) {
	if (!arg.endsWith("/claude-acp-launch.js")) return arg;
	if (!CLAUDE_ACP_PREFIX) return existsSync(arg) ? arg : src;
	return writePrefixLauncher(src);
}

/**
 * The launcher copy: besides the run directory, the one place a probe itself writes (the vendor's own
 * writes through the overlay links are another matter; see linkTargetMtimes). The prefix root must be a
 * directory this user owns, and the copy is opened with O_NOFOLLOW: an existing symlink, or a file this user does not
 * own or that is not a regular file, is refused before a byte is written.
 */
function writePrefixLauncher(src) {
	const uid = process.getuid();
	const root = lstatSync(CLAUDE_ACP_PREFIX);
	if (!root.isDirectory() || root.uid !== uid)
		refuse(`the prefix root must be a directory you own: ${CLAUDE_ACP_PREFIX}`);
	const copy = join(CLAUDE_ACP_PREFIX, "claude-acp-launch.js");
	let fd;
	try {
		fd = openSync(copy, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
	} catch (e) {
		refuse(`cannot write the launcher copy (${e.code}; a symlink is refused): ${copy}`);
	}
	try {
		const st = fstatSync(fd);
		if (!st.isFile() || st.uid !== uid) refuse(`the launcher copy must be a regular file you own: ${copy}`);
		const bytes = readFileSync(src);
		ftruncateSync(fd, 0);
		writeSync(fd, bytes, 0, bytes.length, 0);
	} finally {
		closeSync(fd);
	}
	return copy;
}

export function agyBin() {
	const value = process.env.ENTWURF_AGY_BIN;
	if (!value || !isAbsolute(value))
		throw new Error("agy not found: put it on PATH or set ENTWURF_AGY_BIN before run.sh");
	return value;
}
