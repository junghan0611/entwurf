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
import { statSync } from "node:fs";
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

export function agyBin() {
	const value = process.env.ENTWURF_AGY_BIN;
	if (!value || !isAbsolute(value))
		throw new Error("agy not found: put it on PATH or set ENTWURF_AGY_BIN before run.sh");
	return value;
}
