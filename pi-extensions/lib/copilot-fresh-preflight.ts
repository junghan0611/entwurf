/**
 * copilot-fresh-preflight — the pre-mutation capability check a Copilot fresh call needs
 * (#82 RAIL 9, `docs/adding-a-harness.md` step 9 clauses 3 and 4).
 *
 * ── Why this is a leaf and not a doctor ──
 *
 * A doctor answers "is this host correctly wired?" and is allowed to be slow, to spawn the
 * vendor CLI, and to read live processes. This is not that. It answers ONE narrower question
 * at ONE moment: *before* `mux-fresh-call` mutates the operator's tmux session, are the four
 * things the fresh contract requires actually in place on this filesystem?
 *
 *   birth            — without the birth plugin the session mints no record, so the callback
 *                      would carry no garden id and the sibling never becomes addressable.
 *   MCP hand         — without the bridge server the callback tool does not exist in that
 *                      session, and the first turn has nothing to call.
 *   receive          — without the receiver unit the sibling can be launched and can call
 *                      home, and then nothing can ever be delivered TO it.
 *   visible identity — without the custom footer the citizen has a garden id nobody can see,
 *                      which step 4 refuses to call lifecycle parity.
 *
 * ── Ordering is the whole point ──
 *
 * `scripts/copilot-launch.sh` already fails closed on the receiver, and that check is kept as
 * it is: it guards every manual `entwurf copilot`, whose accepted contract stays receive-only.
 * But a launcher runs INSIDE the window tmux just made, so its refusal leaves a dead window
 * behind and the caller reads a launch receipt for a sibling that never was. `mux-fresh-call`'s
 * rule is that nothing above the single mutation may leave a window behind, so the fresh lane
 * decides the same facts one layer earlier. The overlap on the receiver axis is deliberate and
 * each side names the other; the other three axes are the FRESH lane's requirement only.
 *
 * ── What this deliberately does NOT claim ──
 *
 * Ownership/configuration truth only: entwurf's units are installed and the settings the
 * vendor will read say what they must say. It does NOT prove the Copilot CLI loaded the
 * plugin, connected the MCP server, scanned the extension, or rendered a garden id in its
 * footer — that is runtime truth, and it belongs to `doctor-copilot-*` (which may spawn the
 * vendor) and to the step 9 clause 7 LIVE receipt. A green preflight is a statement about this
 * filesystem, not a prediction about the next process.
 *
 * Every predicate below MIRRORS the shipped adapter that owns that file, deliberately
 * including its environment seams — a preflight that resolved a path its own installer never
 * writes would refuse a correctly installed host and send the operator hunting.
 *
 * No vendor spawn, no network, no await, no mutation.
 */

import { accessSync, constants, existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

/** One reason per capability. These strings are stable contract — they cross the public
 * surfaces as `entwurf_fresh_call` refusals, so a caller can act on them. */
export type CopilotPreflightRejectReason =
	| "copilot-birth-unit-missing"
	| "copilot-mcp-hand-missing"
	| "copilot-receive-unit-missing"
	| "copilot-visible-identity-missing";

const BIRTH_PLUGIN = "entwurf-meta-receive-copilot";
const RECEIVE_UNIT = "entwurf-receive";
const MCP_SERVER_KEY = "entwurf-bridge";
/** Same default and same env seam as `scripts/copilot-statusline-bridge.sh`. */
const DEFAULT_STATUSLINE_COMMAND = "entwurf-copilot-statusline";

function dataHome(env: NodeJS.ProcessEnv): string | null {
	const xdg = env.XDG_DATA_HOME;
	if (typeof xdg === "string" && xdg.length > 0) return xdg;
	const home = env.HOME;
	if (typeof home === "string" && home.length > 0) return path.join(home, ".local", "share");
	return null;
}

/** A JSON object or nothing. Failure to read, parse, or find an object is the SAME answer
 * here — absent — because the caller's next move is identical in all of them: run the
 * installer. Telling a corrupt state file apart from a missing one is the doctor's job. */
function readJsonObject(file: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		// Bounded environment probing, Hard Rule 15's stated exception.
		return null;
	}
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isSymlink(p: string): boolean {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Same DEST the managed launcher will arm from (`scripts/copilot-launch.sh`).
 * `COPILOT_EXTENSIONS_DIR` wins; otherwise `$HOME/.copilot/extensions/<unit>`.
 * String equality, not realpath: the launcher compares with `[ = ]`. */
function receiveDest(env: NodeJS.ProcessEnv): string | null {
	const override = env.COPILOT_EXTENSIONS_DIR;
	if (typeof override === "string" && override.length > 0) {
		return path.join(override, RECEIVE_UNIT);
	}
	const home = env.HOME;
	if (typeof home !== "string" || home.length === 0) return null;
	return path.join(home, ".copilot", "extensions", RECEIVE_UNIT);
}

function isExecutableFile(p: string): boolean {
	try {
		// `X_OK` for THIS user, which is what `command -v` answers and what Copilot will need.
		// A mode-bit test would call a root-owned 0700 binary executable for everyone.
		accessSync(p, constants.X_OK);
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * The statusline command as the shipped adapter resolves it: a value containing a separator is
 * a path and must be executable; a bare name is looked up on PATH. This is a small local
 * search rather than `mux-launch`'s resolver because the import fence keeps `mux-launch` to
 * exactly two importers — a third would be a decision, and this leaf does not need one.
 */
function commandResolvable(command: string, env: NodeJS.ProcessEnv): boolean {
	if (command.includes("/")) return isExecutableFile(command);
	const raw = env.PATH;
	if (typeof raw !== "string" || raw.length === 0) return false;
	for (const dir of raw.split(path.delimiter)) {
		if (dir.length === 0) continue;
		if (isExecutableFile(path.join(dir, command))) return true;
	}
	return false;
}

/**
 * The visible-identity axis, step 9 clause 4. The subject is the EFFECTIVE settings the vendor
 * will read, not entwurf's ownership record: a host can carry a correct footer configuration
 * with no install-state (measured on the acceptance host, 2026-08-24 — `doctor-copilot-statusline`
 * reported `settings: configured (resolvable)` / `state: absent` / rc=0), and refusing that host
 * would be refusing a working visible identity because of a missing receipt.
 *
 * The install-state, when present, is checked for the ONE thing it can still contradict: that
 * it manages the very file Copilot reads. A state pointing somewhere else means two settings
 * files disagree about who owns the footer, and which one wins is not decidable from here.
 */
function visibleIdentityMissing(env: NodeJS.ProcessEnv, data: string): boolean {
	const command = env.COPILOT_STATUSLINE_COMMAND || DEFAULT_STATUSLINE_COMMAND;
	const configured = env.COPILOT_SETTINGS_CONFIG;
	let settingsPath: string;
	if (typeof configured === "string" && configured.length > 0) {
		settingsPath = configured;
	} else {
		const home = env.HOME;
		if (typeof home !== "string" || home.length === 0) return true;
		settingsPath = path.join(home, ".copilot", "settings.json");
	}
	// A symlinked settings file is somebody else's SSOT; the adapter refuses to touch it and
	// this refuses to certify it.
	if (isSymlink(settingsPath)) return true;
	const settings = readJsonObject(settingsPath);
	if (settings === null) return true;
	const statusLine = settings.statusLine;
	if (typeof statusLine !== "object" || statusLine === null || Array.isArray(statusLine)) return true;
	if ((statusLine as Record<string, unknown>).command !== command) return true;
	const footer = settings.footer;
	if (typeof footer !== "object" || footer === null || Array.isArray(footer)) return true;
	// `showCustom` must be exactly true. A truthy string would render nothing.
	if ((footer as Record<string, unknown>).showCustom !== true) return true;
	if (!commandResolvable(command, env)) return true;

	const state = readJsonObject(path.join(data, "entwurf", "copilot-statusline", "install-state.json"));
	if (state === null) return false; // absent state is not drift — see the doc comment above
	const managed = state.managedSettingsPath;
	if (typeof managed !== "string" || !path.isAbsolute(managed)) return true;
	return path.resolve(managed) !== path.resolve(settingsPath);
}

/**
 * Answer for ONE fresh Copilot launch. `null` means every required capability is in place on
 * this filesystem; anything else is the first missing one, in the order the fresh contract
 * consumes them: be born, hold the hand, be reachable, be visible.
 */
export function copilotFreshPreflight(env: NodeJS.ProcessEnv = process.env): CopilotPreflightRejectReason | null {
	const data = dataHome(env);
	// With no HOME and no XDG_DATA_HOME there is no place any of these could be installed.
	// Report the FIRST capability rather than inventing a fifth reason for "no home".
	if (data === null) return "copilot-birth-unit-missing";

	// 1. Birth. The assembly is what the installer bakes and what the birth doctor certifies
	// statically; `hooks.json` is what makes it a hook unit rather than a directory. There is
	// no install-state for this unit — the artifact IS its ownership record.
	const birthUnit = path.join(data, "entwurf", "meta-bridge-copilot", ".assembled", BIRTH_PLUGIN);
	if (!isDir(birthUnit) || !existsSync(path.join(birthUnit, "hooks", "hooks.json"))) {
		return "copilot-birth-unit-missing";
	}

	// 2. MCP hand. The install-state names the config it owns, so the config path is READ from
	// ownership truth rather than re-derived — a preflight that guessed would refuse a
	// correctly installed host whose config lives somewhere else.
	const mcpState = readJsonObject(path.join(data, "entwurf", "copilot-mcp", "install-state.json"));
	if (mcpState === null || mcpState.serverKey !== MCP_SERVER_KEY) return "copilot-mcp-hand-missing";
	const managedConfigPath = mcpState.managedConfigPath;
	if (typeof managedConfigPath !== "string" || !path.isAbsolute(managedConfigPath)) return "copilot-mcp-hand-missing";
	const servers = readJsonObject(managedConfigPath)?.mcpServers;
	if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return "copilot-mcp-hand-missing";
	// The state can be current while the config drifted (hand-edited, restored from a backup,
	// replaced by another tool). The server key present in the file the CLI actually reads is
	// the fact the first turn depends on.
	if (!Object.hasOwn(servers as Record<string, unknown>, MCP_SERVER_KEY)) return "copilot-mcp-hand-missing";

	// 3. Receive. The same facts `scripts/copilot-launch.sh` checks — unit name, recorded
	// path, DEST equality against this env's extensions root, then the entry file.
	const recvState = readJsonObject(path.join(data, "entwurf", "copilot-receive", "install-state.json"));
	if (recvState === null || recvState.unit !== RECEIVE_UNIT) return "copilot-receive-unit-missing";
	const recvPath = recvState.path;
	if (typeof recvPath !== "string" || !path.isAbsolute(recvPath)) return "copilot-receive-unit-missing";
	// Mirror the launcher's path-mismatch predicate PRE-MUTATION. A state that names a
	// real unit in a different extensions root than this env will scan still opens a
	// window today if we only check that the files exist — then `entwurf copilot`
	// refuses inside it and the caller holds a launch receipt for a dead sibling.
	const dest = receiveDest(env);
	if (dest === null || recvPath !== dest) return "copilot-receive-unit-missing";
	if (!isDir(recvPath) || !existsSync(path.join(recvPath, "extension.mjs"))) return "copilot-receive-unit-missing";

	// 4. Visible identity.
	if (visibleIdentityMissing(env, data)) return "copilot-visible-identity-missing";

	return null;
}

/** Repair text, one line per reason. A reason a caller cannot act on is a reason they will
 * guess about — each names the exact command that installs the missing capability. */
export const COPILOT_PREFLIGHT_HINT: Record<CopilotPreflightRejectReason, string> = {
	"copilot-birth-unit-missing":
		"the Copilot BIRTH plugin is not installed here, so the sibling would mint no record and its callback would carry no garden id — run: entwurf install-copilot-bridge",
	"copilot-mcp-hand-missing":
		"the entwurf-bridge MCP server is not registered in the Copilot config this host owns, so the callback tool would not exist in that session — run: entwurf install-copilot-mcp",
	"copilot-receive-unit-missing":
		"the Copilot RECEIVER extension is not installed here, so the sibling could call home but nothing could ever be delivered to it — run: entwurf install-copilot-receive",
	"copilot-visible-identity-missing":
		"Copilot's custom footer is not configured to entwurf's resolvable statusline command (or an install-state manages a different settings file), so the sibling's garden id would be visible nowhere — run: entwurf doctor-copilot-statusline, then entwurf install-copilot-statusline",
};
